const test=require('node:test'),assert=require('node:assert/strict'),{createHmac}=require('node:crypto');
const {createProaxShippingPlanProvider}=require('../lib/proax-shipping-plan');
const {createShippingQuoteService,verifyShippingQuote}=require('../lib/shipping-quotes');
const secret='synthetic-shipping-plan-fixture',time=Date.UTC(2026,9,8);
const items=[{sku:'MEASURED-SKU',qty:2}];
const parcel={content:'MEASURED-SKU × 2',amount:1,type:'box',weight:1.4,weightUnit:'KG',lengthUnit:'CM',dimensions:{length:30,width:20,height:10},insurance:0};
const plan={configured:true,revision:7,packages:[parcel],packing:[{boxId:'box-1',boxName:'Fixture measured box',ruleId:'rule-1',items}],physicalItems:items};
function provider(result=plan,status=200,record=()=>{}){
 return createProaxShippingPlanProvider('https://packing.example.test',{secret,now:()=>time,fetcher:async(url,request)=>{
  record(url,request);return{ok:status>=200&&status<300,json:async()=>result};
 }});
}
test('packing requests carry only server-resolved SKU quantities, country and a timestamp-bound signature',async()=>{
 let captured;const result=await provider(plan,200,(url,request)=>{captured={url,request};})({items,country:'MX'});
 assert.equal(captured.url,'https://packing.example.test/api/public/mahjoy/shipping-plan');
 assert.deepEqual(JSON.parse(captured.request.body),{items,country:'MX'});
 assert.equal(captured.request.headers['x-mahjoy-signature'],createHmac('sha256',secret).update(time+'.'+captured.request.body).digest('hex'));
 assert.equal(result.revision,7);assert.equal(result.packages[0].weight,1.4);
});
test('only an explicit disabled response permits the previously documented packing profile',async()=>{
 assert.deepEqual(await provider({configured:false,revision:0})({items,country:'MX'}),{configured:false,revision:0});
 await assert.rejects(provider({configured:false,revision:1})({items,country:'MX'}),/PACKAGE_PROFILE_REQUIRED/);
 for(const [body,status] of [[{},200],[{configured:'false',revision:0},200],[{configured:false,revision:-1},200],[{configured:false,revision:0},500]])
  await assert.rejects(provider(body,status)({items,country:'MX'}),/SHIPPING_CONFIGURATION_UNAVAILABLE/);
 const offline=createProaxShippingPlanProvider('https://packing.example.test',{secret,fetcher:async()=>{throw Error('offline');}});
 await assert.rejects(offline({items,country:'MX'}),/SHIPPING_CONFIGURATION_UNAVAILABLE/);
 await assert.rejects(provider({error_code:'PACKAGE_PROFILE_REQUIRED'},409)({items,country:'MX'}),/PACKAGE_PROFILE_REQUIRED/);
});
test('packing assignments must account for every physical item and be bounded before quoting',async()=>{
 for(const bad of [
  {...plan,packages:[]},{...plan,packages:[{...parcel,amount:2}]},{...plan,packing:[]},{...plan,revision:1.5},{...plan,revision:0},
  {...plan,physicalItems:[{sku:'MEASURED-SKU',qty:3}]},
  {...plan,physicalItems:[{sku:'MEASURED-SKU',qty:101}]},
  {...plan,packing:[{...plan.packing[0],items:[{sku:'OTHER-SKU',qty:2}]}]},
  {...plan,packing:[{...plan.packing[0],boxName:''}]}
 ])await assert.rejects(provider(bad)({items,country:'MX'}),/SHIPPING_CONFIGURATION_UNAVAILABLE/);
});
function quoteFixture(getPackingPlan){
 const calls=[];
 const config={envia:{apiUrl:'https://carrier.example.test'},productWeights:{},packageProfiles:[],carriersByCountry:{MX:['estafeta']}};
 const origin={name:'Fixture warehouse',phone:'5500000000',street:'Fixture origin',number:'1',district:'Fixture district',city:'Fixture city',state:'NL',country:'MX',postalCode:'66188'};
 const fetcher=async(url,request)=>{
  if(url.includes('/catalog/products'))return{ok:true,json:async()=>({products:[{sku:'MEASURED-SKU',name:'No category weight exists',price:100}]})};
  if(!url.endsWith('/ship/rate/'))throw Error('Unexpected financial operation');
  calls.push(JSON.parse(request.body));return{ok:true,json:async()=>({meta:'rate',data:[{service:'ground',totalPrice:150,currency:'MXN',dropOff:0,deliveryEstimate:'2-4 días'}]})};
 };
 return{calls,service:createShippingQuoteService({config,origins:{MX:origin},getPackingPlan,fetcher,apiKey:'synthetic-provider-key',signingSecret:secret,now:()=>time})};
}
test('verified Proax measurement plans replace category guesses and freeze real gross weight, boxes and assignments',async()=>{
 const f=quoteFixture(provider());
 const result=await f.service.quote({items:items.map(i=>({...i,weight:0.01,dimensions:{length:1,width:1,height:1}})),country:'MX',destination:'85219',currency:'MXN'});
 const signed=verifyShippingQuote(result.quotes[0].quote_token,{items,currency:'MXN'},{secret,now:time});
 assert.equal(signed.packages[0].weight,1.4);assert.deepEqual(signed.packages[0].dimensions,parcel.dimensions);
 assert.equal(signed.packing_revision,7);assert.deepEqual(signed.packing,plan.packing);assert.deepEqual(signed.physical_items,items);
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].packages,signed.packages);
});
test('a configuration error stops before any carrier rate call rather than selecting an old price or box',async()=>{
 const f=quoteFixture(async()=>{throw Object.assign(Error('PACKAGE_PROFILE_REQUIRED'),{code:'PACKAGE_PROFILE_REQUIRED',status:409});});
 await assert.rejects(f.service.quote({items,country:'MX',destination:'85219',currency:'MXN'}),/PACKAGE_PROFILE_REQUIRED/);
 assert.equal(f.calls.length,0);
});
