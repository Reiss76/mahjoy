const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const checkoutRef=Buffer.alloc(32,7).toString('base64url');
function fixture(currency='MXN',options={}) {
  const elements={},events={},listeners={},requests=[],stored=options.stored || new Map(),alerts=[];
  let cart=options.cart || [{id:1,sku:'TEST',name:'Fixture product',price:100,price_usd:10,priceUsd:10,qty:1}];
  const node=id=>elements[id]||(elements[id]={id,style:{},hidden:false,textContent:'',value:'',innerHTML:'',
    hasChildNodes:()=>false,addEventListener(){},append(child){child.parentNode=this;},focus(){}});
  const form=node('co-form');form.qty=node('co-qty');form.qty.value='1';form.checkValidity=()=>false;form.reportValidity=()=>{throw Error('PayPal must not ask for the card form');};
  node('mj-paypal-delivery-phone').value=options.deliveryPhone===undefined?'(55) 5123 4567':options.deliveryPhone;
  const product={...cart[0]};
  const ctx={window:{location:{pathname:currency==='USD'?'/en/checkout.html':'/checkout.html'},
    addEventListener:(event,fn)=>(listeners[event] ||= []).push(fn),dispatchEvent:event=>{for(const fn of listeners[event.type] || [])fn(event);},MJCheckoutProduct:product,
    MJCart:{getCart:()=>cart,saveCart:next=>{cart=next;},clearCart(){throw Error('Unpaid cart items must be preserved');}},
    sessionStorage:{getItem:key=>stored.get(key),setItem:(key,value)=>stored.set(key,value)},
    MJPayPalSync:{save:async()=>{},errorMessage:(_error,fallback)=>fallback}},
    document:{readyState:'loading',documentElement:{lang:currency==='USD'?'en':'es'},getElementById:node,
      addEventListener:(event,fn)=>(events[event] ||= []).push(fn)},
    console:{log(){},error(){},warn(){}},alert:message=>alerts.push(message),setTimeout:fn=>fn(),Event:class {constructor(type){this.type=type;}},
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
      if(path==='/api/shipping/quote')return{ok:true,json:async()=>({quotes:[{id:'fixture-rate',carrier:'fixture',service:'ground',price:30,currency,quote_token:'signed-'+currency}]})};
      throw Error('Unexpected request '+path);
    }};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/shipping-checkout.js','utf8'),ctx);
  ctx.window.MJShippingCheckout.configure({currency,items:()=>cart});
  vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),ctx);
  return{ctx,elements,events,listeners,requests,stored,alerts,getCart:()=>cart,setCart:next=>{cart=next;},node,rendered:[],closed:0};
}
function payload(currency='MXN') {
  const amount=currency==='USD'?'10.00':'100.00';
  return{intent:'CAPTURE',purchase_units:[{items:[{sku:'TEST',name:'Fixture product',quantity:'1',unit_amount:{currency_code:currency,value:amount}}],
    amount:{currency_code:currency,value:amount,breakdown:{item_total:{currency_code:currency,value:amount}}}}]};
}
function bundleItem(extra={}) {return {id:'bundle-9',sku:'BUNDLE-9',name:'Fixture bundle',price:100,price_usd:10,qty:1,...extra};}
function quotedPayload(currency='MXN',sku='BUNDLE-9') {
  const result=payload(currency),unit=result.purchase_units[0];unit.items[0].sku=sku;
  unit.amount.value=currency==='USD'?'40.00':'130.00';unit.amount.breakdown.shipping={currency_code:currency,value:'30.00'};
  return result;
}
async function selectQuote(f,currency) {
  const shipping=f.ctx.window.MJShippingCheckout;
  shipping.setDestination(currency==='USD'?'10001':'85219',currency==='USD'?'US':'MX');await shipping.quote();shipping.selectRate(0);
}
async function entrypoint(f,kind,currency) {
  let options;
  f.ctx.paypal={Buttons:value=>{options=value;f.rendered.push(value);return{render:()=>Promise.resolve(),close:()=>{f.closed++;return Promise.resolve();}}}};
  if(kind==='normal') {
    vm.runInContext(fs.readFileSync('js/paypal-checkout.js','utf8'),f.ctx);await f.ctx.window.MJPayPal.init();
  } else {
    const file=(currency==='USD'?'en/':'')+(kind==='cart'?'cart.html':'checkout.html');
    const scripts=[...fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
    if(kind==='cart') {
      f.ctx.window.location.pathname=(currency==='USD'?'/en':'')+'/cart.html';
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
    assert.equal(created.delivery_phone,undefined);
    assert.equal(created.physicalItems,undefined);assert.equal(created.frozenPhysicalItems,undefined);
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
test('all four storefront entrypoints leave delivery contact collection inside PayPal and preserve card forms',()=>{
  for(const file of ['checkout.html','en/checkout.html','cart.html','en/cart.html']) {
    const html=fs.readFileSync(file,'utf8');
    assert(!html.includes('mj-paypal-delivery-phone'));assert(!html.includes('mj-paypal-delivery-contact'));
    if(file.endsWith('checkout.html')) {
      assert.match(html,/<form[^>]+id="co-form"/);assert.match(html,/name="phone"/);
    }
    if(file==='cart.html') {
      assert.match(html,/id="mj-card-checkout"/);assert.match(html,/name="customer_phone"[^>]+required/);
    }
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
test('native MXN opens and creates without consulting absent or invalid storefront delivery phone',async()=>{
  for(const phone of ['', '+15551234567']){
    const f=fixture('MXN',{deliveryPhone:phone}),options=await entrypoint(f,'express','MXN');let rejected=false;
    if(!phone)f.ctx.document.getElementById=id=>id==='mj-paypal-delivery-phone'?null:f.node(id);
    else Object.defineProperty(f.node('mj-paypal-delivery-phone'),'value',{get(){throw Error('Storefront delivery phone must never be read');}});
    options.onClick({}, {resolve(){},reject(){rejected=true;}});
    assert.equal(rejected,false);assert.equal(f.alerts.length,0);
    await options.createOrder({},{});
    assert.equal(f.requests.find(request=>request.path.endsWith('/paypal/create')).body.delivery_phone,undefined);
    assert.equal(f.requests.filter(request=>request.path==='/api/checkout/prices').length,1);
    assert.equal(f.node('co-form').style.display,'none');
  }
});
test('USD native checkout keeps its PayPal contact module without imposing Mexican phone format',async()=>{
  const f=fixture('USD',{deliveryPhone:'not a Mexican phone'}),pricing=f.ctx.window.MJPayPalPricing;await pricing.init();await pricing.create({},payload('USD'));
  const body=f.requests.find(request=>request.path.endsWith('/paypal/create')).body;
  assert.equal(body.delivery_phone,undefined);assert.equal(body.payload.payment_source.paypal.experience_context.contact_preference,'UPDATE_CONTACT_INFO');
  assert.equal(f.alerts.length,0);
});
test('new native orders never persist storefront phone and legacy stored contact cannot reach recovered capture',async()=>{
  const f=fixture(),pricing=f.ctx.window.MJPayPalPricing;await pricing.init();
  const fetcher=f.ctx.fetch;let finish;
  f.ctx.fetch=(path,init)=>path==='/api/checkout/prices'?new Promise(resolve=>{finish=resolve;}):fetcher(path,init);
  const pending=pricing.create({},payload());f.node('mj-paypal-delivery-phone').value='8187654321';
  finish({ok:true,json:async()=>({items:[{unit_price:100}]})});await pending;
  assert.equal(f.requests.find(request=>request.path.endsWith('/paypal/create')).body.delivery_phone,undefined);
  const stored=()=>JSON.parse(f.stored.get('mj_paypal_native_orders_v1'))['ORDER-MXN'];
  assert.equal(stored().delivery_phone,undefined);
  f.ctx.fetch=async()=>{throw Error('offline');};await assert.rejects(()=>pricing.capture('ORDER-MXN'),error=>error.code==='PAYMENT_STATUS_UNCERTAIN');
  assert.equal(stored().delivery_phone,undefined);
  const legacy=JSON.parse(f.stored.get('mj_paypal_native_orders_v1'));legacy['ORDER-MXN'].delivery_phone='+525551234567';
  f.stored.set('mj_paypal_native_orders_v1',JSON.stringify(legacy));
  const recovery=fixture('MXN',{stored:f.stored,deliveryPhone:'5511112222',nativeShipping:false});await recovery.ctx.window.MJPayPalPricing.init();await recovery.ctx.window.MJPayPalPricing.capture('ORDER-MXN');
  assert.deepEqual(recovery.requests.find(request=>request.path.endsWith('/paypal/capture')).body,{orderId:'ORDER-MXN',checkout_ref:checkoutRef});
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
test('an approved checkout stopped before charge retains its reference without marking payment uncertain',async()=>{
  for(const currency of ['MXN','USD'])for(const code of ['NATIVE_SHIPPING_UNAVAILABLE','NATIVE_SHIPPING_EXPIRED','NATIVE_SHIPPING_PHYSICAL_MISMATCH']) {
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
for(const currency of ['MXN','USD'])for(const kind of ['normal','express','cart']) {
  test(`configured classic ${kind} ${currency} bundle still requires its original signed quote`,async()=>{
    const f=fixture(currency,{cart:[bundleItem()],nativeShipping:false}),options=await entrypoint(f,kind,currency);
    assert.equal(typeof options.onShippingAddressChange,'function');assert.equal(typeof options.onShippingOptionsChange,'function');
    let enabled=true,rejected=false;
    options.onInit({}, {enable(){enabled=true;},disable(){enabled=false;}});assert.equal(enabled,false);
    options.onClick({}, {resolve(){throw Error('Classic bundle needs its signed quote');},reject(){rejected=true;}});assert(rejected);
    await selectQuote(f,currency);assert(enabled);
    options.onClick({}, {resolve(){},reject(){throw Error('Quoted classic bundle must open');}});await options.createOrder({},{});
    const sent=f.requests.find(r=>r.path.endsWith('/paypal/create')).body,unit=sent.payload.purchase_units[0];
    assert.equal(sent.native_shipping,undefined);assert.equal(sent.shipping_quote_token,'signed-'+currency);assert.equal(sent.delivery_phone,undefined);
    assert.equal(unit.amount.breakdown.shipping.value,'30.00');assert.equal(unit.amount.value,currency==='USD'?'40.00':'130.00');
    await f.ctx.window.MJPayPalPricing.capture('ORDER-'+currency);
    assert.deepEqual(f.requests.find(r=>r.path.endsWith('/paypal/capture')).body,{orderId:'ORDER-'+currency,shipping_quote_token:'signed-'+currency});
  });
  test(`configured native ${kind} ${currency} bundle opens without a storefront quote or contact`,async()=>{
    const f=fixture(currency,{cart:[bundleItem()],deliveryPhone:''}),options=await entrypoint(f,kind,currency),pricing=f.ctx.window.MJPayPalPricing;
    assert.equal(pricing.nativeShippingEnabled(),true);assert.equal(f.node('mj-shipping-checkout').hidden,true);
    assert.equal(options.onShippingAddressChange,undefined);assert.equal(options.onShippingOptionsChange,undefined);
    let enabled=false;options.onInit({}, {enable(){enabled=true;},disable(){enabled=false;}});assert(enabled);
    let resolved=false;options.onClick({}, {resolve(){resolved=true;},reject(){throw Error('Native bundle should open without shipping fields');}});assert(resolved);
    await options.createOrder({},{});
    const sent=f.requests.find(r=>r.path.endsWith('/paypal/create')).body;
    assert.equal(sent.native_shipping,true);assert.equal(sent.delivery_phone,undefined);assert.equal(sent.shipping_quote_token,undefined);
    assert.equal(sent.physicalItems,undefined);assert.equal(sent.frozenPhysicalItems,undefined);
    const unit=sent.payload.purchase_units[0];assert.equal(unit.amount.breakdown.shipping,undefined);assert.equal(unit.shipping,undefined);
    assert.equal(unit.amount.value,currency==='USD'?'10.00':'100.00');assert.equal(unit.items[0].sku,'BUNDLE-9');
    assert(!f.requests.some(r=>r.path==='/api/shipping/quote'));
    await pricing.capture('ORDER-'+currency);
    assert.deepEqual(f.requests.find(r=>r.path.endsWith('/paypal/capture')).body,{orderId:'ORDER-'+currency,checkout_ref:checkoutRef});
  });
}
test('backend native capability is authoritative for bundle identities and mixed carts',async()=>{
  const f=fixture(),pricing=f.ctx.window.MJPayPalPricing;await pricing.init();
  for(const bundle of [{sku:' bUnDlE-9 '},{id:' bundle-9 '},{sku:' ',id:'BuNdLe-9'}])assert.equal(pricing.nativeShippingEnabled([{sku:'TEST'},bundle]),true);
  assert.equal(pricing.nativeShippingEnabled([{sku:'TEST',id:9}]),true);
  const disabled=fixture('MXN',{nativeShipping:false});await disabled.ctx.window.MJPayPalPricing.init();
  assert.equal(disabled.ctx.window.MJPayPalPricing.nativeShippingEnabled([{sku:'TEST'}]),false);
  assert.equal(disabled.ctx.window.MJPayPalPricing.nativeShippingEnabled([bundleItem()]),false);
});
for(const currency of ['MXN','USD']) {
  test(`mixed native ${currency} cart keeps both merchandise lines and no quoted shipping amount`,async()=>{
    const f=fixture(currency,{cart:[{id:1,sku:'TEST',name:'Fixture product',price:100,price_usd:10,qty:1},bundleItem({sku:'bUnDlE-9'})],deliveryPhone:''});
    const options=await entrypoint(f,'cart',currency);
    options.onClick({}, {resolve(){},reject(){throw Error('Mixed cart must open native PayPal');}});await options.createOrder({},{});
    const sent=f.requests.find(r=>r.path.endsWith('/paypal/create')).body;
    assert.equal(sent.native_shipping,true);assert.equal(sent.shipping_quote_token,undefined);assert.equal(sent.delivery_phone,undefined);
    assert.equal(sent.payload.purchase_units[0].items.length,2);assert.equal(sent.payload.purchase_units[0].amount.value,currency==='USD'?'20.00':'200.00');
    assert.equal(sent.payload.purchase_units[0].amount.breakdown.shipping,undefined);
    assert(!f.requests.some(r=>r.path==='/api/shipping/quote'));
  });
  test(`cart ${currency} keeps its native SDK and hidden layout as bundles enter and leave while invalidating card quotes`,async()=>{
    const f=fixture(currency),first=await entrypoint(f,'cart',currency),pricing=f.ctx.window.MJPayPalPricing;
    let changed=0;pricing.registerButtonRenderer(()=>{changed++;});
    assert.equal(f.rendered.length,1);assert.equal(first.onShippingAddressChange,undefined);
    await selectQuote(f,currency);assert(f.ctx.window.MJShippingCheckout.state().selected);
    f.setCart([bundleItem()]);f.ctx.window.dispatchEvent(new f.ctx.Event('mj:cartUpdated'));await new Promise(setImmediate);
    assert.equal(changed,0);assert.equal(f.rendered.length,1);assert.equal(f.closed,0);
    assert.equal(f.ctx.window.MJShippingCheckout.state().selected,null);
    assert.equal(f.node('mj-shipping-checkout').hidden,true);assert.equal(f.node('co-form').style.display,'none');
    assert.equal(f.node('cart-shipping').textContent,currency==='USD'?'Calculated in PayPal':'Se calcula en PayPal');
    assert.equal(pricing.selectionForPayPal(currency).price,0);
    f.setCart([{sku:'TEST',name:'Fixture product',price:100,price_usd:10,qty:1}]);f.ctx.window.dispatchEvent(new f.ctx.Event('mj:cartUpdated'));await new Promise(setImmediate);
    assert.equal(changed,0);assert.equal(f.rendered.length,1);assert.equal(f.closed,0);
    assert.equal(f.rendered.at(-1).onShippingAddressChange,undefined);assert.equal(f.node('mj-shipping-checkout').hidden,true);
    assert.equal(f.ctx.window.MJShippingCheckout.state().selected,null);assert.equal(f.node('co-form').style.display,'none');
    assert.equal(f.requests.filter(r=>r.path.endsWith('/paypal/config')).length,1);
    let resolved=false;first.onClick({}, {resolve(){resolved=true;},reject(){throw Error('The same configured native button remains active');}});assert(resolved);
  });
  test(`native ${currency} creation and recovery retain the original mode after the cart gains a bundle`,async()=>{
    const f=fixture(currency),pricing=f.ctx.window.MJPayPalPricing;f.ctx.window.location.pathname=(currency==='USD'?'/en':'')+'/cart.html';await pricing.init();
    let finish;const fetcher=f.ctx.fetch;f.ctx.fetch=(path,init)=>path==='/api/checkout/prices'?new Promise(resolve=>{finish=resolve;}):fetcher(path,init);
    const pending=pricing.create({},payload(currency),{cart:true});
    f.setCart([bundleItem()]);pricing.refreshCheckoutMode();assert.equal(pricing.nativeShippingEnabled(),true);
    finish({ok:true,json:async()=>({items:[{unit_price:currency==='USD'?10:100}]})});await pending;
    assert.equal(f.requests.find(r=>r.path.endsWith('/paypal/create')).body.native_shipping,true);
    const restored=fixture(currency,{stored:f.stored,cart:[bundleItem()],deliveryPhone:'',nativeShipping:false});await restored.ctx.window.MJPayPalPricing.init();
    assert.equal(restored.ctx.window.MJPayPalPricing.nativeShippingEnabled(),false);
    await restored.ctx.window.MJPayPalPricing.capture('ORDER-'+currency);
    assert.deepEqual(restored.requests.find(r=>r.path.endsWith('/paypal/capture')).body,{orderId:'ORDER-'+currency,checkout_ref:checkoutRef});
  });
  test(`retired ${currency} SDK cancel cannot erase the active clicked cart after an explicit entrypoint rerender`,async()=>{
    const f=fixture(currency),retired=await entrypoint(f,'cart',currency);
    const normal={sku:'TEST',name:'Fixture product',price:100,price_usd:10,qty:1};
    f.setCart([normal]);await entrypoint(f,'cart',currency);assert.equal(f.closed,1);assert.equal(f.rendered.length,2);
    const active=f.rendered.at(-1);active.onClick({}, {resolve(){},reject(){throw Error('Active native button must open');}});
    retired.onCancel();f.setCart([{...normal,qty:2}]);
    const changed=payload(currency),unit=changed.purchase_units[0];unit.items[0].quantity='2';
    unit.amount.value=unit.amount.breakdown.item_total.value=currency==='USD'?'20.00':'200.00';
    await assert.rejects(()=>f.ctx.window.MJPayPalPricing.create({},changed));
    assert(!f.requests.some(r=>r.path==='/api/checkout/prices' || r.path.endsWith('/paypal/create')));
    active.onCancel();await f.ctx.window.MJPayPalPricing.create({},changed);
    assert.equal(f.requests.find(r=>r.path.endsWith('/paypal/create')).body.payload.purchase_units[0].items[0].quantity,'2');
  });
  test(`quoted ${currency} bundle recovery uses the original token after cart changes and native feature becomes enabled`,async()=>{
    const f=fixture(currency,{cart:[bundleItem()],deliveryPhone:'',nativeShipping:false}),pricing=f.ctx.window.MJPayPalPricing;
    f.ctx.window.location.pathname=(currency==='USD'?'/en':'')+'/cart.html';await pricing.init();await selectQuote(f,currency);
    await pricing.create({},quotedPayload(currency),{cart:true});
    f.setCart([{sku:'TEST',price:100,price_usd:10,qty:1}]);pricing.refreshCheckoutMode();assert.equal(pricing.nativeShippingEnabled(),false);
    await pricing.capture('ORDER-'+currency);
    assert.deepEqual(f.requests.find(r=>r.path.endsWith('/paypal/capture')).body,{orderId:'ORDER-'+currency,shipping_quote_token:'signed-'+currency});
    const restored=fixture(currency,{stored:f.stored});await restored.ctx.window.MJPayPalPricing.init();
    assert.equal(restored.ctx.window.MJPayPalPricing.nativeShippingEnabled(),true);
    await restored.ctx.window.MJPayPalPricing.capture('ORDER-'+currency);
    assert.deepEqual(restored.requests.find(r=>r.path.endsWith('/paypal/capture')).body,{orderId:'ORDER-'+currency,shipping_quote_token:'signed-'+currency});
  });
  test(`changing a bundle cart while ${currency} pricing is pending invalidates its selected quote before create`,async()=>{
    const f=fixture(currency,{cart:[bundleItem()],nativeShipping:false}),pricing=f.ctx.window.MJPayPalPricing;
    f.ctx.window.location.pathname=(currency==='USD'?'/en':'')+'/cart.html';await pricing.init();await selectQuote(f,currency);
    let finish;const fetcher=f.ctx.fetch;f.ctx.fetch=(path,init)=>path==='/api/checkout/prices'?new Promise(resolve=>{finish=resolve;}):fetcher(path,init);
    const pending=pricing.create({},quotedPayload(currency));
    f.setCart([bundleItem({qty:2})]);pricing.refreshCheckoutMode();finish({ok:true,json:async()=>({items:[{unit_price:currency==='USD'?10:100}]})});
    await assert.rejects(()=>pending);assert(!f.requests.some(r=>r.path.endsWith('/paypal/create')));
  });
  test(`uncertain quoted ${currency} bundle capture blocks a replacement native payment after reload`,async()=>{
    const f=fixture(currency,{cart:[bundleItem()],nativeShipping:false,captureReply:()=>{throw Error('capture response lost');}}),pricing=f.ctx.window.MJPayPalPricing;
    f.ctx.window.location.pathname=(currency==='USD'?'/en':'')+'/cart.html';await pricing.init();await selectQuote(f,currency);
    await pricing.create({},quotedPayload(currency));await assert.rejects(()=>pricing.capture('ORDER-'+currency),error=>error.code==='PAYMENT_STATUS_UNCERTAIN');
    const restored=fixture(currency,{stored:f.stored});await restored.ctx.window.MJPayPalPricing.init();
    await assert.rejects(()=>restored.ctx.window.MJPayPalPricing.create({},payload(currency)),error=>error.code==='PAYMENT_STATUS_UNCERTAIN');
    await restored.ctx.window.MJPayPalPricing.capture('ORDER-'+currency);
    assert.deepEqual(restored.requests.find(r=>r.path.endsWith('/paypal/capture')).body,{orderId:'ORDER-'+currency,shipping_quote_token:'signed-'+currency});
  });
}
