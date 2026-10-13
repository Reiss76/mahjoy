const {postalCodeOf,postalBase,locationText}=require('./shipping-address');
function failure(code,status=503,details) {return Object.assign(new Error(code),{code,status,...(details?{provider:details}:{})});}
async function providerJson(fetcher,url,request={},retries=String(request.method || 'GET').toUpperCase()==='GET'?1:0) {
  try {return await providerAttempt(fetcher,url,request);}catch(error) {
    if(!retries || error.code!=='SHIPPING_PROVIDER_UNAVAILABLE')throw error;
    await new Promise(resolve=>setTimeout(resolve,100));
    return providerAttempt(fetcher,url,request);
  }
}
async function providerAttempt(fetcher,url,request) {
  let response;
  try {response=await fetcher(url,{...request,redirect:'error',signal:AbortSignal.timeout(12000)});}
  catch {throw failure('SHIPPING_PROVIDER_UNAVAILABLE');}
  if(!response.ok)throw failure(response.status===401 || response.status===403?'SHIPPING_AUTHENTICATION_FAILED':response.status>=400 && response.status<500 && response.status!==429?'SHIPPING_PROVIDER_VALIDATION_FAILED':'SHIPPING_PROVIDER_UNAVAILABLE',502,{http:response.status || 0});
  let data;try {data=await response.json();}catch {throw failure('SHIPPING_PROVIDER_INVALID_RESPONSE',502);}
  if(data?.meta==='error' || data?.success===false || data?.error) {
    const code=data?.error?.code ?? data?.code;
    const diagnostic=typeof code==='number' || typeof code==='string' && /^[A-Za-z0-9_-]{1,80}$/.test(code)?code:undefined;
    throw failure('SHIPPING_PROVIDER_VALIDATION_FAILED',502,{http:response.status || 200,...(diagnostic===undefined?{}:{code:diagnostic})});
  }
  return data;
}
function createEnviaReference({apiKey,fetcher=fetch,queriesBase='https://queries.envia.com',geocodesBase='https://geocodes.envia.com',partialRateVerified={},now=Date.now}) {
  const cache=new Map();
  async function get(path) {
    if(!apiKey)throw failure('SHIPPING_AUTHENTICATION_FAILED');
    const old=cache.get(path);if(old && old.expires>now())return old.value;
    const value=await providerJson(fetcher,queriesBase+path,{headers:{Authorization:'Bearer '+apiKey,'User-Agent':'Mahjoy-API-Verification/1.0'}});
    cache.set(path,{value,expires:now()+86400000});return value;
  }
  async function states(country) {
    const result=await get('/state?country_code='+encodeURIComponent(country));
    if(!Array.isArray(result.data) || !result.data.length)throw failure('SHIPPING_LOCATION_UNAVAILABLE');
    return result.data.filter(row=>!row.country_code || row.country_code===country);
  }
  async function resolveDestination(address) {
    const country=address.country,postalCode=postalCodeOf(address.postalCode,country);
    let city=typeof address.city==='string'?address.city.trim():'',state=typeof address.state==='string'?address.state.trim():'';
    const path='/zipcode/'+country+'/'+postalBase(postalCode,country);
    let geo,normalized;
    try {
      const old=cache.get('geo:'+path);
      geo=old && old.expires>now()?old.value:await providerJson(fetcher,geocodesBase+path,{headers:{'User-Agent':'Mahjoy-API-Verification/1.0'}});
      // Geocodes currently returns an array with nested country/state. The
      // documented success/data variant is retained for compatibility.
      if(Array.isArray(geo)) {
        const rows=geo.filter(row=>row?.country?.code===country && postalBase(String(row.zip_code || ''),country)===postalBase(postalCode,country));
        if(!rows.length)throw failure('SHIPPING_DESTINATION_MISMATCH',409);
        const locations=rows.map(row=>({country:row.country.code,zipcode:row.zip_code,city:row.locality,state:row.state?.code?.['2digit'] || row.state?.name}));
        if(new Set(locations.map(row=>locationText(row.state))).size!==1)throw failure('SHIPPING_LOCATION_UNAVAILABLE');
        normalized=locations[0];
      } else if(geo?.data && typeof geo.data==='object')normalized=geo.data;
      else throw failure('SHIPPING_LOCATION_UNAVAILABLE');
      cache.set('geo:'+path,{value:geo,expires:now()+86400000});
    } catch(error) {
      // An outage can use authenticated PayPal city/state plus the official
      // state catalog. A definite invalid/mismatched ZIP cannot be bypassed.
      if(!city || !state || error.code!=='SHIPPING_PROVIDER_UNAVAILABLE')throw error;
    }
    if(normalized) {
      if(normalized.country!==country || postalBase(String(normalized.zipcode || ''),country)!==postalBase(postalCode,country))throw failure('SHIPPING_DESTINATION_MISMATCH',409);
      if(!city)city=normalized.city;if(!state)state=normalized.state;
    }
    if(!city || !state)throw failure('SHIPPING_ADDRESS_REQUIRED',409);
    const candidates=(await states(country)).filter(row=>[row.code_2_digits,row.code_3_digits,row.name].some(value=>locationText(value)===locationText(state)));
    if(candidates.length!==1 || typeof candidates[0].code_2_digits!=='string')throw failure('INVALID_SHIPPING_STATE',409);
    const official=candidates[0],aliases=[official.code_2_digits,official.code_3_digits,official.name].filter(value=>typeof value==='string' && value.trim());
    if(normalized?.state && !aliases.some(value=>locationText(value)===locationText(normalized.state)))throw failure('SHIPPING_DESTINATION_MISMATCH',409);
    return {...address,postalCode,city,state:official.code_2_digits,state_aliases:aliases};
  }
  async function carrier(country,name) {
    const result=await get('/carrier?country_code='+country);
    const rows=Array.isArray(result.data)?result.data:[];
    const matches=rows.filter(row=>String(row.name || '').toLowerCase()===name.toLowerCase() && (!row.country_code || row.country_code===country));
    if(matches.length!==1 || !Number.isSafeInteger(matches[0].id))throw failure('SHIPPING_SERVICE_UNCONFIRMED');return matches[0];
  }
  async function printSettings(country,name) {
    const row=await carrier(country,name),result=await get('/carrier-print-option?carrier_id='+row.id+'&limit=100&page=1');
    const rows=Array.isArray(result.data)?result.data:[];
    for(const size of ['STOCK_4X6','PAPER_4X6','PAPER_7X4.75'])if(rows.some(option=>option.print_format==='PDF' && option.print_size===size && (!option.country_code || option.country_code===country)))return {printFormat:'PDF',printSize:size};
    throw failure('SHIPPING_PRINT_UNAVAILABLE',409);
  }
  function allowPartialRate(country,name) {return partialRateVerified[country]?.includes(name)===true;}
  return {resolveDestination,printSettings,allowPartialRate};
}
module.exports={providerJson,createEnviaReference};
