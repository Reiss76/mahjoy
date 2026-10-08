const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {installShippingFixture}=require('./shipping-client-fixtures');
function browser({complete=true,reply,quoted=true,cart:initialCart,catalogPrices,discount}={}) {
  const requests=[],saved={},alerts=[];
  const values={customer_name:'Fixture recipient',customer_email:'fixture@example.test',customer_phone:'5550000000',
    shipping_street:'Fixture street 1',shipping_city:'Fixture city',shipping_state:'NL'};
  const elements={};
  const form={checkValidity:()=>complete,reportValidity(){},addEventListener(){},elements:{namedItem:name=>({value:values[name]})}};
  elements['mj-card-form']=form;elements['mj-card-submit']={disabled:false};
  const cart=initialCart || [{id:1,sku:'TEST',name:'Fixture product',price:4370,qty:1}];
  const ctx={window:{location:{pathname:'/cart.html',href:'/cart.html'},addEventListener(){},MJCart:{getCart:()=>cart,clearCart(){}}},
    document:{getElementById:id=>elements[id]||(elements[id]={style:{},textContent:'',addEventListener(){}}),addEventListener(){}},
    localStorage:{setItem:(key,value)=>saved[key]=value},alert:text=>alerts.push(text),
    fetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});return reply || {ok:true,json:async()=>({ok:true,orderId:'SERVER-CANONICAL',checkoutUrl:'https://payments.example.test/canonical'})};}};
  installShippingFixture(ctx,{price:429,currency:'MXN'});
  ctx.window.cartDiscount=discount;
  ctx.window.MJPayPalPricing={quote:async()=>cart.map(item=>({sku:item.sku,unit_price:catalogPrices?.[item.sku] ?? 4370}))};
  if(!quoted)ctx.window.MJShippingCheckout.requireForPayment=()=>{throw Error('Shipping quote required');};
  vm.createContext(ctx);
  const scripts=[...fs.readFileSync('cart.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  vm.runInContext(scripts.find(code=>code.includes('function renderCart()')),ctx);
  return{ctx,requests,saved,alerts,form};
}
test('cart card checkout never creates a link for missing address fields or missing shipping',async()=>{
  for(const options of [{complete:false},{quoted:false}]){
    const fixture=browser(options);await fixture.ctx.proceedToCheckout({preventDefault(){}});assert.equal(fixture.requests.length,0);
  }
});
test('card checkout sends complete delivery details once and uses the server order reference',async()=>{
  const fixture=browser();await fixture.ctx.proceedToCheckout({preventDefault(){}});
  assert.equal(fixture.requests.length,1);const request=fixture.requests[0];
  assert.equal(request.path,'/api/centumpay/checkout');
  assert.equal(request.body.shipping_quote_token,'test-signed-MXN');assert.equal(request.body.shipping_cost,429);
  for(const key of ['customer_name','customer_email','customer_phone','shipping_street','shipping_city','shipping_state'])assert(request.body[key]);
  assert.equal(request.body.shipping_cp,'00000');assert.equal(request.body.orderId,undefined);
  assert.equal(fixture.saved.mj_last_order_id,'SERVER-CANONICAL');assert.equal(fixture.ctx.window.location.href,'https://payments.example.test/canonical');
  assert(!fixture.requests.some(request=>request.path==='/api/orders/save'));
});
test('an uncertain card response blocks a second checkout attempt',async()=>{
  const fixture=browser({reply:{ok:false,json:async()=>({error_code:'CHECKOUT_UNCERTAIN'})}});
  await fixture.ctx.proceedToCheckout({preventDefault(){}});await fixture.ctx.proceedToCheckout({preventDefault(){}});
  assert.equal(fixture.requests.length,1);assert(fixture.form._checkoutUncertain);
  assert(fixture.alerts.every(text=>/antes de volver/.test(text)));
});
test('in-flight card creation cannot be reenabled by address input or issue a second link',async()=>{
  let finish;
  const fixture=browser({reply:undefined});
  fixture.ctx.fetch=async(path,options)=>{
    fixture.requests.push({path,body:JSON.parse(options.body)});
    return new Promise(resolve=>{finish=resolve;});
  };
  const first=fixture.ctx.proceedToCheckout({preventDefault(){}});
  await new Promise(setImmediate);
  fixture.ctx.updateCardReadiness();
  await fixture.ctx.proceedToCheckout({preventDefault(){}});
  assert.equal(fixture.requests.length,1);assert.equal(fixture.form._checkoutPending,true);
  finish({ok:true,json:async()=>({ok:true,orderId:'SERVER-CANONICAL',checkoutUrl:'https://payments.example.test/canonical'})});
  await first;assert.equal(fixture.form._checkoutPending,false);
});
test('card coupon prices use per-unit rounding and preserve quantities verified by the pricing API',async()=>{
  const fixture=browser({cart:[{sku:'A',name:'Fixture A',price:333.33,qty:2},{sku:'B',name:'Fixture B',price:100.01,qty:3}],
    discount:{code:'TEST-DISCOUNT',pct:10},catalogPrices:{A:300,B:90.01}});
  await fixture.ctx.proceedToCheckout({preventDefault(){}});
  assert.equal(fixture.requests.length,1);const cart=fixture.requests[0].body.cart;
  assert.equal(cart[0].price,300);assert.equal(cart[0].qty,2);assert.equal(cart[1].price,90.01);assert.equal(cart[1].qty,3);
  assert.equal(fixture.requests[0].body.discount_code,'TEST-DISCOUNT');
});
test('USD card path fails before issuing a MXN checkout request',async()=>{
  let requested=false;
  const ctx={window:{MJCart:{getCart:()=>[{sku:'TEST',qty:1}]},addEventListener(){}},document:{getElementById:()=>({}),addEventListener(){}},alert(){},fetch(){requested=true;}};
  installShippingFixture(ctx,{currency:'USD'});vm.createContext(ctx);
  const scripts=[...fs.readFileSync('en/cart.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  vm.runInContext(scripts.find(code=>code.includes('function renderCart()')),ctx);
  await ctx.proceedToCheckout();assert.equal(requested,false);
});
