const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  canonicalItems, productWeight, normalizeRate, createShippingQuoteService,
  verifyShippingQuote, verifyShippingQuoteSignature, getStoredShippingQuote, shipmentStore, TTL_MS
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
function memoryStore() {
  let saved, queue = Promise.resolve();
  return {
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
          async complete(result) { saved = {...saved,status:'complete',result}; }
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
  const service = createShippingQuoteService({
    config, origins:{MX:configured.origin,US:configured.originUS},
    signingSecret,apiKey:'test-provider-placeholder',fetcher,
    now:()=>currentTime,store:memoryStore(),getStoredShippingQuote:async()=>stored
  });
  return {
    service,requests,
    advance(ms) { currentTime += ms; },
    store(snapshot, paid = true) {
      stored = {snapshot,paid,destination:{name:'Fixture recipient',phone:'5550000000',
        street:'Fixture street',number:'1',district:'Fixture district',city:'Fixture city',
        state:'NL',postalCode:'85219',country:'MX'}};
    }
  };
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
  assert.equal(productWeight({name:'Velvet Tile Bag'},configured),0.13);
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
      : {meta:'generate',data:[{totalPrice:429,currency:'MXN',service:'ground',carrier:'estafeta',trackingNumber:'FIXTURE-LOCKED'}]}})
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
