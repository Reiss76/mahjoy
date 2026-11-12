// A storefront-only, time-limited gift. Catalog prices and coupon rules stay intact.
const ID = 'buen-fin-2026';
const START = Date.parse('2026-11-13T06:00:00.000Z');
const END = Date.parse('2026-11-18T06:00:00.000Z');
const TIERS = [
  {minimum:4000, name:'Line Finder', skus:['LINE-005','LINE-002','LINE-003','LINE-001']},
  {minimum:8000, name:'Velvet Tile Bag', skus:['BAG-tile002','BAG-tile001','BAG-tile003']},
  {minimum:12000, name:'Tile Case', skus:['BAG-tilepink','BAG-tilelila']},
];
const active = (now=Date.now()) => now >= START && now < END;
const key = value => String(value || '').trim().toUpperCase();
function available(products,tier) {
  return tier.skus.flatMap(sku=>{
    const found=products.filter(p=>key(p.sku)===key(sku));
    return found.length===1 && found[0].soldOutEs!==true && found[0].soldOut!==true && Number(found[0].price)>0
      ? [{sku:found[0].sku,name:found[0].name,image:found[0].image || found[0].primary_image_url || null}] : [];
  });
}
function summary(products=[],items=[],currency='MXN',now=Date.now()) {
  const enabled=currency==='MXN' && active(now);
  const subtotal=items.reduce((total,item)=>total+Math.round(item.unit_price*100)*item.qty,0)/100;
  const tiers=TIERS.map(tier=>({...tier,options:available(products,tier)}));
  const eligible=enabled ? tiers.filter(tier=>subtotal>=tier.minimum).at(-1) || null : null;
  return {id:ID,active:enabled,server_time:now,starts_at:START,ends_at:END,time_zone:'America/Mexico_City',
    cumulative:false,subtotal,tiers,eligible};
}
function error(code) {return Object.assign(new Error(code),{code,status:409});}
function applyGift(payload,quote,selected,now=Date.now()) {
  const unit=payload.purchase_units[0],campaign=summary(quote._catalog,quote.items,unit.amount.currency_code,now);
  if(!campaign.eligible)return {payload,prices:quote.items};
  const options=campaign.eligible.options;
  if(!options.length)throw error('BUEN_FIN_GIFT_UNAVAILABLE');
  const gift=selected ? options.find(p=>key(p.sku)===key(selected)) : options[0];
  if(!gift)throw error('BUEN_FIN_GIFT_CHANGED');
  const price={sku:gift.sku,name:gift.name,qty:1,unit_price:0,promotion:ID};
  const updated=structuredClone(payload);
  updated.purchase_units[0].items.push({sku:gift.sku,name:('Regalo Buen Fin · '+gift.name).slice(0,127),quantity:'1',
    category:'PHYSICAL_GOODS',unit_amount:{currency_code:'MXN',value:'0.00'}});
  return {payload:updated,prices:[...quote.items,price]};
}
function registerBuenFin(app,base,fetcher=fetch,now=Date.now) {
  app.get('/api/promotions/buen-fin',async(_req,res)=>{
    res.set('Cache-Control','no-store');
    try {
      let products=[];
      if(active(now())) {
        const response=await fetcher(base+'/api/public/mahjoy/catalog/products',{cache:'no-store',signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error('CATALOG_UNAVAILABLE');
        products=(await response.json()).products || [];
      }
      res.json(summary(products,[],'MXN',now()));
    }catch {res.status(503).json({...summary([],[],'MXN',now()),error:'CATALOG_UNAVAILABLE'});}
  });
}
module.exports={ID,START,END,TIERS,active,summary,applyGift,registerBuenFin};
