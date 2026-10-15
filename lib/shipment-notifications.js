'use strict';
const {createHmac,createHash,timingSafeEqual}=require('crypto');

const SCHEMA=`
CREATE TABLE IF NOT EXISTS mj_shipment_event_inbox (
 event_id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, tracking_number TEXT NOT NULL,
 carrier TEXT NOT NULL, state TEXT, occurred_at TIMESTAMPTZ NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(), processed_at TIMESTAMPTZ,
 result TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mj_shipment_states (
 id BIGSERIAL PRIMARY KEY, order_id TEXT NOT NULL, tracking_number TEXT NOT NULL,
 carrier TEXT NOT NULL, state TEXT NOT NULL, progress_rank INTEGER NOT NULL DEFAULT 0,
 occurred_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(carrier,tracking_number));
CREATE TABLE IF NOT EXISTS mj_shipment_notifications (
 id BIGSERIAL PRIMARY KEY, event_id TEXT UNIQUE NOT NULL,
 order_id TEXT NOT NULL, tracking_number TEXT NOT NULL, state TEXT NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mj_shipment_admin_targets (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 enabled BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mj_wallet_orders (
 id UUID PRIMARY KEY, order_id TEXT UNIQUE NOT NULL, snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS mj_wallet_devices (
 device_id TEXT NOT NULL, wallet_id UUID NOT NULL REFERENCES mj_wallet_orders(id) ON DELETE CASCADE,
 push_token TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(device_id,wallet_id));
CREATE TABLE IF NOT EXISTS mj_wallet_pushes (
 id BIGSERIAL PRIMARY KEY, wallet_id UUID NOT NULL REFERENCES mj_wallet_orders(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL, push_token TEXT NOT NULL, revision TIMESTAMPTZ NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(wallet_id,device_id,revision));
CREATE TABLE IF NOT EXISTS mj_shipment_activation (
 feature TEXT PRIMARY KEY, activated_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS mj_shipment_label_scans (
 order_id TEXT PRIMARY KEY, snapshot_hash TEXT NOT NULL, scanned_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS mj_shipment_inbox_pending_idx ON mj_shipment_event_inbox(next_attempt_at,received_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS mj_shipment_notifications_created_idx ON mj_shipment_notifications(created_at,id);
CREATE INDEX IF NOT EXISTS mj_wallet_push_pending_idx ON mj_wallet_pushes(next_attempt_at,id) WHERE status='pending';
`;
const STATES={created:0,shipped:1,in_transit:2,out_for_delivery:3,delivered:4};
function trackingFacts(order){
 const labels=order.shipping_labels||{},facts=[];
 for(const shipment of labels.shipments||[])for(const number of shipment.trackingNumbers||[])
  if(number&&shipment.carrier)facts.push({tracking_number:String(number),carrier:String(shipment.carrier).toLowerCase().replace(/\s/g,'')});
 if(order.tracking_number&&order.carrier&&!facts.some(x=>x.tracking_number===order.tracking_number))facts.push({tracking_number:order.tracking_number,carrier:String(order.carrier).toLowerCase().replace(/\s/g,'')});
 return facts.filter((item,index)=>facts.findIndex(x=>x.tracking_number===item.tracking_number&&x.carrier===item.carrier)===index);
}
function normalizeState(value){
 const key=String(value||'').trim().toLowerCase().replace(/[ _-]+/g,' ');
 return ({created:'created','label created':'created','shipment created':'created',
  shipped:'shipped','picked up':'in_transit',collected:'in_transit','in transit':'in_transit',
  'out for delivery':'out_for_delivery',delivered:'delivered',
  exception:'issue',incident:'issue','delivery exception':'issue','delivery failed':'issue',
  returned:'returned','returned to sender':'returned',cancelled:'cancelled',canceled:'cancelled'})[key]||null;
}
function parseEvent(raw,headers,secret,now=Date.now()){
 const get=name=>typeof headers.get==='function'?headers.get(name):headers[name.toLowerCase()];
 const timestamp=get('x-webhook-timestamp'),type=get('x-webhook-event'),id=get('x-webhook-id');
 const signature=get('x-webhook-signature')||'';
 if(typeof secret!=='string'||secret.length<32)throw Object.assign(Error('WEBHOOK_NOT_CONFIGURED'),{status:503});
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536||!/^\d{13}$/.test(timestamp||'')||Math.abs(now-Number(timestamp))>300000
  ||!['tracking.simple','tracking.ecommerce'].includes(type)||!/^[-A-Za-z0-9_.:]{1,200}$/.test(id||'')||!/^v1=[a-f0-9]{64}$/i.test(signature))throw Object.assign(Error('WEBHOOK_UNAUTHORIZED'),{status:401});
 const expected=createHmac('sha256',secret).update(timestamp+'.'+type+'.'+raw).digest();
 if(!timingSafeEqual(expected,Buffer.from(signature.slice(3),'hex')))throw Object.assign(Error('WEBHOOK_UNAUTHORIZED'),{status:401});
 let payload;try{payload=JSON.parse(raw);}catch{throw Object.assign(Error('WEBHOOK_INVALID'),{status:400});}
 const data=payload?.data,occurred=new Date(payload?.created_at);
 if(payload?.type!==type||!data||!/^[-A-Za-z0-9]{3,100}$/.test(data.tracking_number||'')||!/^[-A-Za-z0-9_ ]{1,50}$/.test(data.carrier_name||'')
  ||typeof data.status!=='string'||data.status.length>100||!Number.isFinite(occurred.getTime())||occurred.getTime()>now+300000)throw Object.assign(Error('WEBHOOK_INVALID'),{status:400});
 return {id,hash:createHash('sha256').update(raw).digest('hex'),tracking:data.tracking_number,carrier:data.carrier_name.toLowerCase().replace(/\s/g,''),state:normalizeState(data.status),occurredAt:occurred.toISOString()};
}
function transition(previous,event){
 if(!event.state)return false;
 if(!previous)return true;
 if(new Date(event.occurredAt)<new Date(previous.occurred_at))return false;
 if(['delivered','returned','cancelled'].includes(previous.state)||previous.state===event.state)return false;
 return !(event.state in STATES && STATES[event.state]<previous.progress_rank);
}
function createShipmentNotifications(pool,options={}){
 const startedAt=options.startedAt||new Date().toISOString();
 let ready;
 const ensure=()=>ready||(ready=pool.query(SCHEMA).then(()=>pool.query(`INSERT INTO mj_shipment_activation(feature,activated_at) VALUES('tracking',$1) ON CONFLICT DO NOTHING`,[startedAt])).catch(error=>{ready=null;throw error;}));
 async function ingest(event){
  await ensure();
  const {rows}=await pool.query(`INSERT INTO mj_shipment_event_inbox(event_id,body_hash,tracking_number,carrier,state,occurred_at)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,[event.id,event.hash,event.tracking,event.carrier,event.state,event.occurredAt]);
  if(!rows.length){const old=await pool.query('SELECT body_hash FROM mj_shipment_event_inbox WHERE event_id=$1',[event.id]);if(old.rows[0]?.body_hash!==event.hash)throw Object.assign(Error('WEBHOOK_EVENT_CONFLICT'),{status:409});}
  return rows.length>0;
 }
 async function processOne(){
  await ensure();const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const {rows:[event]}=await db.query(`SELECT * FROM mj_shipment_event_inbox WHERE processed_at IS NULL AND next_attempt_at<=now() ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`);
   if(!event){await db.query('ROLLBACK');return false;}
   const orders=await db.query(`SELECT w.order_id FROM web_orders w WHERE w.node_id=31 AND w.paid_at IS NOT NULL AND w.status NOT IN ('cancelled','canceled','refunded')
    AND ((lower(replace(COALESCE(w.carrier,''),' ',''))=$2 AND (w.tracking_number=$1 OR EXISTS(
      SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(to_jsonb(w)->'shipping_labels'->'tracking_numbers')='array' THEN to_jsonb(w)->'shipping_labels'->'tracking_numbers' ELSE '[]'::jsonb END) n WHERE n=$1)))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(to_jsonb(w)->'shipping_labels'->'shipments')='array' THEN to_jsonb(w)->'shipping_labels'->'shipments' ELSE '[]'::jsonb END) s
      WHERE lower(replace(s->>'carrier',' ',''))=$2 AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(s->'trackingNumbers')='array' THEN s->'trackingNumbers' ELSE '[]'::jsonb END) n WHERE n=$1))) LIMIT 2`,[event.tracking_number,event.carrier]);
   if(orders.rows.length!==1){
    await db.query(`UPDATE mj_shipment_event_inbox SET attempts=attempts+1,next_attempt_at=now()+interval '5 minutes',
     processed_at=CASE WHEN received_at<now()-interval '1 day' OR $2 THEN now() END,
     result=CASE WHEN $2 THEN 'ambiguous_order' ELSE 'awaiting_order' END WHERE event_id=$1`,[event.event_id,orders.rows.length>1]);
    await db.query('COMMIT');return true;
   }
   const orderId=orders.rows[0].order_id;
   // Serialize all changes for a tracking number, even before its first row exists.
   await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[event.carrier+':'+event.tracking_number]);
   const {rows:[previous]}=await db.query('SELECT * FROM mj_shipment_states WHERE carrier=$1 AND tracking_number=$2 FOR UPDATE',[event.carrier,event.tracking_number]);
   const changed=transition(previous,{state:event.state,occurredAt:event.occurred_at});
   if(changed){
    const rank=event.state in STATES?STATES[event.state]:(previous?.progress_rank||0);
    await db.query(`INSERT INTO mj_shipment_states(order_id,tracking_number,carrier,state,progress_rank,occurred_at) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(carrier,tracking_number) DO UPDATE SET state=EXCLUDED.state,progress_rank=EXCLUDED.progress_rank,occurred_at=EXCLUDED.occurred_at,updated_at=now()`,[orderId,event.tracking_number,event.carrier,event.state,rank,event.occurred_at]);
    await db.query(`INSERT INTO mj_shipment_notifications(event_id,order_id,tracking_number,state,occurred_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[event.event_id,orderId,event.tracking_number,event.state,event.occurred_at]);
    const {rows:wallets}=await db.query(`UPDATE mj_wallet_orders SET updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE order_id=$1 RETURNING id,updated_at`,[orderId]);
    for(const wallet of wallets)await db.query(`INSERT INTO mj_wallet_pushes(wallet_id,device_id,push_token,revision) SELECT $1,device_id,push_token,$2 FROM mj_wallet_devices WHERE wallet_id=$1 ON CONFLICT DO NOTHING`,[wallet.id,wallet.updated_at]);
   }
   await db.query('UPDATE mj_shipment_event_inbox SET processed_at=now(),result=$2 WHERE event_id=$1',[event.event_id,changed?'applied':'unchanged']);
   await db.query('COMMIT');return true;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
 }
 function register(app){
  app.post('/api/shipping/events/envia',async(req,res)=>{
   res.set('Cache-Control','no-store');
   try{const event=parseEvent(req.rawBody,req.headers,options.secret?.()??process.env.ENVIA_WEBHOOK_SECRET);await ingest(event);res.status(202).json({received:true});}
   catch(error){res.status(error.status||503).json({error:error.status?error.message:'WEBHOOK_UNAVAILABLE'});}
  });
 }
 async function scanLabels(){
  await ensure();
  const {rows}=await pool.query(`SELECT w.order_id,w.tracking_number,w.carrier,to_jsonb(w)->'shipping_labels' AS shipping_labels,w.shipped_at,
    md5(jsonb_build_array(w.tracking_number,w.carrier,to_jsonb(w)->'shipping_labels')::text) AS snapshot_hash
   FROM web_orders w LEFT JOIN mj_shipment_label_scans l ON l.order_id=w.order_id
   WHERE w.node_id=31 AND w.paid_at IS NOT NULL AND w.shipped_at >= (SELECT activated_at FROM mj_shipment_activation WHERE feature='tracking')
   AND w.status IN ('shipped','delivered') AND l.snapshot_hash IS DISTINCT FROM md5(jsonb_build_array(w.tracking_number,w.carrier,to_jsonb(w)->'shipping_labels')::text)
   ORDER BY w.shipped_at,w.order_id LIMIT 100`);
  for(const order of rows){
   const facts=trackingFacts(order);
   if(!facts.length)continue;
   for(const fact of facts){
    const key='proax-label-'+createHash('sha256').update(order.order_id+':'+fact.carrier+':'+fact.tracking_number).digest('hex');
    await ingest({id:key,hash:key,tracking:fact.tracking_number,carrier:fact.carrier,state:'created',occurredAt:new Date(order.shipped_at).toISOString()});
   }
   await pool.query(`INSERT INTO mj_shipment_label_scans(order_id,snapshot_hash) VALUES($1,$2) ON CONFLICT(order_id) DO UPDATE SET snapshot_hash=EXCLUDED.snapshot_hash,scanned_at=now()`,[order.order_id,order.snapshot_hash]);
  }
 }
 let busy=false;
 async function flush(){if(busy)return;busy=true;try{for(let n=0;n<25&&await processOne();n++);}finally{busy=false;}}
 return {ensure,ingest,processOne,flush,scanLabels,register};
}
module.exports={SCHEMA,STATES,trackingFacts,normalizeState,parseEvent,transition,createShipmentNotifications};
