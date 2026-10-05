const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {registerPayPalCheckout}=require('../lib/paypal-checkout');
test('checkout proxy obtains independent catalog prices and signs the exact approved request',async()=>{
 const previous=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='test-secret-for-this-fixture-only';
 try{
  const handlers={};let transmitted;
  registerPayPalCheckout({post:(path,handler)=>handlers[path]=handler},'https://proax.test',async(url,options)=>{
   if(url.includes('catalog/products'))return {ok:true,json:async()=>({products:[{sku:'TEST',name:'Test',price:1000,priceUsd:90}]})};
   transmitted=options;return {status:200,json:async()=>({id:'TESTORDER123456'})};
  });
  const req={body:{prices:[{unit_price:1}],discountPct:99,payload:{purchase_units:[{amount:{currency_code:'USD'},items:[{sku:'TEST',quantity:'1'}]}]}}};
  const res={set(){},status(n){this.statusCode=n;return this},json(body){this.body=body}};
  await handlers['/api/checkout/paypal/create'](req,res);
  const body=JSON.parse(transmitted.body);assert.equal(body.prices[0].unit_price,90);assert.equal(body.discountPct,0);assert.equal(res.body.id,'TESTORDER123456');
  const timestamp=transmitted.headers['x-mahjoy-timestamp'];assert.equal(transmitted.headers['x-mahjoy-signature'],crypto.createHmac('sha256',process.env.PROAX_PAYPAL_SYNC_SECRET).update(timestamp+'.'+transmitted.body).digest('hex'));
 }finally{if(previous===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=previous;}
});
test('capture persists its receipt before requesting payment and fails closed if storage is unavailable',async()=>{
 const previous=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='fixture-secret';
 try{
  const handlers={},events=[];
  registerPayPalCheckout({post:(path,handler)=>handlers[path]=handler},'https://proax.test',async(url,options)=>{
   events.push('capture');assert.equal(JSON.parse(options.body).orderId,'TESTORDER123456');
   return {status:200,json:async()=>({id:'TESTORDER123456',status:'COMPLETED'})};
  },async id=>{assert.equal(id,'TESTORDER123456');events.push('persist')});
  const res={set(){},status(n){this.statusCode=n;return this},json(body){this.body=body}};
  await handlers['/api/checkout/paypal/capture']({body:{orderId:'TESTORDER123456'}},res);
  assert.deepEqual(events,['persist','capture']);assert.equal(res.body.status,'COMPLETED');
  events.length=0;
  registerPayPalCheckout({post:(path,handler)=>handlers[path]=handler},'https://proax.test',async()=>{events.push('capture')},async()=>{throw new Error('Private database connection failure')});
  await handlers['/api/checkout/paypal/capture']({body:{orderId:'TESTORDER123456'}},res);
  assert.equal(res.statusCode,503);assert.equal(res.body.error_code,'PAYPAL_RECEIPT_UNAVAILABLE');assert.deepEqual(events,[]);assert(!JSON.stringify(res.body).includes('Private'));
  await handlers['/api/checkout/paypal/capture']({body:{orderId:'../invalid'}},res);
  assert.equal(res.statusCode,400);assert.equal(res.body.error_code,'INVALID_ORDER');
 }finally{if(previous===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=previous;}
});
test('a lost capture response keeps the persisted reference and reports uncertain payment without a second capture',async()=>{
 const previous=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='fixture-secret';
 try{
  const handlers={},receipts=[];let captures=0;
  registerPayPalCheckout({post:(path,handler)=>handlers[path]=handler},'https://proax.test',async()=>{captures++;throw new Error('Network disconnected')},async id=>receipts.push(id));
  const res={set(){},status(n){this.statusCode=n;return this},json(body){this.body=body}};
  await handlers['/api/checkout/paypal/capture']({body:{orderId:'TESTORDER123456'}},res);
  assert.deepEqual(receipts,['TESTORDER123456']);assert.equal(captures,1);assert.equal(res.statusCode,503);assert.equal(res.body.error_code,'PAYPAL_CAPTURE_STATUS_PENDING');assert.equal(res.body.orderId,'TESTORDER123456');
 }finally{if(previous===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=previous;}
});
