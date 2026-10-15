const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {PGlite}=require('@electric-sql/pglite');
const {createShipmentNotifications}=require('../lib/shipment-notifications');
const {createAppleWallet,setReceiptSession,token}=require('../lib/apple-wallet');
const config={secret:'test-only-wallet-secret-not-for-production',id:'order.test.mahjoy',merchantId:'merchant.test.mahjoy',team:'TESTTEAM01',base:'https://www.playmahjoy.com'};
const walletId='11111111-1111-4111-8111-111111111111';
async function fixture(fn){
 const db=new PGlite();await db.waitReady;
 await db.exec(`CREATE TABLE users(id integer primary key);CREATE TABLE web_orders(id serial primary key,node_id int,order_id text,paypal_order_id text,paid_at timestamptz,status text,tracking_number text,carrier text,shipping_labels jsonb,shipped_at timestamptz,items jsonb,total numeric,currency text);
 INSERT INTO web_orders(node_id,order_id,paypal_order_id,paid_at,status,items,total,currency) VALUES(31,'paypal-TESTORDER1234','TESTORDER1234',now(),'paid','[{"name":"Only my purchase","qty":1}]',100,'USD');`);
 const query=(sql,args=[])=>sql.includes('CREATE TABLE')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,args);
 const pool={query};const shipments=createShipmentNotifications(pool);await shipments.ensure();
 const app=express();app.use(express.json());let available=config;let sent={status:200};let publicEnabled=true;
 const wallet=createAppleWallet(pool,shipments,{config:()=>available,publicEnabled:()=>publicEnabled,sign:async()=>Buffer.from('test-signature'),send:async()=>sent});wallet.register(app);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 let cookie;setReceiptSession({body:{orderId:'TESTORDER1234'},headers:{}},{append:(_,value)=>cookie=value.split(';')[0]},{id:'TESTORDER1234',status:'COMPLETED'},config);
 const base='http://127.0.0.1:'+server.address().port;
 try{await fn({db,wallet,base,cookie,setAvailable:value=>available=value,setSent:value=>sent=value,setPublicEnabled:value=>publicEnabled=value});}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.close();}
}
test('package endpoints require the matching post-payment browser session',()=>fixture(async({base,cookie,setAvailable})=>{
 assert.equal((await fetch(base+'/api/wallet/package/TESTORDER1234')).status,404);
 assert.equal((await fetch(base+'/api/wallet/package/TESTORDER9999',{headers:{cookie}})).status,404);
 const own=await fetch(base+'/api/wallet/package/TESTORDER1234',{headers:{cookie}});assert.equal(own.status,200);assert.match(own.headers.get('content-type'),/application\/vnd.apple.finance.order/);assert.match(own.headers.get('cache-control'),/no-store/);
 setAvailable(null);assert.deepEqual(await(await fetch(base+'/api/wallet/status/TESTORDER1234',{headers:{cookie}})).json(),{available:false});
}));
test('Wallet device registration and updates require this order token; unregister is idempotent',()=>fixture(async({base,db})=>{
 await db.query(`INSERT INTO mj_wallet_orders(id,order_id,snapshot) VALUES($1,'paypal-TESTORDER1234',$2)`,[walletId,JSON.stringify({orderNumber:'TESTORDER1234',items:[]})]);
 const path='/api/wallet/v1/devices/test-device-123456/registrations/'+config.id+'/'+walletId;
 const headers={authorization:'AppleOrder '+token(config.secret,'order',walletId),'content-type':'application/json'};
 const body=JSON.stringify({pushToken:'ab'.repeat(32)});
 assert.equal((await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
 assert.equal((await fetch(base+path,{method:'POST',headers,body})).status,201);
 assert.equal((await fetch(base+path,{method:'POST',headers,body})).status,200);
 const updates=await fetch(base+'/api/wallet/v1/devices/test-device-123456/registrations/'+config.id);assert.deepEqual((await updates.json()).orderIdentifiers,[walletId]);
 assert.equal((await fetch(base+'/api/wallet/v1/orders/'+config.id+'/'+walletId)).status,401);
 assert.equal((await fetch(base+path,{method:'DELETE',headers})).status,200);
 assert.equal((await fetch(base+path,{method:'DELETE',headers})).status,200);
 assert.equal((await fetch(base+'/api/wallet/v1/devices/test-device-123456/registrations/'+config.id)).status,204);
}));
test('private rollout hides checkout enrollment while authenticated Wallet callbacks keep working',()=>fixture(async({base,db,cookie,wallet,setPublicEnabled})=>{
 await db.query(`INSERT INTO mj_wallet_orders(id,order_id,snapshot) VALUES($1,'wallet-demo-private',$2)`,[walletId,JSON.stringify({demo:true,orderNumber:'PRUEBA-WALLET',items:[]})]);
 setPublicEnabled(false);
 assert.deepEqual(await(await fetch(base+'/api/wallet/status/TESTORDER1234',{headers:{cookie}})).json(),{available:false});
 assert.equal((await fetch(base+'/api/wallet/package/TESTORDER1234',{headers:{cookie}})).status,404);
 let issuedCookie=false;
 wallet.setReceiptSession({body:{orderId:'TESTORDER1234'},headers:{}},{append:()=>issuedCookie=true},{id:'TESTORDER1234',status:'COMPLETED'});
 assert.equal(issuedCookie,false);
 const url=base+'/api/wallet/v1/orders/'+config.id+'/'+walletId;
 assert.equal((await fetch(url)).status,401);
 const response=await fetch(url,{headers:{authorization:'AppleOrder '+token(config.secret,'order',walletId)}});
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/application\/vnd.apple.finance.order/);
 setPublicEnabled(true);
 assert.deepEqual(await(await fetch(base+'/api/wallet/status/TESTORDER1234',{headers:{cookie}})).json(),{available:true});
}));
test('provider configuration errors do not delete a valid Wallet registration',()=>fixture(async({db,wallet,setSent})=>{
 await db.query(`INSERT INTO mj_wallet_orders(id,order_id,snapshot) VALUES($1,'paypal-TESTORDER1234','{}')`,[walletId]);
 await db.query(`INSERT INTO mj_wallet_devices(device_id,wallet_id,push_token) VALUES('test-device-123456',$1,'ab')`,[walletId]);
 await db.query(`INSERT INTO mj_wallet_pushes(device_id,wallet_id,push_token,revision) VALUES('test-device-123456',$1,'ab',now())`,[walletId]);
 setSent({status:400,reason:'BadTopic'});await wallet.flush();assert.equal((await db.query('SELECT * FROM mj_wallet_devices')).rows.length,1);
 await db.query(`UPDATE mj_wallet_pushes SET next_attempt_at=now()`);setSent({status:410,reason:'Unregistered'});await wallet.flush();assert.equal((await db.query('SELECT * FROM mj_wallet_devices')).rows.length,0);
}));
