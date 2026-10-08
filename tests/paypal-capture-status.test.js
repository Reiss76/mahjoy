const {installShippingFixture}=require('./shipping-client-fixtures');
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function browser(fetch,lang='es'){
 const ctx={window:{addEventListener(){},location:{pathname:lang==='en'?'/en/shop/':'/shop/'}},document:{documentElement:{lang},addEventListener(){}},fetch};
 installShippingFixture(ctx);vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),ctx);vm.runInContext(fs.readFileSync('js/paypal-sync.js','utf8'),ctx);return ctx.window;
}
test('ambiguous capture failures and pending payments preserve the order reference and never encourage paying again',async()=>{
 for(const lang of ['es','en'])for(const response of ['offline','invalid-json','pending','service-error']){
  let calls=0;const w=browser(async()=>{calls++;if(response==='offline')throw Error('Offline');return {ok:response!=='service-error',json:async()=>{if(response==='invalid-json')throw Error('Invalid JSON');return response==='pending'?{status:'PENDING'}:{error_code:'PAYPAL_CAPTURE_STATUS_PENDING'}}}},lang);
  await assert.rejects(()=>w.MJPayPalPricing.capture('TESTORDER123456'),e=>{
   assert.equal(e.code,'PAYMENT_STATUS_UNCERTAIN');assert.match(e.message,/TESTORDER123456/);assert.match(e.message,lang==='en'?/Do not pay again/:/No vuelvas a pagar/);assert.equal(w.MJPayPalSync.errorMessage(e,'Retry payment'),e.message);return true;
  });assert.equal(calls,1);
 }
});
test('completed captures return their original receipt and explicit pre-capture rejections stay ordinary errors',async()=>{
 const w=browser(async()=>({ok:true,json:async()=>({id:'TESTORDER123456',status:'COMPLETED'})}));
 assert.equal((await w.MJPayPalPricing.capture('TESTORDER123456')).status,'COMPLETED');
 const rejected=browser(async()=>({ok:false,json:async()=>({error_code:'PAYPAL_RECEIPT_UNAVAILABLE',error:'Could not save receipt'})}));
 await assert.rejects(()=>rejected.MJPayPalPricing.capture('TESTORDER123456'),e=>{assert.equal(e.code,'PAYPAL_RECEIPT_UNAVAILABLE');assert.match(e.message,/Could not save receipt/);return true});
});
