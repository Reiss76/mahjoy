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
