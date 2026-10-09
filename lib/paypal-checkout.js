const {createHmac}=require('crypto');
const {resolveCheckoutQuote}=require('./checkout-prices');
const {verifyShippingQuote}=require('./shipping-quotes');
const {verifyPayPalShippingAmount}=require('./shipping-payment');
const {normalizeMxDeliveryPhone}=require('../js/delivery-phone');
const SHIPPING_ERRORS=new Set(['SHIPPING_QUOTE_REQUIRED','SHIPPING_QUOTE_INVALID','SHIPPING_QUOTE_EXPIRED','SHIPPING_QUOTE_MISMATCH','SHIPPING_AMOUNT_MISMATCH','SHIPPING_ADDRESS_MISMATCH','SHIPPING_CURRENCY_MISMATCH','SHIPPING_CART_MISMATCH','SHIPPING_DESTINATION_MISMATCH','SHIPPING_ADDRESS_REQUIRED','PACKAGE_PROFILE_REQUIRED']);
// These failures occur before capture. In-progress/unknown storage and payment
// failures deliberately remain uncertain so the customer never pays again.
const NATIVE_ERRORS=new Set(['NATIVE_SHIPPING_UNAVAILABLE','NATIVE_SHIPPING_PENDING','NATIVE_SHIPPING_EXPIRED','NATIVE_CHECKOUT_UNAUTHORIZED','NATIVE_SHIPPING_UNAUTHORIZED','NATIVE_SHIPPING_SUPERSEDED','NATIVE_SHIPPING_INVALID_STATE','NATIVE_SHIPPING_NOT_READY','NATIVE_SHIPPING_INVALID','NATIVE_SHIPPING_QUOTE_INVALID','NATIVE_SHIPPING_REQUIRED','NATIVE_SHIPPING_SCOPE_INVALID','NATIVE_SHIPPING_CHECKOUT_NOT_FOUND','NATIVE_SHIPPING_PHONE_REQUIRED','NATIVE_SHIPPING_PHONE_INVALID']);
function verifyNativeMerchandise(payload,prices){
 const unit=payload?.purchase_units?.[0],currency=unit?.amount?.currency_code;
 if(payload.purchase_units?.length!==1 || !Array.isArray(unit.items) || unit.items.length!==prices.length || !['MXN','USD'].includes(currency))throw Error('INVALID_CHECKOUT');
 let total=0;
 for(let i=0;i<prices.length;i++){
  const item=unit.items[i],price=prices[i],value=item.unit_amount?.value;
  if(typeof value!=='string' || !/^\d+\.\d{2}$/.test(value) || item.unit_amount.currency_code!==currency
    || String(item.sku).toLowerCase()!==String(price.sku).toLowerCase() || Number(item.quantity)!==price.qty
    || Math.round(Number(value)*100)!==Math.round(price.unit_price*100))throw Error('PRICE_MISMATCH');
  total+=Math.round(price.unit_price*100)*price.qty;
 }
 const expected=(total/100).toFixed(2),amount=unit.amount,breakdown=amount.breakdown;
 if(amount.value!==expected || !breakdown || Object.keys(breakdown).some(key=>key!=='item_total')
   || breakdown.item_total?.currency_code!==currency || breakdown.item_total?.value!==expected || unit.shipping)throw Error('TOTAL_MISMATCH');
}
function registerPayPalCheckout(app,base,fetcher=fetch,beforeCapture,verifyQuote=verifyShippingQuote,options={}){
 async function forward(body){
  const secret=process.env.PROAX_PAYPAL_SYNC_SECRET;if(!secret)throw Error('CHECKOUT_UNAVAILABLE');
  const raw=JSON.stringify(body),timestamp=String(Date.now());
  return fetcher(base+'/api/public/mahjoy/paypal-checkout',{method:'POST',headers:{'Content-Type':'application/json','x-mahjoy-timestamp':timestamp,'x-mahjoy-signature':createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')},body:raw,signal:AbortSignal.timeout(45000)});
 }
 // Proax's verified protocol flag is authoritative. Failed discovery preserves
 // the existing quoted checkout instead of exposing an unfinished native flow.
 if(typeof app.get==='function')app.get('/api/checkout/paypal/config',async(_req,res)=>{
  res.set('Cache-Control','no-store');
  try{const response=await forward({action:'config'}),result=await response.json();return res.json({nativeShipping:typeof options.preflight==='function' && response.ok===true && result.nativeShipping===true});}
  catch(_){return res.json({nativeShipping:false});}
 });
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
    if(req.body.native_shipping===true){
     verifyNativeMerchandise(payload,quote.items);
     const deliveryPhone=unit.amount.currency_code==='MXN'?normalizeMxDeliveryPhone(req.body.delivery_phone):undefined;
     if(typeof options.preflight!=='function')throw Error('NATIVE_SHIPPING_UNAVAILABLE');
     await options.preflight({items:quote.items,country:unit.amount.currency_code==='USD'?'US':'MX',currency:unit.amount.currency_code});
     body={action,nativeShipping:true,payload,prices:quote.items,discountPct:quote.discount_pct,discountCode:quote.discount_code,...(deliveryPhone===undefined?{}:{deliveryPhone})};
    }else{
     const shippingQuote=verifyQuote(req.body.shipping_quote_token,{items:quote.items,currency:unit?.amount?.currency_code});
     verifyPayPalShippingAmount(payload,shippingQuote);
     body={action,payload,prices:quote.items,discountPct:quote.discount_pct,discountCode:quote.discount_code,shippingQuote};
    }
   }
   const secret=process.env.PROAX_PAYPAL_SYNC_SECRET;if(!secret)throw Error('CHECKOUT_UNAVAILABLE');
   // Persist before requesting capture. A closed tab or lost response cannot lose the receipt.
   if(action==='capture'){
    // The captured order's destination and amount are checked against the stored
    // quote in Proax. Expiry does not prevent retrieving an already paid receipt.
    if(req.body.checkout_ref!==undefined){
     if(typeof req.body.checkout_ref!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(req.body.checkout_ref))throw Error('NATIVE_CHECKOUT_UNAUTHORIZED');
     body.checkout_ref=req.body.checkout_ref;
    }else body.shippingQuote=verifyQuote(req.body.shipping_quote_token,{}, {allowExpired:true});
    if(typeof beforeCapture!=='function')throw Error('PAYPAL_RECEIPT_UNAVAILABLE');
    await beforeCapture(body.orderId);
   }
   captureRequested=action==='capture';
   const response=await forward(body);
   const result=await response.json();
   if(!response.ok && (SHIPPING_ERRORS.has(result.error_code || result.error) || NATIVE_ERRORS.has(result.error_code || result.error)))captureRequested=false;
   res.status(response.status).json(result);
  }catch(error){
   if(captureRequested)return res.status(503).json({error:'Payment status is being verified. Do not pay again.',error_code:'PAYPAL_CAPTURE_STATUS_PENDING',orderId:req.body.orderId});
   const shippingCode=SHIPPING_ERRORS.has(error.code || error.message)?(error.code || error.message):null;
   const nativeCode=NATIVE_ERRORS.has(error.code || error.message)?(error.code || error.message):null;
   const code=shippingCode || nativeCode || (error.code==='DISCOUNT_USD_ONLY'?error.code:error.message==='INVALID_ORDER'?'INVALID_ORDER':action==='capture'?'PAYPAL_RECEIPT_UNAVAILABLE':'CHECKOUT_UNAVAILABLE');
   res.status(shippingCode || /^NATIVE_SHIPPING_PHONE_/.test(nativeCode || '')?409:nativeCode?403:action==='capture' && code!=='INVALID_ORDER'?503:400).json({error:code==='DISCOUNT_USD_ONLY'?error.message:'Could not verify checkout. Please try again.',error_code:code});
  }
 });
}
module.exports={registerPayPalCheckout,verifyNativeMerchandise};
