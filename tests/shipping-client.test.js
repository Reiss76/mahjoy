const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function browser({currency = 'MXN', respond} = {}) {
  let clock = Date.now();
  let cart = [{id:1,sku:'TEST-A',name:'Test product',price:4370,price_usd:250,qty:1}];
  const requests = [];
  const ctx = { window:{location:{pathname:currency === 'USD' ? '/en/cart.html' : '/cart.html'}},
    document:{addEventListener(){},getElementById(){return null;}},console,
    Date: class extends Date {static now(){return clock;}},
    fetch:async (path,options) => {
      const body=JSON.parse(options.body);requests.push({path,body});
      if (respond) return respond(path,body,ctx);
      return {ok:true,json:async()=>({quotes:[rate(currency)]})};
    }};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('js/shipping-checkout.js','utf8'),ctx);
  const shipping = ctx.window.MJShippingCheckout;
  shipping.configure({currency,items:()=>cart});
  shipping.setDestination('00000',currency==='USD'?'US':'MX');
  return {ctx,shipping,requests,setCart:next=>{cart=next;},getCart:()=>cart,advance:ms=>{clock+=ms;}};
}
function rate(currency='MXN',overrides={}) {
  return {id:'carrier-ground',carrier:'Test carrier',service:'Home delivery',days:3,price:currency==='USD'?30:429,
    currency,quote_token:'signed-test-rate',expires_at:Date.now()+60000,...overrides};
}
async function ready(fixture) {await fixture.shipping.quote();fixture.shipping.selectRate(0);}

test('a quote is requested with all SKU quantities and no invented weight or dimensions',async()=>{
  const f=browser();f.setCart([{sku:'A',name:'Mat',qty:2},{sku:'B',name:'Rack',qty:1}]);
  await f.shipping.quote();
  assert.equal(f.requests[0].body.items.length,2);
  assert.equal(f.requests[0].body.items[0].qty,2);
  assert.equal(f.requests[0].body.currency,'MXN');
  assert.equal(f.requests[0].body.items.some(item=>item.weight || item.dimensions),false);
  assert.throws(()=>f.shipping.requireForPayment('MXN'),/selecciona/);
  f.shipping.selectRate(0);
  assert.equal(f.shipping.requireForPayment('MXN').price,429);
  assert.equal(f.shipping.state().rates[0].days,'3');
});
test('HTTP errors, network errors, empty and unsigned rates clear a previous selection',async()=>{
  for (const failure of ['http','network','empty','unsigned']) {
    let fail=false;
    const f=browser({respond:async()=>{
      if(!fail)return{ok:true,json:async()=>({quotes:[rate()]})};
      if(failure==='network')throw Error('offline');
      return{ok:failure!=='http',json:async()=>({quotes:failure==='unsigned'?[rate('MXN',{quote_token:null})]:[]})};
    }});
    await ready(f);fail=true;
    await assert.rejects(()=>f.shipping.quote());
    assert.equal(f.shipping.state().selected,null);
    assert.equal(f.ctx.window.MJShippingCost,0);
    assert.throws(()=>f.shipping.requireForPayment('MXN'));
  }
});
test('the selected actual carrier/service is retained instead of grouping numeric days',async()=>{
  const f=browser({respond:async()=>({ok:true,json:async()=>({quotes:[rate('MXN',{id:'ground',price:445}),rate('MXN',{id:'ground_od',service:'Ocurre - Domicilio',price:429})]})})});
  await f.shipping.quote();f.shipping.selectRate(1);
  assert.equal(f.shipping.requireForPayment('MXN').id,'ground');
  assert.equal(f.shipping.requireForPayment('MXN').price,445);
});
test('destination, quantity, currency and expiry cannot reuse a signed selection',async()=>{
  const f=browser();await ready(f);
  assert.throws(()=>f.shipping.requireForPayment('USD'));
  f.setCart([{sku:'TEST-A',name:'Test product',qty:2}]);
  assert.throws(()=>f.shipping.requireForPayment('MXN'));
  await ready(f);f.shipping.setDestination('11111','MX');
  assert.throws(()=>f.shipping.requireForPayment('MXN'));
  await ready(f);f.advance(61000);
  assert.throws(()=>f.shipping.requireForPayment('MXN'),/caducó/);
});
test('the English USD market may quote delivery in Mexico without currency conversion',async()=>{
  const f=browser({currency:'USD'});f.shipping.setDestination('00000','MX');
  await ready(f);const selected=f.shipping.requireForPayment('USD');
  assert.equal(selected.country,'MX');assert.equal(selected.currency,'USD');assert.equal(selected.price,30);
  assert.equal(f.requests[0].body.country,'MX');assert.equal(f.requests[0].body.currency,'USD');
});
test('a late quote response cannot restore rates for an earlier postal code',async()=>{
  let resolve;
  const f=browser({respond:()=>new Promise(r=>{resolve=r;})});
  const pending=f.shipping.quote();f.shipping.setDestination('11111','MX');
  resolve({ok:true,json:async()=>({quotes:[rate()]})});
  await assert.rejects(()=>pending);
  assert.equal(f.shipping.state().selected,null);
  assert.equal(f.shipping.state().rates.length,0);
});
test('the original order token is immutable and address callbacks never PATCH or re-quote',async()=>{
  const f=browser();await ready(f);
  f.shipping.rememberOrder('ORDER',f.shipping.requireForPayment('MXN'));
  const calls=f.requests.length;let rejected=0;
  const actions={reject:()=>{rejected++;return Promise.resolve();},order:{patch(){throw Error('Forbidden PATCH');}}};
  const callbacks=f.shipping.paypalCallbacks();
  await callbacks.onShippingAddressChange({orderID:'ORDER',shippingAddress:{countryCode:'MX',postalCode:'00000'}},actions);
  assert.equal(rejected,0);assert.equal(f.requests.length,calls);
  await callbacks.onShippingAddressChange({orderID:'ORDER',shippingAddress:{countryCode:'MX',postalCode:'11111'}},actions);
  assert.equal(rejected,1);assert.throws(()=>f.shipping.requireForCapture('ORDER'));
  f.shipping.setDestination('00000','MX');await ready(f);
  f.shipping.rememberOrder('ORDER',f.shipping.requireForPayment('MXN'));
  const response=f.ctx.fetch;f.ctx.fetch=async()=>({ok:true,json:async()=>({quotes:[rate('MXN',{quote_token:'new-token-same-postal'})]})});
  await ready(f);assert.throws(()=>f.shipping.requireForCapture('ORDER'));
  f.ctx.fetch=response;
});
test('PayPal create/capture send the original token and normalize shipping into breakdown once',async()=>{
  const f=browser({respond:async(path,body)=>{
    if(path==='/api/shipping/quote')return{ok:true,json:async()=>({quotes:[rate()]})};
    if(path==='/api/checkout/prices')return{ok:true,json:async()=>({items:[{unit_price:4370}]})};
    if(path==='/api/checkout/paypal/create')return{ok:true,json:async()=>({id:'ORDER'})};
    if(path==='/api/checkout/paypal/capture')return{ok:true,json:async()=>({id:'ORDER',status:'COMPLETED'})};
    throw Error('Unexpected request');
  }});
  await ready(f);vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),f.ctx);
  const payload={purchase_units:[{items:[{sku:'TEST-A',name:'Test product',quantity:'1',unit_amount:{currency_code:'MXN',value:'4370.00'}},
    {name:'Envío',quantity:'1',unit_amount:{currency_code:'MXN',value:'429.00'}}],
    amount:{currency_code:'MXN',value:'4799.00',breakdown:{item_total:{currency_code:'MXN',value:'4799.00'}}}}]};
  await f.ctx.window.MJPayPalPricing.create({},payload);
  await f.ctx.window.MJPayPalPricing.capture('ORDER');
  const created=f.requests.find(r=>r.path.endsWith('/paypal/create')).body;
  assert.equal(created.shipping_quote_token,'signed-test-rate');
  assert.equal(created.payload.purchase_units[0].items.length,1);
  assert.equal(created.payload.purchase_units[0].amount.breakdown.item_total.value,'4370.00');
  assert.equal(created.payload.purchase_units[0].amount.breakdown.shipping.value,'429.00');
  assert.equal(created.payload.purchase_units[0].amount.value,'4799.00');
  assert.equal(f.requests.find(r=>r.path.endsWith('/paypal/capture')).body.shipping_quote_token,created.shipping_quote_token);
});
test('shipping errors occur before capture and do not become uncertain-payment errors',async()=>{
  const f=browser({respond:async(path)=>path==='/api/shipping/quote'?{ok:true,json:async()=>({quotes:[rate()]})}:
    {ok:false,json:async()=>({error_code:'SHIPPING_ADDRESS_REQUIRED'})}});
  await ready(f);f.shipping.rememberOrder('ORDER',f.shipping.requireForPayment('MXN'));
  vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),f.ctx);
  await assert.rejects(()=>f.ctx.window.MJPayPalPricing.capture('ORDER'),error=>error.code==='SHIPPING_ADDRESS_REQUIRED' && !/incierto|verificando tu pago/i.test(error.message));
  f.shipping.setDestination('11111','MX');const count=f.requests.length;
  await assert.rejects(()=>f.ctx.window.MJPayPalPricing.capture('ORDER'));
  assert.equal(f.requests.length,count);
});
test('an expired original token can recover a completed receipt, while a new capture is rejected by Proax',async()=>{
  for (const completed of [false,true]) {
    const f=browser({respond:async(path)=>path==='/api/shipping/quote'?{ok:true,json:async()=>({quotes:[rate()]})}:
      completed?{ok:true,json:async()=>({id:'ORDER',status:'COMPLETED'})}:{ok:false,json:async()=>({error_code:'SHIPPING_QUOTE_EXPIRED'})}});
    await ready(f);f.shipping.rememberOrder('ORDER',f.shipping.requireForPayment('MXN'));f.advance(61000);
    vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),f.ctx);
    if(completed)assert.equal((await f.ctx.window.MJPayPalPricing.capture('ORDER')).status,'COMPLETED');
    else await assert.rejects(()=>f.ctx.window.MJPayPalPricing.capture('ORDER'),error=>error.code==='SHIPPING_QUOTE_EXPIRED' && error.code!=='PAYMENT_STATUS_UNCERTAIN');
    assert.equal(f.requests.find(request=>request.path.endsWith('/paypal/capture')).body.shipping_quote_token,'signed-test-rate');
    assert.throws(()=>f.shipping.requireForPayment('MXN'),/caducó/); // A new payment still fails before its request.
  }
});
