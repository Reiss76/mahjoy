const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { quoteItems, registerCheckoutPrices } = require('../lib/checkout-prices');
const products = [
  {id:62,sku:'TILE-mythos',name:'Mythos Tile',price:6000,priceUsd:380},
  {id:73,sku:'BAG-tilelila',name:'Lilac Tile Case',price:1200,priceUsd:70}
];
const stale = [{id:62,sku:'TILE-mythos',name:'Mythos Tile',price:6000,price_usd:380,qty:1},
  {id:73,sku:'BAG-tilelila',name:'Lilac Tile Case',price:1200,qty:1}];
function browser(cart = structuredClone(stale)) {
  const ctx = { window: {addEventListener() {}}, console, setTimeout, alert() {}, document: {addEventListener() {}},
    fetch: async (_url, options) => {
      if(_url.endsWith('/paypal/create')){ctx.createdPayload=JSON.parse(options.body).payload;return {ok:true,json:async()=>({id:'ORDER-ID'})};}
      const body = JSON.parse(options.body);
      const items = quoteItems(products, body.items, body.currency, body.discount_code ? 10 : 0);
      return {ok:true,json:async()=>({items})};
    }};
  ctx.window.MJCart = {getCart:()=>cart, saveCart:next=>cart=next};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),ctx);
  return ctx;
}
function payload(casePrice = 70) {
  const prices=[380,casePrice];return {purchase_units:[{items:products.map((p,n)=>({name:p.name,sku:p.sku,quantity:'1',unit_amount:{currency_code:'USD',value:prices[n].toFixed(2)}})),
    amount:{currency_code:'USD',value:(405+casePrice).toFixed(2),breakdown:{item_total:{currency_code:'USD',value:(380+casePrice).toFixed(2)},shipping:{currency_code:'USD',value:'25.00'}}}}]};
}
test('current Proax prices repair a legacy cart with missing USD without converting MXN',async()=>{
  const ctx=browser();const repaired=await ctx.window.MJPayPalPricing.refreshCart('USD');
  assert.equal(repaired[1].price_usd,70);assert.equal(repaired[1].price,1200);
  assert.equal(repaired.reduce((t,i)=>t+i.price_usd*i.qty,0),450);
});
test('the actual English cart callback sends both products for USD475 including shipping',async()=>{
  const ctx=browser();let options,created;
  const listeners=[];
  ctx.document={addEventListener:(_event,fn)=>listeners.push(fn),getElementById:()=>({hasChildNodes:()=>false})};
  ctx.paypal={Buttons:o=>{options=o;return {render(){}}}};
  const scripts=[...fs.readFileSync('en/cart.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  vm.runInContext(scripts.find(s=>s.includes('function initPayPalCart()')),ctx);
  // First registered listener initializes the SDK and then updates the visual summary.
  // Its summary needs the normal page elements, so catch only that unrelated render error.
  try{listeners[0]();}catch(e){if(!options)throw e;}
  await options.createOrder({}, {order:{create:p=>{created=p;return 'ORDER-ID'}}});
  assert.equal(ctx.createdPayload.purchase_units[0].items[1].unit_amount.value,'70.00');
  assert.equal(ctx.createdPayload.purchase_units[0].amount.value,'475.00');
  assert.equal(ctx.createdPayload.purchase_units[0].custom_id,undefined);
  assert.equal(ctx.createdPayload.payment_source.paypal.experience_context.contact_preference,'UPDATE_CONTACT_INFO');
});
test('zero dollar item never reaches PayPal even if other products and shipping have positive amounts',async()=>{
  const ctx=browser();let called=false;
  await assert.rejects(()=>ctx.window.MJPayPalPricing.create({order:{create(){called=true;}}},payload(0)),/no valid price/);
  assert.equal(called,false);
});
test('a stale nonzero price or wrong total is rejected before creating the order',async()=>{
  const ctx=browser();let called=false;const actions={order:{create(){called=true;}}};
  await assert.rejects(()=>ctx.window.MJPayPalPricing.create(actions,payload(50)),/Prices have changed/);
  const p=payload();p.purchase_units[0].amount.value='405.00';
  await assert.rejects(()=>ctx.window.MJPayPalPricing.create(actions,p),/Invalid checkout total/);
  assert.equal(called,false);
});
test('network failure prevents PayPal creation',async()=>{
  const ctx=browser();ctx.fetch=async()=>{throw new Error('offline');};let called=false;
  await assert.rejects(()=>ctx.window.MJPayPalPricing.create({order:{create(){called=true;}}},payload()),/offline/);
  assert.equal(called,false);
});
test('missing USD, invalid quantity, sold out and discounts giving free items fail closed',()=>{
  assert.throws(()=>quoteItems([{...products[1],priceUsd:null}], [stale[1]],'USD'),/Price unavailable/);
  assert.throws(()=>quoteItems(products,[{...stale[1],qty:0}],'USD'),/quantity/);
  assert.throws(()=>quoteItems([{...products[1],soldOutEn:true}],[stale[1]],'USD'),/sold out/);
  assert.throws(()=>quoteItems(products,stale,'USD',100),/discount/);
  assert.equal(quoteItems(products,stale,'MXN')[1].unit_price,1200);
});
test('validated discount prices still pass the PayPal guard with line rounding',async()=>{
  const ctx=browser();ctx.window.cartDiscount={code:'VALID',pct:10};const p=payload();
  p.purchase_units[0].items[0].unit_amount.value='342.00';p.purchase_units[0].items[1].unit_amount.value='63.00';
  p.purchase_units[0].amount.breakdown.item_total.value='405.00';p.purchase_units[0].amount.value='430.00';
  let called=false;await ctx.window.MJPayPalPricing.create({order:{create(){called=true;}}},p);assert(ctx.createdPayload);
});
test('server quotes use the catalog and validate the coupon, ignoring caller-supplied prices',async()=>{
  let handler;const paths=[];
  registerCheckoutPrices({post:(_path,fn)=>handler=fn},'https://proax.example',async url=>{
    paths.push(url);return {ok:true,json:async()=>url.includes('/discount/')?{valid:true,discount_pct:10}:{products}};
  });
  const res={set(){},json(v){this.body=v;return this;},status(n){this.statusCode=n;return this;}};
  await handler({body:{items:stale,currency:'USD',discount_code:'VALID'}},res);
  assert.equal(res.body.items[1].unit_price,63);assert.equal(res.body.items[1].price_usd,70);
  assert(paths.some(p=>p.includes('/discount/VALID')));
});
test('shipping keeps the quoted market amount and rejects every cross-currency conversion',()=>{
  const pricing=browser().window.MJPayPalPricing;
  assert.equal(pricing.shippingPrice(60,'USD','USD',19.5),60);
  assert.equal(pricing.shippingPrice(25,'USD','USD',19.5),25);
  assert.equal(pricing.shippingPrice(1170,'MXN','MXN'),1170);
  assert.throws(()=>pricing.shippingPrice(1170,'MXN','USD',19.5),/No currency conversion/);
  assert.throws(()=>pricing.shippingPrice(60,'USD','MXN',19.5),/No currency conversion/);
});
test('the USD checkout callback retains a USD60 shipping quote instead of reducing it to USD3',async()=>{
  const ctx=browser();let options,created;
  ctx.window.location={pathname:'/en/checkout.html'};
  ctx.window.MJCheckoutProduct={...products[0],price_usd:380};
  ctx.window.MJShippingCost=60;ctx.window.MJShippingCurrency='USD';ctx.window.cachedExchangeRate=19.5;
  const container={innerHTML:''};
  ctx.document={readyState:'loading',addEventListener(){},getElementById:id=>id==='co-form'?{qty:{value:'1'}}:container};
  ctx.paypal={Buttons:o=>{options=o;return {render:()=>Promise.resolve()};}};
  vm.runInContext(fs.readFileSync('js/paypal-checkout.js','utf8'),ctx);
  ctx.window.MJPayPal.init();
  await options.createOrder({}, {order:{create:p=>{created=p;return 'SIMULATED';}}});
  const unit=ctx.createdPayload.purchase_units[0];assert.equal(unit.items[1].unit_amount.value,'60.00');assert.equal(unit.amount.value,'440.00');
});
test('Mexico PayPal cart uses MXN7200 even though the same items are USD450 in the US market',async()=>{
 const ctx=browser();let options,created;const listeners=[];
 ctx.document={addEventListener:(_e,fn)=>listeners.push(fn),getElementById:()=>({hasChildNodes:()=>false})};
 ctx.paypal={Buttons:o=>{options=o;return {render(){}}}};
 const scripts=[...fs.readFileSync('cart.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 vm.runInContext(scripts.find(s=>s.includes('function initPayPalCart()')),ctx);
 try{listeners[0]()}catch(e){if(!options)throw e}
 await options.createOrder({}, {order:{create:p=>{created=p;return 'SIMULATED';}}});
 const unit=ctx.createdPayload.purchase_units[0];assert.equal(unit.amount.currency_code,'MXN');assert.equal(unit.items[0].unit_amount.value,'6000.00');assert.equal(unit.items[1].unit_amount.value,'1200.00');assert.equal(unit.amount.breakdown.item_total.value,'7200.00');
});
test('shipping API requests the storefront currency directly and discards mismatched carrier currencies',async()=>{
 let handler,requested=[];
 const source=fs.readFileSync('server.js','utf8');const start=source.indexOf("app.post('/api/shipping/quote'");const end=source.indexOf('// ─── Envia.com Shipment Creation',start);
 const ctx={app:{post:(_p,fn)=>handler=fn},ENVIA_API_KEY:'TEST-ONLY',ENVIA_API_URL:'https://carrier.test',ORIGINS:{US:{country:'US'},MX:{country:'MX'}},getProductWeight:()=>1,console,fetch:async(_url,o)=>{const body=JSON.parse(o.body);requested.push(body.settings.currency);return{json:async()=>({data:[{price:29.99,currency:'USD',service:'std'},{price:999,currency:'MXN',service:'std'}]})}}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 for(const currency of ['USD','MXN']){
  const res={status(n){this.statusCode=n;return this},json(v){this.body=v}};requested=[];
  await handler({body:{destination:'10001',country:'US',currency,items:[{qty:1,weight:1}]}},res);
  if(currency==='MXN'){assert.equal(res.statusCode,409);assert.equal(requested.length,0);continue;}
  assert(requested.length>0&&requested.every(c=>c===currency));assert.equal(res.body.currency,currency);assert(res.body.quotes.every(q=>q.currency===currency));assert.equal(res.body.shipping_cost,currency==='USD'?29.99:999);
 }
});
test('market toggle navigates to independent prices and ignores a stale localStorage currency',()=>{
 for(const english of [false,true]){
  let callback,toggle;const ctx={window:{location:{pathname:english?'/en/product.html':'/product.html',search:'',hash:'#62'}},document:{addEventListener:(_e,f)=>callback=f,querySelector:()=>({appendChild:e=>toggle=e}),getElementById:()=>null,createElement:()=>({setAttribute(){}})}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(english?'js/currency-en.js':'js/currency.js','utf8'),ctx);callback();
  assert.equal(ctx.window.MJCurrency.get(),english?'USD':'MXN');assert.equal(ctx.window.MJCurrency.format(6000,380),english?'$380.00 USD':'$6000.00 MXN');assert.equal(toggle.href,english?'/product.html#62':'/en/product.html#62');if(english)assert.equal(ctx.window.MJCurrency.format(6000,null),'');
 }
});
test('US delivery in the Mexico checkout rejects before quoting shipping and sends the buyer to the USD market',async()=>{
 const ctx=browser();let options,quoteCalled=false,rejected=false,marketCountry;
 ctx.window.MJCheckoutProduct={...products[0]};ctx.window.location={pathname:'/checkout.html'};
 ctx.window.MJPayPalPricing.requireMarket=(country,currency,actions)=>{marketCountry=country;assert.equal(currency,'MXN');actions.reject();return false;};
 ctx.document={readyState:'complete',addEventListener(){},getElementById:id=>id==='co-qty'?{value:'1'}:{hasChildNodes:()=>false}};
 ctx.setTimeout=fn=>fn();ctx.paypal={Buttons:o=>{options=o;return{render(){}}}};
 const scripts=[...fs.readFileSync('checkout.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 vm.runInContext(scripts.find(s=>s.includes('function initPayPalExpress()')),ctx);
 ctx.fetch=async()=>{quoteCalled=true;throw Error('unexpected quote');};
 await options.onShippingChange({shipping_address:{country_code:'US',postal_code:'10001'}},{reject(){rejected=true;return Promise.resolve();}});
 assert(rejected);assert.equal(marketCountry,'US');assert.equal(quoteCalled,false);
});
test('market redirect preserves product, quantity and cart instead of converting prices',async()=>{
 const ctx=browser();let redirected,rejected=false;
 ctx.URL=URL;ctx.alert=()=>{};
 ctx.window.location={href:'https://www.playmahjoy.com/checkout.html?sku=TILE-test#62',assign:url=>redirected=url};
 ctx.document.getElementById=()=>({value:'3'});
 assert.equal(ctx.window.MJPayPalPricing.requireMarket('US','MXN',{reject(){rejected=true;return Promise.resolve();}}),false);
 await new Promise(setImmediate);
 assert(rejected);const url=new URL(redirected);assert.equal(url.pathname,'/en/checkout.html');assert.equal(url.searchParams.get('sku'),'TILE-test');assert.equal(url.searchParams.get('qty'),'3');assert.equal(url.searchParams.get('country'),'US');assert.equal(url.hash,'#62');assert.equal(ctx.window.MJCart.getCart().length,2);
 assert.equal(ctx.window.MJPayPalPricing.requireMarket('US','USD',{reject(){throw Error('unexpected')}}),true);
});
test('checkout restores the submitted and displayed quantity before loading USD prices',async()=>{
 const ctx=browser(),elements={};ctx.URLSearchParams=URLSearchParams;ctx.window.location={pathname:'/en/checkout.html',search:'?id=62&qty=3',hash:''};ctx.isEN=true;
 ctx.document={addEventListener(){},getElementById:id=>id==='co-wa-btn'?null:elements[id]||(elements[id]={style:{},value:'1',textContent:'',addEventListener(){}})};
 ctx.fetch=async()=>({ok:true,json:async()=>({...products[0],price_usd:380})});
 vm.runInContext(fs.readFileSync('js/checkout.js','utf8'),ctx);await ctx.loadCheckout();
 assert.equal(elements['co-qty'].value,'3');assert.equal(elements['co-qty-display'].textContent,'3');assert.match(elements['co-subtotal'].textContent,/1,140/);
});
