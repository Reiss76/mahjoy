const {createHmac,createHash,timingSafeEqual}=require('node:crypto');
const {canonicalItems,verifyShippingQuote}=require('./shipping-quotes');
const {recommendShipping}=require('./shipping-estimates');
const {postalCodeOf}=require('./shipping-address');

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
function canonicalPhysicalItems(value){
 if(!Array.isArray(value) || !value.length || value.length>100)throw error('NATIVE_SHIPPING_PHYSICAL_MISMATCH',409);
 const quantities=new Map();let units=0;
 for(const item of value){
  if(!item || typeof item!=='object' || Array.isArray(item) || typeof item.sku!=='string' || !item.sku.trim()
    || item.sku.trim().length>127 || /[\u0000-\u001f\u007f]/.test(item.sku) || /^BUNDLE-/i.test(item.sku.trim())
    || typeof item.qty!=='number' || !Number.isInteger(item.qty) || item.qty<1 || item.qty>100)throw error('NATIVE_SHIPPING_PHYSICAL_MISMATCH',409);
  units+=item.qty;if(units>100)throw error('NATIVE_SHIPPING_PHYSICAL_MISMATCH',409);
  const sku=item.sku.trim(),key=sku.toLowerCase(),current=quantities.get(key);
  quantities.set(key,{sku:current?.sku || sku,qty:(current?.qty || 0)+item.qty});
 }
 return [...quantities.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,item])=>item);
}
function physicalIdentity(items){return JSON.stringify(canonicalPhysicalItems(items).map(item=>[item.sku.toLowerCase(),item.qty]));}
async function nativeShippingQuote(quoteService,body,verify=verifyShippingQuote){
 if(!body || typeof body.postalCode!=='string'
   || !['MX','US'].includes(body.country) || !['MXN','USD'].includes(body.currency))throw error('INVALID_SHIPPING_DESTINATION',409);
 const postalCode=postalCodeOf(body.postalCode,body.country);
 const items=canonicalItems(body.items);
 const hasBundle=items.some(item=>/^BUNDLE-/i.test(item.sku));
 const frozen=canonicalPhysicalItems(body.frozenPhysicalItems ?? (hasBundle ? null : items));
 if(!hasBundle && physicalIdentity(frozen)!==physicalIdentity(items))throw error('NATIVE_SHIPPING_PHYSICAL_MISMATCH',409);
 const destination=body.city && body.state?{postalCode,country:body.country,city:body.city,state:body.state}:postalCode;
 const values=body.items.every(item=>item.unit_amount!==undefined)?body.items:undefined;
 if(body.protocolVersion===2 && (!values || typeof destination!=='object'))throw error('INVALID_SHIPPING_DESTINATION',409);
 const result=await quoteService.quote({items,destination,country:body.country,currency:body.currency},values?{verifiedValues:values}:{});
 const candidates=[];let changedPhysicalItems=false;
 for(const rate of result?.quotes || []){
  if(!rate || rate.currency!==body.currency || rate.drop_off!==undefined && rate.drop_off!==0)continue;
  // Verify the server-issued token again. Browser prices, parcels, and carrier
  // fields cannot choose a quotation or replace the frozen shipping snapshot.
  let quote;try{quote=verify(rate.quote_token,{items,postalCode,country:body.country,currency:body.currency});}catch(_){continue;}
  if(quote.drop_off!==undefined && quote.drop_off!==0 || quote.price!==rate.price
    || quote.carrier!==rate.carrier || quote.service!==rate.service)continue;
  if(!Array.isArray(quote.packages) || quote.packages.reduce((total,pack)=>total+pack.amount,0)>20)continue;
  // The authenticated caller froze physical composition at order creation.
  // Re-quoting a changed live bundle must reject, never silently replace it.
  try{if(physicalIdentity(quote.physical_items ?? (hasBundle ? null : quote.items))!==physicalIdentity(frozen))throw error('NATIVE_SHIPPING_PHYSICAL_MISMATCH',409);}
  catch(_){changedPhysicalItems=true;continue;}
  candidates.push({rate,quote});
 }
 if(!candidates.length)throw error(changedPhysicalItems?'NATIVE_SHIPPING_PHYSICAL_MISMATCH':'SHIPPING_RATES_UNAVAILABLE',changedPhysicalItems?409:503);
 const rates=candidates.map(({rate,quote})=>({...rate,price:quote.price,carrier:quote.carrier,service:quote.service,delivery_minutes:quote.delivery_minutes ?? null}));
 const recommended=recommendShipping(rates);
 const english=body.currency==='USD';
 const options=recommended.map(({kind,rate})=>{
  const quote=candidates.find(value=>value.quote.carrier===rate.carrier && value.quote.service===rate.service && value.quote.price===rate.price).quote;
  const id='mj-'+createHash('sha256').update(JSON.stringify(quote)).digest('hex').slice(0,48);
  const title=english?{economical:'Economy',fastest:'Fast',both:'Economy and fast'}[kind]:{economical:'Económico',fastest:'Rápido',both:'Económico y rápido'}[kind];
  const estimate=quote.delivery_status==='known' && quote.delivery_estimate ? quote.delivery_estimate : english?'Time unavailable':'Tiempo por confirmar';
  const brand=(quote.carrier_name || rate.carrier_name || quote.carrier)+' · '+(quote.service_name || rate.service_name || quote.service);
  const label=(body.protocolVersion===2?title+' · '+brand+' · '+estimate+' (est.)':brand).replace(/[\r\n\u0000]/g,' ').slice(0,127);
  return {kind,shippingQuote:quote,option:{id,label,amount:{currency_code:quote.currency,value:quote.price.toFixed(2)}}};
 });
 const first=options[0];
 return {...first,options,selectedOptionId:first.option.id};

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
  try {
   const body=JSON.parse(raw);
   if(body.action==='verify') {
    if(typeof quoteService.verifyFinal!=='function')throw error('SHIPPING_VERIFICATION_UNAVAILABLE');
    return send(200,await quoteService.verifyFinal(body.shippingQuote,body.destination));
   }
   return send(200,await nativeShippingQuote(quoteService,body,options.verifyQuote));
  }
  catch(e){const code=typeof e.code==='string' && /^[A-Z0-9_]{1,80}$/.test(e.code)?e.code:'SHIPPING_UNAVAILABLE';return send(e.status===409 || e.status===400?409:503,{error_code:code});}
 });
}
module.exports={signature,verifyRpcRequest,nativeShippingQuote,registerPayPalNativeShippingRpc,canonicalPhysicalItems};
