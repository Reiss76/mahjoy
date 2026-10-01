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
  const ctx = { window: {}, console, setTimeout, alert() {}, document: {addEventListener() {}},
    fetch: async (_url, options) => {
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
  assert.equal(created.purchase_units[0].items[1].unit_amount.value,'70.00');
  assert.equal(created.purchase_units[0].amount.value,'475.00');
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
  let called=false;await ctx.window.MJPayPalPricing.create({order:{create(){called=true;}}},p);assert(called);
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
test('shipping already quoted in USD stays USD; MXN is converted exactly once',()=>{
  const pricing=browser().window.MJPayPalPricing;
  assert.equal(pricing.shippingPrice(60,'USD','USD',19.5),60);
  assert.equal(pricing.shippingPrice(25,'USD','USD',19.5),25);
  assert.equal(pricing.shippingPrice(1170,'MXN','USD',19.5),60);
  assert.equal(pricing.shippingPrice(60,'USD','MXN',19.5),1170);
  assert.throws(()=>pricing.shippingPrice(60,'MXN','USD',0),/exchange rate/);
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
  const unit=created.purchase_units[0];assert.equal(unit.items[1].unit_amount.value,'60.00');assert.equal(unit.amount.value,'440.00');
});
