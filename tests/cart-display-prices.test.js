const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {cartDisplayPrices,resolveCartDisplayPrices,registerCartDisplayPrices,quoteItems}=require('../lib/checkout-prices');
const products=[{id:64,sku:'TILE-sensu',name:'Sensu Tile',price:6000,priceUsd:380,soldOutEn:true,soldOutEs:true},
  {id:73,sku:'BAG-tilelila',name:'Lilac Tile Case',price:1200,priceUsd:70,soldOutEn:false,soldOutEs:false}];
const legacy=[{id:64,sku:'TILE-SENSU',name:'Sensu Tile',price:6000,qty:1},{id:73,sku:'BAG-TILELILA',name:'Lilac Tile Case',price:1200,qty:1}];
test('sold-out Sensu does not erase its USD380 or the case USD70; payment quotes still reject it',()=>{
  const displayed=cartDisplayPrices(products,legacy,'USD');
  assert.equal(displayed.reduce((n,p)=>n+p.price_usd*p.qty,0),450);
  assert.deepEqual(displayed.map(p=>p.cart_status),['sold_out','available']);
  assert.throws(()=>quoteItems(products,legacy,'USD'),/sold out/);
  assert.equal(cartDisplayPrices(products,legacy,'MXN').reduce((n,p)=>n+p.price*p.qty,0),7200);
});
test('missing products and USD prices stay unknown rather than becoming zero or converted MXN',()=>{
  const missing=cartDisplayPrices([{...products[1],priceUsd:null}],legacy,'USD');
  assert.deepEqual(missing.map(p=>p.cart_status),['unavailable','price_unavailable']);
  assert.deepEqual(missing.map(p=>p.price_usd),[null,null]);
  assert.equal(missing[1].price,1200);
  for(const items of [[],[{...legacy[0],qty:0}],[{...legacy[0],qty:1.5}]])assert.throws(()=>cartDisplayPrices(products,items,'USD'));
});
test('display endpoint reads products and bundles without creating any payment or order',async()=>{
  const routes={},requests=[];
  registerCartDisplayPrices({post:(path,fn)=>routes[path]=fn},'https://catalog.test',async url=>{
    requests.push(url);return {ok:true,json:async()=>url.endsWith('/bundles')?[{id:8,name:'Bundle',price:1000,priceUsd:80}]:{products}};
  });
  const res={set(k,v){this[k]=v;return this;},json(body){this.body=body;return this;},status(code){this.code=code;return this;}};
  await routes['/api/cart/prices']({body:{currency:'USD',items:[...legacy,{id:'bundle-8',qty:1}]}},res);
  assert.equal(res['Cache-Control'],'no-store');assert.equal(res.body.items[2].price_usd,80);
  assert.equal(requests.length,2);assert(requests.every(url=>url.includes('/api/public/mahjoy/')));
});
function fixture(currency='USD',initial=legacy,fetcher){
  let stored=structuredClone(initial);const listeners=new Map(),elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',style:{},hasChildNodes:()=>false,addEventListener(){}});return elements.get(id);};
  const window={location:{pathname:currency==='USD'?'/en/cart.html':'/cart.html'},
    addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
    dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event);},
    MJShippingCheckout:{state:()=>({selected:null,destination:{postalCode:'',country:'MX'}}),subscribe:fn=>{fn({selected:null});return()=>{};},refresh(){},setPayPalNativeMode(){}},
    MJPayPalPricing:{nativeShippingEnabled:()=>true}};
  window.MJCart={getCart:()=>stored,saveCart:next=>{stored=next;window.dispatchEvent({type:'mj:cartUpdated'});},cartCount:()=>stored.reduce((n,p)=>n+p.qty,0)};
  const ctx={window,document:{getElementById:element,addEventListener(){}},console,Intl,Event,CustomEvent,AbortSignal,JSON,Error,setTimeout,
    alert(){},fetch:fetcher||(async(_url,options)=>({ok:true,json:async()=>({items:cartDisplayPrices(products,JSON.parse(options.body).items,currency)})}))};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/cart-pricing.js','utf8'),ctx);
  const html=fs.readFileSync(currency==='USD'?'en/cart.html':'cart.html','utf8');
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  vm.runInContext(scripts.find(s=>s.includes('function renderCart()')),ctx);
  vm.runInContext(scripts.find(s=>s.includes('function initPayPalCart()')),ctx);
  return {ctx,element,getCart:()=>stored,setCart:next=>{stored=next;},pricing:window.MJCartPricing};
}
for(const currency of ['USD','MXN'])test(`actual ${currency} cart renders unknown prices without zero, then the verified total even with a sold-out item`,async()=>{
  const f=fixture(currency);f.ctx.renderCart();
  assert.equal(f.element('cart-total').textContent,'—');assert.doesNotMatch(f.element('cart-items').innerHTML,/\$0[.,]00|Contact for price/);
  await f.pricing.refresh();
  assert.equal(f.pricing.summary().subtotal,currency==='USD'?450:7200);
  assert.equal(f.element('cart-total').textContent,currency==='USD'?'$450.00':'$7200.00');
  assert.match(f.element('cart-items').innerHTML,currency==='USD'?/\$380\.00/:/6,000/);
  assert.match(f.element('cart-items').innerHTML,currency==='USD'?/\$70\.00/:/1,200/);
  assert.match(f.element('cart-price-status').textContent,/Sensu Tile/);
  assert.equal(f.pricing.summary().canPay,false);assert.throws(()=>f.pricing.requireReady());
});
test('network failure clears the payable total and exposes retry without losing the cart',async()=>{
  const f=fixture('USD',legacy,async()=>{throw Error('Offline')});await f.pricing.refresh();
  assert.equal(f.element('cart-total').textContent,'—');assert.equal(f.pricing.summary().retry,true);
  assert.equal(f.getCart().length,2);assert.equal(f.pricing.summary().canPay,false);
});
test('removing the unavailable tile enables the case, and upsell events recheck newly added products',async()=>{
  const f=fixture();await f.pricing.refresh();
  f.ctx.window.MJCart.saveCart([f.getCart()[1]]);await new Promise(setImmediate);
  assert.equal(f.pricing.summary().subtotal,70);assert.equal(f.pricing.summary().canPay,true);
  f.setCart([...f.getCart(),legacy[0]]);f.ctx.window.dispatchEvent(new Event('cartUpdated'));await new Promise(setImmediate);
  assert.equal(f.pricing.summary().subtotal,450);assert.equal(f.pricing.summary().canPay,false);
});
test('a response for old quantities cannot overwrite a newer cart',async()=>{
  let finish,requests=0;
  const f=fixture('USD',legacy,async(_url,options)=>{
    requests++;const items=cartDisplayPrices(products,JSON.parse(options.body).items,'USD');
    if(requests===1)return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({items})});});
    return {ok:true,json:async()=>({items})};
  });
  const pending=f.pricing.refresh();f.setCart([{...legacy[0],qty:2},legacy[1]]);finish();await pending;
  assert.equal(f.getCart()[0].qty,2);assert.equal(f.pricing.summary().subtotal,830);
});
test('PayPal remains disabled for unavailable display data and becomes enabled after a successful recheck',async()=>{
  let available=false;
  const f=fixture('USD',legacy,async(_url,options)=>({ok:true,json:async()=>({items:cartDisplayPrices(products.map(p=>({...p,soldOutEn:!available})),JSON.parse(options.body).items,'USD')})}));
  const displayFetch=f.ctx.fetch;
  f.ctx.fetch=async(path,options)=>path.endsWith('/paypal/config')?{ok:true,json:async()=>({nativeShipping:true})}:displayFetch(path,options);
  vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),f.ctx);
  await f.ctx.window.MJPayPalPricing.init();let enabled;
  f.ctx.window.MJPayPalPricing.buttonCallbacks('USD').onInit({}, {enable(){enabled=true;},disable(){enabled=false;}});
  assert.equal(enabled,false);await f.pricing.refresh();assert.equal(enabled,false);
  available=true;await f.pricing.refresh();assert.equal(enabled,true);
});
