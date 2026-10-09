const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(currency) {
  const product={id:1,sku:'TEST-SINGLE',name:'Fixture product',price:4370,price_usd:250,priceUsd:250};
  const requests=[];let options;
  const form={qty:{value:'1'},checkValidity:()=>true};const elements={};
  const node=id=>id==='co-form'?form:id==='co-qty'?form.qty:elements[id]||(elements[id]={style:{},textContent:'',hasChildNodes:()=>false});
  const ctx={window:{location:{pathname:currency==='USD'?'/en/checkout.html':'/checkout.html'},MJCheckoutProduct:product},
    document:{readyState:'loading',addEventListener(){},getElementById:node},console:{log(){},error(){},warn(){}},alert(){},setTimeout:fn=>fn(),
    paypal:{Buttons:value=>{options=value;return{render:()=>Promise.resolve()}}},
    fetch:async(path,init)=>{
      if(path==='/api/checkout/paypal/config')return{ok:true,json:async()=>({nativeShipping:false})};
      const body=JSON.parse(init.body);requests.push({path,body});
      if(path==='/api/shipping/quote')return{ok:true,json:async()=>({quotes:[{id:'carrier:ground',carrier:'carrier',service:'ground',carrier_name:'Fixture carrier',service_name:'Fixture home delivery',
        days:3,currency,price:currency==='USD'?30:429,quote_token:'signed-'+currency}]})};
      if(path==='/api/checkout/prices')return{ok:true,json:async()=>({items:[{unit_price:currency==='USD'?250:4370}]})};
      if(path==='/api/checkout/paypal/create')return{ok:true,json:async()=>({id:'ORDER-'+currency})};
      throw Error('Unexpected request '+path);
    }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/shipping-checkout.js','utf8'),ctx);
  ctx.window.MJShippingCheckout.configure({currency,items:()=>[{...product,qty:Number(form.qty.value)}]});
  ctx.window.MJShippingCheckout.setDestination('00000',currency==='USD'?'US':'MX');
  vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),ctx);
  return{ctx,requests,options:()=>options};
}
for(const currency of ['MXN','USD'])for(const kind of ['normal','express']){
  test(`${kind} ${currency} product callback is blocked without a quote and creates once with the actual selected rate`,async()=>{
    const f=fixture(currency);
    if(kind==='normal'){
      vm.runInContext(fs.readFileSync('js/paypal-checkout.js','utf8'),f.ctx);await f.ctx.window.MJPayPal.init();
    }else{
      f.ctx.document.readyState='complete';
      const file=currency==='USD'?'en/checkout.html':'checkout.html';
      const scripts=[...fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
      vm.runInContext(scripts.find(script=>script.includes('function initPayPalExpress()')),f.ctx);await new Promise(setImmediate);
    }
    await assert.rejects(()=>Promise.resolve().then(()=>f.options().createOrder({},{})));
    assert.equal(f.requests.length,0);
    await f.ctx.window.MJShippingCheckout.quote();f.ctx.window.MJShippingCheckout.selectRate(0);
    await f.options().createOrder({},{});
    const create=f.requests.find(request=>request.path==='/api/checkout/paypal/create').body;
    const unit=create.payload.purchase_units[0];
    assert.equal(create.shipping_quote_token,'signed-'+currency);
    assert.equal(unit.items.length,1);assert.equal(unit.items[0].sku,'TEST-SINGLE');
    assert.equal(unit.amount.breakdown.shipping.value,currency==='USD'?'30.00':'429.00');
    assert.equal(unit.amount.value,currency==='USD'?'280.00':'4799.00');
    assert.equal(unit.shipping.options[0].label,'Fixture carrier · Fixture home delivery');
    assert(f.options().onShippingAddressChange);assert.equal(f.options().onShippingChange,undefined);
  });
}
test('all storefront payment pages load the signed shipping widget before the payment helper',()=>{
  for(const file of ['cart.html','en/cart.html','checkout.html','en/checkout.html']){
    const html=fs.readFileSync(file,'utf8');
    assert(html.includes('id="mj-shipping-checkout"'));
    assert(html.indexOf('js/shipping-checkout.js')<html.indexOf('js/paypal-pricing.js'));
    assert(!html.includes('ESTIMATED_SHIPPING'));assert(!html.includes('US_SHIPPING_FLAT'));assert(!html.includes('order.patch'));
  }
});
