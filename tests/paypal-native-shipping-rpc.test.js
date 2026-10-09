const test=require('node:test'),assert=require('node:assert/strict');
const {signature,verifyRpcRequest,nativeShippingQuote,registerPayPalNativeShippingRpc,canonicalPhysicalItems}=require('../lib/paypal-native-shipping-rpc');
const {signShippingQuote}=require('../lib/shipping-quotes');
const secret='fixture-shared-secret',now=Date.now();
const body={items:[{sku:'TEST',quantity:1}],postalCode:'85219',country:'MX',currency:'MXN'};
function quote(price,carrier='estafeta',dropOff=0){return {version:1,expires_at:now+600000,items:[{sku:'TEST',qty:1}],destination:{postalCode:'85219',country:'MX'},origin:{name:'Fixture',street:'Fixture',number:'1',city:'Fixture',state:'NL',country:'MX',postalCode:'66188'},packages:[{content:'Fixture',amount:1,type:'box',weight:2,weightUnit:'KG',lengthUnit:'CM',dimensions:{length:40,width:30,height:20}}],carrier,service:'ground',price,currency:'MXN',drop_off:dropOff};}
function rate(price,carrier,dropOff=0){const snapshot=quote(price,carrier,dropOff);return {price,carrier: snapshot.carrier,service:'ground',currency:'MXN',drop_off:dropOff,quote_token:signShippingQuote(snapshot,{secret}),carrier_name:'Fixture',service_name:'Door delivery'};}
function verify(token,context){return require('../lib/shipping-quotes').verifyShippingQuote(token,context,{secret});}
test('RPC requires fresh signature of the exact original bytes',()=>{
 const raw=JSON.stringify(body),timestamp=String(now),headers={'x-mahjoy-timestamp':timestamp,'x-mahjoy-signature':signature(raw,timestamp,secret)};
 assert(verifyRpcRequest(raw,name=>headers[name],secret,now));
 assert(!verifyRpcRequest(raw+' ',name=>headers[name],secret,now));
 assert(!verifyRpcRequest(raw,name=>headers[name],secret,now+300001));
 assert(!verifyRpcRequest(raw,name=>headers[name],undefined,now));
 assert(!verifyRpcRequest(null,name=>headers[name],secret,now));
 headers['x-mahjoy-signature']='invalid';assert(!verifyRpcRequest(raw,name=>headers[name],secret,now));
});
test('selects cheapest verified delivery quote; excludes pickup and tampered prices',async()=>{
 const rates=[rate(100,'fedex',1),{...rate(250,'dhl'),price:1},rate(445,'estafeta'),rate(284,'paquetexpress')];
 let input;
 const result=await nativeShippingQuote({quote:async value=>{input=value;return {quotes:rates}}},body,verify);
 assert.deepEqual(input,{items:[{sku:'TEST',qty:1}],destination:'85219',country:'MX',currency:'MXN'});
 assert.equal(result.shippingQuote.price,284);assert.equal(result.shippingQuote.carrier,'paquetexpress');
 assert.equal(result.option.amount.value,'284.00');assert.equal(result.option.amount.currency_code,'MXN');
 assert.match(result.option.id,/^mj-[a-f0-9]{48}$/);assert(!JSON.stringify(result).includes('quote_token'));
});
test('quote cannot substitute another cart, destination, currency, or parcel without the signed snapshot',async()=>{
 const good=rate(284,'paquetexpress');
 for(const changed of [{items:[{sku:'OTHER',quantity:1}]},{postalCode:'99999'},{currency:'USD'}])
  await assert.rejects(()=>nativeShippingQuote({quote:async()=>({quotes:[good]})},{...body,...changed},verify),/SHIPPING_RATES_UNAVAILABLE/);
 const forged={...good,quote_token:good.quote_token.slice(0,-1)+'x'};
 await assert.rejects(()=>nativeShippingQuote({quote:async()=>({quotes:[forged]})},body,verify),/SHIPPING_RATES_UNAVAILABLE/);
});
test('provider and package-profile failures have no shipping fallback',async()=>{
 const e=Object.assign(new Error('PACKAGE_PROFILE_REQUIRED'),{code:'PACKAGE_PROFILE_REQUIRED',status:409});
 await assert.rejects(()=>nativeShippingQuote({quote:async()=>{throw e}},body,verify),{code:'PACKAGE_PROFILE_REQUIRED'});
 await assert.rejects(()=>nativeShippingQuote({quote:async()=>({quotes:[]})},body,verify),/SHIPPING_RATES_UNAVAILABLE/);
});
test('HTTP endpoint rejects unsigned JSON and signs success and safe failure responses',async()=>{
 let handler,calls=0;
 registerPayPalNativeShippingRpc({post:(_p,h)=>handler=h},{quote:async()=>{calls++;return {quotes:[rate(284,'paquetexpress')]}}},{secret,now:()=>now,verifyQuote:verify});
 const raw=JSON.stringify(body),timestamp=String(now),headers={'x-mahjoy-timestamp':timestamp,'x-mahjoy-signature':signature(raw,timestamp,secret)};
 function response(){return {headers:{},set(k,v){this.headers[k]=v;return this;},status(s){this.statusCode=s;return this;},json(v){this.value=v;return this;},send(v){this.raw=v;return this;}};}
 let res=response();await handler({body,get:name=>headers[name]},res);assert.equal(res.statusCode,401);assert.equal(calls,0);
 res=response();await handler({body,rawBody:raw,get:name=>headers[name]},res);assert.equal(res.statusCode,200);assert.equal(calls,1);
 assert(verifyRpcRequest(res.raw,name=>res.headers[name],secret,now));assert.equal(JSON.parse(res.raw).shippingQuote.price,284);
 registerPayPalNativeShippingRpc({post:(_p,h)=>handler=h},{quote:async()=>{throw Error('private provider credential')}},{secret,now:()=>now});
 res=response();await handler({rawBody:raw,get:name=>headers[name]},res);assert.equal(res.statusCode,503);
 assert(verifyRpcRequest(res.raw,name=>res.headers[name],secret,now));assert(!res.raw.includes('credential'));
});
function bundleRate({physical_items,price=369,packages,carrier='paquetexpress',items=[{sku:'BUNDLE-9',qty:1}],currency='MXN',country='MX',postalCode='85219'}={}){
 const snapshot={...quote(price,carrier),items,currency,destination:{postalCode,country},
  origin:{...quote(price,carrier).origin,country,postalCode:country==='US'?'78852':'66188'},
  ...(physical_items===undefined?{}:{physical_items}),...(packages?{packages}:{})};
 return {price,carrier,service:'ground',currency,drop_off:0,quote_token:signShippingQuote(snapshot,{secret}),carrier_name:'Fixture',service_name:'Door delivery'};
}
test('bundle and mixed-cart RPC preserve frozen physical composition and every signed package in both markets',async()=>{
 for(const currency of ['MXN','USD']){
  const country=currency==='USD'?'US':'MX',postalCode=currency==='USD'?'78852':'85219';
  const commercial=[{sku:'BUNDLE-9',qty:1},{sku:'TEST',qty:1}],frozen=[{sku:'A',qty:2},{sku:'TEST',qty:1}],packages=[quote(369).packages[0],{...quote(369).packages[0],content:'Second package',weight:1.5}];
  const signed=bundleRate({items:commercial,physical_items:[{sku:'a',qty:1},{sku:'A',qty:1},{sku:'test',qty:1}],packages,currency,country,postalCode});
  let requested;const result=await nativeShippingQuote({quote:async input=>{requested=input;return {quotes:[signed]}}},
   {items:commercial,frozenPhysicalItems:frozen,postalCode,country,currency},verify);
  assert.deepEqual(requested.items,commercial);assert.equal(requested.frozenPhysicalItems,undefined,'Public quote cannot accept a browser packing override');
  assert.equal(result.shippingQuote.packages.length,2);assert.equal(result.shippingQuote.packages[1].weight,1.5);
  assert.deepEqual(result.shippingQuote.items,commercial);assert.equal(result.option.amount.currency_code,currency);
  assert.equal(result.option.amount.value,'369.00');assert.match(result.option.id,/^mj-[a-f0-9]{48}$/);
 }
});
test('missing, changed or substituted bundle composition is rejected before returning a native option',async()=>{
 const commercial=[{sku:'BUNDLE-9',qty:1}],frozen=[{sku:'A',qty:2}];
 for(const physical_items of [undefined,[{sku:'A',qty:1}],[{sku:'OTHER',qty:2}],[{sku:'BUNDLE-9',qty:1}]]) {
  const signed=bundleRate({physical_items});
  await assert.rejects(()=>nativeShippingQuote({quote:async()=>({quotes:[signed]})},{...body,items:commercial,frozenPhysicalItems:frozen},verify),
   error=>error.code==='NATIVE_SHIPPING_PHYSICAL_MISMATCH' && error.status===409);
 }
 let quoted=false;
 await assert.rejects(()=>nativeShippingQuote({quote:async()=>{quoted=true;return {quotes:[]}}},{...body,items:commercial},verify),
  error=>error.code==='NATIVE_SHIPPING_PHYSICAL_MISMATCH');assert.equal(quoted,false);
 await assert.rejects(()=>nativeShippingQuote({quote:async()=>({quotes:[rate(284,'paquetexpress')]})},{...body,frozenPhysicalItems:[{sku:'OTHER',qty:1}]},verify),
  error=>error.code==='NATIVE_SHIPPING_PHYSICAL_MISMATCH');
});
test('physical manifests are canonical, bounded to 100 units, nonmutating and cannot contain another bundle',()=>{
 const input=[{sku:'b',qty:1},{sku:'A',qty:2},{sku:'a',qty:3}],before=JSON.stringify(input);
 assert.deepEqual(canonicalPhysicalItems(input),[{sku:'A',qty:5},{sku:'b',qty:1}]);assert.equal(JSON.stringify(input),before);
 for(const invalid of [null,[],[{sku:'BUNDLE-9',qty:1}],[{sku:'A',qty:'1'}],[{sku:'A',qty:0}],[{sku:'A',qty:NaN}],[{sku:'A',qty:101}],[{sku:'A',qty:60},{sku:'a',qty:41}]])
  assert.throws(()=>canonicalPhysicalItems(invalid),error=>error.code==='NATIVE_SHIPPING_PHYSICAL_MISMATCH');
});
test('native RPC rejects more than 20 total parcels while retaining a valid multiparcel quote',async()=>{
 const oversized=bundleRate({items:body.items.map(item=>({sku:item.sku,qty:item.quantity})),packages:Array.from({length:11},()=>({...quote(369).packages[0],amount:2}))});
 await assert.rejects(()=>nativeShippingQuote({quote:async()=>({quotes:[oversized]})},body,verify),/SHIPPING_RATES_UNAVAILABLE/);
});
test('HTTP RPC signs physical-mismatch responses and refuses a changed frozen manifest without a new signature',async()=>{
 const requestBody={...body,items:[{sku:'BUNDLE-9',qty:1}],frozenPhysicalItems:[{sku:'A',qty:2}]},raw=JSON.stringify(requestBody),timestamp=String(now);
 const headers={'x-mahjoy-timestamp':timestamp,'x-mahjoy-signature':signature(raw,timestamp,secret)};
 let handler,calls=0;
 registerPayPalNativeShippingRpc({post:(_p,h)=>handler=h},{quote:async()=>{calls++;return {quotes:[bundleRate({physical_items:[{sku:'A',qty:1}]})]}}},{secret,now:()=>now,verifyQuote:verify});
 function response(){return {headers:{},set(k,v){this.headers[k]=v;return this;},status(s){this.statusCode=s;return this;},json(v){this.value=v;return this;},send(v){this.raw=v;return this;}};}
 let res=response();await handler({rawBody:raw,get:name=>headers[name]},res);
 assert.equal(res.statusCode,409);assert.equal(JSON.parse(res.raw).error_code,'NATIVE_SHIPPING_PHYSICAL_MISMATCH');assert(verifyRpcRequest(res.raw,name=>res.headers[name],secret,now));
 res=response();await handler({rawBody:JSON.stringify({...requestBody,frozenPhysicalItems:[{sku:'A',qty:1}]}),get:name=>headers[name]},res);
 assert.equal(res.statusCode,401);assert.equal(calls,1);
});
