const {createHmac}=require('crypto');
const {resolveCheckoutQuote}=require('./checkout-prices');
function registerPayPalCheckout(app,base,fetcher=fetch,beforeCapture){
 for(const action of ['create','capture'])app.post('/api/checkout/paypal/'+action,async(req,res)=>{
  res.set('Cache-Control','no-store');
  let captureRequested=false;
  try{
   let body={action,orderId:req.body.orderId};
   if(action==='capture' && (typeof body.orderId!=='string' || !/^[A-Z0-9]{10,30}$/.test(body.orderId)))throw Error('INVALID_ORDER');
   if(action==='create'){
    const payload=req.body.payload,unit=payload?.purchase_units?.[0];
    const items=(unit?.items || []).filter(i=>!(!i.sku && /^(shipping|envío)$/i.test(i.name)));
    const quote=await resolveCheckoutQuote(base,{items,currency:unit?.amount?.currency_code,discount_code:req.body.discount_code},fetcher);
    body={action,payload,prices:quote.items,discountPct:quote.discount_pct,discountCode:quote.discount_code};
   }
   const secret=process.env.PROAX_PAYPAL_SYNC_SECRET;if(!secret)throw Error('CHECKOUT_UNAVAILABLE');
   // Persist before requesting capture. A closed tab or lost response cannot lose the receipt.
   if(action==='capture'){
    if(typeof beforeCapture!=='function')throw Error('PAYPAL_RECEIPT_UNAVAILABLE');
    await beforeCapture(body.orderId);
   }
   const raw=JSON.stringify(body),timestamp=String(Date.now());
   captureRequested=action==='capture';
   const response=await fetcher(base+'/api/public/mahjoy/paypal-checkout',{method:'POST',headers:{'Content-Type':'application/json','x-mahjoy-timestamp':timestamp,'x-mahjoy-signature':createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')},body:raw,signal:AbortSignal.timeout(45000)});
   res.status(response.status).json(await response.json());
  }catch(error){
   if(captureRequested)return res.status(503).json({error:'Payment status is being verified. Do not pay again.',error_code:'PAYPAL_CAPTURE_STATUS_PENDING',orderId:req.body.orderId});
   const code=error.code==='DISCOUNT_USD_ONLY'?error.code:error.message==='INVALID_ORDER'?'INVALID_ORDER':action==='capture'?'PAYPAL_RECEIPT_UNAVAILABLE':'CHECKOUT_UNAVAILABLE';
   res.status(action==='capture' && code!=='INVALID_ORDER'?503:400).json({error:code==='DISCOUNT_USD_ONLY'?error.message:'Could not verify checkout. Please try again.',error_code:code});
  }
 });
}
module.exports={registerPayPalCheckout};
