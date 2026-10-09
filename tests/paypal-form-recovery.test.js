const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Run production shipping, pricing and normal-product button callbacks with the
// existing isolated browser fixture. No SDK, provider or financial request runs.
const source=fs.readFileSync('tests/paypal-native-client.test.js','utf8');
const fixtureSource=source.slice(0,source.indexOf("for(const currency of ['MXN','USD'])for(const kind"));
const harness={require,Buffer,setImmediate,console};vm.createContext(harness);vm.runInContext(fixtureSource,harness);

function unusedCardForm(f) {
  const form=f.node('co-form');form.style.display='none';
  form.email={value:'card-only@example.test'};form.email_confirm={value:'different-card-only@example.test'};
  form.checkValidity=()=>{throw Error('PayPal must not validate the optional card form');};
  form.reportValidity=()=>{throw Error('PayPal must not request card-form contact or address fields');};
  return form;
}
function actions() {
  const result={resolved:0,rejected:0};
  result.resolve=()=>{result.resolved++;};result.reject=()=>{result.rejected++;};
  return result;
}
for(const currency of ['MXN','USD']) {
  test(`normal ${currency} PayPal first click uses its signed quote with a hidden, invalid card form`,async()=>{
    const f=harness.fixture(currency,{nativeShipping:false}),form=unusedCardForm(f);
    const options=await harness.entrypoint(f,'normal',currency);await harness.selectQuote(f,currency);
    let enabled=false;options.onInit({}, {enable(){enabled=true;},disable(){enabled=false;}});assert(enabled);
    const clicked=actions();options.onClick({},clicked);assert.equal(clicked.resolved,1);assert.equal(clicked.rejected,0);
    const orderId=await options.createOrder({},{});
    const created=f.requests.find(request=>request.path.endsWith('/paypal/create')).body;
    assert.equal(created.shipping_quote_token,'signed-'+currency);assert.equal(created.native_shipping,undefined);
    assert.equal(created.payload.application_context.shipping_preference,'GET_FROM_FILE');
    assert(!JSON.stringify(created).includes('card-only@example.test'));
    const address=currency==='USD'?{countryCode:'US',postalCode:'10001'}:{countryCode:'MX',postalCode:'85219'};
    const accepted=actions();await options.onShippingAddressChange({orderID:orderId,shippingAddress:address},accepted);
    assert.equal(accepted.rejected,0);await options.onApprove({orderID:orderId});
    const captured=f.requests.find(request=>request.path.endsWith('/paypal/capture')).body;
    assert.equal(captured.orderId,orderId);assert.equal(captured.shipping_quote_token,created.shipping_quote_token);
    assert.equal(form.email.value,'card-only@example.test');assert.equal(form.email_confirm.value,'different-card-only@example.test');
    assert.equal(f.alerts.length,0);assert(!f.requests.some(request=>request.path.startsWith('/api/centumpay/')));
  });
  test(`normal ${currency} PayPal still rejects an unquoted first click without consulting card fields`,async()=>{
    const f=harness.fixture(currency,{nativeShipping:false});unusedCardForm(f);
    const options=await harness.entrypoint(f,'normal',currency),clicked=actions();
    options.onClick({},clicked);assert.equal(clicked.resolved,0);assert.equal(clicked.rejected,1);
    assert.throws(()=>options.createOrder({},{}),error=>error.code==='SHIPPING_QUOTE_REQUIRED');
    assert(!f.requests.some(request=>request.path==='/api/checkout/prices' || request.path.endsWith('/paypal/create') || request.path.endsWith('/paypal/capture')));
    assert(f.alerts.length>0);
  });
  test(`normal ${currency} static PayPal entry delegates to shared callbacks with no card-form validation`,async()=>{
    const f=harness.fixture(currency,{nativeShipping:false});unusedCardForm(f);
    const options=await harness.entrypoint(f,'normal',currency);await harness.selectQuote(f,currency);
    const clicked=actions();let buttonClicks=0;
    f.ctx.document.querySelector=selector=>{
      assert.equal(selector,'#paypal-button-container .paypal-button');
      return{click(){buttonClicks++;options.onClick({},clicked);}};
    };
    await f.ctx.window.MJPayPal.pay();
    assert.equal(buttonClicks,1);assert.equal(clicked.resolved,1);assert.equal(clicked.rejected,0);
    assert.equal(f.node('paypal-button-container').style.display,'block');
    assert(!f.requests.some(request=>request.path.endsWith('/paypal/create') || request.path.endsWith('/paypal/capture')));
  });
}
test('normal MXN PayPal retains its destination guard and only accepts the original signed postal code',async()=>{
  const f=harness.fixture('MXN',{nativeShipping:false});unusedCardForm(f);
  const options=await harness.entrypoint(f,'normal','MXN');await harness.selectQuote(f,'MXN');
  options.onClick({},actions());const orderId=await options.createOrder({},{}),rejected=actions();
  await options.onShippingAddressChange({orderID:orderId,shippingAddress:{countryCode:'MX',postalCode:'11111'}},rejected);
  assert.equal(rejected.rejected,1);assert.throws(()=>f.ctx.window.MJShippingCheckout.requireForCapture(orderId));
  assert(!f.requests.some(request=>request.path.endsWith('/paypal/capture')));
  await options.onShippingAddressChange({orderID:orderId,shippingAddress:{countryCode:'MX',postalCode:'85219'}},rejected);
  assert.equal(rejected.rejected,1);assert.equal(f.ctx.window.MJShippingCheckout.requireForCapture(orderId).quote_token,'signed-MXN');
  await options.onApprove({orderID:orderId});
  assert.equal(f.requests.find(request=>request.path.endsWith('/paypal/capture')).body.shipping_quote_token,'signed-MXN');
});
test('normal native MXN PayPal still requires a valid delivery phone before opening or creating an order',async()=>{
  for(const deliveryPhone of ['', '+15551234567']) {
    const f=harness.fixture('MXN',{deliveryPhone});unusedCardForm(f);
    const options=await harness.entrypoint(f,'normal','MXN'),clicked=actions();
    options.onClick({},clicked);assert.equal(clicked.resolved,0);assert.equal(clicked.rejected,1);
    await assert.rejects(()=>options.createOrder({},{}),error=>/^NATIVE_SHIPPING_PHONE_(REQUIRED|INVALID)$/.test(error.code));
    assert(!f.requests.some(request=>request.path==='/api/checkout/prices' || request.path.endsWith('/paypal/create')));
  }
});
