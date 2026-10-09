const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const checkoutRef=Buffer.alloc(32,7).toString('base64url');
function fixture(currency='MXN',options={}) {
  const elements={},events={},listeners={},requests=[],stored=options.stored || new Map(),alerts=[];
  let cart=[{id:1,sku:'TEST',name:'Fixture product',price:100,price_usd:10,priceUsd:10,qty:1}];
  const node=id=>elements[id]||(elements[id]={id,style:{},hidden:false,textContent:'',value:'',innerHTML:'',
    hasChildNodes:()=>false,addEventListener(){},append(child){child.parentNode=this;},focus(){}});
  const form=node('co-form');form.qty=node('co-qty');form.qty.value='1';form.checkValidity=()=>false;form.reportValidity=()=>{throw Error('PayPal must not ask for the card form');};
  const product={...cart[0]};
  const ctx={window:{location:{pathname:currency==='USD'?'/en/checkout.html':'/checkout.html'},
    addEventListener:(event,fn)=>(listeners[event] ||= []).push(fn),MJCheckoutProduct:product,
    MJCart:{getCart:()=>cart,saveCart:next=>{cart=next;},clearCart(){throw Error('Unpaid cart items must be preserved');}},
    sessionStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},
    MJPayPalSync:{save:async()=>{},errorMessage:(_error,fallback)=>fallback}},
    document:{readyState:'loading',documentElement:{lang:currency==='USD'?'en':'es'},getElementById:node,
      addEventListener:(event,fn)=>(events[event] ||= []).push(fn)},
    console:{log(){},error(){},warn(){}},alert:message=>alerts.push(message),setTimeout:fn=>fn(),
    fetch:async(path,init={})=>{
      const body=init.body ? JSON.parse(init.body) : undefined;requests.push({path,body});
      if(path==='/api/checkout/paypal/config') {
        if(options.configReply)return options.configReply();
        return{ok:true,json:async()=>({nativeShipping:options.nativeShipping!==false})};
      }
      if(path==='/api/checkout/prices')return{ok:true,json:async()=>({items:body.items.map(item=>({sku:item.sku,name:item.name,
        price:100,price_usd:10,unit_price:currency==='USD'?10:100}))})};
      if(path==='/api/checkout/paypal/create')return{ok:true,json:async()=>({id:'ORDER-'+currency,checkout_ref:options.checkoutRef || checkoutRef,shipping_state:'PENDING'})};
      if(path==='/api/checkout/paypal/capture') {
        if(options.captureReply)return options.captureReply(body);
        return{ok:true,json:async()=>({id:body.orderId,status:'COMPLETED'})};
      }
      throw Error('Unexpected request '+path);
    }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/shipping-checkout.js','utf8'),ctx);
  ctx.window.MJShippingCheckout.configure({currency,items:()=>cart});
  vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),ctx);
  return{ctx,elements,events,requests,stored,alerts,getCart:()=>cart,setCart:next=>{cart=next;},node};
}
function payload(currency='MXN') {
  const amount=currency==='USD'?'10.00':'100.00';
  return{intent:'CAPTURE',purchase_units:[{items:[{sku:'TEST',name:'Fixture product',quantity:'1',unit_amount:{currency_code:currency,value:amount}}],
    amount:{currency_code:currency,value:amount,breakdown:{item_total:{currency_code:currency,value:amount}}}}]};
}
async function entrypoint(f,kind,currency) {
  let options;
  f.ctx.paypal={Buttons:value=>{options=value;return{render:()=>Promise.resolve()}}};
  if(kind==='normal') {
    vm.runInContext(fs.readFileSync('js/paypal-checkout.js','utf8'),f.ctx);await f.ctx.window.MJPayPal.init();
  } else {
    const file=(currency==='USD'?'en/':'')+(kind==='cart'?'cart.html':'checkout.html');
    const scripts=[...fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
    if(kind==='cart') {
      vm.runInContext(scripts.find(code=>code.includes('function initPayPalCart()')),f.ctx);
      f.events.DOMContentLoaded.at(-1)();
    } else {
      f.ctx.document.readyState='complete';
      vm.runInContext(scripts.find(code=>code.includes('function initPayPalExpress()')),f.ctx);
    }
    await new Promise(setImmediate);
  }
  return options;
}
for(const currency of ['MXN','USD'])for(const kind of ['normal','express','cart']) {
  test(`native ${kind} ${currency} opens without storefront address and sends merchandise only`,async()=>{
    const f=fixture(currency),options=await entrypoint(f,kind,currency);
    let enabled=false,resolved=false;
    options.onInit({}, {enable(){enabled=true;},disable(){enabled=false;}});assert(enabled);
    options.onClick({}, {resolve(){resolved=true;},reject(){throw Error('Native PayPal needs no storefront shipping quote');}});assert(resolved);
    assert.equal(options.onShippingAddressChange,undefined);assert.equal(options.onShippingOptionsChange,undefined);
    await options.createOrder({},{});
    const created=f.requests.find(request=>request.path.endsWith('/paypal/create')).body,unit=created.payload.purchase_units[0];
    assert.equal(created.native_shipping,true);assert.equal(created.shipping_quote_token,undefined);
    assert.equal(unit.amount.value,currency==='USD'?'10.00':'100.00');
    assert.equal(unit.amount.breakdown.shipping,undefined);assert.equal(unit.shipping,undefined);
    assert.equal(unit.items.length,1);assert.equal(unit.items[0].sku,'TEST');
    assert(f.elements['mj-shipping-checkout'].hidden);
    assert.equal(f.elements['co-form'].style.display,'none');
    assert(!f.requests.some(request=>request.path==='/api/shipping/quote'));
    const pricing=f.ctx.window.MJPayPalPricing;
    await pricing.capture('ORDER-'+currency);
    const captured=f.requests.find(request=>request.path.endsWith('/paypal/capture')).body;
    assert.deepEqual(captured,{orderId:'ORDER-'+currency,checkout_ref:checkoutRef});
    if(kind==='cart') {
      f.setCart([{sku:'TEST',name:'Fixture product',qty:3},{sku:'ADDED',name:'Later product',qty:1}]);
      pricing.completeCart('ORDER-'+currency);
      assert.deepEqual(JSON.parse(JSON.stringify(f.getCart())),[{sku:'TEST',name:'Fixture product',qty:2},{sku:'ADDED',name:'Later product',qty:1}]);
    }
  });
}
test('both product quantity selectors remain outside the optional address form with a single associated input',()=>{
  for(const file of ['checkout.html','en/checkout.html']) {
    const html=fs.readFileSync(file,'utf8'),formStart=html.indexOf('<form id="co-form"');
    assert(html.indexOf('id="co-qty-display"')<formStart);
    assert(html.indexOf('id="co-qty"')<formStart);
    assert.equal([...html.matchAll(/id="co-qty-display"/g)].length,1);
    assert.equal([...html.matchAll(/id="co-qty"/g)].length,1);
    assert.match(html,/<input[^>]+id="co-qty"[^>]+form="co-form"/);
  }
});
for(const currency of ['MXN','USD'])for(const kind of ['normal','express']) {
  test(`native ${kind} ${currency} preserves a quantity of two while the address form is hidden`,async()=>{
    const f=fixture(currency),options=await entrypoint(f,kind,currency);
    f.node('co-qty').value='2';
    assert.equal(f.node('co-form').style.display,'none');
    await options.createOrder({},{});
    const created=f.requests.find(request=>request.path.endsWith('/paypal/create')).body.payload.purchase_units[0];
    assert.equal(created.items[0].quantity,'2');assert.equal(created.amount.value,currency==='USD'?'20.00':'200.00');
    assert.equal(f.requests.find(request=>request.path==='/api/checkout/prices').body.items[0].quantity,'2');
  });
}
test('capability is cached and cannot enable native shipping on errors or a nonboolean flag',async()=>{
  for(const reply of [()=>{throw Error('offline');},()=>({ok:false,json:async()=>({nativeShipping:true})}),()=>({ok:true,json:async()=>({nativeShipping:'true'})})]) {
    const f=fixture('MXN',{configReply:reply}),pricing=f.ctx.window.MJPayPalPricing;
    await Promise.all([pricing.init(),pricing.init()]);assert.equal(pricing.nativeShippingEnabled(),false);
    assert.equal(f.requests.filter(request=>request.path.endsWith('/paypal/config')).length,1);
    assert.equal(f.elements['mj-shipping-checkout'].hidden,false);
    await assert.rejects(()=>pricing.create({},payload()),error=>error.code==='SHIPPING_QUOTE_REQUIRED');
    assert(!f.requests.some(request=>request.path.endsWith('/paypal/create')));
  }
});
test('PayPal buttons wait for backend capability before rendering or hiding the quote widget',async()=>{
  let finish;
  const f=fixture('MXN',{configReply:()=>new Promise(resolve=>{finish=resolve;})});let rendered=false;
  f.ctx.paypal={Buttons:()=>{rendered=true;return{render:()=>Promise.resolve()}}};
  vm.runInContext(fs.readFileSync('js/paypal-checkout.js','utf8'),f.ctx);
  const ready=f.ctx.window.MJPayPal.init();await new Promise(setImmediate);
  assert.equal(rendered,false);assert.equal(f.node('mj-shipping-checkout').hidden,false);
  finish({ok:true,json:async()=>({nativeShipping:true})});await ready;
  assert.equal(rendered,true);assert.equal(f.node('mj-shipping-checkout').hidden,true);
});
test('choosing card reveals its address and quote fields but still cannot pay without a signed quote',async()=>{
  const f=fixture(),pricing=f.ctx.window.MJPayPalPricing;await pricing.init();
  assert.equal(f.node('co-form').style.display,'none');assert.equal(f.node('mj-shipping-checkout').hidden,true);
  f.ctx.window.MJShippingCheckout.showCardFields();
  assert.equal(f.node('co-form').style.display,'flex');assert.equal(f.node('mj-shipping-checkout').hidden,false);
  assert.equal(f.node('mj-shipping-checkout').parentNode,f.node('mj-card-shipping'));
  assert.throws(()=>f.ctx.window.MJShippingCheckout.requireForPayment('MXN'),error=>error.code==='SHIPPING_QUOTE_REQUIRED');
});
test('returning from card to native PayPal hides card fields and its price without losing the prepared card checkout',async()=>{
  const f=fixture(),options=await entrypoint(f,'cart','MXN'),shipping=f.ctx.window.MJShippingCheckout;
  const fetcher=f.ctx.fetch;
  f.ctx.fetch=(path,init)=>path==='/api/shipping/quote'
    ? Promise.resolve({ok:true,json:async()=>({quotes:[{id:'test-ground',carrier:'carrier',service:'ground',price:30,currency:'MXN',quote_token:'signed-card-quote'}]})})
    : fetcher(path,init);
  shipping.showCardFields();shipping.setDestination('00000','MX');
  f.node('co-email').value='typed@example.test';
  await shipping.quote();shipping.selectRate(0);
  assert.equal(f.node('cart-shipping').textContent,'$30.00 MXN');
  assert.equal(f.node('cart-total-label').textContent,'Total');
  let resolved=false;options.onClick({}, {resolve(){resolved=true;},reject(){throw Error('Native PayPal should open');}});
  assert(resolved);assert.equal(shipping.state().cardMode,false);
  assert.equal(f.node('mj-card-checkout').hidden,true);assert.equal(f.node('co-form').style.display,'none');
  assert.equal(f.node('mj-shipping-checkout').hidden,true);
  assert.equal(f.node('cart-shipping').textContent,'Se calcula en PayPal');
  assert.equal(f.node('cart-total-label').textContent,'Importe de productos');
  assert.equal(f.node('cart-total').textContent,'$100.00');
  assert.equal(f.node('co-email').value,'typed@example.test');
  assert.equal(shipping.state().selected.quote_token,'signed-card-quote');
  shipping.showCardFields();
  assert.equal(f.node('mj-shipping-checkout').hidden,false);
  assert.equal(shipping.requireForPayment('MXN').quote_token,'signed-card-quote');
});
test('the PayPal layout helper leaves the classic shipping and card selection unchanged',async()=>{
  const f=fixture('MXN',{nativeShipping:false}),shipping=f.ctx.window.MJShippingCheckout;
  await f.ctx.window.MJPayPalPricing.init();shipping.showCardFields();
  shipping.showPayPalFields();
  assert.equal(shipping.state().cardMode,true);assert.equal(f.node('mj-card-checkout').hidden,false);
  assert.equal(f.node('mj-shipping-checkout').hidden,false);
});
test('invalid native references never reach capture',async()=>{
  const f=fixture('MXN',{checkoutRef:'invalid'}),pricing=f.ctx.window.MJPayPalPricing;await pricing.init();
  const original=payload();
  await assert.rejects(()=>pricing.create({},original),/prepare PayPal/);
  assert.equal(original.purchase_units[0].amount.breakdown.shipping,undefined);
  await assert.rejects(()=>pricing.capture('ORDER-MXN'),/recover.*checkout/);
  assert(!f.requests.some(request=>request.path.endsWith('/paypal/capture')));
});
test('the clicked merchandise stays frozen while a trusted price request is in flight',async()=>{
  const f=fixture(),pricing=f.ctx.window.MJPayPalPricing;await pricing.init();
  const fetcher=f.ctx.fetch;let finish;
  f.ctx.fetch=(path,init)=>path==='/api/checkout/prices' ? new Promise(resolve=>{finish=resolve;}) : fetcher(path,init);
  const original=payload(),pending=pricing.create({},original,{cart:true});
  original.purchase_units[0].items[0].sku='CHANGED';original.purchase_units[0].items[0].quantity='9';
  finish({ok:true,json:async()=>({items:[{unit_price:100}]})});await pending;
  const item=f.requests.find(request=>request.path.endsWith('/paypal/create')).body.payload.purchase_units[0].items[0];
  assert.equal(item.sku,'TEST');assert.equal(item.quantity,'1');
});
test('an uncertain native capture persists across reload, blocks another payment, and recovers the same order after disabling the feature',async()=>{
  const f=fixture('MXN',{captureReply:()=>{throw Error('offline');}}),pricing=f.ctx.window.MJPayPalPricing;
  await pricing.init();await pricing.create({},payload());
  await assert.rejects(()=>pricing.capture('ORDER-MXN'),error=>error.code==='PAYMENT_STATUS_UNCERTAIN');
  const calls=f.requests.length;
  await assert.rejects(()=>pricing.create({},payload()),error=>error.code==='PAYMENT_STATUS_UNCERTAIN');
  assert.equal(f.requests.length,calls);
  const restored=fixture('MXN',{stored:f.stored,nativeShipping:false}),recovery=restored.ctx.window.MJPayPalPricing;
  await recovery.init();assert.equal(recovery.nativeShippingEnabled(),false);
  await assert.rejects(()=>recovery.create({},payload()),error=>error.code==='PAYMENT_STATUS_UNCERTAIN');
  const result=await recovery.capture('ORDER-MXN');assert.equal(result.status,'COMPLETED');
  assert.deepEqual(restored.requests.find(request=>request.path.endsWith('/paypal/capture')).body,{orderId:'ORDER-MXN',checkout_ref:checkoutRef});
});
test('conflicting capture, in-progress, lookup and unavailable storage stay uncertain, while missing shipping is rejected before capture',async()=>{
  for(const code of ['NATIVE_SHIPPING_CONFLICT','NATIVE_SHIPPING_CAPTURE_IN_PROGRESS','NATIVE_SHIPPING_STORAGE_UNAVAILABLE','PAYPAL_LOOKUP_FAILED','NATIVE_SHIPPING_PAID_MISMATCH','PAYPAL_CAPTURE_STATUS_PENDING','NATIVE_SHIPPING_NOT_READY']) {
    const f=fixture('MXN',{captureReply:()=>({ok:false,json:async()=>({error_code:code})})}),pricing=f.ctx.window.MJPayPalPricing;
    await pricing.init();await pricing.create({},payload());
    await assert.rejects(()=>pricing.capture('ORDER-MXN'),error=>error.code===(code==='NATIVE_SHIPPING_NOT_READY'?code:'PAYMENT_STATUS_UNCERTAIN'));
    if(code!=='NATIVE_SHIPPING_NOT_READY')await assert.rejects(()=>pricing.create({},payload()),error=>error.code==='PAYMENT_STATUS_UNCERTAIN');
  }
});
test('an approved checkout stopped by feature-off or session expiry retains its reference without marking payment uncertain',async()=>{
  for(const currency of ['MXN','USD'])for(const code of ['NATIVE_SHIPPING_UNAVAILABLE','NATIVE_SHIPPING_EXPIRED']) {
    const f=fixture(currency,{captureReply:()=>({ok:false,json:async()=>({error_code:code})})}),pricing=f.ctx.window.MJPayPalPricing;
    await pricing.init();await pricing.create({},payload(currency));
    const orderId='ORDER-'+currency;
    await assert.rejects(()=>pricing.capture(orderId),error=>{
      assert.equal(error.code,code);assert(!/verifying your payment|verificando tu pago/i.test(error.message));return true;
    });
    const saved=JSON.parse(f.stored.get('mj_paypal_native_orders_v1'))[orderId];
    assert.equal(saved.checkout_ref,checkoutRef);assert.equal(saved.capturePending,false);
    assert.equal(pricing.selectionForPayPal(currency).pending,true);
    assert.equal(f.requests.filter(request=>request.path.endsWith('/paypal/capture')).length,1);
  }
});
