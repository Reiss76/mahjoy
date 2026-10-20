function quoteItems(products, items, currency, discountPct = 0) {
  if (!['MXN', 'USD'].includes(currency)) throw new Error('Invalid currency');
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('Invalid cart');
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct >= 100) throw new Error('Invalid discount');
  return items.map(item => {
    const qty = Number(item.qty ?? item.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw new Error('Invalid quantity');
    const sku = String(item.sku || '').toLowerCase();
    const matches = products.filter(p => sku ? String(p.sku).toLowerCase() === sku
      : item.id != null ? String(p.id) === String(item.id)
      : String(p.name).toLowerCase() === String(item.name || '').toLowerCase());
    if (matches.length !== 1) throw new Error('Product unavailable: ' + (item.name || item.sku || item.id));
    const p = matches[0];
    if (currency === 'USD' ? p.soldOutEn === true : p.soldOutEs === true) throw new Error('Product sold out: ' + p.name);
    const price = Number(p.price);
    const rawUsd = p.priceUsd ?? p.price_usd;
    const priceUsd = rawUsd == null ? null : Number(rawUsd);
    const base = currency === 'USD' ? priceUsd : price;
    if (!Number.isFinite(base) || base <= 0) throw new Error('Price unavailable in ' + currency + ': ' + p.name);
    const discounted = Math.round(base * (1 - discountPct / 100) * 100) / 100;
    if (discounted <= 0) throw new Error('Price unavailable in ' + currency + ': ' + p.name);
    return { id: p.type === 'bundle' ? 'bundle-' + p.id : p.id, sku: p.sku, name: p.name,
      qty, price, price_usd: priceUsd, unit_price: discounted, image: p.image || p.primary_image_url || null };
  });
}

async function resolveCheckoutQuote(base, body, fetcher = fetch) {
      const get = async path => {
        const response = await fetcher(base + path, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
        const data=await response.json();
        if (!response.ok) {
          const error=new Error(data.error_code==='DISCOUNT_USD_ONLY'?'This code is only valid in the EN store when paying in USD.':'Could not verify current prices. Please try again.');
          error.code=data.error_code;throw error;
        }
        return data;
      };
      const catalog = await get('/api/public/mahjoy/catalog/products?checkout=' + Date.now());
      let products = catalog.products || [];
      if ((body.items || []).some(i => /^bundle-/i.test(String(i.sku || i.id || '')))) {
        const bundles = await get('/api/public/mahjoy/bundles');
        products = products.concat((Array.isArray(bundles) ? bundles : bundles.bundles || []).map(b => ({ ...b, type: 'bundle', sku: 'BUNDLE-' + b.id })));
      }
      let discountPct = 0, discountCode=null;
      if(!['MXN','USD'].includes(body.currency))throw new Error('Invalid currency');
      if (body.discount_code) {
        const discount = await get('/api/public/vendors/discount/' + encodeURIComponent(body.discount_code)+'?currency='+body.currency+'&market='+(body.currency==='USD'?'EN':'ES'));
        if(discount.discount_usd_only && body.currency!=='USD'){const error=new Error('This code is only valid in the EN store when paying in USD.');error.code='DISCOUNT_USD_ONLY';throw error;}
        if (!discount.valid) throw new Error('Discount code is no longer valid');
        discountPct = Number(discount.discount_pct);
        discountCode=String(discount.discount_code || body.discount_code).trim().toUpperCase();
      }
  return {items:quoteItems(products,body.items,body.currency,discountPct),discount_pct:discountPct,discount_code:discountCode};
}

function registerCheckoutPrices(app, base, fetcher = fetch) {
  app.post('/api/checkout/prices', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const quote = await resolveCheckoutQuote(base,req.body,fetcher);
      res.json(quote);
    } catch (error) {
      res.status(400).json({ error: error.message, error_code:error.code });
    }
  });
}

// Cart display must still show a catalog price when an item cannot currently be
// purchased. Payment quotes above remain strict and never use this response.
function cartDisplayPrices(products, items, currency) {
  if (!['MXN','USD'].includes(currency)) throw new Error('Invalid currency');
  if (!Array.isArray(items) || !items.length || items.length>100) throw new Error('Invalid cart');
  return items.map(item=>{
    const qty=Number(item.qty ?? item.quantity);
    if (!Number.isInteger(qty)||qty<1||qty>1000) throw new Error('Invalid quantity');
    const id=String(item.id??'').trim(),numericId=/^\d+$/.test(id)?Number(id):null;
    const sku=String(item.sku||(/^bundle-\d+$/i.test(id)?id:'')).trim().toLowerCase();
    const matches=products.filter(p=>sku?String(p.sku).toLowerCase()===sku:numericId?Number(p.id)===numericId:String(p.name).toLowerCase()===String(item.name||'').toLowerCase());
    const p=matches.length===1?matches[0]:null;
    const amount=value=>value!=null&&Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
    const price=p?amount(p.price):null,priceUsd=p?amount(p.priceUsd??p.price_usd):null;
    const soldOut=p&&(currency==='USD'?p.soldOutEn===true:p.soldOutEs===true);
    return {id:p?(p.type==='bundle'?'bundle-'+p.id:p.id):item.id,sku:p?.sku||String(item.sku||''),name:p?.name||String(item.name||item.sku||'Product'),
      qty,price,price_usd:priceUsd,image:p?.image||p?.primary_image_url||null,
      cart_status:!p?'unavailable':(currency==='USD'?priceUsd:price)==null?'price_unavailable':soldOut?'sold_out':'available'};
  });
}
async function resolveCartDisplayPrices(base,body,fetcher=fetch) {
  if(!body||!['MXN','USD'].includes(body.currency)||!Array.isArray(body.items)||!body.items.length||body.items.length>100)throw new Error('Invalid cart');
  const get=async path=>{
    const response=await fetcher(base+path,{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Could not verify current prices. Please try again.');
    return response.json();
  };
  const catalog=await get('/api/public/mahjoy/catalog/products?cart='+Date.now());
  let products=catalog.products||[];
  if(body.items.some(item=>/^bundle-/i.test(String(item.sku||item.id||'')))) {
    const bundles=await get('/api/public/mahjoy/bundles');
    products=products.concat((Array.isArray(bundles)?bundles:bundles.bundles||[]).map(b=>({...b,type:'bundle',sku:'BUNDLE-'+b.id})));
  }
  return {items:cartDisplayPrices(products,body.items,body.currency)};
}
function registerCartDisplayPrices(app,base,fetcher=fetch) {
  app.post('/api/cart/prices',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try {res.json(await resolveCartDisplayPrices(base,req.body,fetcher));}
    catch(error){res.status(400).json({error:error.message});}
  });
}
module.exports = { quoteItems, registerCheckoutPrices, resolveCheckoutQuote, cartDisplayPrices, resolveCartDisplayPrices, registerCartDisplayPrices };
