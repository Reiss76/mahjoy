const {createHmac,createHash,timingSafeEqual}=require('node:crypto');
const {canonicalItems,verifyShippingQuote}=require('./shipping-quotes');

const FRESH_MS=5*60*1000;
function signature(raw,timestamp,secret){return createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');}
function verifyRpcRequest(raw,headers,secret,now=Date.now()){
 if(typeof secret!=='string' || !secret || typeof raw!=='string' || Buffer.byteLength(raw)>100000)return false;
 const timestamp=headers('x-mahjoy-timestamp'),supplied=headers('x-mahjoy-signature');
 if(typeof timestamp!=='string' || !/^\d{13}$/.test(timestamp) || Math.abs(now-Number(timestamp))>FRESH_MS
   || typeof supplied!=='string' || !/^[a-f0-9]{64}$/.test(supplied))return false;
 return timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(signature(raw,timestamp,secret),'hex'));
}
function error(code,status=503){const e=new Error(code);e.code=code;e.status=status;return e;}
async function nativeShippingQuote(quoteService,body,verify=verifyShippingQuote){
 if(!body || typeof body.postalCode!=='string' || !/^\d{5}$/.test(body.postalCode)
   || !['MX','US'].includes(body.country) || !['MXN','USD'].includes(body.currency))throw error('INVALID_SHIPPING_DESTINATION',409);
 const items=canonicalItems(body.items);
 const result=await quoteService.quote({items,destination:body.postalCode,country:body.country,currency:body.currency});
 const candidates=[];
 for(const rate of result?.quotes || []){
  if(!rate || rate.currency!==body.currency || rate.drop_off===1 || rate.drop_off===2)continue;
  // Verify the server-issued token again. Browser prices, parcels, and carrier
  // fields cannot choose a quotation or replace the frozen shipping snapshot.
  let quote;try{quote=verify(rate.quote_token,{items,postalCode:body.postalCode,country:body.country,currency:body.currency});}catch(_){continue;}
  if(quote.drop_off===1 || quote.drop_off===2 || quote.price!==rate.price
    || quote.carrier!==rate.carrier || quote.service!==rate.service)continue;
  candidates.push({rate,quote});
 }
 candidates.sort((a,b)=>a.quote.price-b.quote.price || (a.quote.carrier+':'+a.quote.service).localeCompare(b.quote.carrier+':'+b.quote.service));
 if(!candidates.length)throw error('SHIPPING_RATES_UNAVAILABLE');
 const {quote,rate}=candidates[0];
 const id='mj-'+createHash('sha256').update(JSON.stringify(quote)).digest('hex').slice(0,48);
 return {shippingQuote:quote,option:{id,label:((rate.carrier_name || quote.carrier)+' · '+(rate.service_name || quote.service)).slice(0,127),
  amount:{currency_code:quote.currency,value:quote.price.toFixed(2)}}};
}
function registerPayPalNativeShippingRpc(app,quoteService,options={}){
 app.post('/api/checkout/paypal/shipping-quote',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const secret=options.secret ?? process.env.PROAX_PAYPAL_SYNC_SECRET;
  const raw=typeof req.rawBody==='string'?req.rawBody:null;
  const now=options.now || Date.now;
  if(!verifyRpcRequest(raw,name=>req.get(name),secret,now()))return res.status(401).json({error_code:'UNAUTHORIZED'});
  const send=(status,value)=>{
   const responseRaw=JSON.stringify(value),timestamp=String(now());
   res.set('Content-Type','application/json');res.set('x-mahjoy-timestamp',timestamp);
   res.set('x-mahjoy-signature',signature(responseRaw,timestamp,secret));
   return res.status(status).send(responseRaw);
  };
  try{return send(200,await nativeShippingQuote(quoteService,JSON.parse(raw),options.verifyQuote));}
  catch(e){const code=typeof e.code==='string' && /^[A-Z0-9_]{1,80}$/.test(e.code)?e.code:'SHIPPING_UNAVAILABLE';return send(e.status===409 || e.status===400?409:503,{error_code:code});}
 });
}
module.exports={signature,verifyRpcRequest,nativeShippingQuote,registerPayPalNativeShippingRpc};
