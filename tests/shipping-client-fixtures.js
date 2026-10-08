// Prepared signed-selection double for tests whose subject is catalog, discount or payment transport.
function installShippingFixture(ctx, options={}) {
  const orders=new Map();
  const selection=currency=>({currency,price:options.price ?? (currency==='USD'?25:250),id:'test-service',carrier:'Test carrier',service:'Test delivery',
    country:currency==='USD'?'US':'MX',postalCode:'00000',quote_token:'test-signed-'+currency,contextKey:'test-context-'+currency});
  ctx.window.MJShippingCheckout={
    requireForPayment:currency=>selection(currency),
    rememberOrder:(id,rate)=>orders.set(id,rate),
    requireForCapture:id=>orders.get(id)||selection(options.currency||(ctx.window.location?.pathname?.startsWith('/en/')?'USD':'MXN')),
    state:()=>({selected:selection(options.currency||(ctx.window.location?.pathname?.startsWith('/en/')?'USD':'MXN')),destination:{postalCode:'00000',country:options.currency==='USD'?'US':'MX'}}),
    subscribe(){},refresh(){},setDestination(){},
    paypalCallbacks:()=>({}),
    errorMessage:()=> 'Select a valid shipping quote before paying.'
  };
  return ctx.window.MJShippingCheckout;
}
module.exports={installShippingFixture};
