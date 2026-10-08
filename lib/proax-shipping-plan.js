const {createHmac}=require('node:crypto');

function unavailable(){const e=new Error('SHIPPING_CONFIGURATION_UNAVAILABLE');e.code=e.message;e.status=503;return e;}
// Only the storefront server can request a packing plan. Browser-supplied weights
// and dimensions never enter this request or override the manager's measurements.
function createProaxShippingPlanProvider(base,options={}) {
  const fetcher=options.fetcher || fetch;
  const now=options.now || Date.now;
  return async ({items,country})=>{
    const secret=options.secret ?? process.env.PROAX_PAYPAL_SYNC_SECRET;
    if(!secret)throw unavailable();
    const raw=JSON.stringify({items,country}),timestamp=String(now());
    let response,result;
    try {
      response=await fetcher(String(base).replace(/\/$/,'')+'/api/public/mahjoy/shipping-plan',{
        method:'POST',headers:{'Content-Type':'application/json','x-mahjoy-timestamp':timestamp,
          'x-mahjoy-signature':createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex')},
        body:raw,signal:AbortSignal.timeout(12000),cache:'no-store'
      });
      result=await response.json();
    }catch(_){throw unavailable();}
    if(!response.ok){
      if(result.error_code==='PACKAGE_PROFILE_REQUIRED'){
        const error=new Error('PACKAGE_PROFILE_REQUIRED');error.code=error.message;error.status=409;throw error;
      }
      throw unavailable();
    }
    if(!result || typeof result.configured!=='boolean' || !Number.isSafeInteger(result.revision) || result.revision<0)throw unavailable();
    if(!result.configured){
      // Once a manager saves the new source of truth, disabling it means manual
      // quoting. It must not silently restore the historical hardcoded parcel.
      if(result.revision>0){const error=new Error('PACKAGE_PROFILE_REQUIRED');error.code=error.message;error.status=409;throw error;}
      return {configured:false,revision:0};
    }
    if(!Array.isArray(result.packages) || !result.packages.length || result.packages.length>20 ||
      !Array.isArray(result.packing) || result.packing.length!==result.packages.length ||
      !Array.isArray(result.physicalItems) || !result.physicalItems.length || result.physicalItems.length>100)throw unavailable();
    if(result.revision<1 || result.packages.some(p=>!p || p.amount!==1))throw unavailable();
    let count=0;
    for(const item of result.physicalItems){
      if(typeof item?.sku!=='string' || !item.sku.trim() || item.sku.length>150 || !Number.isSafeInteger(item.qty) || item.qty<1)throw unavailable();
      count+=item.qty;
    }
    if(count>100 || JSON.stringify(result).length>20000)throw unavailable();
    for(const line of result.packing){
      if(typeof line?.boxId!=='string' || !line.boxId || line.boxId.length>100 ||
        typeof line.boxName!=='string' || !line.boxName.trim() || line.boxName.length>150 ||
        typeof line.ruleId!=='string' || !line.ruleId || line.ruleId.length>100 ||
        !Array.isArray(line.items) || !line.items.length || line.items.length>100)throw unavailable();
      for(const item of line.items){
        if(typeof item?.sku!=='string' || !item.sku.trim() || item.sku.length>150 || !Number.isSafeInteger(item.qty) || item.qty<1 || item.qty>100)throw unavailable();
      }
    }
    const identity=items=>{
      const totals=new Map();for(const item of items)totals.set(item.sku,(totals.get(item.sku)||0)+item.qty);
      return JSON.stringify([...totals].sort(([a],[b])=>a.localeCompare(b)));
    };
    if(identity(result.physicalItems)!==identity(result.packing.flatMap(p=>p.items)))throw unavailable();
    return {configured:true,revision:result.revision,packages:result.packages,packing:result.packing,physicalItems:result.physicalItems};
  };
}
module.exports={createProaxShippingPlanProvider};
