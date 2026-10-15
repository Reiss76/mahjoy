const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto');
const {PGlite}=require('@electric-sql/pglite');
const {parseEvent,transition,createShipmentNotifications}=require('../lib/shipment-notifications');
const secret='test-only-webhook-secret-not-a-real-key';
function signed(status='In transit'){
 const now=Date.parse('2026-10-14T12:00:00Z'),raw=JSON.stringify({type:'tracking.simple',created_at:new Date(now).toISOString(),data:{tracking_number:'TRACK123',carrier_name:'FedEx',status}});
 const headers={'x-webhook-timestamp':String(now),'x-webhook-event':'tracking.simple','x-webhook-id':'test-event-1','x-webhook-signature':'v1='+crypto.createHmac('sha256',secret).update(now+'.tracking.simple.'+raw).digest('hex')};
 return {now,raw,headers};
}
test('signed Envia events authenticate exact original bytes; no unsigned or stale fallback',()=>{
 const x=signed();assert.equal(parseEvent(x.raw,x.headers,secret,x.now).state,'in_transit');
 for(const [raw,headers,time] of [[x.raw+' ',x.headers,x.now],[x.raw,{...x.headers,'x-webhook-signature':''},x.now],[x.raw,x.headers,x.now+300001]])assert.throws(()=>parseEvent(raw,headers,secret,time));
 assert.throws(()=>parseEvent(x.raw,x.headers,'',x.now),/NOT_CONFIGURED/);
 const unknown=signed('Provider-specific status');assert.equal(parseEvent(unknown.raw,unknown.headers,secret,unknown.now).state,null);
});
test('tracking progress cannot regress or leave a terminal delivered state',()=>{
 const prior={state:'out_for_delivery',progress_rank:3,occurred_at:'2026-10-14T10:00:00Z'};
 assert.equal(transition(prior,{state:'in_transit',occurredAt:'2026-10-14T11:00:00Z'}),false);
 assert.equal(transition(prior,{state:'delivered',occurredAt:'2026-10-14T09:00:00Z'}),false);
 assert.equal(transition({...prior,state:'delivered',progress_rank:4},{state:'issue',occurredAt:'2026-10-14T11:00:00Z'}),false);
 assert.equal(transition({...prior,state:'issue'},{state:'out_for_delivery',occurredAt:'2026-10-14T11:00:00Z'}),true);
});
async function fixture(fn){
 const db=new PGlite();await db.waitReady;
 await db.exec(`CREATE TABLE users(id integer primary key);CREATE TABLE web_orders(id serial primary key,node_id int,order_id text,paid_at timestamptz,status text,tracking_number text,carrier text,shipping_labels jsonb,shipped_at timestamptz);
 INSERT INTO web_orders(node_id,order_id,paid_at,status,tracking_number,carrier) VALUES(31,'ORDER-A',now(),'shipped','TRACK123','fedex');`);
 const query=(sql,args=[])=>sql.startsWith('SELECT pg_advisory_xact_lock')?Promise.resolve({rows:[]}):sql.includes('CREATE TABLE')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);
 const pool={query,connect:async()=>({query,release(){}})};
 const service=createShipmentNotifications(pool,{startedAt:'2020-01-01T00:00:00Z'});
 try{await service.ensure();await fn({db,pool,service});}finally{await db.close();}
}
test('durable events deduplicate, preserve customer association, and update registered Wallet devices once',()=>fixture(async({db,service})=>{
 await db.query(`INSERT INTO mj_wallet_orders(id,order_id,snapshot) VALUES('11111111-1111-4111-8111-111111111111','ORDER-A','{}')`);
 await db.query(`INSERT INTO mj_wallet_devices(device_id,wallet_id,push_token) VALUES('test-device','11111111-1111-4111-8111-111111111111','test-token')`);
 const base={id:'event-1',hash:'abc',tracking:'TRACK123',carrier:'fedex',state:'in_transit',occurredAt:'2026-10-14T12:00:00Z'};
 assert.equal(await service.ingest(base),true);assert.equal(await service.ingest(base),false);
 await assert.rejects(service.ingest({...base,hash:'changed'}),/CONFLICT/);
 await service.processOne();
 await service.ingest({...base,id:'event-2',hash:'second'});await service.processOne();
 assert.equal((await db.query('SELECT * FROM mj_shipment_notifications')).rows.length,1);
 assert.equal((await db.query('SELECT * FROM mj_wallet_pushes')).rows.length,1);
 await service.ingest({...base,id:'event-3',hash:'third',state:'delivered',occurredAt:'2026-10-14T13:00:00Z'});await service.processOne();
 assert.equal((await db.query('SELECT state,order_id FROM mj_shipment_states')).rows[0].state,'delivered');
 assert.equal((await db.query('SELECT * FROM mj_shipment_notifications')).rows.length,2);
 assert.equal((await db.query('SELECT status FROM web_orders')).rows[0].status,'shipped','notification processing must not rewrite a paid order');
}));
test('unknown or mismatched carrier events cannot notify another customer',()=>fixture(async({db,service})=>{
 await service.ingest({id:'wrong-carrier',hash:'abc',tracking:'TRACK123',carrier:'ups',state:'delivered',occurredAt:'2026-10-14T12:00:00Z'});
 await service.processOne();assert.equal((await db.query('SELECT * FROM mj_shipment_notifications')).rows.length,0);
 assert.equal((await db.query('SELECT result FROM mj_shipment_event_inbox')).rows[0].result,'awaiting_order');
}));
test('multi-package matching keeps the carrier and tracking number paired',()=>fixture(async({db,service})=>{
 await db.query(`UPDATE web_orders SET shipping_labels=$1`,[JSON.stringify({tracking_numbers:['TRACK123','OTHER456'],shipments:[{carrier:'fedex',trackingNumbers:['TRACK123']},{carrier:'ups',trackingNumbers:['OTHER456']}]})]);
 await service.ingest({id:'cross-pair',hash:'x',tracking:'TRACK123',carrier:'ups',state:'delivered',occurredAt:new Date().toISOString()});
 await service.processOne();assert.equal((await db.query('SELECT * FROM mj_shipment_notifications')).rows.length,0);
 await service.ingest({id:'right-pair',hash:'y',tracking:'OTHER456',carrier:'ups',state:'delivered',occurredAt:new Date().toISOString()});
 await service.processOne();assert.equal((await db.query('SELECT order_id FROM mj_shipment_notifications')).rows[0].order_id,'ORDER-A');
}));
test('label scanning drains batches and persists activation across restarts',()=>fixture(async({db,pool,service})=>{
 await db.exec(`INSERT INTO web_orders(node_id,order_id,paid_at,status,tracking_number,carrier,shipped_at)
 SELECT 31,'BATCH-'||n,now(),'shipped','TRACK-'||n,'fedex',now() FROM generate_series(1,150) n;`);
 await service.scanLabels();assert.equal((await db.query('SELECT count(*)::int AS n FROM mj_shipment_event_inbox')).rows[0].n,100);
 await service.scanLabels();assert.equal((await db.query('SELECT count(*)::int AS n FROM mj_shipment_event_inbox')).rows[0].n,150);
 await db.exec(`INSERT INTO web_orders(node_id,order_id,paid_at,status,tracking_number,carrier,shipped_at) VALUES(31,'AFTER-RESTART',now(),'shipped','RESTART123','fedex',now());`);
 const restarted=createShipmentNotifications(pool,{startedAt:new Date(Date.now()+86400000).toISOString()});
 await restarted.scanLabels();assert.equal((await db.query('SELECT count(*)::int AS n FROM mj_shipment_event_inbox')).rows[0].n,151);
}));
