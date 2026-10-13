const test=require('node:test'),assert=require('node:assert/strict');
const {createEnviaReference,providerJson}=require('../lib/envia-reference');
const {deliveryEstimate,recommendShipping}=require('../lib/shipping-estimates');
const {valueLines,declarePackages}=require('../lib/shipping-valuation');
const {postalCodeOf,samePostal}=require('../lib/shipping-address');
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
