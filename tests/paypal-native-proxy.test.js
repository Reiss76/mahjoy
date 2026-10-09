const test=require('node:test'),assert=require('node:assert/strict');
const {registerPayPalCheckout}=require('../lib/paypal-checkout');
function payload(){return {purchase_units:[{amount:{currency_code:'MXN',value:'1000.00',breakdown:{item_total:{currency_code:'MXN',value:'1000.00'}}},items:[{sku:'TEST',name:'Test',quantity:'1',unit_amount:{currency_code:'MXN',value:'1000.00'}}]}]};}
function response(){return {set(){return this;},status(n){this.statusCode=n;return this;},json(v){this.value=v;return this;}};}
async function fixture(run){const old=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='fixture-only';try{await run();}finally{if(old===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=old;}}
test('native create forwards independently verified merchandise and never reads a browser shipping quote',()=>fixture(async()=>{
 const handlers={};let transmitted;
 registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async(url,options)=>{
  if(url.includes('catalog/products'))return {ok:true,json:async()=>({products:[{sku:'TEST',name:'Test',price:1000}]})};
  const expected=require('node:crypto').createHmac('sha256','fixture-only').update(options.headers['x-mahjoy-timestamp']+'.'+options.body).digest('hex');
  assert.equal(options.headers['x-mahjoy-signature'],expected);
  transmitted=JSON.parse(options.body);return {status:200,ok:true,json:async()=>({id:'TESTORDER123456',checkout_ref:'A'.repeat(43),shipping_state:'PENDING'})};
 },undefined,()=>{throw Error('browser quote must not be read')},{preflight:async input=>{assert.equal(input.country,'MX');assert.equal(input.currency,'MXN');assert.equal(input.items[0].sku,'TEST');}});
 const res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,delivery_phone:'(55) 5123 4567',payload:payload(),shipping_quote_token:'forged',prices:[{unit_price:1}],physicalItems:[{sku:'BROWSER-INJECTION',qty:99}]}},res);
 assert.equal(res.value.shipping_state,'PENDING');assert.equal(transmitted.nativeShipping,true);
 assert.equal(transmitted.prices[0].unit_price,1000);assert.equal(transmitted.shippingQuote,undefined);assert.equal(transmitted.deliveryPhone,'+525551234567');
 assert.deepEqual(transmitted.physicalItems,[{sku:'TEST',qty:1}]);
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
 const res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,delivery_phone:'55 5123 4567',payload:payload()}},res);
 assert.deepEqual(events,['packing']);assert.equal(res.statusCode,409);assert.equal(res.value.error_code,'PACKAGE_PROFILE_REQUIRED');
}));
test('native capability is unavailable until this merchant deployment supplies packing preflight',()=>fixture(async()=>{
 const handlers={};registerPayPalCheckout({post(){},get:(p,h)=>handlers[p]=h},'https://proax.test',async()=>({ok:true,json:async()=>({nativeShipping:true})}));
 const res=response();await handlers['/api/checkout/paypal/config']({},res);assert.deepEqual(res.value,{nativeShipping:false});
}));
test('native phone is absent by default in both markets and any supplied legacy phone is still validated',()=>fixture(async()=>{
 const handlers={};let forwarded=0,packed=0,lastBody;
 registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async(url,options)=>{
  if(url.includes('catalog/products'))return {ok:true,json:async()=>({products:[{sku:'TEST',name:'Test',price:1000,priceUsd:1000}]})};
  forwarded++;lastBody=JSON.parse(options.body);return {status:200,ok:true,json:async()=>({id:'TESTORDER123456',shipping_state:'PENDING'})};
 },undefined,undefined,{preflight:async()=>{packed++;}});
 for(const [phone,code] of [[null,'NATIVE_SHIPPING_PHONE_REQUIRED'],['','NATIVE_SHIPPING_PHONE_REQUIRED'],['+15551234567','NATIVE_SHIPPING_PHONE_INVALID']]){
  const res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:payload(),delivery_phone:phone}},res);
  assert.equal(res.statusCode,409);assert.equal(res.value.error_code,code);
 }
 assert.equal(forwarded,0);assert.equal(packed,0);
 let res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:payload()}},res);
 assert.equal(res.statusCode,200);assert.equal(lastBody.deliveryPhone,undefined);assert.deepEqual(lastBody.physicalItems,[{sku:'TEST',qty:1}]);
 const usd=payload();usd.purchase_units[0].amount.currency_code='USD';usd.purchase_units[0].amount.breakdown.item_total.currency_code='USD';usd.purchase_units[0].items[0].unit_amount.currency_code='USD';
 res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:usd}},res);
 assert.equal(res.statusCode,200);assert.equal(forwarded,2);assert.equal(packed,2);assert.equal(lastBody.deliveryPhone,undefined);
 res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:usd,delivery_phone:'+15551234567'}},res);
 assert.equal(res.statusCode,409);assert.equal(forwarded,2);assert.equal(packed,2);
}));
test('native bundle and mixed-cart creation freezes only server preflight physical items in the signed request',()=>fixture(async()=>{
 for(const currency of ['MXN','USD']) {
  const handlers={};let transmitted,prepared;
  registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async(url,options)=>{
   if(url.includes('catalog/products'))return {ok:true,json:async()=>({products:[{sku:'TEST',name:'Standalone',price:500,priceUsd:50}]})};
   if(url.endsWith('/bundles'))return {ok:true,json:async()=>[{id:9,name:'Bundle',price:1000,priceUsd:100}]};
   const expected=require('node:crypto').createHmac('sha256','fixture-only').update(options.headers['x-mahjoy-timestamp']+'.'+options.body).digest('hex');
   assert.equal(options.headers['x-mahjoy-signature'],expected);transmitted=JSON.parse(options.body);
   return {status:200,ok:true,json:async()=>({id:'TESTORDER123456',shipping_state:'PENDING'})};
  },undefined,()=>{throw Error('No browser shipping quote')},{preflight:async input=>{
   prepared=input;return {physical_items:[{sku:'PHYSICAL-A',qty:1},{sku:'physical-a',qty:1},{sku:'TEST',qty:1}]};
  }});
  const bundleValue=currency==='MXN'?'1000.00':'100.00',standaloneValue=currency==='MXN'?'500.00':'50.00',total=currency==='MXN'?'1500.00':'150.00';
  const p={purchase_units:[{items:[{sku:'BUNDLE-9',name:'Bundle',quantity:'1',unit_amount:{currency_code:currency,value:bundleValue}},
   {sku:'TEST',name:'Standalone',quantity:'1',unit_amount:{currency_code:currency,value:standaloneValue}}],
   amount:{currency_code:currency,value:total,breakdown:{item_total:{currency_code:currency,value:total}}}}]};
  const res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:p,physicalItems:[{sku:'FORGED',qty:99}]}},res);
  assert.equal(res.statusCode,200);assert.deepEqual(prepared.items.map(item=>[item.sku,item.qty]),[['BUNDLE-9',1],['TEST',1]]);
  assert.deepEqual(transmitted.physicalItems,[{sku:'PHYSICAL-A',qty:2},{sku:'TEST',qty:1}]);
  assert.equal(transmitted.payload.purchase_units[0].items[0].sku,'BUNDLE-9');assert.equal(transmitted.prices[0].unit_price,Number(bundleValue));
  assert.equal(transmitted.deliveryPhone,undefined);assert.equal(transmitted.shippingQuote,undefined);
 }
}));
test('a bundle without a bounded physical preflight manifest never forwards a PayPal create',()=>fixture(async()=>{
 for(const physical_items of [undefined,[],[{sku:'BUNDLE-9',qty:1}],[{sku:'A',qty:0.5}],[{sku:'A',qty:101}],[{sku:'A',qty:60},{sku:'a',qty:41}]]) {
  const handlers={};let forwarded=0;
  registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async url=>{
   if(url.includes('catalog/products'))return {ok:true,json:async()=>({products:[]})};
   if(url.endsWith('/bundles'))return {ok:true,json:async()=>[{id:9,name:'Bundle',price:1000}]};
   forwarded++;throw Error('Must not create');
  },undefined,undefined,{preflight:async()=>({physical_items})});
  const p=payload();p.purchase_units[0].items[0].sku='BUNDLE-9';
  const res=response();await handlers['/api/checkout/paypal/create']({body:{native_shipping:true,payload:p,physicalItems:[{sku:'FAKE',qty:1}]}},res);
  assert.equal(res.statusCode,409);assert.equal(res.value.error_code,'NATIVE_SHIPPING_PHYSICAL_MISMATCH');assert.equal(forwarded,0);
 }
}));
test('a physical mismatch from Proax is a pre-capture rejection while storage or capture uncertainty still stays pending',()=>fixture(async()=>{
 for(const [code,pending] of [['NATIVE_SHIPPING_PHYSICAL_MISMATCH',false],['PAYPAL_CAPTURE_STATUS_PENDING',true]]) {
  const handlers={},events=[];
  registerPayPalCheckout({post:(p,h)=>handlers[p]=h},'https://proax.test',async()=>{
   events.push('forward');return {ok:false,status:pending?503:409,json:async()=>({error_code:code})};
  },async()=>events.push('persist'));
  const res=response();await handlers['/api/checkout/paypal/capture']({body:{orderId:'TESTORDER123456',checkout_ref:'A'.repeat(43)}},res);
  assert.deepEqual(events,['persist','forward']);assert.equal(res.value.error_code,code);assert.equal(res.statusCode,pending?503:409);
 }
}));
