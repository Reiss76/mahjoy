const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const shipping=require('../lib/shipping-quotes');
const source=fs.readFileSync('server.js','utf8');
const start=source.indexOf("app.post('/api/centumpay/checkout'");
const handlerSource=source.slice(start,source.indexOf("app.options('/api/centumpay/checkout'",start));
const products=[{id:59,sku:'MAT-PIEL',name:'Mat Polo Club',price:1330,priceUsd:90}];
function fixture() {
  const calls=[],saved=[];let handler;
  const snapshot={version:1,expires_at:Date.now()+1800000,items:[{sku:'MAT-PIEL',qty:1}],destination:{postalCode:'85219',country:'MX'},
    origin:{name:'Shop',street:'Origin',number:'1',city:'City',state:'NL',country:'MX',postalCode:'66188'},
    packages:[{content:'Mat',amount:1,type:'box',weight:1,weightUnit:'KG',lengthUnit:'CM',dimensions:{length:83,width:33,height:27}}],carrier:'estafeta',service:'ground',price:429,currency:'MXN'};
  const context={app:{post(_p,h){handler=h}},require:n=>require('../'+n.replace(/^\.\//,'')),crypto,console:{log(){},error(){}},
    PROAX_API_URL:'https://proax.test',saveOrderToBackup(){},saveOrderToDatabase:async d=>{saved.push(d);return true},
    fetch:async(url,options)=>{
      if(url.includes('/catalog/products'))return {ok:true,json:async()=>({products})};
      calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,checkoutUrl:'https://checkout.example.test/fixture'})};
    }};
  vm.createContext(context);vm.runInContext(handlerSource,context);
  const body={orderId:'mahjoy-existing-paid',cart:[{id:59,sku:'MAT-PIEL',name:'Mat Polo Club',qty:1,price:1330}],currency:'MXN',shipping_cp:'85219',shipping_country:'MX',shipping_cost:429,
    customer_name:'Test',customer_email:'test@example.test',customer_phone:'5500000000',shipping_street:'Test Street 1',shipping_city:'Test City',shipping_state:'SO',
    shipping_quote_token:shipping.signShippingQuote(snapshot)};
  const response=()=>({setHeader(){},status(n){this.statusCode=n;return this},json(b){this.body=b;return this}});
  return {handler,body,calls,saved,response};
}
test('card route cannot create a hosted payment with an altered product price or missing shipping quote',async()=>{
  const old=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='offline-shipping-fixture-secret';
  try{
    const f=fixture(),r=f.response();
    await f.handler({body:{...f.body,cart:[{...f.body.cart[0],price:1}]}},r);
    assert.equal(r.statusCode,409);assert.equal(r.body.error_code,'PRICE_MISMATCH');assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);
    await f.handler({body:{...f.body,shipping_quote_token:undefined}},r);
    assert.equal(r.statusCode,409);assert.equal(r.body.error_code,'SHIPPING_QUOTE_REQUIRED');assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);
    await f.handler({body:{...f.body,shipping_street:''}},r);
    assert.equal(r.statusCode,409);assert.equal(r.body.error_code,'SHIPPING_ADDRESS_REQUIRED');assert.equal(f.calls.length,0);
  }finally{if(old===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=old;}
});
test('card freezes server catalog merchandise and quote once under a fresh server order ID',async()=>{
  const old=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='offline-shipping-fixture-secret';
  try{
    const f=fixture(),r=f.response();await f.handler({body:f.body},r);
    assert.equal(r.body.ok,true);assert.match(r.body.orderId,/^mahjoy-[a-f0-9-]{36}$/);assert.notEqual(r.body.orderId,f.body.orderId);
    assert.equal(f.saved.length,1);assert.equal(f.calls.length,1);assert.equal(f.saved[0].orderId,r.body.orderId);
    assert.equal(f.saved[0].cart.length,1);assert.equal(f.saved[0].cart[0].price,1330);assert.equal(f.saved[0].shipping_quote.price,429);
    assert.equal(f.calls[0].cart.reduce((n,p)=>n+p.qty*p.price,0),1759);assert.equal(f.calls[0].shipping_cost,429);
    assert.equal(f.calls[0].shipping_quote.destination.postalCode,'85219');
  }finally{if(old===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=old;}
});
