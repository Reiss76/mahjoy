'use strict';
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const http2=require('http2');
const {zipSync}=require('fflate');
const asn1js=require('asn1js');
const pkijs=require('pkijs');
const {trackingFacts}=require('./shipment-notifications');

const ORDER=/^[A-Z0-9]{10,30}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const COOKIE='__Host-mahjoy_wallet';
const pem=value=>String(value||'').replace(/\\n/g,'\n');
const bytes=p=>Buffer.from(p.replace(/-----[^-]+-----/g,'').replace(/\s/g,''),'base64');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const token=(secret,kind,id)=>crypto.createHmac('sha256',secret).update(kind+':'+id).digest('base64url');

function readWalletConfig(env=process.env){
 if(env.MAHJOY_WALLET_ENABLED!=='true'||env.MAHJOY_SHIPMENT_NOTIFICATIONS_ENABLED!=='true')return null;
 try{
  const id=env.MAHJOY_WALLET_ORDER_TYPE_ID,merchantId=env.MAHJOY_WALLET_MERCHANT_ID,team=env.MAHJOY_WALLET_TEAM_ID,secret=env.MAHJOY_WALLET_AUTH_SECRET;
  if(!/^order\.[A-Za-z0-9.-]{3,200}$/.test(id||'')||!/^merchant\.[A-Za-z0-9.-]{3,200}$/.test(merchantId||'')||! /^[A-Z0-9]{10}$/.test(team||'')||!secret||secret.length<32)return null;
  const cert=pem(env.MAHJOY_WALLET_SIGNING_CERT),key=pem(env.MAHJOY_WALLET_SIGNING_KEY),wwdr=pem(env.MAHJOY_WALLET_WWDR_CERT);
  const leaf=new crypto.X509Certificate(cert),intermediate=new crypto.X509Certificate(wwdr),privateKey=crypto.createPrivateKey(key);
  const now=Date.now();
  if(now<Date.parse(leaf.validFrom)||now>=Date.parse(leaf.validTo)||!leaf.subject.split('\n').includes('UID='+id)||!leaf.subject.split('\n').includes('OU='+team)
   ||privateKey.asymmetricKeyType!=='rsa'||!leaf.verify(intermediate.publicKey)||!leaf.checkPrivateKey(privateKey))return null;
  if(!intermediate.ca||!intermediate.subject.includes('Apple Worldwide Developer Relations')||now<Date.parse(intermediate.validFrom)||now>=Date.parse(intermediate.validTo))return null;
  return {id,merchantId,team,secret,cert,key,wwdr,base:'https://www.playmahjoy.com'};
 }catch{return null;}
}
function sessionOrders(cookie,secret,now=Date.now()){
 try{
  const value=String(cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!value||value.length>3500)return [];
  const [body,signature]=value.split('.');if(!equal(token(secret,'browser',body),signature))return [];
  const data=JSON.parse(Buffer.from(body,'base64url').toString());
  return data.exp>now&&Array.isArray(data.orders)?data.orders.filter(id=>ORDER.test(id)).slice(-20):[];
 }catch{return [];}
}
function setReceiptSession(req,res,receipt,config){
 if(!config||receipt?.status!=='COMPLETED'||receipt.id!==req.body?.orderId||!ORDER.test(receipt.id))return;
 const orders=[...new Set([...sessionOrders(req.headers.cookie,config.secret),receipt.id])].slice(-20);
 const body=Buffer.from(JSON.stringify({orders,exp:Date.now()+30*86400000})).toString('base64url');
 res.append('Set-Cookie',`${COOKIE}=${body}.${token(config.secret,'browser',body)}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`);
}
async function signManifest(manifest,config){
 pkijs.setEngine('crypto',crypto.webcrypto,new pkijs.CryptoEngine({name:'crypto',crypto:crypto.webcrypto,subtle:crypto.webcrypto.subtle}));
 const cert=new pkijs.Certificate({schema:asn1js.fromBER(bytes(config.cert)).result});
 const intermediate=new pkijs.Certificate({schema:asn1js.fromBER(bytes(config.wwdr)).result});
 const key=await crypto.webcrypto.subtle.importKey('pkcs8',crypto.createPrivateKey(config.key).export({type:'pkcs8',format:'der'}),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signed=new pkijs.SignedData({version:1,encapContentInfo:new pkijs.EncapsulatedContentInfo({eContentType:'1.2.840.113549.1.7.1'}),certificates:[cert,intermediate],signerInfos:[new pkijs.SignerInfo({version:1,sid:new pkijs.IssuerAndSerialNumber({issuer:cert.issuer,serialNumber:cert.serialNumber})})]});
 await signed.sign(key,0,'SHA-256',manifest.buffer.slice(manifest.byteOffset,manifest.byteOffset+manifest.byteLength));
 return Buffer.from(new pkijs.ContentInfo({contentType:'1.2.840.113549.1.7.2',content:signed.toSchema(true)}).toSchema().toBER(false));
}
function makeOrder(wallet,states,config){
 const snapshot=wallet.snapshot;
 states=[...(snapshot.tracking||[]).filter(fact=>!states.some(s=>s.carrier===fact.carrier&&s.tracking_number===fact.tracking_number)).map(fact=>({...fact,state:'created'})),...states];
 const statuses={created:'processing',shipped:'shipped',in_transit:'onTheWay',out_for_delivery:'outForDelivery',delivered:'delivered',issue:'issue',returned:'issue',cancelled:'cancelled'};
 const order={schemaVersion:1,orderType:'ecommerce',orderTypeIdentifier:config.id,orderIdentifier:wallet.id,
  orderNumber:snapshot.orderNumber,createdAt:new Date(wallet.created_at).toISOString(),updatedAt:new Date(wallet.updated_at).toISOString(),
  orderManagementURL:config.base+'/gracias.html?order='+encodeURIComponent(snapshot.orderNumber),
  merchant:{displayName:'MAH JOY',merchantIdentifier:config.merchantId,url:config.base,logo:'logo'},
  status:states.length&&states.every(s=>s.state==='delivered')?'completed':'open',
  authenticationToken:token(config.secret,'order',wallet.id),webServiceURL:config.base+'/api/wallet',changeNotifications:'enabled',
  lineItems:snapshot.items,fulfillments:states.map(s=>({fulfillmentIdentifier:s.carrier+':'+s.tracking_number,fulfillmentType:'shipping',status:statuses[s.state]||'processing',carrier:s.carrier,trackingNumber:s.tracking_number,
   ...(s.state==='delivered'?{deliveredAt:new Date(s.occurred_at).toISOString()}:{}),shippingType:'shipping'}))};
 if(snapshot.payment)order.payment=snapshot.payment;
 return order;
}
async function buildPackage(order,config,sign=signManifest){
 const files={'order.json':Buffer.from(JSON.stringify(order)),'logo.png':fs.readFileSync(path.join(__dirname,'../images/logo-mahjoy-horizontal.png'))};
 const manifest=Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(files).map(([name,data])=>[name,crypto.createHash('sha256').update(data).digest('hex')]))));
 files['manifest.json']=manifest;files.signature=await sign(manifest,config);
 return Buffer.from(zipSync(files,{level:6}));
}
function sendWalletPush(pushToken,config){
 return new Promise(resolve=>{
  let done=false;const client=http2.connect('https://api.push.apple.com',{cert:config.cert,key:config.key});
  const finish=(status,reason)=>{if(done)return;done=true;clearTimeout(timer);client.destroy();resolve({status,reason});};
  const timer=setTimeout(()=>finish(503,'Timeout'),8000);client.on('error',()=>finish(503,'TransportError'));
  try{const request=client.request({':method':'POST',':path':'/3/device/'+pushToken,'apns-topic':config.id,'apns-priority':'5','apns-expiration':String(Math.floor(Date.now()/1000)+86400)});
   let status=503,body='';request.on('response',headers=>status=Number(headers[':status']));request.on('data',chunk=>{if(body.length<4096)body+=chunk.toString();});request.on('end',()=>{let reason;try{reason=JSON.parse(body).reason;}catch{}finish(status,reason);});request.on('error',()=>finish(503,'TransportError'));request.end('{}');
  }catch{finish(503,'TransportError');}
 });
}
function createAppleWallet(pool,shipments,options={}){
 const config=options.config||(()=>readWalletConfig());
 async function owned(req){const c=config();return c&&ORDER.test(req.params.orderId||'')&&sessionOrders(req.headers.cookie,c.secret).includes(req.params.orderId)?c:null;}
 async function walletById(req){
  const c=config(),id=req.params.walletId;
  if(!c||req.params.typeId!==c.id||!UUID.test(id||'')||!equal(req.get('authorization')||'','AppleOrder '+token(c.secret,'order',id)))return null;
  await shipments.ensure();const {rows:[wallet]}=await pool.query('SELECT * FROM mj_wallet_orders WHERE id=$1',[id]);return wallet?{c,wallet}:null;
 }
 async function payload(wallet,c){
  const {rows}=await pool.query('SELECT * FROM mj_shipment_states WHERE order_id=$1 ORDER BY id',[wallet.order_id]);
  const {rows:[order]}=await pool.query(`SELECT tracking_number,carrier,to_jsonb(w)->'shipping_labels' AS shipping_labels FROM web_orders w WHERE node_id=31 AND order_id=$1 AND paid_at IS NOT NULL`,[wallet.order_id]);
  const value={...wallet,snapshot:{...wallet.snapshot,tracking:order?trackingFacts(order):wallet.snapshot.tracking||[]}};
  return buildPackage(makeOrder(value,rows,c),c,options.sign);
 }
 function register(app){
  app.get('/api/wallet/status/:orderId',async(req,res)=>{res.set('Cache-Control','private, no-store');const c=await owned(req);res.json({available:!!c});});
  app.get('/api/wallet/package/:orderId',async(req,res)=>{
   res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex'});
   const c=await owned(req);if(!c)return res.status(404).end();
   try{
    await shipments.ensure();
    const {rows:[order]}=await pool.query(`SELECT * FROM web_orders WHERE node_id=31 AND paid_at IS NOT NULL AND status IN ('paid','shipped','delivered') AND (paypal_order_id=$1 OR order_id=$1 OR order_id='paypal-'||$1) LIMIT 1`,[req.params.orderId]);
    if(!order)return res.status(409).json({error:'ORDER_SYNCHRONIZING'});
    let items=typeof order.items==='string'?JSON.parse(order.items):order.items;
    if(!Array.isArray(items))return res.status(503).end();
    const snapshot={orderNumber:req.params.orderId,items:items.map(i=>({title:String(i.name||i.product_name||'MAH JOY').slice(0,150),quantity:Number(i.qty||i.quantity||1)}))};
    if(['MXN','USD'].includes(order.currency)&&Number.isFinite(Number(order.total)))snapshot.payment={status:'paid',total:{currency:order.currency,amount:Number(order.total).toFixed(2)}};
    const {rows:[wallet]}=await pool.query(`INSERT INTO mj_wallet_orders(id,order_id,snapshot) VALUES($1,$2,$3) ON CONFLICT(order_id) DO UPDATE SET order_id=EXCLUDED.order_id RETURNING *`,[crypto.randomUUID(),order.order_id,JSON.stringify(snapshot)]);
    res.type('application/vnd.apple.finance.order').set('Content-Disposition','attachment; filename="Mahjoy.order"').send(await payload(wallet,c));
   }catch{res.status(503).json({error:'WALLET_TEMPORARILY_UNAVAILABLE'});}
  });
  app.get('/api/wallet/v1/orders/:typeId/:walletId',async(req,res)=>{
   try{const data=await walletById(req);if(!data)return res.status(401).end();
    const modified=new Date(data.wallet.updated_at).toUTCString();res.set({'Cache-Control':'private, must-revalidate','Last-Modified':modified,'Vary':'Authorization'});
    if(req.get('if-modified-since')&&Date.parse(req.get('if-modified-since'))>=Math.floor(new Date(data.wallet.updated_at).getTime()/1000)*1000)return res.status(304).end();
    res.type('application/vnd.apple.finance.order').send(await payload(data.wallet,data.c));
   }catch{res.status(503).end();}
  });
  for(const method of ['post','delete'])app[method]('/api/wallet/v1/devices/:deviceId/registrations/:typeId/:walletId',async(req,res)=>{
   try{const data=await walletById(req);if(!data)return res.status(401).end();const device=req.params.deviceId;
    if(!/^[-A-Za-z0-9_]{16,200}$/.test(device))return res.status(400).end();
    if(method==='delete'){await pool.query('DELETE FROM mj_wallet_devices WHERE device_id=$1 AND wallet_id=$2',[device,data.wallet.id]);await pool.query('DELETE FROM mj_wallet_pushes WHERE device_id=$1 AND wallet_id=$2',[device,data.wallet.id]);return res.status(200).end();}
    const pushToken=req.body?.pushToken;if(!/^[a-f0-9]{32,512}$/i.test(pushToken||'')||pushToken.length%2)return res.status(400).end();
    const {rows:[count]}=await pool.query('SELECT count(*)::int AS total FROM mj_wallet_devices WHERE wallet_id=$1 AND device_id<>$2',[data.wallet.id,device]);
    if(count.total>=20)return res.status(429).end();
    const {rows}=await pool.query(`INSERT INTO mj_wallet_devices(device_id,wallet_id,push_token) VALUES($1,$2,$3) ON CONFLICT(device_id,wallet_id) DO UPDATE SET push_token=EXCLUDED.push_token,updated_at=now() RETURNING (xmax=0) AS inserted`,[device,data.wallet.id,pushToken]);
    res.status(rows[0]?.inserted?201:200).end();
   }catch{res.status(503).end();}
  });
  app.get('/api/wallet/v1/devices/:deviceId/registrations/:typeId',async(req,res)=>{
   try{const c=config();if(!c||req.params.typeId!==c.id||!/^[-A-Za-z0-9_]{16,200}$/.test(req.params.deviceId))return res.status(404).end();
    await shipments.ensure();const since=String(req.query.ordersModifiedSince||req.query.lastModified||'1970-01-01T00:00:00.000Z');if(!Number.isFinite(Date.parse(since)))return res.status(400).end();
    const {rows}=await pool.query(`SELECT w.id,w.updated_at FROM mj_wallet_devices d JOIN mj_wallet_orders w ON w.id=d.wallet_id WHERE d.device_id=$1 AND w.updated_at>$2::timestamptz ORDER BY w.updated_at`,[req.params.deviceId,since]);
    res.set('Cache-Control','no-store');if(!rows.length)return res.status(204).end();
    res.json({orderIdentifiers:rows.map(w=>w.id),lastModified:new Date(rows[rows.length-1].updated_at).toISOString()});
   }catch{res.status(503).end();}
  });
  // Wallet logs can contain private order data. Acknowledge without retaining it.
  app.post('/api/wallet/v1/log',(_req,res)=>res.status(200).end());
 }
 let busy=false;
 async function flush(){
  const c=config();if(!c||busy)return;busy=true;
  try{await shipments.ensure();for(let n=0;n<25;n++){
   const {rows:[job]}=await pool.query(`UPDATE mj_wallet_pushes SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
    WHERE id=(SELECT id FROM mj_wallet_pushes WHERE status='pending' AND next_attempt_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
   if(!job)break;
   const {rows:[device]}=await pool.query('SELECT push_token FROM mj_wallet_devices WHERE device_id=$1 AND wallet_id=$2',[job.device_id,job.wallet_id]);
   if(!device||device.push_token!==job.push_token){await pool.query("UPDATE mj_wallet_pushes SET status='dropped' WHERE id=$1",[job.id]);continue;}
   let result;try{result=await (options.send||sendWalletPush)(job.push_token,c);}catch{result={status:503};}
   const invalid=result.status===410||(result.status===400&&['BadDeviceToken','DeviceTokenNotForTopic'].includes(result.reason));
   if(invalid){await pool.query('DELETE FROM mj_wallet_devices WHERE wallet_id=$1 AND device_id=$2 AND push_token=$3',[job.wallet_id,job.device_id,job.push_token]);}
   await pool.query('UPDATE mj_wallet_pushes SET status=$2 WHERE id=$1',[job.id,result.status===200?'sent':job.attempts>=5||invalid?'dropped':'pending']);
  }}finally{busy=false;}
 }
 return {register,flush,config,setReceiptSession:(req,res,receipt)=>setReceiptSession(req,res,receipt,config())};
}
module.exports={readWalletConfig,sessionOrders,setReceiptSession,signManifest,makeOrder,buildPackage,createAppleWallet,token};
