const test=require('node:test'),assert=require('node:assert/strict');
const {registerPayPalCheckout}=require('../lib/paypal-checkout');
function payload(){return {purchase_units:[{amount:{currency_code:'MXN',value:'1000.00',breakdown:{item_total:{currency_code:'MXN',value:'1000.00'}}},items:[{sku:'TEST',name:'Test',quantity:'1',unit_amount:{currency_code:'MXN',value:'1000.00'}}]}]};}
function response(){return {set(){return this;},status(n){this.statusCode=n;return this;},json(v){this.value=v;return this;}};}
async function fixture(run){const old=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='fixture-only';try{await run();}finally{if(old===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=old;}}
test('native create forwards independently verified merchandise and never reads a browser shipping quote',()=>fixture(async()=>{
 const handlers={};let transmitted;
 registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async(url,options)=>{
  if(url.includes('catalog/products'))return {ok:true,json:async()=>({products:[{sku:'TEST',name:'Test',price:1000}]})};
  transmitted=JSON.parse(options.body);return {status:200,ok:true,json:async()=>({id:'TESTORDER123456',checkout_ref:'A'.repeat(43),shipping_state:'PENDING'})};
 },undefined,()=>{throw Error('browser quote must not be read')},{preflight:async input=>{assert.equal(input.country,'MX');assert.equal(input.currency,'MXN');assert.equal(input.items[0].sku,'TEST');}});
 const res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:payload(),shipping_quote_token:'forged',prices:[{unit_price:1}]}},res);
 assert.equal(res.value.shipping_state,'PENDING');assert.equal(transmitted.nativeShipping,true);
 assert.equal(transmitted.prices[0].unit_price,1000);assert.equal(transmitted.shippingQuote,undefined);
}));
test('native create rejects incomplete or injected total and shipping amounts before order creation',()=>fixture(async()=>{
 const handlers={};let creates=0;
 registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async(url)=>{
  if(url.includes('catalog/products'))return {ok:true,json:async()=>({products:[{sku:'TEST',name:'Test',price:1000}]})};
  creates++;throw Error('must not create');
 });
 for(const change of [p=>p.purchase_units[0].amount.value='1.00',p=>p.purchase_units[0].amount.breakdown.shipping={currency_code:'MXN',value:'250.00'},p=>p.purchase_units[0].shipping={options:[]},p=>p.purchase_units[0].items[0].unit_amount.value='1.00']){
  const p=payload();change(p);const res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:p}},res);assert.equal(res.statusCode,400);
 }
 assert.equal(creates,0);
}));
test('native capture retains the order capability, persists receipt first, and never needs preselected quote',()=>fixture(async()=>{
 const handlers={},events=[];
 registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async(_url,options)=>{
  events.push('capture');const body=JSON.parse(options.body);assert.equal(body.checkout_ref,'A'.repeat(43));assert.equal(body.shippingQuote,undefined);
  return {ok:true,status:200,json:async()=>({id:'TESTORDER123456',status:'COMPLETED'})};
 },async()=>events.push('persist'),()=>{throw Error('must not read quote')});
 let res=response();await handlers['/api/checkout/paypal/capture']({body:{orderId:'TESTORDER123456',checkout_ref:'A'.repeat(43)}},res);
 assert.deepEqual(events,['persist','capture']);assert.equal(res.value.status,'COMPLETED');
 events.length=0;res=response();await handlers['/api/checkout/paypal/capture']({body:{orderId:'TESTORDER123456',checkout_ref:'invalid'}},res);
 assert.equal(res.statusCode,403);assert.deepEqual(events,[]);
}));
test('capability discovery is disabled when configuration is absent or fails',()=>fixture(async()=>{
 for(const nativeShipping of [true,false,'true',undefined]){
  const handlers={};registerPayPalCheckout({post(){},get:(p,h)=>handlers[p]=h},'https://proax.test',async(_url,options)=>{
   assert.deepEqual(JSON.parse(options.body),{action:'config'});return {ok:true,json:async()=>({nativeShipping})};
  },undefined,undefined,{preflight:async()=>{}});const res=response();await handlers['/api/checkout/paypal/config']({},res);assert.equal(res.value.nativeShipping,nativeShipping===true);
 }
 const handlers={};registerPayPalCheckout({post(){},get:(p,h)=>handlers[p]=h},'https://proax.test',async()=>{throw Error('private config unavailable');});
 const res=response();await handlers['/api/checkout/paypal/config']({},res);assert.deepEqual(res.value,{nativeShipping:false});
}));
test('physical preflight fails before PayPal creation without asking for a postal code or falling back to 250',()=>fixture(async()=>{
 const handlers={},events=[];
 registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async url=>{
  if(url.includes('catalog/products'))return {ok:true,json:async()=>({products:[{sku:'TEST',name:'Test',price:1000}]})};
  events.push('create');throw Error('must not create');
 },undefined,undefined,{preflight:async input=>{
  assert.equal(input.postalCode,undefined);assert.equal(input.destination,undefined);events.push('packing');
  throw Object.assign(Error('PACKAGE_PROFILE_REQUIRED'),{code:'PACKAGE_PROFILE_REQUIRED',status:409});
 }});
 const res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:payload()}},res);
 assert.deepEqual(events,['packing']);assert.equal(res.statusCode,409);assert.equal(res.value.error_code,'PACKAGE_PROFILE_REQUIRED');
}));
test('native capability is unavailable until this merchant deployment supplies packing preflight',()=>fixture(async()=>{
 const handlers={};registerPayPalCheckout({post(){},get:(p,h)=>handlers[p]=h},'https://proax.test',async()=>({ok:true,json:async()=>({nativeShipping:true})}));
 const res=response();await handlers['/api/checkout/paypal/config']({},res);assert.deepEqual(res.value,{nativeShipping:false});
}));
