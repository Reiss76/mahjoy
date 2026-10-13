function invalid() {const code='SHIPPING_DECLARED_VALUE_REQUIRED';throw Object.assign(new Error(code),{code,status:409});}
function money(value) {
  if(typeof value!=='string' && typeof value!=='number')invalid();
  if(!/^\d+(?:\.\d{1,2})?$/.test(String(value)))invalid();
  const result=Math.round(Number(value)*100);
  if(!Number.isSafeInteger(result) || result<0 || result>100000000)invalid();
  return result;
}
function valueLines(items,currency) {
  if(!Array.isArray(items) || !items.length)invalid();
  return items.map(item=>{
    const qty=Number(item.qty ?? item.quantity),sku=String(item.sku || '').trim().toUpperCase();
    const amount=item.unit_amount;
    if(!sku || !Number.isInteger(qty) || qty<1 || amount?.currency_code!==currency)invalid();
    const totalCents=money(amount.value)*qty;
    if(!Number.isSafeInteger(totalCents))invalid();
    return {sku,qty,totalCents};
  });
}
function declarePackages(packages,packing,lines,components) {
  if(!Array.isArray(lines) || !lines.length || !Array.isArray(packages) || !packages.length)invalid();
  const total=lines.reduce((sum,line)=>sum+line.totalCents,0);
  if(!Number.isSafeInteger(total) || total<0 || total>100000000)invalid();
  // The legacy confirmed cart is one physical parcel; its verified merchandise
  // total can be assigned without reconstructing historical bundle composition.
  if(packages.length===1 && packages[0].amount===1 && !packing?.length)
    return [{...packages[0],declaredValue:total/100}];
  if(!Array.isArray(packing) || packing.length!==packages.length || packages.some(pack=>pack.amount!==1))invalid();
  const values=new Map(),merged=new Map();
  for(const line of lines) {const old=merged.get(line.sku) || {sku:line.sku,qty:0,totalCents:0};old.qty+=line.qty;old.totalCents+=line.totalCents;merged.set(line.sku,old);}
  for(const line of merged.values()) {
    const expansion=components?.find(row=>String(row.sku).toUpperCase()===line.sku);
    const units=expansion?.items ?? (!/^BUNDLE-/i.test(line.sku)?[{sku:line.sku,qty:line.qty}]:null);
    if(!Array.isArray(units) || !units.length)invalid();
    const sorted=units.map(item=>({sku:String(item.sku).toUpperCase(),qty:Number(item.qty)})).sort((a,b)=>a.sku.localeCompare(b.sku));
    if(sorted.some(item=>!item.sku || !Number.isInteger(item.qty) || item.qty<1))invalid();
    const count=sorted.reduce((sum,item)=>sum+item.qty,0);
    if(count>100)invalid();
    const base=Math.floor(line.totalCents/count);let index=0;
    for(const unit of sorted)for(let i=0;i<unit.qty;i++) {
      index++;const queue=values.get(unit.sku) || [];
      queue.push(index===count?line.totalCents-base*(count-1):base);values.set(unit.sku,queue);
    }
  }
  const result=packages.map((pack,index)=>{
    if(!Array.isArray(packing[index]?.items))invalid();let cents=0;
    for(const item of packing[index].items) {
      const queue=values.get(String(item.sku).toUpperCase()),qty=Number(item.qty);
      if(!queue || !Number.isInteger(qty) || qty<1 || queue.length<qty)invalid();
      cents+=queue.splice(0,qty).reduce((sum,value)=>sum+value,0);
    }
    return {...pack,declaredValue:cents/100};
  });
  if([...values.values()].some(queue=>queue.length) || Math.round(result.reduce((sum,pack)=>sum+pack.declaredValue,0)*100)!==total)invalid();
  return result;
}
module.exports={money,valueLines,declarePackages};
