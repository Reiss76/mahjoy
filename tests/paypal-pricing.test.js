const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {quoteItems}=require('../lib/checkout-prices');
// Reuse the actual payment-entrypoint VM fixtures without registering its tests.
const source=fs.readFileSync('tests/paypal-native-client.test.js','utf8');
const fixtureSource=source.slice(0,source.indexOf("for(const currency of ['MXN','USD'])for(const kind"));
const harness={require,Buffer,setImmediate,console};vm.createContext(harness);vm.runInContext(fixtureSource,harness);
const products=[{id:1,sku:'TEST',name:'Fixture product',price:100,price_usd:10},
  {id:9,sku:'BUNDLE-9',name:'Fixture bundle',type:'bundle',price:100,price_usd:10}];
function setup(currency,cart) {
  const f=harness.fixture(currency,{nativeShipping:false,cart}),original=f.ctx.fetch;f.prices=[];f.saved=[];
  f.ctx.fetch=async(path,init)=>{
    if(path==='/api/checkout/prices') {
      const body=JSON.parse(init.body);f.prices.push(body);return {ok:true,json:async()=>({items:quoteItems(products,body.items,body.currency)})};
    }
    return original(path,init);
  };
  f.ctx.window.MJCart.saveCart=next=>{f.saved.push(next);f.setCart(next);f.ctx.window.dispatchEvent(new f.ctx.Event('mj:cartUpdated'));};
  f.ctx.window.MJShippingCheckout.configure({currency,items:()=>f.getCart(),beforeQuote:()=>f.ctx.window.MJPayPalPricing.refreshCart(currency)});
  return f;
}
for(const currency of ['MXN','USD'])for(const legacy of [
  {id:'1',sku:'',name:'Old catalog name'},
  {id:' 001 ',sku:'',name:'Old catalog name'},
  {name:'Fixture product'},
  {id:'fixture-product',name:'Fixture product'},
  {id:'bundle-9',name:'Fixture bundle'},
]) {
  test(`actual ${currency} cart callback pays a legacy ${legacy.id || 'name-only'} identity after one canonical quote`,async()=>{
    const f=setup(currency,[{...legacy,price:100,price_usd:10,qty:1}]),options=await harness.entrypoint(f,'cart',currency);
    let enabled=false;options.onInit({}, {enable(){enabled=true;},disable(){enabled=false;}});assert.equal(enabled,false);
    await harness.selectQuote(f,currency);assert(enabled);
    const expected=legacy.id==='bundle-9'?'BUNDLE-9':'TEST';assert.equal(f.getCart()[0].sku,expected);
    assert.equal(f.prices[0].items[0].qty,1);
    if(legacy.id==='bundle-9')assert.equal(f.prices[0].items[0].sku,'BUNDLE-9');
    if(legacy.id==='fixture-product')assert.equal(f.prices[0].items[0].id,undefined);
    options.onClick({}, {resolve(){},reject(){throw Error('Canonical quote should enable PayPal');}});
    await options.createOrder({},{});
    assert.equal(f.requests.filter(r=>r.path==='/api/shipping/quote').length,1);
    assert(f.ctx.window.MJShippingCheckout.state().selected);
    const created=f.requests.find(r=>r.path.endsWith('/paypal/create')).body;
    assert.equal(created.payload.purchase_units[0].items[0].sku,expected);assert.equal(created.shipping_quote_token,'signed-'+currency);
    assert.equal(created.payload.purchase_units[0].amount.value,currency==='USD'?'40.00':'130.00');
  });
}
test('canonical price correlation follows verified response order even when catalog IDs and names differ',async()=>{
  const f=setup('MXN',[{id:'old-a',name:'Old A',qty:1},{id:'old-b',name:'Old B',qty:2}]);
  f.ctx.fetch=async()=>({ok:true,json:async()=>({items:[{id:101,sku:'NEW-A',name:'Renamed A',qty:1,price:100,price_usd:10},
    {id:202,sku:'NEW-B',name:'Renamed B',qty:2,price:200,price_usd:20}]})});
  const refreshed=await f.ctx.window.MJPayPalPricing.refreshCart('MXN');
  assert.deepEqual(JSON.parse(JSON.stringify(refreshed.map(p=>[p.sku,p.name,p.qty]))),[['NEW-A','Renamed A',1],['NEW-B','Renamed B',2]]);
});
test('changed products or quantities during pricing remain in the cart and cannot reuse the old price response',async()=>{
  for(const changed of [[{id:'1',name:'Fixture product',qty:2}],[{id:'2',name:'Another product',qty:1}]]) {
    const f=setup('MXN',[{id:'1',name:'Fixture product',qty:1}]);let finish;
    f.ctx.fetch=()=>new Promise(resolve=>{finish=resolve;});
    const refresh=f.ctx.window.MJPayPalPricing.refreshCart('MXN');f.setCart(changed);
    finish({ok:true,json:async()=>({items:[{id:1,sku:'TEST',name:'Fixture product',qty:1,price:100,price_usd:10}]})});
    await assert.rejects(()=>refresh,error=>error.code==='SHIPPING_CART_CHANGED');
    assert.deepEqual(f.getCart(),changed);assert.equal(f.saved.length,0);
  }
});
test('latest valid quantity bounds and verified response quantity are enforced before canonical saving',async()=>{
  for(const qty of [0,1.5,1001]) {
    const f=setup('MXN',[{id:'1',name:'Fixture product',qty}]);
    await assert.rejects(()=>f.ctx.window.MJPayPalPricing.refreshCart('MXN'));assert.equal(f.saved.length,0);
  }
  const f=setup('MXN',[{id:'1',name:'Fixture product',qty:1}]);
  f.ctx.fetch=async()=>({ok:true,json:async()=>({items:[{sku:'TEST',name:'Fixture product',qty:2,price:100,price_usd:10}]})});
  await assert.rejects(()=>f.ctx.window.MJPayPalPricing.refreshCart('MXN'));assert.equal(f.saved.length,0);
});
test('a slower price refresh never overwrites canonical prices already accepted by a newer refresh',async()=>{
  const f=setup('MXN',[{id:'1',name:'Fixture product',qty:1}]),pending=[];
  f.ctx.fetch=()=>new Promise(resolve=>pending.push(resolve));
  const first=f.ctx.window.MJPayPalPricing.refreshCart('MXN'),second=f.ctx.window.MJPayPalPricing.refreshCart('MXN');
  const response=price=>({ok:true,json:async()=>({items:[{id:1,sku:'TEST',name:'Fixture product',qty:1,price,price_usd:10}]})});
  pending[1](response(200));await second;pending[0](response(100));await first;
  assert.equal(f.getCart()[0].price,200);assert.equal(f.saved.length,1);
});
