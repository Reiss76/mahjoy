const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const bf=require('../lib/buen-fin');
const {resolveCheckoutQuote,cartDisplayPrices,quoteItems}=require('../lib/checkout-prices');
const products=[
 {id:1,sku:'MAT',name:'Mat Golden Lotus',price:1200,priceUsd:80},
 {id:2,sku:'RACK',name:'Rack Green',price:2400,priceUsd:160},
 {id:3,sku:'RACK-BAG',name:'Rack Bag',price:800,priceUsd:50},
 {id:4,sku:'TJT',name:'National Mahjong League Card',price:101.99,priceUsd:10},
];
const bundle={id:29,sku:'BUNDLE-29',name:'Golden Lotus Bundle',type:'bundle',price:10100,priceUsd:650};
const cart=products.concat(bundle).map(p=>({...p,qty:1}));
const fetcher=pct=>async url=>({ok:true,json:async()=>url.includes('/discount/')?{valid:true,discount_pct:pct}:url.endsWith('/bundles')?[bundle]:{products}});

test('automatic 10% covers every MXN product and bundle, rounds per unit, and leaves catalog values intact',async()=>{
 const before=JSON.stringify(cart);
 const input={items:cart,currency:'MXN',discount_pct:99};
 const quote=await resolveCheckoutQuote('https://catalog.test',input,fetcher(0),bf.START);
 assert.deepEqual(quote.items.map(i=>i.unit_price),[1080,2160,720,91.79,9090]);
 assert.equal(quote.discount_pct,0);assert.equal(quote.discount_code,null);
 assert.deepEqual(quote.items.map(i=>i.price),[1200,2400,800,101.99,10100]);
 assert.equal(JSON.stringify(cart),before);
 assert.deepEqual(cartDisplayPrices(products.concat(bundle),cart,'MXN',10).map(i=>i.unit_price),quote.items.map(i=>i.unit_price));
 for(const now of [bf.START-1,bf.END]) {
  const normal=await resolveCheckoutQuote('https://catalog.test',input,fetcher(0),now);
  assert.equal(normal.items[0].unit_price,1200);assert.equal(normal.items.at(-1).unit_price,10100);
  assert.equal(normal.items[2].unit_price,720); // The existing bag offer still applies.
 }
 assert.equal(bf.discountPct('MXN',bf.END-1),10);
 assert.equal(bf.discountPct('USD',bf.START),0);
 const usd=await resolveCheckoutQuote('https://catalog.test',{...input,currency:'USD'},fetcher(0),bf.START);
 assert.equal(usd.items[0].unit_price,80);assert.equal(usd.items.at(-1).unit_price,650);
});

test('coupons use the highest rate, never compound, and gift thresholds use discounted merchandise',async()=>{
 for(const [pct,expected] of [[5,1080],[10,1080],[20,960]]) {
  const quote=await resolveCheckoutQuote('https://catalog.test',{items:[cart[0]],currency:'MXN',discount_code:'TEST'},fetcher(pct),bf.START);
  assert.equal(quote.items[0].unit_price,expected);assert.equal(quote.discount_pct,pct);
 }
 const p=[{id:5,sku:'TEST',name:'Test',price:4400},...bf.TIERS.flatMap(t=>t.skus.map(sku=>({sku,name:t.name,price:400})))];
 const discounted=quoteItems(p,[{sku:'TEST',qty:1}],'MXN',0,10);
 assert.equal(bf.summary(p,discounted,'MXN',bf.START).eligible,null);
 const qualified=quoteItems(p.map(i=>i.sku==='TEST'?{...i,price:4500}:i),[{sku:'TEST',qty:1}],'MXN',0,10);
 assert.equal(bf.summary(p,qualified,'MXN',bf.START).eligible.minimum,4000);
});

const fixtureSource=fs.readFileSync('tests/paypal-native-client.test.js','utf8').split("for(const currency of ['MXN','USD'])for(const kind")[0];
const harness={require,Buffer,setImmediate,console};vm.createContext(harness);vm.runInContext(fixtureSource,harness);
for(const currency of ['MXN','USD'])for(const kind of ['normal','express','cart'])test(`${kind} ${currency} PayPal payload agrees with the campaign quote without capturing`,async()=>{
 const f=harness.fixture(currency,{nativeShipping:true,cart:[cart[0]]});
 f.ctx.window.MJBuenFin={discountPct:()=>10,selectedGift:()=>undefined};
 const original=f.ctx.fetch;
 f.ctx.fetch=async(path,init)=>{
  if(path==='/api/checkout/prices') {
   const body=JSON.parse(init.body);
   return{ok:true,json:async()=>({items:quoteItems(products,body.items,body.currency,0,currency==='MXN'?10:0)})};
  }
  return original(path,init);
 };
 const options=await harness.entrypoint(f,kind,currency);await options.createOrder({},{});
 const created=f.requests.find(r=>r.path.endsWith('/paypal/create')).body.payload.purchase_units[0];
 assert.equal(created.amount.value,currency==='MXN'?'1080.00':'80.00');
 assert.equal(created.items[0].unit_amount.value,created.amount.value);
 assert(!f.requests.some(r=>r.path.includes('/capture')));
});

test('the open browser removes its automatic discount and restores ordinary popups at the deadline',async()=>{
 let elapsed=0,interval,restored=0;const nodes=new Map(),events=[];
 const node=()=>({classList:{toggle(){},add(){},remove(){}},setAttribute(){},addEventListener(){},appendChild(child){if(child.id)nodes.set(child.id,child);},prepend(){},remove(){nodes.delete(this.id);}});
 const ctx={console,Date,Intl,CustomEvent,performance:{now:()=>elapsed},sessionStorage:{getItem:()=> '1'},
  setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{interval=fn;},
  document:{body:node(),getElementById:id=>nodes.get(id),createElement:node,addEventListener(){}},
  window:{location:{pathname:'/cart.html'},dispatchEvent:event=>events.push(event.detail),addEventListener(){}},
  fetch:async()=>({ok:true,json:async()=>bf.summary([] ,[],'MXN',bf.END-1000+elapsed)})};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/buen-fin.js','utf8'),ctx);
 await ctx.window.MJBuenFin.ready;
 assert.equal(ctx.window.MJBuenFin.discountPct(),10);assert.equal(nodes.has('mj-bf-launcher'),true);
 ctx.window.MJBuenFin.whenNormal(()=>restored++);await new Promise(setImmediate);assert.equal(restored,0);
 elapsed=1000;interval();await new Promise(setImmediate);
 assert.equal(ctx.window.MJBuenFin.discountPct(),0);assert.equal(nodes.has('mj-bf-launcher'),false);assert.equal(restored,1);
 assert.equal(events.at(-1).discount_pct,0);
});

test('the real cart shows the discount once and restores its normal total without a reload',async()=>{
 let rate=10;
 const items=[{...cart[0],qty:2},cart.at(-1)];
 const f=harness.fixture('MXN',{nativeShipping:true,cart:items});
 f.ctx.Intl=Intl;
 f.ctx.window.MJBuenFin={discountPct:()=>rate,ready:Promise.resolve()};
 f.ctx.window.MJCart.cartCount=()=>f.getCart().reduce((sum,item)=>sum+item.qty,0);
 const original=f.ctx.fetch;
 f.ctx.fetch=async(path,init)=>path==='/api/cart/prices'
  ?{ok:true,json:async()=>({items:cartDisplayPrices(products.concat(bundle),JSON.parse(init.body).items,'MXN',rate)})}
  :original(path,init);
 await f.ctx.window.MJPayPalPricing.init();
 vm.runInContext(fs.readFileSync('js/cart-pricing.js','utf8'),f.ctx);
 const scripts=[...fs.readFileSync('cart.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 vm.runInContext(scripts.find(s=>s.includes('function renderCart()')),f.ctx);
 vm.runInContext(scripts.find(s=>s.includes('function initPayPalCart()')),f.ctx);
 await f.ctx.window.MJCartPricing.refresh();
 assert.equal(f.node('cart-subtotal').textContent,'$12500.00');
 assert.equal(f.node('cart-discount-label').textContent,'Buen Fin (10%)');
 assert.equal(f.node('cart-discount-amount').textContent,'-$1250.00');
 assert.equal(f.node('cart-total').textContent,'$11250.00');
 rate=0;f.ctx.window.dispatchEvent({type:'mj:buen-fin'});
 assert.equal(f.node('cart-discount-row').style.display,'none');
 assert.equal(f.node('cart-total').textContent,'$12500.00');
});
