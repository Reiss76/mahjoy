const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {registerPaymentPolicy}=require('../lib/payment-policy');
test('legacy payment URLs return PayPal-only before provider calls or order writes, including stale clients',async()=>{
 const app=express();app.use(express.json());let downstream=0;
 registerPaymentPolicy(app);
 app.use((_req,res)=>{downstream++;res.json({ok:true});});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try {
  const base='http://127.0.0.1:'+server.address().port;
  for(const path of ['/api/centumpay/checkout','/api/centumpay/checkout/','/api/payments/centumpay/checkout','/api/poll/trigger']) {
   const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cart:[{sku:'MAT-010',qty:1,price:1200}],currency:'MXN'})});
   assert.equal(response.status,410);assert.equal(response.headers.get('cache-control'),'no-store');
   const body=await response.json();assert.equal(body.error_code,'PAYPAL_ONLY');assert.equal(body.checkoutUrl,undefined);
  }
  assert.equal(downstream,0);
  const paypal=await fetch(base+'/api/checkout/paypal/config');assert.equal(paypal.status,200);assert.equal(downstream,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
