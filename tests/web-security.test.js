const test=require('node:test'),assert=require('node:assert/strict');
const {publicAsset,operationsGuard}=require('../lib/web-security');
test('only storefront pages and public assets are served, never server code, secrets or backups',()=>{
 for(const p of ['/','/en/checkout.html','/js/paypal-pricing.js','/css/site.css','/fonts/My Font.otf','/images/a.webp','/product'])assert(publicAsset(p),p);
 for(const p of ['/server.js','/lib/paypal-sync.js','/lib/web-security.js','/package.json','/data/orders.json','/config/secrets.json','/.env','/%2eenv','/node_modules/express/index.js','/tests/file.js','/js/../../server.js','/js/app.js.map','/js/%2e%2e/server.js'])assert(!publicAsset(p),p);
});
test('private order data, mutations, shipping labels and diagnostic tools require a server-only credential',()=>{
 const before=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='test'.repeat(16);
 try{for(const p of ['/api/orders','/api/orders/by-email','/api/orders/save','/api/orders/today','/api/orders/abc/status','/api/shipping/create','/api/poll/debug','/api/notifications/test','/api/telegram/updates']){
 let next=false;const res={status(n){this.statusCode=n;return this},json(){},set(){}};
 operationsGuard({path:p,get:()=>''},res,()=>next=true);assert.equal(res.statusCode,401,p);assert(!next);
 operationsGuard({path:p,get:()=>process.env.PROAX_PAYPAL_SYNC_SECRET},res,()=>next=true);assert(next,p);
 }
 for(const p of ['/api/orders/paypal-express','/api/checkout/prices','/api/shipping/quote']){let next=false;operationsGuard({path:p,get:()=>''},{},()=>next=true);assert(next);}
 }finally{if(before===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=before;}
});
