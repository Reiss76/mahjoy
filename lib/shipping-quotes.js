const crypto = require('crypto');

const VERSION = 1;
const TTL_MS = 30 * 60 * 1000;
const DOMAIN = 'mahjoy-shipping-quote:v1:';
const PAID_STATUSES = new Set(['paid', 'shipped', 'delivered']);

function fail(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sku(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 150) fail('INVALID_SHIPPING_ITEMS');
  return value.trim().toUpperCase();
}
function canonicalItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100) fail('INVALID_SHIPPING_ITEMS');
  const quantities = new Map();
  for (const item of items) {
    const key = sku(item && item.sku);
    const qty = Number(item.qty ?? item.quantity);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000) fail('INVALID_SHIPPING_ITEMS');
    const total = (quantities.get(key) || 0) + qty;
    if (total > 1000) fail('INVALID_SHIPPING_ITEMS');
    quantities.set(key, total);
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([key, qty]) => ({sku: key, qty}));
}

function destinationOf(body) {
  const value = typeof body.destination === 'object' && body.destination !== null ? body.destination : {};
  const country = String(body.country || value.country || 'MX').toUpperCase();
  const postalCode = body.postalCode ?? value.postalCode ?? value.cp ?? body.destination_postal_code
    ?? (typeof body.destination === 'string' ? body.destination : undefined);
  if (!['MX', 'US'].includes(country)) fail('SHIPPING_COUNTRY_UNSUPPORTED');
  if (typeof postalCode !== 'string' || !/^\d{5}$/.test(postalCode)) fail('INVALID_SHIPPING_POSTAL_CODE');
  return {postalCode, country};
}

function currencyOf(value, country) {
  if (!['MXN', 'USD'].includes(value)) fail('INVALID_SHIPPING_CURRENCY');
  if (country === 'US' && value !== 'USD') fail('US_REQUIRES_USD', 409);
  return value;
}

function positive(value, code, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) fail(code);
  return value;
}
function cents(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value))) {
    fail('INVALID_SHIPPING_PRICE');
  }
  const number = Number(value);
  positive(number, 'INVALID_SHIPPING_PRICE', 1000000);
  const result = Math.round(number * 100);
  if (!Number.isSafeInteger(result) || Math.abs(number * 100 - result) > 0.000001) fail('INVALID_SHIPPING_PRICE');
  return result;
}
function packagesOf(packages) {
  if (!Array.isArray(packages) || !packages.length || packages.length > 20) fail('INVALID_SHIPPING_PACKAGES');
  return packages.map(p => {
    if (!p || p.type !== 'box' || p.weightUnit !== 'KG' || p.lengthUnit !== 'CM') fail('INVALID_SHIPPING_PACKAGES');
    if (!Number.isSafeInteger(p.amount) || p.amount < 1 || p.amount > 20) fail('INVALID_SHIPPING_PACKAGES');
    if (typeof p.content !== 'string' || !p.content.trim() || p.content.length > 200) fail('INVALID_SHIPPING_PACKAGES');
    const d = p.dimensions;
    if (!d) fail('INVALID_SHIPPING_PACKAGES');
    const result = {
      content: p.content, amount: p.amount, type: 'box',
      weight: positive(p.weight, 'INVALID_SHIPPING_PACKAGES', 1000),
      weightUnit: 'KG', lengthUnit: 'CM',
      dimensions: {
        length: positive(d.length, 'INVALID_SHIPPING_PACKAGES', 1000),
        width: positive(d.width, 'INVALID_SHIPPING_PACKAGES', 1000),
        height: positive(d.height, 'INVALID_SHIPPING_PACKAGES', 1000)
      }
    };
    for (const key of ['insurance', 'declaredValue']) {
      if (p[key] !== undefined) {
        if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < 0 || p[key] > 1000000) fail('INVALID_SHIPPING_PACKAGES');
        result[key] = p[key];
      }
    }
    return result;
  });
}
function originOf(origin) {
  if (!origin || !['MX', 'US'].includes(origin.country) || typeof origin.postalCode !== 'string' || !/^\d{5}$/.test(origin.postalCode)) fail('INVALID_SHIPPING_ORIGIN');
  for (const key of ['name', 'street', 'number', 'city', 'state']) {
    if (typeof origin[key] !== 'string' || !origin[key].trim() || origin[key].length > 255) fail('INVALID_SHIPPING_ORIGIN');
  }
  const result = {};
  for (const key of ['name','company','phone','email','street','number','district','city','state','country','postalCode','reference']) {
    if (origin[key] !== undefined) {
      if (typeof origin[key] !== 'string' || origin[key].length > 255) fail('INVALID_SHIPPING_ORIGIN');
      result[key] = origin[key];
    }
  }
  return result;
}
function codeOf(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fail('INVALID_SHIPPING_SERVICE');
  return value;
}
function secretOf(options = {}) {
  const secret = options.secret ?? (process.env.SHIPPING_QUOTE_SECRET || process.env.PROAX_PAYPAL_SYNC_SECRET);
  if (typeof secret !== 'string' || !secret) fail('SHIPPING_SIGNING_UNAVAILABLE', 503);
  return secret;
}
function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== VERSION || !Number.isSafeInteger(snapshot.expires_at) || snapshot.expires_at <= 0) fail('INVALID_SHIPPING_QUOTE');
  snapshot.items = canonicalItems(snapshot.items);
  snapshot.destination = destinationOf(snapshot.destination);
  snapshot.currency = currencyOf(snapshot.currency, snapshot.destination.country);
  snapshot.origin = originOf(snapshot.origin);
  if (snapshot.origin.country !== snapshot.destination.country) fail('INVALID_SHIPPING_ORIGIN');
  snapshot.packages = packagesOf(snapshot.packages);
  snapshot.carrier = codeOf(snapshot.carrier);
  snapshot.service = codeOf(snapshot.service);
  snapshot.price = cents(snapshot.price) / 100;
  return snapshot;
}
function signShippingQuote(snapshot, options = {}) {
  const payload = Buffer.from(JSON.stringify(validateSnapshot(clone(snapshot)))).toString('base64url');
  const signature = crypto.createHmac('sha256', secretOf(options)).update(DOMAIN + payload).digest('base64url');
  const token='sq1.' + payload + '.' + signature;
  if(token.length>32768)fail('PACKAGE_PROFILE_REQUIRED',409);
  return token;
}
function verifyShippingQuote(token, context = {}, options = {}) {
  if (token === undefined || token === null || token === '') fail('SHIPPING_QUOTE_REQUIRED');
  if (typeof token !== 'string' || token.length > 32768) fail('SHIPPING_QUOTE_INVALID');
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'sq1' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) fail('SHIPPING_QUOTE_INVALID');
  const expected = crypto.createHmac('sha256', secretOf(options)).update(DOMAIN + parts[1]).digest();
  const supplied = Buffer.from(parts[2], 'base64url');
  if (supplied.toString('base64url') !== parts[2] || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) fail('SHIPPING_QUOTE_INVALID');
  let snapshot;
  try { snapshot = validateSnapshot(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))); }
  catch (_) { fail('SHIPPING_QUOTE_INVALID'); }
  const now = typeof options.now === 'function' ? options.now() : options.now ?? Date.now();
  if (!options.allowExpired && snapshot.expires_at <= now) fail('SHIPPING_QUOTE_EXPIRED', 409);
  if (context.items !== undefined) {
    let items;
    try { items = canonicalItems(context.items); } catch (_) { fail('SHIPPING_CART_MISMATCH', 409); }
    if (JSON.stringify(items) !== JSON.stringify(snapshot.items)) fail('SHIPPING_CART_MISMATCH', 409);
  }
  if (context.currency !== undefined && context.currency !== snapshot.currency) fail('SHIPPING_CURRENCY_MISMATCH', 409);
  if (context.postalCode !== undefined && context.postalCode !== snapshot.destination.postalCode) fail('SHIPPING_DESTINATION_MISMATCH', 409);
  if (context.country !== undefined && String(context.country).toUpperCase() !== snapshot.destination.country) fail('SHIPPING_DESTINATION_MISMATCH', 409);
  return clone(snapshot);
}
function verifyShippingQuoteSignature(token, context = {}, options = {}) {
  return verifyShippingQuote(token, context, {...options, allowExpired: true});
}

function productWeight(product, config) {
  const weights = config.productWeights || {};
  const exact = weights[String(product.sku || '').toLowerCase()];
  if (exact !== undefined) return positive(exact, 'PRODUCT_WEIGHT_UNAVAILABLE', 1000);
  const name = String(product.name || '').toLowerCase();
  const matches = Object.keys(weights).filter(key => key !== 'default' && name.includes(key))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  if (!matches.length) fail('PRODUCT_WEIGHT_UNAVAILABLE', 409);
  return positive(weights[matches[0]], 'PRODUCT_WEIGHT_UNAVAILABLE', 1000);
}
function resolveCatalogItems(requestItems, products, config, currency, requireWeights=true) {
  if (!Array.isArray(requestItems) || !requestItems.length || requestItems.length > 100) fail('INVALID_SHIPPING_ITEMS');
  const resolved = requestItems.map(item => {
    if (!item || typeof item !== 'object') fail('INVALID_SHIPPING_ITEMS');
    const matches = products.filter(p => item.sku ? typeof p.sku === 'string' && p.sku.trim() && sku(p.sku) === sku(item.sku)
      : item.id !== undefined ? String(p.id) === String(item.id)
      : String(p.name || '').toLowerCase() === String(item.name || '').toLowerCase());
    if (matches.length !== 1) fail('SHIPPING_PRODUCT_UNAVAILABLE', 409);
    const p = matches[0];
    if ((currency === 'USD' ? p.soldOutEn : p.soldOutEs) === true) fail('SHIPPING_PRODUCT_UNAVAILABLE', 409);
    return {...canonicalItems([{sku: p.sku, qty: item.qty ?? item.quantity}])[0], weight:requireWeights?productWeight(p, config):0};
  });
  return {items: canonicalItems(resolved), rawWeight: resolved.reduce((total, p) => total + p.weight * p.qty, 0)};
}
function confirmedPackages(items, rawWeight, destination, config) {
  const matches = (config.packageProfiles || []).filter(p => p.confirmed === true && p.country === destination.country
    && JSON.stringify(canonicalItems(p.items)) === JSON.stringify(items));
  if (matches.length !== 1) fail('PACKAGE_PROFILE_REQUIRED', 409);
  const packages = packagesOf(matches[0].packages);
  if (packages.reduce((total, p) => total + p.weight * p.amount, 0) + 0.000001 < rawWeight) fail('PACKAGE_WEIGHT_BELOW_PRODUCTS', 409);
  return packages;
}
function normalizeRate(rate, carrier, currency) {
  if (!rate || rate.currency !== currency) return null;
  // Automatic checkout supports door-to-door delivery only. Provider descriptions
  // for branch modes can conflict, so exclude both modes without inferring service
  // suffixes. Missing dropOff remains compatible with existing provider responses.
  const dropOff=rate.dropOff == null ? null : Number(rate.dropOff);
  if(dropOff===1 || dropOff===2)return null;
  try {
    // Only a provider total is accepted; a base amount/price can omit surcharges.
    const value = rate.total_price ?? rate.totalPrice;
    if (rate.carrier !== undefined && String(rate.carrier).trim().toLowerCase() !== carrier.toLowerCase()) return null;
    const price = cents(value) / 100;
    const service = codeOf(rate.service ?? rate.serviceCode ?? rate.carrier_service_code);
    const estimate = rate.deliveryEstimate ?? rate.delivery_days ?? rate.deliveryDays ?? rate.estimated_delivery;
    if (!['string', 'number'].includes(typeof estimate) || (typeof estimate === 'number' && (!Number.isFinite(estimate) || estimate < 0))) return null;
    const days = String(estimate).trim();
    if (!days || days.length > 150) return null;
    return {
      id: carrier + ':' + service, carrier: codeOf(carrier), service, price, currency, days,
      carrier_name: String(rate.carrierDescription || carrier).slice(0,150),
      service_name: String(rate.serviceDescription || rate.serviceName || service).slice(0,150),
      delivery_description: typeof rate.dropOffDescription==='string' ? rate.dropOffDescription.slice(0,150) : '',
      ...(Number.isInteger(dropOff) && dropOff>=0 && dropOff<=2 ? {drop_off:dropOff} : {})
    };
  } catch (_) { return null; }
}

async function getStoredShippingQuote(pool, orderId) {
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(orderId)) fail('INVALID_SHIPPING_ORDER');
  const primary = await pool.query('SELECT to_jsonb(m) AS order_data FROM mahjoy_orders m WHERE order_id=$1 LIMIT 1', [orderId]);
  const row = primary.rows[0] && primary.rows[0].order_data;
  if (row && row.shipping_quote) {
    const stored = storedOrder(row.shipping_quote, row, false);
    const payment = await pool.query('SELECT to_jsonb(o) AS order_data FROM web_orders o WHERE node_id=31 AND order_id=$1 LIMIT 1', [orderId]);
    const paid = payment.rows[0] && payment.rows[0].order_data;
    if (!paid || !paid.paid_at || !paid.transaction_id || !PAID_STATUSES.has(paid.status)) return stored;
    let actualItems = paid.items || paid.cart;
    if (typeof actualItems === 'string') {
      try { actualItems = JSON.parse(actualItems); } catch (_) { fail('STORED_SHIPPING_PAYMENT_MISMATCH', 409); }
    }
    actualItems = Array.isArray(actualItems) ? actualItems.filter(i => i.sku || !/^(env[ií]o|shipping)$/i.test(String(i.name || '').trim())) : [];
    const paidAddress = orderAddress(paid);
    const country = paid.shipping_country || paidAddress.country || (paid.payment_method === 'centumpay' ? 'MX' : '');
    const postalCode = paid.shipping_cp || paidAddress.postalCode || paidAddress.cp || '';
    if (JSON.stringify(canonicalItems(actualItems)) !== JSON.stringify(stored.snapshot.items)
      || cents(Number(paid.shipping_cost)) !== cents(stored.snapshot.price)
      || postalCode !== stored.snapshot.destination.postalCode || country !== stored.snapshot.destination.country
      || (paid.currency && paid.currency !== stored.snapshot.currency)
      || (paid.payment_method === 'centumpay' && stored.snapshot.currency !== 'MXN')) fail('STORED_SHIPPING_PAYMENT_MISMATCH', 409);
    // Prefer the verified payment's full address, falling back to the same-CP checkout
    // address only when the payment row has no street (older webhook records).
    const source = paid.shipping_street || paidAddress.street ? paid : row;
    return storedOrder(row.shipping_quote, {...source,shipping_country:country}, true);
  }
  const schema = await pool.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mahjoy_paypal_checkouts' AND column_name='shipping_quote') AS ready");
  if (!schema.rows[0] || !schema.rows[0].ready) return null;
  const fallback = await pool.query('SELECT c.shipping_quote, to_jsonb(o) AS order_data, s.capture_id FROM mahjoy_paypal_checkouts c LEFT JOIN mahjoy_paypal_sales s ON s.paypal_order_id=c.order_id LEFT JOIN web_orders o ON o.id=s.web_order_id AND o.node_id=31 WHERE c.order_id=$1 LIMIT 1', [orderId]);
  const found = fallback.rows[0];
  if (!found || !found.shipping_quote) return null;
  const order = found.order_data || {};
  return storedOrder(found.shipping_quote, order, !!found.capture_id && !!order.paid_at && PAID_STATUSES.has(order.status));
}
function storedOrder(value, row, paid) {
  let snapshot;
  try { snapshot = typeof value === 'string' ? JSON.parse(value) : clone(value); } catch (_) { fail('INVALID_STORED_SHIPPING_QUOTE', 409); }
  snapshot = validateSnapshot(snapshot);
  const address = orderAddress(row);
  const street = row.shipping_street || address.street || address.address_line_1 || '';
  const interior = row.shipping_interior || address.interior || address.street2 || '';
  const destination = {
    name: [row.customer_name, row.customer_lastname].filter(Boolean).join(' '),
    email: row.customer_email || '', phone: row.customer_phone || '',
    street: street + (interior ? ', ' + interior : ''), number: row.shipping_number || address.number || 'S/N',
    district: row.shipping_neighborhood || address.neighborhood || '', city: row.shipping_city || address.city || '',
    state: row.shipping_state || address.state || '', country: row.shipping_country || address.country || '',
    postalCode: row.shipping_cp || address.postalCode || address.cp || ''
  };
  return {snapshot, paid, destination};
}
function orderAddress(row) {
  const value = row.shipping_address;
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; } catch (_) {}
  }
  fail('INVALID_STORED_SHIPPING_ADDRESS', 409);
}

function shipmentStore(pool) {
  return {
    async withLock(orderId, operation) {
      const client = await pool.connect();
      let locked = false;
      try {
        await client.query('SELECT pg_advisory_lock(hashtext($1))', ['mahjoy-shipping:' + orderId]);
        locked = true;
        await client.query("CREATE TABLE IF NOT EXISTS mahjoy_shipping_labels (order_id TEXT PRIMARY KEY, quote_hash TEXT NOT NULL, status TEXT NOT NULL, result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
        return await operation({
          client,
          async read() { const result = await client.query('SELECT quote_hash,status,result FROM mahjoy_shipping_labels WHERE order_id=$1', [orderId]); return result.rows[0]; },
          async reserve(hash) { await client.query("INSERT INTO mahjoy_shipping_labels(order_id,quote_hash,status) VALUES($1,$2,'pending')", [orderId, hash]); },
          async uncertain(result) { await client.query("UPDATE mahjoy_shipping_labels SET result=$2::jsonb,updated_at=NOW() WHERE order_id=$1", [orderId, JSON.stringify(result)]); },
          async complete(result) { await client.query("UPDATE mahjoy_shipping_labels SET status='complete',result=$2::jsonb,updated_at=NOW() WHERE order_id=$1", [orderId, JSON.stringify(result)]); }
        });
      } finally {
        try {
          if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['mahjoy-shipping:' + orderId]);
        } finally { client.release(); }
      }
    }
  };
}

function createShippingQuoteService(options) {
  const {config, origins, apiKey, fetcher = fetch, catalogBase = 'https://proax.app'} = options;
  const now = options.now || Date.now;
  const signing = {secret: options.signingSecret, now};
  const apiBase = String(options.apiBase || config.envia.apiUrl).replace(/\/$/, '');
  async function getJson(url, request) {
    const response = await fetcher(url, {...request, signal: AbortSignal.timeout(12000)});
    if (!response.ok) fail('SHIPPING_PROVIDER_UNAVAILABLE', 502);
    const data = await response.json();
    return data;
  }
  async function catalog(items) {
    const data = await getJson(catalogBase + '/api/public/mahjoy/catalog/products?checkout=' + now(), {cache:'no-store'});
    let products = data.products;
    if (!Array.isArray(products) || !products.length) fail('SHIPPING_CATALOG_UNAVAILABLE', 503);
    if (items.some(i => /^bundle-/i.test(String(i.sku || i.id || '')))) {
      const data = await getJson(catalogBase + '/api/public/mahjoy/bundles', {cache:'no-store'});
      const bundles = Array.isArray(data) ? data : data.bundles;
      if (!Array.isArray(bundles)) fail('SHIPPING_CATALOG_UNAVAILABLE', 503);
      products = products.concat(bundles.map(b => ({...b, id:'bundle-' + b.id, sku:'BUNDLE-' + b.id})));
    }
    return products;
  }
  async function rates(payload, carrier, currency) {
    if (typeof apiKey !== 'string' || !apiKey) fail('SHIPPING_PROVIDER_UNAVAILABLE', 503);
    const data = await getJson(apiBase + '/ship/rate/', {
      method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + apiKey},
      body:JSON.stringify({...payload, shipment:{type:1, carrier}})
    });
    if (data.meta !== 'rate' || !Array.isArray(data.data)) fail('SHIPPING_PROVIDER_UNAVAILABLE', 502);
    return data.data.map(rate => normalizeRate(rate, carrier, currency)).filter(Boolean);
  }
  async function quote(body) {
    secretOf(signing);
    const destination = destinationOf(body);
    const currency = currencyOf(body.currency || (destination.country === 'US' ? 'USD' : 'MXN'), destination.country);
    if (!Array.isArray(body.items) || !body.items.length) fail('INVALID_SHIPPING_ITEMS');
    const products = await catalog(body.items);
    const resolved = resolveCatalogItems(body.items, products, config, currency,!options.getPackingPlan);
    let packages,packingMetadata={};
    if(options.getPackingPlan){
      const plan=await options.getPackingPlan({items:resolved.items,country:destination.country});
      if(plan.configured){
        packages=packagesOf(plan.packages);
        packingMetadata={packing_revision:plan.revision,packing:plan.packing,physical_items:plan.physicalItems};
      }
    }
    if(!packages){
      const weighted=options.getPackingPlan?resolveCatalogItems(body.items,products,config,currency):resolved;
      packages=confirmedPackages(weighted.items,weighted.rawWeight,destination,config);
    }
    const origin = originOf(options.getOrigin ? options.getOrigin(destination.country) : origins[destination.country]);
    if (origin.country !== destination.country) fail('INVALID_SHIPPING_ORIGIN');
    const payload = {
      origin, destination:{
        name:'Cliente', phone:destination.country === 'US' ? '5551234567' : '5500000000',
        street:'Street', number:'1', district:destination.country === 'US' ? '' : 'Colonia',
        city:'City', state:destination.country === 'US' ? 'TX' : 'MX', ...destination
      },
      packages, settings:{currency}
    };
    const carriers = config.carriersByCountry && config.carriersByCountry[destination.country];
    if (!Array.isArray(carriers) || !carriers.length) fail('SHIPPING_PROVIDER_UNAVAILABLE', 503);
    const results = await Promise.allSettled(carriers.map(carrier => rates(payload, codeOf(carrier), currency)));
    const quotes = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value).sort((a,b) => a.price - b.price);
    if (!quotes.length) fail('SHIPPING_RATES_UNAVAILABLE', 503);
    for (const rate of quotes) {
      const snapshot = {version:VERSION, expires_at:now() + TTL_MS, items:resolved.items, destination,
        origin, packages, carrier:rate.carrier, service:rate.service, price:rate.price, currency,
        carrier_name:rate.carrier_name, service_name:rate.service_name, delivery_description:rate.delivery_description,
        ...(rate.drop_off!==undefined ? {drop_off:rate.drop_off} : {}),...packingMetadata};
      rate.quote_token = signShippingQuote(snapshot, signing);
      rate.expires_at = snapshot.expires_at;
    }
    const cheapest = quotes[0];
    return {quotes, currency, cheapest_rate:cheapest.price, shipping_cost:cheapest.price,
      cheapest_carrier:cheapest.carrier, cheapest_service:cheapest.service, cheapest_days:cheapest.days};
  }
  async function generate(body) {
    const orderId = body.orderId;
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(orderId)) fail('INVALID_SHIPPING_ORDER');
    if (typeof options.getStoredShippingQuote !== 'function' || !options.store) fail('SHIPPING_FULFILLMENT_UNAVAILABLE', 503);
    return options.store.withLock(orderId, async record => {
      const stored = await options.getStoredShippingQuote(orderId, record.client);
      if (!stored || stored.paid !== true) fail('SHIPPING_PAYMENT_REQUIRED', 409);
      const snapshot = validateSnapshot(clone(stored.snapshot));
      const destination = clone(stored.destination || {});
      if (!['MX','US'].includes(destination.country)) fail('SHIPPING_ADDRESS_REQUIRED', 409);
      const actual = destinationOf(destination);
      if (actual.postalCode !== snapshot.destination.postalCode || actual.country !== snapshot.destination.country) fail('SHIPPING_DESTINATION_CHANGED', 409);
      for (const key of ['name','phone','street','city','state']) {
        if (typeof destination[key] !== 'string' || !destination[key].trim()) fail('SHIPPING_ADDRESS_REQUIRED', 409);
      }
      if (body.destination !== undefined) {
        const supplied = destinationOf(body.destination);
        if (supplied.postalCode !== actual.postalCode || supplied.country !== actual.country) fail('SHIPPING_DESTINATION_CHANGED', 409);
      }
      if ((body.carrier && body.carrier !== snapshot.carrier) || (body.service && body.service !== snapshot.service)
        || body.packageInfo !== undefined || body.packages !== undefined) fail('SHIPPING_QUOTE_CHANGED', 409);
      const hash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      const existing = await record.read();
      if (existing) {
        if (existing.quote_hash !== hash) fail('SHIPPING_QUOTE_CHANGED', 409);
        if (existing.status === 'complete' && existing.result) return existing.result;
        fail('SHIPPING_LABEL_STATUS_PENDING', 409);
      }
      const payload = {origin:snapshot.origin, destination, packages:snapshot.packages,
        settings:{currency:snapshot.currency}, shipment:{type:1,carrier:snapshot.carrier,service:snapshot.service}};
      const current = (await rates(payload, snapshot.carrier, snapshot.currency)).find(q => q.service === snapshot.service);
      if (!current) fail('SHIPPING_RATES_UNAVAILABLE', 409);
      if (cents(current.price) > cents(snapshot.price)) fail('SHIPPING_RATE_CHANGED', 409);
      await record.reserve(hash);
      let data;
      try {
        data = await getJson(apiBase + '/ship/generate/', {
          method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer ' + apiKey},
          body:JSON.stringify({...payload, settings:{...payload.settings,printFormat:'PDF',printSize:'STOCK_4X6'}})
        });
      } catch (_) { fail('SHIPPING_LABEL_STATUS_PENDING', 503); }
      if (data.meta !== 'generate' || !Array.isArray(data.data) || !data.data.length) fail('SHIPPING_LABEL_STATUS_PENDING', 503);
      const shipment = data.data[0];
      const trackingNumbers = shipment.trackingNumbers || [shipment.trackingNumber || shipment.tracking || shipment.carrier_tracking_number].filter(Boolean);
      if (!Array.isArray(trackingNumbers) || !trackingNumbers.length) fail('SHIPPING_LABEL_STATUS_PENDING', 503);
      let labelCost;
      try {
        labelCost = cents(shipment.total_price ?? shipment.totalPrice) / 100;
        if (String(shipment.carrier || '').toLowerCase() !== snapshot.carrier.toLowerCase()
          || shipment.service !== snapshot.service || shipment.currency !== snapshot.currency
          || cents(labelCost) > cents(snapshot.price)) fail('SHIPPING_LABEL_STATUS_PENDING', 503);
      } catch (_) {
        if (record.uncertain) await record.uncertain({orderId,trackingNumbers,requiresReview:true,
          carrier:shipment.carrier || null,service:shipment.service || null,
          currency:shipment.currency || null,totalPrice:shipment.total_price ?? shipment.totalPrice ?? null});
        fail('SHIPPING_LABEL_STATUS_PENDING', 503);
      }
      const result = {ok:true, orderId, trackingNumber:trackingNumbers[0], trackingNumbers,
        carrier:snapshot.carrier, service:snapshot.service,
        label_cost:labelCost,currency:snapshot.currency,
        labelUrl:shipment.label || shipment.labelUrl || null, estimatedDelivery:shipment.estimated_delivery || null};
      await record.complete(result);
      return result;
    });
  }
  return {quote, generate};
}

module.exports = {
  canonicalItems, productWeight, resolveCatalogItems, confirmedPackages, normalizeRate,
  signShippingQuote, verifyShippingQuote, verifyShippingQuoteSignature,
  getStoredShippingQuote, shipmentStore, createShippingQuoteService, TTL_MS
};
