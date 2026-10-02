const {createHmac}=require('crypto');
const {resolveCheckoutQuote}=require('./checkout-prices');
function registerPayPalCheckout(app,base,fetcher=fetch){
 for(const action of ['create','capture'])app.post('/api/checkout/paypal/'+action,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   let body={action,orderId:req.body.orderId};
   if(action==='create'){
    const payload=req.body.payload,unit=payload?.purchase_units?.[0];
    const items=(unit?.items || []).filter(i=>!(!i.sku && /^(shipping|envío)$/i.test(i.name)));
    const quote=await resolveCheckoutQuote(base,{items,currency:unit?.amount?.currency_code,discount_code:req.body.discount_code},fetcher);
    body={action,payload,prices:quote.items,discountPct:quote.discount_pct,discountCode:quote.discount_code};
   }
   const secret=process.env.PROAX_PAYPAL_SYNC_SECRET;if(!secret)throw Error('CHECKOUT_UNAVAILABLE');
   const raw=JSON.stringify(body),timestamp=String(Date.now());
   const response=await fetcher(base+'/api/public/mahjoy/paypal-checkout',{method:'POST',headers:{'Content-Type':'application/json','x-mahjoy-timestamp':timestamp,'x-mahjoy-signature':createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')},body:raw,signal:AbortSignal.timeout(45000)});
   res.status(response.status).json(await response.json());
  }catch(error){res.status(400).json({error:error.code==='DISCOUNT_USD_ONLY'?error.message:'Could not verify checkout. Please try again.',error_code:error.code});}
 });
}
module.exports={registerPayPalCheckout};
