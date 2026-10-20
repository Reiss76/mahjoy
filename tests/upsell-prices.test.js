const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {quoteItems,cartDisplayPrices}=require('../lib/checkout-prices');
const products=[
 {id:1,sku:'RACK',name:'Rack Cosmic',price:2400,priceUsd:160},
 {id:2,sku:'RACK-BAG',name:'Rack Bag Blue',price:800,priceUsd:50,image:'/api/public/media/rack-bag'},
 {id:3,sku:'TILE',name:'Sensu Tile',price:6000,priceUsd:380},
 {id:4,sku:'TILE-BAG',name:'Tile Bag Velvet',price:900,priceUsd:50.25},
];
const cart=(indices=[0,1])=>indices.map(index=>({...products[index],qty:1}));
function popup(kind,currency,catalog=products) {
 const file=`js/${kind}-bag-upsell.js`,getter=kind==='rack'?'fetchRackBags':'fetchTileBags',requests=[];
 const ctx={window:{location:{pathname:currency==='USD'?'/en/product.html':'/product.html'}},
  localStorage:{getItem:()=>null},document:{readyState:'loading',addEventListener(){}},console,Intl,
  fetch:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>({products:catalog})};}};
 vm.createContext(ctx);
 // Expose real private pure functions only in this isolated test context.
 const source=fs.readFileSync(file,'utf8').replace('  function init() {',`  window.fixture={fetchBags:${getter},formatPrice};\n  function init() {`);
 vm.runInContext(source,ctx);return{...ctx.window.fixture,requests};
}
for(const kind of ['rack','tile'])for(const currency of ['USD','MXN'])test(`${kind} bag popup reads independent ${currency} prices with explicit currency and cent precision`,async()=>{
 const f=popup(kind,currency),[bag]=await f.fetchBags(),p=products[kind==='rack'?1:3],base=currency==='USD'?p.priceUsd:p.price;
 assert.equal(bag.original_price,base);assert.equal(bag.discount_price,Math.round(base*.9*100)/100);
 assert.equal(bag.price,p.price);assert.equal(bag.price_usd,p.priceUsd);
 assert.match(f.formatPrice(bag.discount_price),new RegExp(`\\d\\.\\d{2} ${currency}$`));
 assert.equal(f.requests[0].url,'https://proax.app/api/public/mahjoy/catalog/products');assert.equal(f.requests[0].options.cache,'no-store');
 if(kind==='rack'&&currency==='USD')assert.equal(f.formatPrice(bag.discount_price),'$45.00 USD');
});
test('English offers never fall back to MXN or advertise sold-out products',async()=>{
 for(const kind of ['rack','tile']){
  assert.equal((await popup(kind,'USD',products.map(p=>({...p,priceUsd:null}))).fetchBags()).length,0);
  assert.equal((await popup(kind,'USD',products.map(p=>({...p,soldOutEn:true}))).fetchBags()).length,0);
 }
});
test('bag discounts are verified from catalog identities and vanish when the qualifying product is removed',()=>{
 const items=cart();items[0].name='Untrusted name';items[1].price=1;items[1].promo_code='ANYTHING';
 assert.equal(quoteItems(products,items,'USD')[1].unit_price,45);
 assert.equal(quoteItems(products,[items[1]],'USD')[0].unit_price,50);
 assert.equal(quoteItems(products,[{...items[1],name:'Rack Cosmic'}],'USD')[0].unit_price,50);
 assert.equal(quoteItems(products,items,'MXN')[1].unit_price,720);
 assert.equal(quoteItems(products,cart([2,3]),'USD')[1].unit_price,45.23);
 const display=cartDisplayPrices(products,items,'USD');assert.equal(display[1].unit_price,45);assert.equal(display[1].price_usd,50);
});
test('coupons use the larger rate without compounding or touching standalone bag prices',()=>{
 assert.equal(quoteItems(products,cart(),'USD',20)[1].unit_price,40);
 assert.equal(quoteItems(products,cart(),'USD',5)[1].unit_price,45);
 assert.equal(quoteItems(products,cart([1]),'USD',5)[0].unit_price,47.5);
});
const fixtureSource=fs.readFileSync('tests/paypal-native-client.test.js','utf8').split("for(const currency of ['MXN','USD'])for(const kind")[0];
const harness={require,Buffer,setImmediate,console};vm.createContext(harness);vm.runInContext(fixtureSource,harness);
for(const currency of ['USD','MXN'])for(const coupon of [0,5,20])test(`${currency} live cart entrypoint and server price quote agree with ${coupon}% coupon`,async()=>{
 const f=harness.fixture(currency,{nativeShipping:true,cart:cart()}),original=f.ctx.fetch;
 f.ctx.fetch=async(path,init)=>{
  if(path.includes('/vendors/discount/'))return{ok:true,json:async()=>({valid:true,discount_pct:coupon})};
  if(path==='/api/checkout/prices'){
   const body=JSON.parse(init.body);return{ok:true,json:async()=>({items:quoteItems(products,body.items,body.currency,body.discount_code?coupon:0)})};
  }
  return original(path,init);
 };
 const options=await harness.entrypoint(f,'cart',currency);
 if(coupon){f.node('cart-discount-code').value='FIXTURE';await f.ctx.window.applyCartDiscount();}
 await options.createOrder({},{});
 const unit=f.requests.find(request=>request.path.endsWith('/paypal/create')).body.payload.purchase_units[0];
 const expected=quoteItems(products,cart(),currency,coupon);
 assert.equal(Number(unit.items[1].unit_amount.value),expected[1].unit_price);
 assert.equal(Number(unit.amount.value),expected.reduce((sum,item)=>sum+item.qty*item.unit_price,0));
 assert.equal(unit.amount.currency_code,currency);
 assert(!f.requests.some(request=>request.path.includes('/capture')));
});
