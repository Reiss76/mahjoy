const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path');
const {execFileSync}=require('child_process');
const {unzipSync}=require('fflate');
const {sessionOrders,setReceiptSession,makeOrder,buildPackage,signManifest,readWalletConfig}=require('../lib/apple-wallet');
const config={secret:'test-only-wallet-secret-not-for-production',id:'order.test.mahjoy',merchantId:'merchant.test.mahjoy',team:'TESTTEAM01',base:'https://www.playmahjoy.com'};
const id='11111111-1111-4111-8111-111111111111';
test('Wallet receipt ownership is signed, HttpOnly, and scoped to exact completed PayPal receipts',()=>{
 let cookie;const res={append:(name,value)=>{assert.equal(name,'Set-Cookie');cookie=value;}};
 const req={body:{orderId:'TESTORDER1234'},headers:{}};
 setReceiptSession(req,res,{id:'TESTORDER9999',status:'COMPLETED'},config);assert.equal(cookie,undefined);
 setReceiptSession(req,res,{id:'TESTORDER1234',status:'APPROVED'},config);assert.equal(cookie,undefined);
 setReceiptSession(req,res,{id:'TESTORDER1234',status:'COMPLETED'},config);
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.deepEqual(sessionOrders(cookie,config.secret),['TESTORDER1234']);
 assert.deepEqual(sessionOrders(cookie,config.secret+'bad'),[]);
 assert.deepEqual(sessionOrders(cookie,config.secret,Date.now()+31*86400000),[]);
 assert.equal(readWalletConfig({MAHJOY_WALLET_ENABLED:'true'}),null);
});
test('each customer package includes only its own snapshot and cannot complete a two-box order after one delivery',()=>{
 const wallet={id,created_at:'2026-10-14T10:00:00Z',updated_at:'2026-10-14T11:00:00Z',snapshot:{orderNumber:'TESTORDER1234',items:[{title:'Test item',quantity:1}],tracking:[{carrier:'fedex',tracking_number:'ONE'},{carrier:'fedex',tracking_number:'TWO'}]}};
 const a=makeOrder(wallet,[{carrier:'fedex',tracking_number:'ONE',state:'delivered',occurred_at:'2026-10-14T11:00:00Z'}],config);
 assert.equal(a.status,'open');assert.equal(a.fulfillments.length,2);assert.equal(a.changeNotifications,'enabled');assert.equal(a.customer,undefined);
 assert.equal(makeOrder(wallet,[...a.fulfillments.map(f=>({carrier:f.carrier,tracking_number:f.trackingNumber,state:'delivered',occurred_at:'2026-10-14T11:00:00Z'}))],config).status,'completed');
});
test('distribution uses SHA-256 manifest entries and a real verifiable detached CMS signature',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mahjoy-wallet-test-'));fs.chmodSync(dir,0o700);
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-nodes','-days','1','-subj','/CN=Test certificate'],{stdio:'ignore'});
  const c={...config,key:fs.readFileSync(path.join(dir,'key.pem'),'utf8'),cert:fs.readFileSync(path.join(dir,'cert.pem'),'utf8'),wwdr:fs.readFileSync(path.join(dir,'cert.pem'),'utf8')};
  const order={orderIdentifier:id,schemaVersion:1};
  const zip=await buildPackage(order,c,signManifest),files=unzipSync(zip),manifest=JSON.parse(Buffer.from(files['manifest.json']));
  for(const [name,hash] of Object.entries(manifest))assert.equal(crypto.createHash('sha256').update(files[name]).digest('hex'),hash);
  fs.writeFileSync(path.join(dir,'manifest'),files['manifest.json']);fs.writeFileSync(path.join(dir,'signature'),files.signature);
  execFileSync('openssl',['cms','-verify','-binary','-inform','DER','-in',path.join(dir,'signature'),'-content',path.join(dir,'manifest'),'-noverify'],{stdio:'ignore'});
  assert.deepEqual(JSON.parse(Buffer.from(files['order.json'])),order);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
