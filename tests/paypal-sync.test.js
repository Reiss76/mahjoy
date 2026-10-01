const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {getPayPalOrderId,signedRequest,registerPayPalSync}=require('../lib/paypal-sync');
test('all legacy receipt formats resolve the same PayPal order ID',()=>{
 for(const b of [{order_id:'AAAABBBBCCCC1'},{orderId:'AAAABBBBCCCC1'},{payment_id:'AAAABBBBCCCC1'},{order_id:'paypal-AAAABBBBCCCC1'},{paypalOrderId:'AAAABBBBCCCC1'}])assert.equal(getPayPalOrderId(b),'AAAABBBBCCCC1');
 assert.equal(getPayPalOrderId({orderId:'../orders'}),null);
});
test('request signs timestamp and exact serialized payload',()=>{
 const a=signedRequest('AAAABBBBCCCC1',{shipping:{cp:'64000'}},'secret',100);
 assert.equal(a.headers['x-mahjoy-timestamp'],'100');
 assert.notEqual(a.headers['x-mahjoy-signature'],signedRequest('AAAABBBBCCCC1',{shipping:{cp:'64001'}},'secret',100).headers['x-mahjoy-signature']);
 assert.throws(()=>signedRequest('AAAABBBBCCCC1',{},''));
});
test('browser retains failed receipts and removes durable acknowledgments',async()=>{
 const values={},storage={setItem:(k,v)=>values[k]=v,getItem:k=>values[k],removeItem:k=>delete values[k]};
 const ctx={window:{addEventListener(){}},localStorage:storage,fetch:async()=>({ok:false})};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/paypal-sync.js','utf8'),ctx);
 const d={id:'AAAABBBBCCCC1',status:'COMPLETED'};await assert.rejects(()=>ctx.window.MJPayPalSync.save(d));assert(values['mj_paypal_sync_AAAABBBBCCCC1']);
 ctx.fetch=async()=>({ok:true,json:async()=>({sync:'queued'})});await ctx.window.MJPayPalSync.save(d);assert(!values['mj_paypal_sync_AAAABBBBCCCC1']);
 await assert.rejects(()=>ctx.window.MJPayPalSync.save({...d,status:'PENDING'}));
});
test('failed Proax delivery is saved for retry and never records a paid local order',async()=>{
 const calls=[];const pool={query:async(q,args)=>{calls.push({q,args});return {rows:q.startsWith('UPDATE mahjoy_paypal_sync_jobs SET next_attempt_at')?[{payload:{},attempts:1}]:[]}}};let handler,paid=0;
 const fetchBefore=global.fetch,secretBefore=process.env.PROAX_PAYPAL_SYNC_SECRET;
 try{process.env.PROAX_PAYPAL_SYNC_SECRET='secret';global.fetch=async()=>({ok:false,status:503,json:async()=>({error:'Temporary error'})});registerPayPalSync({post:(url,fn)=>handler=fn},pool,'https://proax.example',async()=>paid++);
 const res={status(n){this.code=n;return this},json(v){this.body=v;return this}};await handler({body:{order_id:'AAAABBBBCCCC1',cart:[{sku:'MAT-col',qty:2}]}},res);
 assert.equal(res.code,202);assert.equal(paid,0);assert(calls.some(c=>c.q.includes('last_error=$2')));assert(calls.some(c=>c.q.includes('INSERT INTO mahjoy_paypal_sync_jobs')));
 }finally{global.fetch=fetchBefore;if(secretBefore==null)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=secretBefore;}
});
