const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  canonicalItems, productWeight, normalizeRate, createShippingQuoteService,
  verifyShippingQuote, verifyShippingQuoteSignature, getStoredShippingQuote, shipmentStore, shippingLabelOrderFields, proaxShippingLabelFields, TTL_MS
} = require('../lib/shipping-quotes');
const configured = require('../config/shipping');
const signingSecret = 'shipping-test-fixture-signature-key';
const fixtureTime = Date.UTC(2026, 9, 8, 12);
const items = [
  {sku:'MAT-PIEL', qty:1}, {sku:'RACK-VERDE', qty:1}, {sku:'RACK-BAG006', qty:1}
];
const products = [
  {id:1, sku:'MAT-PIEL', name:'Mat Polo Club', price:1000},
  {id:2, sku:'RACK-VERDE', name:'Rack Green', price:2000},
  {id:3, sku:'RACK-BAG006', name:'Rack Bag Vino', price:500},
  {id:4, sku:'RACK-NEGRO', name:'Rack Black', price:2000},
  {id:5, sku:'TILE-CASE', name:'Tile Case', price:500}
];
function memoryStore(overrides={}) {
  let saved, queue = Promise.resolve();
  return {
    saved:()=>saved,
    async withLock(_id, operation) {
      const before = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await before;
      try {
        return await operation({
          async read() { return saved; },
          async reserve(hash) { saved = {quote_hash:hash,status:'pending'}; },
          async uncertain(result) { saved = {...saved,result}; },
          async complete(result) {
            if(overrides.beforeComplete)await overrides.beforeComplete();
            saved = {...saved,status:'complete',result};
            if(overrides.afterComplete)await overrides.afterComplete();
          }
        });
      } finally { release(); }
    }
  };
}
function fixture(overrides = {}) {
  const requests = [];
  let currentTime = fixtureTime, stored;
  const config = {...configured, envia:{apiUrl:'https://carrier.test'},
    carriersByCountry:{MX:overrides.carriers || ['estafeta']}};
  const fetcher = async (url, request) => {
    if (url.includes('/catalog/products')) return {ok:true,json:async()=>({products})};
    requests.push({url,body:JSON.parse(request.body)});
    if (overrides.fetcher) return overrides.fetcher(url,request);
    if (url.endsWith('/ship/rate/')) return {ok:true,json:async()=>({meta:'rate',data:[{
      service:'ground',serviceDescription:'Ground delivery',deliveryEstimate:2,
      totalPrice:overrides.ratePrice ?? 429,currency:overrides.rateCurrency || 'MXN'
    }]})};
    return {ok:true,json:async()=>({meta:'generate',data:[{
      trackingNumber:'FIXTURE-TRACKING',label:'https://carrier.test/fixture.pdf',
      carrier:'estafeta',service:'ground',currency:'MXN',totalPrice:overrides.ratePrice ?? 429
    }]})};
  };
  const storage=overrides.store || memoryStore();
  const service = createShippingQuoteService({
    config, origins:{MX:configured.origin,US:configured.originUS},
    signingSecret,apiKey:'test-provider-placeholder',fetcher,
    now:()=>currentTime,store:storage,getStoredShippingQuote:async()=>stored,getPackingPlan:overrides.getPackingPlan
  });
  return {
    service,requests,storage,
    advance(ms) { currentTime += ms; },
    store(snapshot, paid = true) {
      stored = {snapshot,paid,destination:{name:'Fixture recipient',phone:'5550000000',
        street:'Fixture street',number:'1',district:'Fixture district',city:'Fixture city',
        state:'NL',postalCode:'85219',country:'MX'}};
    }
  };
}
const multiPackages=[
  {content:'First parcel',amount:1,type:'box',weight:1.2,weightUnit:'KG',lengthUnit:'CM',dimensions:{length:20,width:15,height:10}},
  {content:'Second parcel',amount:1,type:'box',weight:1.3,weightUnit:'KG',lengthUnit:'CM',dimensions:{length:25,width:16,height:12}}
];
function multiRows(){return [
  {trackingNumber:'TRACK-ONE',carrier:'estafeta',service:'ground',currency:'MXN',totalPrice:60,label:'https://carrier.test/one.pdf'},
  {trackingNumber:'TRACK-TWO',carrier:'estafeta',service:'ground',currency:'MXN',totalPrice:39,label:'https://carrier.test/two.pdf'}
];}
function multiFixture(rows=multiRows(),overrides={}) {
  return fixture({...overrides,getPackingPlan:async()=>({configured:true,revision:1,packages:overrides.packages || multiPackages,
    physicalItems:canonicalItems(items),packing:[{boxId:'first',boxName:'First parcel',ruleId:'first',items}]}),
    fetcher:async url=>({ok:true,json:async()=>url.endsWith('/ship/rate/')
      ? {meta:'rate',data:[{totalPrice:99,currency:'MXN',service:'ground',deliveryEstimate:2}]}
      : {meta:'generate',data:rows}})});
}
async function quoted(f) {
  const result = await f.service.quote({items,country:'MX',destination:'85219',currency:'MXN'});
  return verifyShippingQuote(result.quotes[0].quote_token,{items,currency:'MXN'}, {secret:signingSecret,now:fixtureTime});
}

test('canonical cart aggregates/reorders duplicates and preserves SKU identity', () => {
  assert.deepEqual(canonicalItems([{sku:' rack-verde ',quantity:1},{sku:'MAT-PIEL',qty:1},{sku:'RACK-VERDE',qty:2}]),
    [{sku:'MAT-PIEL',qty:1},{sku:'RACK-VERDE',qty:3}]);
  assert.throws(()=>canonicalItems([{sku:'MAT-PIEL',qty:0}]),/INVALID_SHIPPING_ITEMS/);
  assert.throws(()=>canonicalItems([{sku:'MAT-PIEL',qty:1.5}]),/INVALID_SHIPPING_ITEMS/);
});
test('configured specific weights take precedence over generic tile/rack names', () => {
  assert.equal(productWeight({name:'Rack Bag Vino'},configured),0.12);
  assert.equal(productWeight({name:'Velvet Tile Bag'},configured),0.25);
  assert.equal(productWeight({name:'Tile Case'},configured),0.31);
  assert.equal(productWeight({name:'Mat Polo Club'},configured),0.81);
  assert.throws(()=>productWeight({name:'Unknown product'},configured),/PRODUCT_WEIGHT_UNAVAILABLE/);
});
test('only the exact confirmed cart quotes the documented parcel and origin', async () => {
  const f=fixture();
  const result=await f.service.quote({items:items.map(i=>({...i,weight:0.01,dimensions:{length:1,width:1,height:1}})),
    country:'MX',destination:'85219',currency:'MXN',packageInfo:{weight:0.01}});
  const rate=result.quotes[0];
  assert.equal(rate.price,429);assert.equal(rate.days,'2');assert.equal(rate.carrier,'estafeta');assert.equal(rate.service,'ground');
  const snapshot=verifyShippingQuote(rate.quote_token,{items,currency:'MXN',postalCode:'85219',country:'MX'},{secret:signingSecret,now:fixtureTime});
  assert.equal(snapshot.origin.postalCode,'66188');
  assert.equal(snapshot.origin.street,'Espigas');
  assert.equal(snapshot.packages[0].weight,14.79);
  assert.deepEqual(snapshot.packages[0].dimensions,{length:83,width:33,height:27});
  assert.equal(snapshot.expires_at,fixtureTime+TTL_MS);
  assert.equal(rate.expires_at,snapshot.expires_at);
  assert.deepEqual(f.requests[0].body.packages,snapshot.packages);
});
test('packing preflight needs no customer address and never calls the carrier or creates a shipping price',async()=>{
 const f=fixture();
 const prepared=await f.service.preflight({items,country:'MX',currency:'MXN'});
 assert.deepEqual(prepared.items,canonicalItems(items));assert.equal(prepared.packages[0].weight,14.79);
 assert.deepEqual(prepared.packages[0].dimensions,{length:83,width:33,height:27});
 assert.equal(prepared.shipping_cost,undefined);assert.equal(prepared.price,undefined);assert.equal(f.requests.length,0);
 await assert.rejects(()=>f.service.preflight({items:[{sku:'MAT-PIEL',qty:1}],country:'MX',currency:'MXN'}),/PACKAGE_PROFILE_REQUIRED/);
 await assert.rejects(()=>f.service.preflight({items,country:'US',currency:'MXN'}),/US_REQUIRES_USD/);
 assert.equal(f.requests.length,0);
});
test('currency policy preserves USD delivery to Mexico and rejects US delivery priced in MXN', async () => {
  const f=fixture({ratePrice:60,rateCurrency:'USD'});
  const result=await f.service.quote({items,destination:'00123',country:'MX',currency:'USD'});
  const snapshot=verifyShippingQuote(result.quotes[0].quote_token,{items,currency:'USD',postalCode:'00123'},{secret:signingSecret,now:fixtureTime});
  assert.equal(snapshot.price,60);assert.equal(snapshot.destination.postalCode,'00123');
  const invalid=fixture();
  await assert.rejects(invalid.service.quote({items,destination:'78852',country:'US',currency:'MXN'}),/US_REQUIRES_USD/);
  assert.equal(invalid.requests.length,0);
});
test('other colors, quantities, incomplete carts and forged names cannot obtain the profile', async () => {
  for (const cart of [
    items.slice(0,2),items.map((i,index)=>({...i,qty:index===0?2:1})),
    items.map(i=>i.sku==='RACK-VERDE'?{sku:'RACK-NEGRO',qty:1}:i)
  ]) {
    const f=fixture();
    await assert.rejects(f.service.quote({items:cart,destination:'85219',country:'MX',currency:'MXN'}),/PACKAGE_PROFILE_REQUIRED/);
    assert.equal(f.requests.length,0);
  }
  const f=fixture();
  await assert.rejects(f.service.quote({items:[{sku:'UNKNOWN',name:'Mat Polo Club',qty:1}],destination:'85219',country:'MX',currency:'MXN'}),/SHIPPING_PRODUCT_UNAVAILABLE/);
  assert.equal(f.requests.length,0);
});
test('rates require provider total, matching currency and genuine service, never a base amount', () => {
  const valid={totalPrice:'429.00',currency:'MXN',service:'ground',deliveryEstimate:2};
  assert.equal(normalizeRate(valid,'estafeta','MXN').price,429);
  for (const invalid of [
    {...valid,totalPrice:undefined,price:250},
    {...valid,totalPrice:'429oops'},
    {...valid,totalPrice:-1},
    {...valid,currency:'USD'},
    {...valid,carrier:'dhl'},
    {...valid,service:undefined},
    {...valid,deliveryEstimate:{min:2}}
  ]) assert.equal(normalizeRate(invalid,'estafeta','MXN'),null);
});
test('USPS Media is excluded by every service alias and provider label, without excluding other carriers or ground services',()=>{
 const rate={totalPrice:30.15,currency:'USD',service:'ground_advantage',deliveryEstimate:5};
 for(const field of ['service','serviceCode','carrier_service_code'])for(const code of ['media','media_mail','media-mail','MediaMail']){
  assert.equal(normalizeRate({...rate,[field]:code},'usps','USD'),null);
 }
 for(const field of ['serviceDescription','serviceName'])assert.equal(normalizeRate({...rate,[field]:'Media (Books, Video, Playscripts)'},'USPS','USD'),null);
 assert.equal(normalizeRate({...rate,service:'ground_advantage',serviceDescription:'USPS Ground Advantage'},'usps','USD').price,30.15);
 assert.equal(normalizeRate({...rate,service:'ground_economy',serviceDescription:'Ground Economy'},'fedex','USD').price,30.15);
 assert.equal(normalizeRate({...rate,service:'media_mail'},'other-carrier','USD').service,'media_mail');
 assert.equal(normalizeRate({...rate,serviceName:'Multimedia Ground'},'usps','USD').service,'ground_advantage');
});
function mediaFixture(overrides={}) {
 const requests=[],storage=overrides.store || memoryStore();let stored;
 const service=createShippingQuoteService({config:{...configured,envia:{apiUrl:'https://carrier.test'},carriersByCountry:{US:['usps','fedex']}},
  origins:{US:configured.originUS},signingSecret,apiKey:'test-provider-placeholder',now:()=>fixtureTime,store:storage,
  getStoredShippingQuote:async()=>stored,
  getPackingPlan:async()=>({configured:true,revision:1,packages:[{content:'Fixture parcel',amount:1,type:'box',weight:2,weightUnit:'KG',lengthUnit:'CM',dimensions:{length:50,width:20,height:10}}]}),
  fetcher:async(url,request)=>{
   if(url.includes('/catalog/products'))return {ok:true,json:async()=>({products})};
   requests.push({url,body:JSON.parse(request.body)});
   assert(url.endsWith('/ship/rate/'),'No provider purchase is permitted by this fixture');
   const carrier=JSON.parse(request.body).shipment.carrier;
   const rates=carrier==='usps'?[{service:'media_mail',serviceDescription:'Media (Books, Video, Playscripts)',totalPrice:30.15},
     {service:'ground_advantage',serviceDescription:'USPS Ground Advantage',totalPrice:158.42}]
     :[{service:'ground_economy',serviceDescription:'FedEx Ground Economy',totalPrice:58.92}];
   return {ok:true,json:async()=>({meta:'rate',data:rates.map(rate=>({...rate,currency:'USD',deliveryEstimate:5}))})};
  }});
 return {service,requests,storage,store(snapshot){stored={snapshot,paid:true,destination:{name:'Fixture recipient',phone:'5550000000',street:'Fixture street',city:'Fixture city',state:'NY',...snapshot.destination}};}};
}
async function mediaSnapshot(f) {
 const result=await f.service.quote({items:[{sku:'MAT-PIEL',qty:1}],destination:'10001',country:'US',currency:'USD'});
 return {result,snapshot:verifyShippingQuote(result.quotes[0].quote_token,{}, {secret:signingSecret,now:fixtureTime})};
}
test('US quotes choose the next eligible rate at its original provider price and keep the US origin and USD',async()=>{
 const f=mediaFixture(),{result,snapshot}=await mediaSnapshot(f);
 assert.deepEqual(result.quotes.map(rate=>[rate.carrier,rate.service,rate.price]),[['fedex','ground_economy',58.92],['usps','ground_advantage',158.42]]);
 assert.equal(result.cheapest_rate,58.92);assert.equal(result.shipping_cost,58.92);assert.equal(result.currency,'USD');
 assert.equal(snapshot.price,58.92);assert.equal(snapshot.origin.country,'US');assert.equal(snapshot.origin.postalCode,configured.originUS.postalCode);assert.equal(snapshot.destination.postalCode,'10001');
 for(const request of f.requests){assert.equal(request.body.origin.country,'US');assert.equal(request.body.destination.country,'US');assert.equal(request.body.settings.currency,'USD');}
});
test('a paid historical Media snapshot is blocked before rate, reservation or provider purchase without changing its price',async()=>{
 for(const metadata of [{service:'media_mail'},{service:'legacy_code',service_name:'Media (Books, Video, Playscripts)'}]){
  const f=mediaFixture(),{snapshot}=await mediaSnapshot(f),old={...snapshot,carrier:'usps',price:30.15,...metadata};f.store(old);f.requests.length=0;
  await assert.rejects(()=>f.service.generate({orderId:'FIXTURE-MEDIA'}),error=>error.code==='SHIPPING_SERVICE_INELIGIBLE' && error.status===409);
  assert.equal(f.requests.length,0);assert.equal(f.storage.saved(),undefined);assert.equal(old.price,30.15);assert.equal(old.service,metadata.service);
 }
});
test('a completed Media guide still replays its original receipt with no new rate, reservation or purchase',async()=>{
 let existing;const storage={withLock:async(_id,run)=>run({read:async()=>existing,reserve:async()=>{throw Error('A completed guide must not reserve again');}})};
 const f=mediaFixture({store:storage}),{snapshot}=await mediaSnapshot(f),old={...snapshot,carrier:'usps',service:'media_mail',service_name:'Media (Books, Video, Playscripts)',price:30.15};f.store(old);
 const result={ok:true,orderId:'FIXTURE-MEDIA',trackingNumber:'OLD-MEDIA-TRACKING',trackingNumbers:['OLD-MEDIA-TRACKING'],carrier:'usps',service:'media_mail',currency:'USD',label_cost:30.15,labelUrl:'https://carrier.test/old-media.pdf'};
 existing={quote_hash:require('node:crypto').createHash('sha256').update(JSON.stringify(old)).digest('hex'),status:'complete',result};f.requests.length=0;
 assert.deepEqual(await f.service.generate({orderId:'FIXTURE-MEDIA'}),result);assert.equal(f.requests.length,0);
});
test('only door-to-door rates are offered and their provider labels are signed with the quote', async () => {
  const providerRate={carrier:'paquetexpress',carrierDescription:'Paquetexpress',serviceDescription:'Paquetexpress Standard',
    currency:'MXN',deliveryEstimate:'2-4 días'};
  const providerRates=[
    {...providerRate,service:'ground',totalPrice:179,dropOff:0,dropOffDescription:'Puerta a puerta'},
    {...providerRate,service:'ground_do',totalPrice:169,dropOff:2,dropOffDescription:'Sucursal a puerta'},
    {...providerRate,service:'ground_od',totalPrice:170,dropOff:1,dropOffDescription:'Puerta a sucursal'}
  ];
  const f=fixture({carriers:['paquetexpress'],fetcher:async(url)=>{
    assert.ok(url.endsWith('/ship/rate/'));
    return {ok:true,json:async()=>({meta:'rate',data:providerRates})};
  }});
  const result=await f.service.quote({items,destination:'85219',country:'MX',currency:'MXN'});
  assert.deepEqual(result.quotes.map(rate=>rate.service),['ground']);
  assert.equal(result.cheapest_rate,179); // Neither cheaper branch mode can be offered.
  for(const rate of result.quotes) {
    const expected=providerRates.find(provider=>provider.service===rate.service);
    assert.equal(rate.carrier_name,'Paquetexpress');assert.equal(rate.service_name,'Paquetexpress Standard');
    assert.equal(rate.delivery_description,expected.dropOffDescription);assert.equal(rate.drop_off,expected.dropOff);
    const snapshot=verifyShippingQuote(rate.quote_token,{items,currency:'MXN',postalCode:'85219',country:'MX'},
      {secret:signingSecret,now:fixtureTime});
    for(const field of ['carrier_name','service_name','delivery_description','drop_off']) assert.equal(snapshot[field],rate[field]);
  }
  const selected=result.quotes[0];
  const [version,payload,signature]=selected.quote_token.split('.');
  const changed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  changed.delivery_description='Puerta a sucursal';
  const forged=[version,Buffer.from(JSON.stringify(changed)).toString('base64url'),signature].join('.');
  assert.throws(()=>verifyShippingQuote(forged,{}, {secret:signingSecret,now:fixtureTime}),/SHIPPING_QUOTE_INVALID/);
  for(const service of ['ground','ground_do','ground_od']) {
    for(const dropOff of [1,2]) assert.equal(normalizeRate({...providerRate,service,totalPrice:429,dropOff},'paquetexpress','MXN'),null);
    assert.equal(normalizeRate({...providerRate,service,totalPrice:429,dropOff:0},'paquetexpress','MXN').service,service);
    assert.equal(normalizeRate({...providerRate,service,totalPrice:429},'paquetexpress','MXN').service,service);
  }
});
test('signature, expiry and all checkout bindings are enforced with shared error codes', async () => {
  const f=fixture(),result=await f.service.quote({items,destination:'85219',country:'MX',currency:'MXN'});
  const token=result.quotes[0].quote_token,options={secret:signingSecret,now:fixtureTime};
  assert.throws(()=>verifyShippingQuote(undefined,{},options),/SHIPPING_QUOTE_REQUIRED/);
  assert.throws(()=>verifyShippingQuote(token.slice(0,-1)+(token.endsWith('A')?'B':'A'),{},options),/SHIPPING_QUOTE_INVALID/);
  assert.throws(()=>verifyShippingQuote(token,{items:items.slice(1)},options),/SHIPPING_CART_MISMATCH/);
  assert.throws(()=>verifyShippingQuote(token,{currency:'USD'},options),/SHIPPING_CURRENCY_MISMATCH/);
  assert.throws(()=>verifyShippingQuote(token,{postalCode:'85218'},options),/SHIPPING_DESTINATION_MISMATCH/);
  assert.throws(()=>verifyShippingQuote(token,{country:'US'},options),/SHIPPING_DESTINATION_MISMATCH/);
  assert.throws(()=>verifyShippingQuote(token,{}, {...options,now:fixtureTime+TTL_MS}),/SHIPPING_QUOTE_EXPIRED/);
  assert.equal(verifyShippingQuoteSignature(token,{}, {...options,now:fixtureTime+TTL_MS}).price,429);
  assert.equal(verifyShippingQuote(token,{}, {...options,now:fixtureTime+TTL_MS,allowExpired:true}).price,429);
});
test('generate reuses the paid stored parcel after TTL and is durable-idempotent', async () => {
  const f=fixture(),snapshot=await quoted(f);f.store(snapshot);f.advance(TTL_MS+1);
  const [first,second]=await Promise.all([
    f.service.generate({orderId:'FIXTURE-ORDER'}),f.service.generate({orderId:'FIXTURE-ORDER'})
  ]);
  assert.deepEqual(second,first);
  const generated=f.requests.filter(r=>r.url.endsWith('/ship/generate/'));
  assert.equal(generated.length,1);
  assert.deepEqual(generated[0].body.origin,snapshot.origin);
  assert.deepEqual(generated[0].body.packages,snapshot.packages);
  assert.deepEqual(generated[0].body.shipment,{type:1,carrier:'estafeta',service:'ground'});
});
test('all parcel rows, labels and the total 60+39 billing survive concurrent generation and durable replay',async()=>{
  const f=multiFixture(),snapshot=await quoted(f);f.store(snapshot);
  const [first,concurrent]=await Promise.all([f.service.generate({orderId:'FIXTURE-ORDER'}),f.service.generate({orderId:'FIXTURE-ORDER'})]);
  assert.deepEqual(first,concurrent);assert.deepEqual(first.trackingNumbers,['TRACK-ONE','TRACK-TWO']);
  assert.deepEqual(first.labelUrls,['https://carrier.test/one.pdf','https://carrier.test/two.pdf']);
  assert.equal(first.trackingNumber,'TRACK-ONE');assert.equal(first.labelUrl,first.labelUrls[0]);assert.equal(first.label_cost,99);
  assert.deepEqual(first.shipments.map(row=>row.label_cost),[60,39]);assert.equal(first.shipments.length,2);
  assert.deepEqual(f.storage.saved().result,first);assert.equal(f.storage.saved().status,'complete');
  assert.deepEqual(await f.service.generate({orderId:'FIXTURE-ORDER'}),first);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/rate/')).length,2);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
  for(const request of f.requests)assert.deepEqual(request.body.packages,multiPackages);
});
test('one grouped provider row bills once and preserves a combined label and all package tracking numbers',async()=>{
  const grouped={...multiRows()[0],trackingNumbers:['TRACK-ONE','TRACK-TWO'],totalPrice:99,label:'https://carrier.test/group.pdf'};
  const f=multiFixture([grouped],{packages:[{...multiPackages[0],amount:2}]}),snapshot=await quoted(f);f.store(snapshot);
  const result=await f.service.generate({orderId:'FIXTURE-ORDER'});
  assert.equal(result.label_cost,99);assert.equal(result.shipments.length,1);assert.equal(result.shipments[0].label_cost,99);
  assert.deepEqual(result.trackingNumbers,['TRACK-ONE','TRACK-TWO']);assert.deepEqual(result.labelUrls,['https://carrier.test/group.pdf']);
  assert.deepEqual(await f.service.generate({orderId:'FIXTURE-ORDER'}),result);assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('order cache and Proax update fields retain every label group without mutating its durable result',async()=>{
  const f=multiFixture();f.store(await quoted(f));const result=await f.service.generate({orderId:'FIXTURE-ORDER'});
  const cache=shippingLabelOrderFields(result),update=proaxShippingLabelFields(result);
  assert.deepEqual(cache.trackingNumbers,['TRACK-ONE','TRACK-TWO']);assert.deepEqual(cache.labelUrls,result.labelUrls);
  assert.deepEqual(update.tracking_numbers,cache.trackingNumbers);assert.deepEqual(update.label_urls,cache.labelUrls);
  assert.equal(update.label_cost,99);assert.equal(update.label_currency,'MXN');assert.equal(update.shipments.length,2);
  assert.equal(cache.trackingNumber,'TRACK-ONE');assert.equal(update.tracking_number,cache.trackingNumber);assert.equal(update.label_url,cache.labelUrl);
  cache.trackingNumbers.pop();cache.labelUrls.pop();cache.shipments[0].trackingNumbers.pop();
  assert.equal(result.trackingNumbers.length,2);assert.equal(result.labelUrls.length,2);assert.equal(result.shipments[0].trackingNumbers.length,1);
  const legacy=shippingLabelOrderFields({trackingNumber:'OLD',labelUrl:'https://carrier.test/old.pdf',label_cost:99,currency:'MXN'});
  assert.deepEqual(legacy.trackingNumbers,['OLD']);assert.deepEqual(legacy.labelUrls,['https://carrier.test/old.pdf']);
});
test('manual shipment creation forwards the full durable group and safely retries failed Proax synchronization without reissuing',async()=>{
  const f=multiFixture();f.store(await quoted(f));const server=fs.readFileSync('server.js','utf8');
  const helper=server.match(/async function updateProaxOrder\(orderId, updates\) \{[\s\S]*?^\}/m)?.[0];
  const route=server.match(/app\.post\('\/api\/shipping\/create',[\s\S]*?^\}\);/m)?.[0];assert(helper && route);
  const sent=[],orders=new Map([['FIXTURE-ORDER',{status:'paid'}]]);let handler;
  const replies=[{ok:false,status:503},{ok:true,status:200},new Error('temporary network failure'),{ok:true,status:200}];
  const context={shippingQuotes:f.service,pendingOrders:orders,
    PROAX_API_URL:'https://proax.fixture.test',PROAX_NODE_ID:'31',PROAX_API_KEY:'test-only-placeholder',
    console:{log(){},warn(){}},app:{post:(_path,fn)=>{handler=fn;}},
    require:path=>{assert.equal(path,'./lib/shipping-quotes');return {shippingLabelOrderFields,proaxShippingLabelFields};},
    fetch:async(url,request)=>{sent.push({url,body:JSON.parse(request.body)});const reply=replies.shift();if(reply instanceof Error)throw reply;return reply;}};
  vm.createContext(context);vm.runInContext(helper+'\n'+route,context);
  function response(){return {statusCode:200,set(){return this;},status(code){this.statusCode=code;return this;},json(value){this.value=value;return this;}};}
  for(const pending of [true,false,true,false]) {
    const res=response();await handler({body:{orderId:'FIXTURE-ORDER'}},res);assert.equal(res.statusCode,200);
    assert.equal(res.value.proax_sync_pending,pending?true:undefined);assert.equal(res.value.label_cost,99);
    assert.deepEqual(res.value.trackingNumbers,['TRACK-ONE','TRACK-TWO']);
  }
  assert.equal(sent.length,4);for(const request of sent) {
    assert.equal(request.url,'https://proax.fixture.test/api/inventory/31/web-orders/FIXTURE-ORDER');
    assert.deepEqual(request.body.tracking_numbers,['TRACK-ONE','TRACK-TWO']);assert.equal(request.body.label_urls.length,2);
    assert.equal(request.body.shipments.length,2);assert.equal(request.body.label_cost,99);assert.equal(request.body.label_currency,'MXN');
    assert.equal(request.body.tracking_number,'TRACK-ONE');assert.equal(request.body.label_url,'https://carrier.test/one.pdf');
  }
  assert.equal(orders.get('FIXTURE-ORDER').trackingNumbers.length,2);assert.equal(orders.get('FIXTURE-ORDER').labelUrls.length,2);
  assert.equal(orders.get('FIXTURE-ORDER').shipments.length,2);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('mixed decimal row prices sum in cents and a zero-price additional parcel never duplicates group billing',async()=>{
  for(const prices of [['60.01','38.99'],[0,99]]) {
    const rows=multiRows().map((row,index)=>({...row,totalPrice:prices[index]})),f=multiFixture(rows);f.store(await quoted(f));
    assert.equal((await f.service.generate({orderId:'FIXTURE-ORDER'})).label_cost,99);
  }
});
test('a group whose individual prices fit but whose summed billing exceeds the paid quote stays pending with every label',async()=>{
  const rows=multiRows();rows[1].totalPrice=40;const f=multiFixture(rows);f.store(await quoted(f));
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  const saved=f.storage.saved();assert.equal(saved.status,'pending');assert.equal(saved.result.requiresReview,true);
  assert.deepEqual(saved.result.trackingNumbers,['TRACK-ONE','TRACK-TWO']);assert.equal(saved.result.labelUrls.length,2);
  assert.deepEqual(saved.result.shipments.map(row=>row.totalPrice),[60,40]);
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('partial, duplicate and mismatched additional parcel rows are preserved for review and never regenerated',async()=>{
  const base=multiRows();
  for(const rows of [[base[0]],[base[0],{...base[1],trackingNumber:'TRACK-ONE'}],
    [base[0],{...base[1],currency:'USD'}],[base[0],{...base[1],carrier:'dhl'}],
    [base[0],{...base[1],service:'express'}],[base[0],{...base[1],totalPrice:null}],
    [base[0],{...base[1],total_price:40}],[base[0],{...base[1],trackingNumbers:[null]}]]) {
    const f=multiFixture(rows);f.store(await quoted(f));
    await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
    assert.equal(f.storage.saved().status,'pending');assert.equal(f.storage.saved().result.shipments.length,rows.length);
    assert.equal(f.storage.saved().result.labelUrls.length,rows.length);
    if(rows.length===2 && rows[1].trackingNumber==='TRACK-TWO')assert(f.storage.saved().result.trackingNumbers.includes('TRACK-TWO'));
    await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
    assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
  }
});
test('every emitted row needs its own HTTP(S) PDF, while incomplete or unsafe label groups stay pending without reissue',async()=>{
  for(const missing of [undefined,null,'','javascript:alert(1)','file:///tmp/label.pdf','https://user:password@carrier.test/label.pdf']) {
    const rows=multiRows();rows[1].label=missing;const f=multiFixture(rows);f.store(await quoted(f));
    await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
    assert.equal(f.storage.saved().status,'pending');assert.deepEqual(f.storage.saved().result.trackingNumbers,['TRACK-ONE','TRACK-TWO']);
    assert.equal(f.storage.saved().result.shipments.length,2);assert.equal(f.storage.saved().result.labelUrls.length,1);
    await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
    assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
  }
});
test('a grouped response whose explicit primary tracking is outside its tracking array remains pending',async()=>{
  const f=multiFixture([{...multiRows()[0],trackingNumber:'OTHER',trackingNumbers:['TRACK-ONE','TRACK-TWO'],totalPrice:99}]);f.store(await quoted(f));
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert.deepEqual(f.storage.saved().result.trackingNumbers,['OTHER','TRACK-ONE','TRACK-TWO']);
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('cached completion cannot replay missing per-row PDFs, but a legacy combined PDF remains compatible',async()=>{
  const f=multiFixture(),snapshot=await quoted(f);f.store(snapshot);const emitted=await f.service.generate({orderId:'FIXTURE-ORDER'});
  const saved=f.storage.saved(),original=JSON.parse(JSON.stringify(emitted));
  saved.result={...original,shipments:original.shipments.map((row,index)=>index?{...row,labelUrl:null,labelUrls:[]}:row),labelUrls:[original.labelUrls[0]]};
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  saved.result={...original,labelUrl:'javascript:alert(1)'};
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  saved.result={...original,trackingNumber:'OTHER'};
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  saved.result={...original,shipments:original.shipments.map((row,index)=>index?{...row,labelUrl:'https://carrier.test/unmatched.pdf'}:row)};
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  saved.result={...original,labelUrl:'https://carrier.test/combined.pdf',labelUrls:['https://carrier.test/combined.pdf']};delete saved.result.shipments;
  delete saved.result.labelUrls; // Historical records stored only the scalar PDF.
  const legacy=await f.service.generate({orderId:'FIXTURE-ORDER'});
  assert.equal(legacy.labelUrl,'https://carrier.test/combined.pdf');
  const update=proaxShippingLabelFields(legacy),cache=shippingLabelOrderFields(legacy);
  assert.equal(update.shipments.length,1);assert.deepEqual(update.shipments[0].trackingNumbers,['TRACK-ONE','TRACK-TWO']);
  assert.deepEqual(update.label_urls,['https://carrier.test/combined.pdf']);assert.deepEqual(update.shipments[0].labelUrls,update.label_urls);
  assert.equal(update.shipments[0].totalPrice,99);assert.equal(update.shipments[0].label_cost,99);assert.equal(update.label_cost,99);
  assert.equal(update.shipments[0].carrier,'estafeta');assert.equal(update.shipments[0].service,'ground');assert.equal(update.shipments[0].currency,'MXN');
  assert.equal(cache.shipments.length,1);assert.equal(legacy.shipments,undefined);
  assert.deepEqual(proaxShippingLabelFields(await f.service.generate({orderId:'FIXTURE-ORDER'})),update);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('failed persistence keeps the emitted group pending, while a lost successful write is recovered without reissue',async()=>{
  const failed=multiFixture(multiRows(),{store:memoryStore({beforeComplete:()=>{throw Error('write unavailable');}})});failed.store(await quoted(failed));
  await assert.rejects(failed.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert.equal(failed.storage.saved().status,'pending');assert.equal(failed.storage.saved().result.label_cost,99);
  assert.equal(failed.storage.saved().result.shipments.length,2);
  await assert.rejects(failed.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert.equal(failed.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
  const lost=multiFixture(multiRows(),{store:memoryStore({afterComplete:()=>{throw Error('write reply lost');}})});lost.store(await quoted(lost));
  const result=await lost.service.generate({orderId:'FIXTURE-ORDER'});assert.equal(result.label_cost,99);
  assert.deepEqual(await lost.service.generate({orderId:'FIXTURE-ORDER'}),result);
  assert.equal(lost.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('a historical completed record missing a parcel is never accepted as the complete group or regenerated',async()=>{
  let existing;const storage={withLock:async(_id,run)=>run({read:async()=>existing,reserve:async()=>{throw Error('Must never reserve a second label group');}})};
  const f=multiFixture(multiRows(),{store:storage}),snapshot=await quoted(f);f.store(snapshot);
  existing={quote_hash:require('node:crypto').createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),status:'complete',
    result:{ok:true,orderId:'FIXTURE-ORDER',trackingNumber:'TRACK-ONE',trackingNumbers:['TRACK-ONE'],carrier:'estafeta',service:'ground',currency:'MXN',label_cost:60,labelUrl:'https://carrier.test/one.pdf'}};
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,0);
});
test('an ambiguous database completion cannot be overwritten by review evidence and recovers the committed group',async()=>{
  let row,loseComplete=true,loseRead=false,uncertainWrite=false;
  const client={async query(text,values=[]) {
    if(text.startsWith('SELECT quote_hash')) {
      if(loseRead){loseRead=false;throw Error('database read temporarily unavailable');}
      return {rows:row?[row]:[]};
    }
    if(text.startsWith('INSERT INTO mahjoy_shipping_labels'))row={quote_hash:values[1],status:'pending'};
    if(text.includes("SET status='complete'")) {
      row={...row,status:'complete',result:JSON.parse(values[1])};
      if(loseComplete){loseComplete=false;loseRead=true;throw Error('committed write reply lost');}
    }
    if(text.startsWith('UPDATE mahjoy_shipping_labels SET result=')) {
      uncertainWrite=true;assert.match(text,/AND status='pending'/);
      if(row.status==='pending')row={...row,result:JSON.parse(values[1])};
    }
    return {rows:[]};
  },release(){}};
  const f=multiFixture(multiRows(),{store:shipmentStore({connect:async()=>client})});f.store(await quoted(f));
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert(uncertainWrite);assert.equal(row.status,'complete');assert.equal(row.result.requiresReview,undefined);
  const recovered=await f.service.generate({orderId:'FIXTURE-ORDER'});
  assert.equal(recovered.label_cost,99);assert.deepEqual(recovered.trackingNumbers,['TRACK-ONE','TRACK-TWO']);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('generate rejects unpaid order, changed address/carrier/package and increased tariff before emission', async () => {
  const f=fixture(),snapshot=await quoted(f);f.store(snapshot,false);
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_PAYMENT_REQUIRED/);
  f.store(snapshot);
  for(const body of [
    {destination:{postalCode:'00000',country:'MX'}},{carrier:'dhl'},
    {service:'other'},{packageInfo:{weight:1}}
  ]) await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER',...body}),/SHIPPING_(DESTINATION_CHANGED|QUOTE_CHANGED)/);
  const expensive=fixture({ratePrice:430});expensive.store(snapshot);
  await assert.rejects(expensive.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_RATE_CHANGED/);
  assert.equal(expensive.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,0);
});
test('an uncertain provider emission cannot be automatically repeated', async () => {
  const f=fixture({fetcher:async(url)=>{
    if(url.endsWith('/ship/rate/'))return {ok:true,json:async()=>({meta:'rate',data:[{totalPrice:429,currency:'MXN',service:'ground',deliveryEstimate:'2-5'}]})};
    throw new Error('Simulated lost provider response');
  }});
  const snapshot=await quoted(f);f.store(snapshot);
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('stored quote lookup uses paid authoritative rows and does not hide database errors', async () => {
  const f=fixture(),snapshot=await quoted(f);
  const row={shipping_quote:snapshot,status:'paid',shipping_street:'Fixture street',
    shipping_interior:'Apartment 4',shipping_city:'Fixture city',shipping_state:'NL',shipping_cp:'85219',
    shipping_address:{country:'MX'},customer_name:'Fixture recipient'};
  const payment={...row,paid_at:'2026-10-08',transaction_id:'FIXTURE-PAYMENT',items,shipping_cost:429,currency:'MXN'};
  const directResults=[{rows:[{order_data:{...row,status:'checkout_started'}}]},{rows:[{order_data:payment}]}];
  const direct=await getStoredShippingQuote({query:async()=>directResults.shift()},'FIXTURE-ORDER');
  assert.equal(direct.paid,true);assert.equal(direct.destination.postalCode,'85219');
  assert.equal(direct.destination.number,'S/N');assert.equal(direct.destination.street,'Fixture street, Apartment 4');
  const responses=[{rows:[]},{rows:[{ready:true}]},{rows:[{shipping_quote:snapshot,capture_id:'FIXTURE-CAPTURE',order_data:{...row,paid_at:'2026-10-08'}}]}];
  const fallback=await getStoredShippingQuote({query:async()=>responses.shift()},'FIXTURE-ORDER');
  assert.equal(fallback.paid,true);
  assert.equal(fallback.destination.country,'MX');
  const noCapture=[{rows:[]},{rows:[{ready:true}]},{rows:[{shipping_quote:snapshot,order_data:row}]}];
  assert.equal((await getStoredShippingQuote({query:async()=>noCapture.shift()},'FIXTURE-ORDER')).paid,false);
  await assert.rejects(getStoredShippingQuote({query:async()=>{throw new Error('Fixture DB unavailable')}},'FIXTURE-ORDER'),/Fixture DB unavailable/);
});
test('paid card lookup rejects changed receipt cart, amount and country', async () => {
  const f=fixture(),snapshot=await quoted(f);
  const local={shipping_quote:snapshot,status:'checkout_started',shipping_street:'Fixture street',
    shipping_city:'Fixture city',shipping_state:'NL',shipping_cp:'85219',customer_name:'Fixture recipient'};
  const payment={...local,status:'paid',paid_at:'2026-10-08',transaction_id:'FIXTURE-CARD',
    payment_method:'centumpay',shipping_cost:429,items};
  for(const changed of [{shipping_cost:250},{items:items.slice(1)},{shipping_address:{country:'US'}},{shipping_cp:'85218'}]) {
    const responses=[{rows:[{order_data:local}]},{rows:[{order_data:{...payment,...changed}}]}];
    await assert.rejects(getStoredShippingQuote({query:async()=>responses.shift()},'FIXTURE-ORDER'),/STORED_SHIPPING_PAYMENT_MISMATCH/);
  }
});
test('generate validates actual stored country even when its postal code is unchanged', async () => {
  const f=fixture(),snapshot=await quoted(f);
  const responses=[{rows:[]},{rows:[{ready:true}]},{rows:[{shipping_quote:snapshot,capture_id:'FIXTURE-CAPTURE',order_data:{
    paid_at:'2026-10-08',status:'paid',shipping_cp:'85219',shipping_address:{country:'US'},
    customer_name:'Fixture recipient',customer_phone:'5550000000',shipping_street:'Fixture street',
    shipping_city:'Fixture city',shipping_state:'NL'
  }}]}];
  const stored=await getStoredShippingQuote({query:async()=>responses.shift()},'FIXTURE-ORDER');
  assert.equal(stored.destination.country,'US');
  const service=createShippingQuoteService({config:{...configured,envia:{apiUrl:'https://carrier.test'}},
    signingSecret,apiKey:'test-provider-placeholder',store:memoryStore(),getStoredShippingQuote:async()=>stored,
    fetcher:async()=>{throw new Error('Provider must not be called');}});
  await assert.rejects(service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_DESTINATION_CHANGED/);
});
test('provider label billing or service mismatch remains pending and is never reissued', async () => {
  const f=fixture({fetcher:async(url)=>{
    if(url.endsWith('/ship/rate/'))return {ok:true,json:async()=>({meta:'rate',data:[{totalPrice:429,currency:'MXN',service:'ground',deliveryEstimate:2}]})};
    return {ok:true,json:async()=>({meta:'generate',data:[{trackingNumber:'FIXTURE-UNCERTAIN',
      carrier:'dhl',service:'express',currency:'USD',totalPrice:999}]})};
  }});
  f.store(await quoted(f));
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  await assert.rejects(f.service.generate({orderId:'FIXTURE-ORDER'}),/SHIPPING_LABEL_STATUS_PENDING/);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/ship/generate/')).length,1);
});
test('Postgres fulfillment lookup uses the locked client, never a second pool connection', async () => {
  const f=fixture(),snapshot=await quoted(f);
  const client={
    async query(text) {
      if(text.startsWith('SELECT quote_hash'))return {rows:[]};
      return {rows:[]};
    },
    release() { this.released=true; }
  };
  const pool={connect:async()=>client,query:async()=>{throw new Error('Second pool connection would deadlock');}};
  let lookupClient;
  const service=createShippingQuoteService({config:{...configured,envia:{apiUrl:'https://carrier.test'}},
    apiKey:'test-provider-placeholder',signingSecret,store:shipmentStore(pool),
    getStoredShippingQuote:async(_id,connection)=>{lookupClient=connection;return {snapshot,paid:true,destination:{
      name:'Fixture recipient',phone:'5550000000',street:'Fixture street',city:'Fixture city',state:'NL',country:'MX',postalCode:'85219'
    }};},
    fetcher:async(url)=>({ok:true,json:async()=>url.endsWith('/ship/rate/')
      ? {meta:'rate',data:[{totalPrice:429,currency:'MXN',service:'ground',deliveryEstimate:2}]}
      : {meta:'generate',data:[{totalPrice:429,currency:'MXN',service:'ground',carrier:'estafeta',trackingNumber:'FIXTURE-LOCKED',label:'https://carrier.test/locked.pdf'}]}})
  });
  await service.generate({orderId:'FIXTURE-ORDER'});
  assert.equal(lookupClient,client);assert.equal(client.released,true);
});
test('shipping quote HTTP route exposes signed rate/expiry and returns package errors without leaking internals', async () => {
  const f=fixture(),source=fs.readFileSync('server.js','utf8');
  const start=source.indexOf("app.post('/api/shipping/quote'");
  const end=source.indexOf('\n});',start)+5;
  let handler;
  vm.runInNewContext(source.slice(start,end),{shippingQuotes:f.service,app:{post(_url,fn){handler=fn;}}});
  const response=()=>({statusCode:200,headers:{},set(name,value){this.headers[name]=value;return this;},
    status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}});
  const valid=response();
  await handler({body:{items,destination:'85219',country:'MX',currency:'MXN'}},valid);
  assert.equal(valid.statusCode,200);assert.equal(valid.headers['Cache-Control'],'no-store');
  assert.equal(valid.body.quotes[0].expires_at,fixtureTime+TTL_MS);
  assert.equal(typeof valid.body.quotes[0].quote_token,'string');
  const incomplete=response();
  await handler({body:{items:items.slice(1),destination:'85219',country:'MX',currency:'MXN'}},incomplete);
  assert.equal(incomplete.statusCode,409);assert.equal(incomplete.body.error_code,'PACKAGE_PROFILE_REQUIRED');
  assert.equal(incomplete.body.quotes.length,0);
});
