const test=require('node:test'),assert=require('node:assert/strict');
const {createEnviaReference,providerJson}=require('../lib/envia-reference');
const {deliveryEstimate,recommendShipping}=require('../lib/shipping-estimates');
const {valueLines,declarePackages}=require('../lib/shipping-valuation');
const {postalCodeOf,samePostal,sameLocation}=require('../lib/shipping-address');
const reply=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const row=(service,price,text,structured)=>({carrier:'fixture',service,price,...{delivery_minutes:deliveryEstimate(text,structured).minutes}});
test('delivery durations use both quantity and verified day/hrs units, retaining raw provider metadata',()=>{
 for(const [unit,quantity,minutes] of [['days',3,4320],['day',1,1440],['hours',20,1200],['hrs',16,960]]) {
  const value=deliveryEstimate('Día siguiente',{dateDifference:quantity,timeUnit:unit,date:'2026-10-15',time:'08:00'});
  if(quantity===3)assert.equal(value.status,'conflicting');else assert.equal(value.minutes,minutes);
  assert.equal(value.structured.timeUnit,unit);assert.equal(value.structured.time,'08:00');
 }
 assert.equal(deliveryEstimate('1–3 días').minutes,4320);
 assert.equal(deliveryEstimate('mismo día').minutes,0);
 assert.equal(deliveryEstimate('2 to 5 business days').minutes,7200);
 assert.equal(deliveryEstimate('Unknown').minutes,null);
 assert.equal(deliveryEstimate('3-1 days').minutes,null);
 assert.equal(deliveryEstimate('2-3 días',{dateDifference:6,timeUnit:'days'}).status,'conflicting');
});
test('economy and fastest are ordered independently with conservative ranges and stable ties',()=>{
 const rates=[row('ground',27.32,'4-6 days'),row('priority',87.48,'1-3 days'),row('premium',238.91,'1-3 days')];
 assert.deepEqual(recommendShipping(rates).map(v=>[v.kind,v.rate.service]),[['economical','ground'],['fastest','priority']]);
 assert.deepEqual(recommendShipping(rates.reverse()).map(v=>v.rate.service),['ground','priority']);
 const overlap=[row('a',20,'1-4 days'),row('b',30,'2-3 days')];assert.equal(recommendShipping(overlap)[1].rate.service,'b');
 const ties=[row('z',10,'2 days'),row('a',10,'1 day')];assert.deepEqual(recommendShipping(ties).map(v=>[v.kind,v.rate.service]),[['both','a']]);
 assert.equal(recommendShipping([row('z',10,'2 days'),row('a',10,'2 days')])[0].rate.service,'a');
});
test('unknown or contradictory durations cannot win speed and identical service winners are deduplicated',()=>{
 const unknown=row('unknown',10,'Very Express'),known=row('known',20,'2 days');
 assert.deepEqual(recommendShipping([unknown,known]).map(v=>v.rate.service),['unknown','known']);
 assert.deepEqual(recommendShipping([unknown]).map(v=>v.kind),['economical']);
 const conflicting=row('conflict',8,'1-3 days',{dateDifference:7,timeUnit:'days'});
 assert.deepEqual(recommendShipping([conflicting,known]).map(v=>v.rate.service),['conflict','known']);
 assert.deepEqual(recommendShipping([known,{...known}]).map(v=>v.kind),['both']);
 assert.deepEqual(recommendShipping([{...known,price:NaN},{...known,price:-1}]),[]);
});
function reference(fetcher){return createEnviaReference({apiKey:'test-only-key',fetcher,partialRateVerified:{US:['fedex']},now:()=>1});}
test('Geocodes array response resolves real state/city, preserves ZIP+4 and uses the official state catalog',async()=>{
 const calls=[];const ref=reference(async(url,request)=>{calls.push(url);
  if(url.includes('geocodes')) {assert.equal(request.headers.Authorization,undefined);return reply([{zip_code:'60601',country:{code:'US'},state:{name:'Illinois',code:{'2digit':'IL'}},locality:'Chicago'}]);}
  return reply({data:[{country_code:'US',name:'Illinois',code_2_digits:'IL',code_3_digits:'ILL'}]});
 });
 const first=await ref.resolveDestination({country:'US',postalCode:'60601 1234',city:'Chicago',state:'Illinois'});
 assert.equal(first.postalCode,'60601-1234');assert.equal(first.city,'Chicago');assert.equal(first.state,'IL');
 assert(first.state_aliases.includes('Illinois'));await ref.resolveDestination({country:'US',postalCode:'60601-1234'});assert.equal(calls.length,2);
 assert(ref.allowPartialRate('US','fedex'));assert(!ref.allowPartialRate('MX','fedex'));assert(!ref.allowPartialRate('US','other'));
});
test('documented Geocodes wrapper remains supported but mismatched ZIP/state and definite business errors cannot use a fallback',async()=>{
 const fetcher=async url=>reply(url.includes('geocodes')?{success:true,data:{country:'MX',zipcode:'66188',state:'NL',city:'Ciudad Santa Catarina'}}:{data:[{name:'Nuevo León',code_2_digits:'NL',code_3_digits:'NLE'}]});
 assert.equal((await reference(fetcher).resolveDestination({country:'MX',postalCode:'66188'})).state,'NL');
 for(const geo of [{success:false},{success:true,data:{country:'US',zipcode:'66188',state:'NL',city:'City'}},[]]) {
  await assert.rejects(reference(async url=>url.includes('geocodes')?reply(geo):fetcher(url)).resolveDestination({country:'MX',postalCode:'66188',city:'Real city',state:'NL'}));
 }
 await assert.rejects(reference(fetcher).resolveDestination({country:'MX',postalCode:'66188',city:'City',state:'JA'}));
});
test('PayPal Mexico City aliases resolve to the official Envia state and remain valid for signed quote matching',async()=>{
 const ref=reference(async url=>reply(url.includes('geocodes')?
  [{zip_code:'11550',country:{code:'MX'},state:{name:'Ciudad de México',code:{'2digit':'CX'}},locality:'Miguel Hidalgo'}]:
  {data:[{country_code:'MX',name:'Ciudad de México',code_2_digits:'CX',code_3_digits:'CMX'},
   {country_code:'MX',name:'México',code_2_digits:'EM',code_3_digits:'MEX'}]}));
 for(const state of ['CDMX',' cdmx ','CX','CMX','Ciudad de México','DF','D.F.','Distrito Federal']) {
  const address={country:'MX',postalCode:'11550',city:'Miguel Hidalgo',state};
  const normalized=await ref.resolveDestination(address);
  assert.equal(normalized.state,'CX');
  assert.equal(sameLocation(normalized,address),true);
  assert(normalized.state_aliases.includes('CDMX'));
 }
 for(const state of ['México','MEX','EM'])await assert.rejects(
  ref.resolveDestination({country:'MX',postalCode:'11550',city:'Miguel Hidalgo',state}),
  {code:'SHIPPING_DESTINATION_MISMATCH'});
 await assert.rejects(ref.resolveDestination({country:'MX',postalCode:'11550',city:'Miguel Hidalgo',state:'Unknown'}),{code:'INVALID_SHIPPING_STATE'});
});
test('Mexico City aliases never apply outside Mexico or bypass postal state validation',async()=>{
 const states=[{country_code:'MX',name:'Ciudad de México',code_2_digits:'CX',code_3_digits:'CMX'},
  {country_code:'MX',name:'México',code_2_digits:'EM',code_3_digits:'MEX'}];
 const ref=reference(async url=>reply(url.includes('geocodes')?
  [{zip_code:'50000',country:{code:'MX'},state:{name:'México',code:{'2digit':'EM'}},locality:'Toluca'}]:{data:states}));
 await assert.rejects(ref.resolveDestination({country:'MX',postalCode:'50000',city:'Toluca',state:'CDMX'}),{code:'SHIPPING_DESTINATION_MISMATCH'});
 const normalized=await ref.resolveDestination({country:'MX',postalCode:'50000',city:'Toluca',state:'MEX'});
 assert.equal(normalized.state,'EM');assert(!normalized.state_aliases.includes('CDMX'));
 const otherCountry=reference(async url=>reply(url.includes('geocodes')?
  [{zip_code:'60601',country:{code:'US'},state:{name:'Fixture',code:{'2digit':'XX'}},locality:'City'}]:
  {data:[{country_code:'US',name:'Fixture',code_2_digits:'XX',code_3_digits:'CMX'}]}));
 await assert.rejects(otherCountry.resolveDestination({country:'US',postalCode:'60601',city:'City',state:'CDMX'}),{code:'INVALID_SHIPPING_STATE'});
});
test('Polanco municipality and neighborhood names use the verified Envia locality while retaining the exact delivery address',async()=>{
 const geo=[{zip_code:'11530',country:{code:'MX'},state:{name:'Ciudad de Mexico',code:{'2digit':'CX','3digit':'CMX'}},
  locality:'Ciudad de México',regions:{region_1:'Ciudad de Mexico',region_2:'Miguel Hidalgo'},suburbs:['Polanco II Sección']}];
 const ref=reference(async url=>reply(url.includes('geocodes')?geo:{data:[{country_code:'MX',name:'Ciudad de México',code_2_digits:'CX',code_3_digits:'CMX'}]}));
 for(const city of ['Ciudad de México','ciudad de mexico','Miguel Hidalgo','Polanco II Sección']) {
  const address={country:'MX',postalCode:'11530',city,state:'CDMX',street:'Calle de prueba',number:'340',interior:'203',name:'Destinataria de prueba'};
  const result=await ref.resolveDestination(address);
  assert.equal(result.city,'Ciudad de México');assert.equal(result.state,'CX');
  assert(result.city_aliases.includes(city));assert(result.city_aliases.includes('Miguel Hidalgo'));
  assert(sameLocation(result,address));
  for(const key of ['street','number','interior','name'])assert.equal(result[key],address[key]);
 }
 const unknown=await ref.resolveDestination({country:'MX',postalCode:'11530',city:'Guadalajara',state:'CDMX',city_aliases:['Ciudad de México']});
 assert.equal(unknown.city,'Guadalajara');assert.equal(unknown.city_aliases,undefined);
 assert.equal(sameLocation(unknown,{country:'MX',postalCode:'11530',city:'Ciudad de México',state:'CDMX'}),false);
 await assert.rejects(ref.resolveDestination({country:'MX',postalCode:'11530',city:'Miguel Hidalgo',state:'México'}),{code:'INVALID_SHIPPING_STATE'});
});
test('postal-code city normalization selects an unambiguous locality and never trusts client aliases',async()=>{
 const rows=[{locality:'City A',regions:{region_2:'Municipality A'},suburbs:Array.from({length:20},(_,i)=>'Neighborhood '+i)},
  {locality:'City B',regions:{region_2:'Municipality B'},suburbs:['Neighborhood B']}]
  .map(row=>({...row,zip_code:'11111',country:{code:'MX'},state:{code:{'2digit':'NL'}}}));
 const ref=reference(async url=>reply(url.includes('geocodes')?rows:{data:[{country_code:'MX',name:'Nuevo León',code_2_digits:'NL',code_3_digits:'NLE'}]}));
 const result=await ref.resolveDestination({country:'MX',postalCode:'11111',city:'Neighborhood 19',state:'NL',city_aliases:['Foreign city']});
 assert.equal(result.city,'City A');assert(result.city_aliases.includes('Neighborhood 19'));assert(result.city_aliases.length<=10);assert(!result.city_aliases.includes('Foreign city'));
 assert.equal((await ref.resolveDestination({country:'MX',postalCode:'11111',city:'Municipality B',state:'NL'})).city,'City B');
 rows[1].regions.region_2='Municipality A';
 const ambiguous=await ref.resolveDestination({country:'MX',postalCode:'11111',city:'Municipality A',state:'NL'});
 assert.equal(ambiguous.city,'Municipality A');assert.equal(ambiguous.city_aliases,undefined);
});
test('the PayPal quote and final shipping verification accept the municipality without changing the buyer address',async()=>{
 const {createShippingQuoteService,verifyShippingQuote}=require('../lib/shipping-quotes');
 const {nativeShippingQuote}=require('../lib/paypal-native-shipping-rpc');
 const base=require('../config/shipping'),secret='local-shipping-regression',calls=[];
 const ref=reference(async url=>reply(url.includes('geocodes')?
  [{zip_code:'11530',country:{code:'MX'},state:{code:{'2digit':'CX'}},locality:'Ciudad de México',regions:{region_2:'Miguel Hidalgo'},suburbs:['Polanco II Sección']}]:
  {data:[{country_code:'MX',name:'Ciudad de México',code_2_digits:'CX',code_3_digits:'CMX'}]}));
 const config={...base,carriersByCountry:{MX:['fedex']},packageProfiles:[{confirmed:true,country:'MX',items:[{sku:'RACK-COSMIC',qty:1}],
  packages:[{type:'box',content:'Rack',amount:1,weight:3,weightUnit:'KG',lengthUnit:'CM',dimensions:{length:50,width:20,height:10}}]}]};
 const service=createShippingQuoteService({config,origins:{MX:base.origin},signingSecret:secret,apiKey:'fixture',
  resolveDestination:ref.resolveDestination,allowPartialRate:()=>true,fetcher:async(url,request)=>{
   if(url.includes('/catalog/products'))return reply({products:[{sku:'RACK-COSMIC',name:'Rack Cosmic',price:2400}]});
   assert(url.endsWith('/ship/rate/'),'Only quote requests are allowed');
   const payload=JSON.parse(request.body);calls.push(payload);
   assert.equal(payload.destination.city,'Ciudad de México');assert.equal(payload.destination.state,'CX');
   return reply({meta:'rate',data:[{carrier:'fedex',service:'ground',dropOff:0,totalPrice:249.85,currency:'MXN',deliveryEstimate:2}]});
  }});
 const input={country:'MX',postalCode:'11530',city:'Miguel Hidalgo',state:'CDMX',currency:'MXN',protocolVersion:2,
  items:[{sku:'RACK-COSMIC',quantity:'1',unit_amount:{currency_code:'MXN',value:'2160.00'}}],frozenPhysicalItems:[{sku:'RACK-COSMIC',qty:1}]};
 const result=await nativeShippingQuote(service,input,(token,context)=>verifyShippingQuote(token,context,{secret}));
 assert.equal(result.option.amount.value,'249.85');assert(result.shippingQuote.destination.city_aliases.includes('Miguel Hidalgo'));
 const buyerAddress={country:'MX',postalCode:'11530',city:'Miguel Hidalgo',state:'CDMX',street:'Calle de prueba',number:'340',interior:'203',name:'Destinataria de prueba',phone:'5550000000'};
 const before=JSON.stringify(buyerAddress);
 assert.equal((await service.verifyFinal(result.shippingQuote,buyerAddress)).ok,true);
 assert.equal(JSON.stringify(buyerAddress),before);assert.equal(calls.length,2);assert.equal(calls[1].destination.street,buyerAddress.street);
 assert.equal(calls[1].destination.number,'340');assert.equal(calls[1].destination.interior,'203');
});
test('carrier print settings prefer tested PDF combinations including UPS PAPER_7X4.75 and reject unsupported combinations',async()=>{
 const ref=reference(async url=>reply(url.includes('/carrier?')?{data:[{id:28,name:'ups',country_code:'US'}]}:{data:[{print_format:'PDF',print_size:'STOCK_4X6.5'},{print_format:'PDF',print_size:'PAPER_7X4.75'}]}));
 assert.deepEqual(await ref.printSettings('US','ups'),{printFormat:'PDF',printSize:'PAPER_7X4.75'});
 const bad=reference(async url=>reply(url.includes('/carrier?')?{data:[{id:28,name:'ups',country_code:'US'}]}:{data:[{print_format:'ZPL',print_size:'STOCK_4X6'}]}));
 await assert.rejects(bad.printSettings('US','ups'),{code:'SHIPPING_PRINT_UNAVAILABLE'});
});
test('HTTP 200 business errors, authentication text and malformed JSON never become successful rates',async()=>{
 for(const data of [{meta:'error',error:{code:1129,message:'private body'}},{meta:'rate',success:false,data:[{}]},{error:'failure'}])await assert.rejects(providerJson(async()=>reply(data),'https://fixture/rate',{method:'POST'}),{code:'SHIPPING_PROVIDER_VALIDATION_FAILED'});
 await assert.rejects(providerJson(async()=>reply(null,401),'https://fixture/rate'),{code:'SHIPPING_AUTHENTICATION_FAILED'});
 await assert.rejects(providerJson(async()=>({ok:true,json:async()=>{throw Error('bad')}}),'https://fixture/rate'),{code:'SHIPPING_PROVIDER_INVALID_RESPONSE'});
});
test('read-only transient queries retry once; ambiguous generation is never repeated',async()=>{
 let calls=0;assert.deepEqual(await providerJson(async()=>++calls===1?reply(null,503):reply({data:[]}),'https://fixture/state'),{data:[]});assert.equal(calls,2);
 calls=0;await assert.rejects(providerJson(async()=>{calls++;throw Error('timeout')},'https://fixture/ship/generate/',{method:'POST'}));assert.equal(calls,1);
 calls=0;await assert.rejects(providerJson(async()=>{calls++;throw Error('timeout')},'https://fixture/ship/rate/',{method:'POST'},1));assert.equal(calls,2);
});
test('declared value uses verified discounted merchandise, allocating all bundle/duplicate-line centavos exactly across packages',()=>{
 const currency='USD',lines=valueLines([{sku:'BUNDLE-1',qty:1,unit_amount:{currency_code:currency,value:'10.01'}},{sku:'X',qty:1,unit_amount:{currency_code:currency,value:'1.00'}},{sku:'X',qty:1,unit_amount:{currency_code:currency,value:'2.00'}}],currency);
 const packages=[{amount:1,insurance:0},{amount:1,insurance:0}],packing=[{items:[{sku:'A',qty:1},{sku:'X',qty:1}]},{items:[{sku:'B',qty:1},{sku:'X',qty:1}]}];
 const components=[{sku:'BUNDLE-1',items:[{sku:'A',qty:1},{sku:'B',qty:1}]},{sku:'X',items:[{sku:'X',qty:2}]}];
 const result=declarePackages(packages,packing,lines,components);
 assert.deepEqual(result.map(p=>p.declaredValue),[6.5,6.51]);assert(result.every(p=>p.insurance===0));assert.equal(result.reduce((s,p)=>s+Math.round(p.declaredValue*100),0),1301);
 assert.throws(()=>declarePackages(packages,[{items:[{sku:'A',qty:1}]},{items:[{sku:'B',qty:1}]}],lines,components),/SHIPPING_DECLARED_VALUE_REQUIRED/);
 assert.throws(()=>valueLines([{sku:'A',qty:1,unit_amount:{currency_code:'MXN',value:'2.001'}}],currency),/SHIPPING_DECLARED_VALUE_REQUIRED/);
});
test('ZIP+4 is preserved and equivalent base formats match without accepting malformed postal codes',()=>{
 assert.equal(postalCodeOf('60601 1234','US'),'60601-1234');assert(samePostal('60601-1234','60601','US'));assert(!samePostal('60601','10001-1234','US'));
 for(const value of ['60601--1234','606011234','60601-123','bad'])assert.throws(()=>postalCodeOf(value,'US'));
 assert.throws(()=>postalCodeOf('66188-1234','MX'));
});
