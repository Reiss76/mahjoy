/**
 * MAH JOY — Custom server
 * Serves static files + handles CentumPay checkout proxy server-side
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { Pool } = require('pg');

// ─── Neon PostgreSQL Connection ───────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_x2RgNOqr1TSV@ep-sweet-dawn-aht8zmog-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const pool = new Pool({ 
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize orders table
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mahjoy_orders (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(100) UNIQUE NOT NULL,
        customer_name VARCHAR(100),
        customer_lastname VARCHAR(100),
        customer_email VARCHAR(255),
        customer_phone VARCHAR(50),
        shipping_street VARCHAR(255),
        shipping_interior VARCHAR(100),
        shipping_neighborhood VARCHAR(100),
        shipping_city VARCHAR(100),
        shipping_state VARCHAR(100),
        shipping_cp VARCHAR(20),
        shipping_cost DECIMAL(10,2),
        cart JSONB,
        status VARCHAR(50) DEFAULT 'checkout_started',
        source VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query('ALTER TABLE mahjoy_orders ADD COLUMN IF NOT EXISTS shipping_quote JSONB');
    console.log('[db] Orders table ready');
  } catch (err) {
    console.error('[db] Failed to init database:', err.message);
  }
}
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// CentumPay credentials from env
const CENTUMPAY_API_KEY    = process.env.CENTUMPAY_API_KEY;
const CENTUMPAY_API_SECRET = process.env.CENTUMPAY_API_SECRET;
const CENTUMPAY_TOTP_SECRET= process.env.CENTUMPAY_TOTP_SECRET;
const CENTUMPAY_API_HASH   = process.env.CENTUMPAY_API_HASH;
const CENTUMPAY_ENV        = (process.env.CENTUMPAY_ENV || 'prod').toLowerCase();

app.use(express.json({verify:(req,_res,buffer)=>{
  if(req.originalUrl.split('?')[0]==='/api/checkout/paypal/shipping-quote')req.rawBody=buffer.toString('utf8');
}}));
app.disable('x-powered-by');
app.use(require('./lib/web-security').operationsGuard);

// Administrative entry point: Proax handles authentication and existing roles.
// Register before language routing so the login also works for US visitors.
app.get(['/admin', '/admin.html', '/en/admin', '/en/admin.html'], (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Referrer-Policy', 'no-referrer');
  res.redirect(302, 'https://proax.app/login?next=%2Fn%2F31%2Finventory');
});

// ─── Geo-redirect: USA→English, Mexico→Spanish ───────────────────────────────

// Countries that should see English by default
const ENGLISH_COUNTRIES = ['US', 'GB', 'AU', 'CA', 'NZ', 'IE'];

// Get country from various headers (Railway/Cloudflare/Vercel)
function getCountryCode(req) {
  // Cloudflare
  if (req.headers['cf-ipcountry']) return req.headers['cf-ipcountry'].toUpperCase();
  // Vercel
  if (req.headers['x-vercel-ip-country']) return req.headers['x-vercel-ip-country'].toUpperCase();
  // Railway (via Cloudflare)
  if (req.headers['x-country']) return req.headers['x-country'].toUpperCase();
  // Fallback: check Accept-Language header
  const lang = req.headers['accept-language'] || '';
  if (lang.startsWith('en-US') || lang.startsWith('en-GB')) return 'US';
  if (lang.startsWith('es-MX') || lang.startsWith('es')) return 'MX';
  return null;
}

app.use((req, res, next) => {
  // Only redirect on root Spanish pages (not /en/)
  if (req.path.startsWith('/en/')) return next();
  
  // Skip if already has language preference cookie
  if (req.headers.cookie && req.headers.cookie.includes('mj_lang=')) return next();
  
  // Only redirect HTML pages
  if (!req.path.endsWith('.html') && req.path !== '/') return next();
  
  const country = getCountryCode(req);
  
  // If English-speaking country, redirect to /en/
  if (country && ENGLISH_COUNTRIES.includes(country)) {
    const enPath = req.path === '/' ? '/en/index.html' : '/en' + req.path;
    // Set cookie so we don't redirect again if they switch back
    res.cookie('mj_lang', 'en', { maxAge: 365 * 24 * 60 * 60 * 1000 });
    return res.redirect(302, enPath);
  }
  
  next();
});



// ─── CentumPay helpers ────────────────────────────────────────────────────────

function base32ToBuf(input) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const norm = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = '';
  for (const ch of norm) {
    const v = alpha.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function generateTotp(secret) {
  const key = base32ToBuf(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

// ─── CentumPay checkout endpoint ─────────────────────────────────────────────

app.post('/api/centumpay/checkout', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { 
      cart = [], 
      orderId,
      customer_name,
      customer_lastname,
      customer_email,
      customer_phone,
      shipping_street,
      shipping_interior,
      shipping_neighborhood,
      shipping_city,
      shipping_state,
      shipping_cp,
      shipping_cost,
      webSite,
      discount_code
    } = req.body;
    
    if (!cart.length) return res.status(400).json({ error: 'Cart vacío' });
    if(req.body.currency && req.body.currency!=='MXN')return res.status(409).json({error:'Card checkout is only available in MXN',error_code:'CARD_CURRENCY_UNAVAILABLE'});
    if([customer_name,customer_email,customer_phone,shipping_street,shipping_city,shipping_state].some(value=>typeof value!=='string' || !value.trim())) {
      return res.status(409).json({error:'Completa tus datos y dirección de envío antes de pagar.',error_code:'SHIPPING_ADDRESS_REQUIRED'});
    }
    const productQuote=await require('./lib/checkout-prices').resolveCheckoutQuote(PROAX_API_URL,{items:cart,currency:'MXN',discount_code},fetch);
    for(let n=0;n<cart.length;n++) {
      const shown=Number(cart[n].price);
      if(!Number.isFinite(shown) || Math.round(shown*100)!==Math.round(productQuote.items[n].unit_price*100)) {
        return res.status(409).json({error:'Los precios cambiaron. Actualiza el carrito y revisa el total.',error_code:'PRICE_MISMATCH'});
      }
    }
    const merchandise=productQuote.items.map(p=>({id:p.id,sku:p.sku,name:p.name,qty:p.qty,price:p.unit_price}));
    const shippingQuote=require('./lib/shipping-payment').verifyCardShipping({...req.body,cart:merchandise},require('./lib/shipping-quotes').verifyShippingQuote);

    // A checkout cannot overwrite a previously frozen quote or paid order.
    const myOrderId = 'mahjoy-'+crypto.randomUUID();

    // Build cart with shipping included
    const cartItems = merchandise.map(item => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      qty: Number(item.qty),
      price: Number(item.price)
    }));
    
    // Add shipping as cart item if present
    if (shippingQuote.price > 0) {
      cartItems.push({
        name: 'Envío',
        qty: 1,
        price: shippingQuote.price
      });
    }

    // Forward to Proax API with all customer data
    const universePayload = {
      orderId: myOrderId,
      cart: cartItems,
      customer_name: customer_name || '',
      customer_lastname: customer_lastname || '',
      customer_email: customer_email || '',
      customer_phone: customer_phone || '',
      shipping_street: shipping_street || '',
      shipping_interior: shipping_interior || '',
      shipping_neighborhood: shipping_neighborhood || '',
      shipping_city: shipping_city || '',
      shipping_state: shipping_state || '',
      shipping_cp: shipping_cp || '',
      shipping_cost: shippingQuote.price,
      shipping_quote: shippingQuote
    };

    // BACKUP: Save order data to file AND database BEFORE calling Proax
    const orderBackupData = {
      orderId: myOrderId,
      cart: merchandise,
      customer_name,
      customer_lastname,
      customer_email,
      customer_phone,
      shipping_street,
      shipping_interior,
      shipping_neighborhood,
      shipping_city,
      shipping_state,
      shipping_cp,
      shipping_cost: shippingQuote.price,
      shipping_quote: shippingQuote,
      status: 'checkout_started',
      source: 'centumpay',
      discount_code: discount_code || null
    };
    
    // Save to file (fallback)
    saveOrderToBackup(orderBackupData);
    
    // Save to Neon database (primary)
    if(!await saveOrderToDatabase(orderBackupData)) {
      return res.status(503).json({error:'Could not save the shipping quote. Please try again.',error_code:'SHIPPING_QUOTE_STORAGE_UNAVAILABLE'});
    }

    console.log('[centumpay] Forwarding to Proax:', JSON.stringify(universePayload, null, 2));

    const universeRes = await fetch('https://proax.app/api/payments/centumpay/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(universePayload),
    });

    const universeJson = await universeRes.json();
    console.log('[centumpay] Universe response:', JSON.stringify(universeJson, null, 2));

    if (universeJson.ok && universeJson.checkoutUrl) {
      return res.json({ 
        ok: true, 
        checkoutUrl: universeJson.checkoutUrl, 
        saleToken: universeJson.saleToken,
        orderId: universeJson.orderId || myOrderId 
      });
    } else {
      return res.status(502).json({ 
        error: 'Universe API error',
        error_code: universeJson.error_code || 'CHECKOUT_UNAVAILABLE',
        detail: universeJson 
      });
    }
  } catch (err) {
    if(err.code==='DISCOUNT_USD_ONLY')return res.status(403).json({error:err.message,error_code:err.code});
    if(/^SHIPPING_|^PACKAGE_PROFILE_/.test(err.code || err.message || ''))return res.status(409).json({error:err.code || err.message,error_code:err.code || err.message});
    console.error('[centumpay]', err);
    return res.status(500).json({ error: 'Error interno', detail: String(err) });
  }
});

app.options('/api/centumpay/checkout', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

// ─── Explicit routes ─────────────────────────────────────────────────────────
app.get('/cart', (req, res) => res.sendFile(path.join(__dirname, 'cart.html')));
app.get('/product', (req, res) => res.sendFile(path.join(__dirname, 'product.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(__dirname, 'checkout.html')));
app.get('/collab', (req, res) => res.sendFile(path.join(__dirname, 'collab.html')));
app.get('/mis-pedidos', (req, res) => res.sendFile(path.join(__dirname, 'mis-pedidos.html')));
app.get('/pedidos', (req, res) => res.sendFile(path.join(__dirname, 'mis-pedidos.html')));

// ─── Static files ─────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || require('./lib/web-security').publicAsset(req.path)) return next();
  res.status(404).end();
});
app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html',
}));

// NOTE: Catch-all route moved to END of file (after all API routes)

app.listen(PORT, () => {
  console.log(`MAH JOY server running on port ${PORT}`);
  
  // Start CentumPay polling after 10 seconds
  setTimeout(() => {
    if (typeof startPolling === 'function') {
      startPolling();
    }
  }, 10000);
});

// ─── Envia.com Shipping API ──────────────────────────────────────────────────

const ENVIA_API_KEY = process.env.ENVIA_API_KEY || 'c541f5b32442e1505448fbdcf85f6cc4ac132a273f148242b8159234fa34432c';
const ENVIA_API_URL = 'https://api.envia.com/ship/rate/';

// One shipping authority supplies signed rates and the same parcel for fulfillment.
const shippingConfig = require('./config/shipping');
const {
  createShippingQuoteService, getStoredShippingQuote, shipmentStore
} = require('./lib/shipping-quotes');
function shippingOrigin(country) {
  const configured = country === 'MX' ? shippingConfig.origin : shippingConfig.originUS;
  const completeOverride = process.env['ENVIA_ORIGIN_' + country + '_JSON'];
  let origin = configured;
  if (completeOverride) {
    try { origin = JSON.parse(completeOverride); }
    catch (_) { const error = new Error('INVALID_SHIPPING_ORIGIN'); error.code = error.message; error.status = 503; throw error; }
  }
  const postalOverride = country === 'MX' ? process.env.ENVIA_ORIGIN_CP : process.env.ENVIA_ORIGIN_CP_US;
  if (postalOverride && postalOverride !== origin.postalCode) {
    const error = new Error('SHIPPING_ORIGIN_MISMATCH'); error.code = error.message; error.status = 503; throw error;
  }
  return origin;
}
const shippingQuotes = createShippingQuoteService({
  config: shippingConfig, getOrigin: shippingOrigin, apiKey: ENVIA_API_KEY,
  getPackingPlan: require('./lib/proax-shipping-plan').createProaxShippingPlanProvider(process.env.PROAX_API_URL || 'https://proax.app'),
  apiBase: ENVIA_API_URL.replace('/ship/rate/', ''),
  getStoredShippingQuote: (orderId, client) => getStoredShippingQuote(client || pool, orderId),
  store: shipmentStore(pool)
});
require('./lib/paypal-native-shipping-rpc').registerPayPalNativeShippingRpc(app,shippingQuotes);
app.post('/api/shipping/quote', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json(await shippingQuotes.quote(req.body)); }
  catch (error) {
    res.status(error.status || 503).json({error: 'Could not verify shipping. Please try again.', error_code:error.code || 'SHIPPING_UNAVAILABLE', quotes:[]});
  }
});

// ─── Envia.com Shipment Creation ─────────────────────────────────────────────

const ENVIA_CREATE_URL = 'https://api.envia.com/ship/generate/';

// In-memory order storage (in production, use a database)
const pendingOrders = new Map();

// Proax API config
const PROAX_API_URL = process.env.PROAX_API_URL || 'https://proax.app';
const PROAX_NODE_ID = process.env.PROAX_NODE_ID || '31'; // Mahjoy node ID
const PROAX_API_KEY = process.env.PROAX_API_KEY || 'mj-secret-2024';

require('./lib/checkout-prices').registerCheckoutPrices(app, PROAX_API_URL);
let paypalReceipts;
require('./lib/paypal-checkout').registerPayPalCheckout(app, PROAX_API_URL, fetch, async orderId => {
  if(!paypalReceipts)throw new Error('PAYPAL_RECEIPT_UNAVAILABLE');
  await paypalReceipts.enqueue(orderId);
},undefined,{preflight:shippingQuotes.preflight});

// ─── Orders Backup (File Persistence) ─────────────────────────────────────────
const ORDERS_BACKUP_FILE = path.join(__dirname, 'data', 'orders-backup.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Load existing orders from backup file
function loadOrdersBackup() {
  try {
    if (fs.existsSync(ORDERS_BACKUP_FILE)) {
      const data = fs.readFileSync(ORDERS_BACKUP_FILE, 'utf8');
      const orders = JSON.parse(data);
      console.log(`[orders-backup] Loaded ${orders.length} orders from backup`);
      return orders;
    }
  } catch (err) {
    console.error('[orders-backup] Failed to load:', err.message);
  }
  return [];
}

// Save order to backup file
function saveOrderToBackup(orderData) {
  try {
    let orders = loadOrdersBackup();
    // Check if order already exists (by orderId)
    const existingIndex = orders.findIndex(o => o.orderId === orderData.orderId);
    if (existingIndex >= 0) {
      orders[existingIndex] = { ...orders[existingIndex], ...orderData, updatedAt: new Date().toISOString() };
    } else {
      orders.push({ ...orderData, createdAt: new Date().toISOString() });
    }
    fs.writeFileSync(ORDERS_BACKUP_FILE, JSON.stringify(orders, null, 2));
    console.log(`[orders-backup] Saved order ${orderData.orderId}`);
    return true;
  } catch (err) {
    console.error('[orders-backup] Failed to save:', err.message);
    return false;
  }
}

// Get all orders from backup
function getAllOrdersFromBackup() {
  return loadOrdersBackup();
}

// ─── Database Functions ───────────────────────────────────────────────────────
async function saveOrderToDatabase(orderData) {
  try {
    const result = await pool.query(`
      INSERT INTO mahjoy_orders (
        order_id, customer_name, customer_lastname, customer_email, customer_phone,
        shipping_street, shipping_interior, shipping_neighborhood, shipping_city, 
        shipping_state, shipping_cp, shipping_cost, cart, status, source, discount_code, shipping_quote
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (order_id) DO UPDATE SET
        status = CASE WHEN mahjoy_orders.status IN ('shipped','delivered') THEN mahjoy_orders.status ELSE EXCLUDED.status END,
        discount_code = COALESCE(EXCLUDED.discount_code, mahjoy_orders.discount_code),
        shipping_quote = COALESCE(mahjoy_orders.shipping_quote, EXCLUDED.shipping_quote),
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [
      orderData.orderId,
      orderData.customer_name || '',
      orderData.customer_lastname || '',
      orderData.customer_email || '',
      orderData.customer_phone || '',
      orderData.shipping_street || '',
      orderData.shipping_interior || '',
      orderData.shipping_neighborhood || '',
      orderData.shipping_city || '',
      orderData.shipping_state || '',
      orderData.shipping_cp || '',
      orderData.shipping_cost || 0,
      JSON.stringify(orderData.cart || []),
      orderData.status || 'checkout_started',
      orderData.source || 'web',
      orderData.discount_code || null,
      orderData.shipping_quote ? JSON.stringify(orderData.shipping_quote) : null
    ]);
    console.log(`[db] Saved order ${orderData.orderId} (id: ${result.rows[0]?.id})${orderData.discount_code ? ` Código: ${orderData.discount_code}` : ''}`);
    return true;
  } catch (err) {
    console.error('[db] Failed to save order:', err.message);
    return false;
  }
}

async function getOrdersFromDatabase(limit = 100) {
  try {
    const result = await pool.query(`
      SELECT * FROM mahjoy_orders 
      ORDER BY created_at DESC 
      LIMIT $1
    `, [limit]);
    return result.rows.map(row => {
      const cart = row.cart || [];
      const shippingCost = parseFloat(row.shipping_cost) || 0;
      const itemsTotal = cart.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (item.qty || 1)), 0);
      const total = itemsTotal + shippingCost;
      
      return {
        orderId: row.order_id,
        customer_name: row.customer_name,
        customer_lastname: row.customer_lastname,
        customer_email: row.customer_email,
        customer_phone: row.customer_phone,
        // Flat shipping fields for backward compatibility
        shipping_street: row.shipping_street,
        shipping_interior: row.shipping_interior,
        shipping_neighborhood: row.shipping_neighborhood,
        shipping_city: row.shipping_city,
        shipping_state: row.shipping_state,
        shipping_cp: row.shipping_cp,
        shipping_cost: shippingCost,
        // Shipping as object for "Mis Pedidos" page
        shipping: {
          name: `${row.customer_name || ''} ${row.customer_lastname || ''}`.trim(),
          street: row.shipping_street || '',
          neighborhood: row.shipping_interior || row.shipping_neighborhood || '',
          city: row.shipping_city || '',
          state: row.shipping_state || '',
          cp: row.shipping_cp || ''
        },
        cart: cart,
        items: cart, // Alias for compatibility
        total: total,
        amount: total,
        status: row.status,
        source: row.source,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
  } catch (err) {
    console.error('[db] Failed to get orders:', err.message);
    return [];
  }
}

async function getTodayOrdersFromDatabase() {
  try {
    const result = await pool.query(`
      SELECT * FROM mahjoy_orders 
      WHERE created_at >= CURRENT_DATE
      ORDER BY created_at DESC
    `);
    return result.rows.map(row => ({
      orderId: row.order_id,
      customer_name: row.customer_name,
      customer_lastname: row.customer_lastname,
      customer_email: row.customer_email,
      customer_phone: row.customer_phone,
      shipping_street: row.shipping_street,
      shipping_city: row.shipping_city,
      shipping_state: row.shipping_state,
      shipping_cp: row.shipping_cp,
      shipping_cost: parseFloat(row.shipping_cost),
      cart: row.cart,
      status: row.status,
      createdAt: row.created_at
    }));
  } catch (err) {
    console.error('[db] Failed to get today orders:', err.message);
    return [];
  }
}

// Helper to update order in Proax
async function updateProaxOrder(orderId, updates) {
  try {
    await fetch(`${PROAX_API_URL}/api/inventory/${PROAX_NODE_ID}/web-orders/${orderId}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': PROAX_API_KEY
      },
      body: JSON.stringify(updates)
    });
    console.log(`[proax] Updated order ${orderId}:`, updates);
  } catch (err) {
    console.warn(`[proax] Failed to update order ${orderId}:`, err.message);
  }
}

// Save order to in-memory AND persist to Proax DB
app.post('/api/orders/save', async (req, res) => {
  try {
    const { orderId, customer, shipping, items, carrier, shippingCost, total } = req.body;
    
    if (!orderId || !shipping || !customer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const orderData = {
      orderId,
      customer,
      shipping,
      items,
      carrier,
      shippingCost,
      total,
      status: 'pending_payment',
      createdAt: new Date().toISOString()
    };
    
    // Save to in-memory (for immediate use)
    pendingOrders.set(orderId, orderData);
    
    // Persist to Proax database
    try {
      await fetch(`${PROAX_API_URL}/api/inventory/${PROAX_NODE_ID}/web-orders`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': PROAX_API_KEY
        },
        body: JSON.stringify({
          order_id: orderId,
          customer_name: customer?.name || '',
          customer_lastname: customer?.lastname || '',
          customer_email: customer?.email || '',
          customer_phone: customer?.phone || '',
          shipping_street: shipping?.street || '',
          shipping_interior: shipping?.interior || '',
          shipping_neighborhood: shipping?.neighborhood || '',
          shipping_city: shipping?.city || '',
          shipping_state: shipping?.state || '',
          shipping_cp: shipping?.cp || shipping?.postalCode || '',
          items: items || [],
          subtotal: (total || 0) - (shippingCost || 0),
          shipping_cost: shippingCost || 0,
          total: total || 0,
          carrier: carrier || '',
          status: 'pending_payment'
        })
      });
      console.log(`[orders] Persisted order ${orderId} to Proax`);
    } catch (proaxErr) {
      console.warn(`[orders] Failed to persist to Proax (non-critical):`, proaxErr.message);
    }
    
    console.log(`[orders] Saved order ${orderId}`);
    
    // Send order confirmation email
    sendOrderReceivedEmail(orderData);
    
    res.json({ ok: true, orderId });
  } catch (err) {
    console.error('[orders] Save error:', err);
    res.status(500).json({ error: 'Failed to save order' });
  }
});

// Get orders by email (for "Mis Pedidos" page)
app.get('/api/orders/by-email', async (req, res) => {
  try {
    const email = req.query.email?.toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    let allOrders = [];
    
    // 1. First, check Neon PostgreSQL database (primary source for PayPal Express orders)
    try {
      const dbResult = await pool.query(`
        SELECT * FROM mahjoy_orders 
        WHERE LOWER(customer_email) = $1
        ORDER BY created_at DESC
      `, [email]);
      
      const dbOrders = dbResult.rows.map(row => {
        const cart = row.cart || [];
        const shippingCost = parseFloat(row.shipping_cost) || 0;
        const itemsTotal = cart.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (item.qty || 1)), 0);
        const total = itemsTotal + shippingCost;
        
        return {
          orderId: row.order_id,
          status: row.status,
          total: total,
          items: cart,
          createdAt: row.created_at,
          trackingNumber: row.tracking_number,
          shipping: {
            street: row.shipping_street,
            city: row.shipping_city,
            state: row.shipping_state,
            cp: row.shipping_cp,
            cost: shippingCost
          }
        };
      });
      
      allOrders = [...allOrders, ...dbOrders];
      console.log(`[orders/by-email] Found ${dbOrders.length} orders in Neon for ${email}`);
    } catch (dbErr) {
      console.error('[orders/by-email] Neon query error:', dbErr.message);
    }

    // 2. Also check Proax API
    try {
      const proaxRes = await fetch(`${PROAX_API_URL}/api/inventory/${PROAX_NODE_ID}/web-orders?email=${encodeURIComponent(email)}`, {
        headers: { 'Authorization': `Bearer ${PROAX_API_KEY}` }
      });
      
      if (proaxRes.ok) {
        const data = await proaxRes.json();
        const proaxOrders = (data.orders || data || []).map(o => ({
          orderId: o.order_id || o.orderId,
          status: o.status,
          total: o.total,
          items: o.items || [],
          createdAt: o.created_at || o.createdAt,
          trackingNumber: o.tracking_number || o.trackingNumber,
          shipping: o.shipping
        }));
        
        // Add Proax orders that aren't already in the list (by orderId)
        const existingIds = new Set(allOrders.map(o => o.orderId));
        const newOrders = proaxOrders.filter(o => !existingIds.has(o.orderId));
        allOrders = [...allOrders, ...newOrders];
        console.log(`[orders/by-email] Found ${proaxOrders.length} orders in Proax for ${email}`);
      }
    } catch (proaxErr) {
      console.error('[orders/by-email] Proax fetch error:', proaxErr.message);
    }
    
    // Sort by date (newest first)
    allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json({ orders: allOrders });
  } catch (err) {
    console.error('[orders] Fetch by email error:', err);
    res.status(500).json({ error: 'Failed to fetch orders', orders: [] });
  }
});

// Verified PayPal payments use a durable queue and the signed Proax integration.
paypalReceipts=require('./lib/paypal-sync').registerPayPalSync(app, pool, PROAX_API_URL, async order => {
  const saved = await saveOrderToDatabase({
    ...order, orderId: order.order_id, cart: order.items, status: 'paid', source: 'paypal'
  });
  if (!saved) throw new Error('Could not persist verified order locally');
  await pool.query('UPDATE mahjoy_orders SET inventory_deducted_at=COALESCE(inventory_deducted_at,now()) WHERE order_id=$1',[order.order_id]);
});

// Send "order received" email when checkout is submitted
async function sendOrderReceivedEmail(order) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log('[email] Resend API key not configured, skipping email');
    return false;
  }

  const email = order.customer?.email;
  if (!email) {
    console.log('[email] No customer email, skipping');
    return false;
  }

  const itemsList = (order.items || [])
    .map(i => `<tr><td style="padding:8px 0;border-bottom:1px solid #f0e4ec;">${i.name}</td><td style="padding:8px 0;border-bottom:1px solid #f0e4ec;text-align:center;">x${i.qty || 1}</td><td style="padding:8px 0;border-bottom:1px solid #f0e4ec;text-align:right;color:#6B0F2A;font-weight:600;">$${(i.price || 0).toFixed(2)} MXN</td></tr>`)
    .join('');

  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #fdf8fb;">
      <div style="text-align: center; margin-bottom: 30px;">
        <img src="https://www.playmahjoy.com/images/logo-mahjoy-horizontal.png" alt="MAH JOY" style="height: 40px;">
      </div>
      
      <div style="background: #fff; border-radius: 16px; padding: 30px; box-shadow: 0 2px 10px rgba(107,15,42,0.08);">
        <h1 style="color: #6B0F2A; font-size: 24px; margin: 0 0 10px 0; text-align: center;">¡Recibimos tu pedido!</h1>
        <p style="color: #999; font-size: 14px; text-align: center; margin: 0 0 25px 0;">Pedido #${order.orderId}</p>
        
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          Hola <strong>${order.customer?.name || ''}</strong>,
        </p>
        
        <p style="color: #333; font-size: 16px; line-height: 1.6;">
          Hemos recibido tu pedido y está pendiente de pago. Una vez confirmado el pago, comenzaremos a preparar tu envío.
        </p>
        
        <div style="background: #fdf8fb; border-radius: 12px; padding: 20px; margin: 25px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="color: #999; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">
                <th style="text-align: left; padding-bottom: 10px;">Producto</th>
                <th style="text-align: center; padding-bottom: 10px;">Cant.</th>
                <th style="text-align: right; padding-bottom: 10px;">Precio</th>
              </tr>
            </thead>
            <tbody>
              ${itemsList}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="padding-top: 15px; font-weight: bold; color: #6B0F2A;">Total</td>
                <td style="padding-top: 15px; text-align: right; font-weight: bold; color: #6B0F2A; font-size: 18px;">$${(order.total || 0).toFixed(2)} MXN</td>
              </tr>
            </tfoot>
          </table>
        </div>
        
        <div style="background: #fff8e1; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #f57c00; font-size: 14px;">
            ⏳ <strong>Pendiente de pago</strong> — Si ya realizaste el pago, lo confirmaremos pronto.
          </p>
        </div>
        
        <div style="margin-top: 25px;">
          <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0;">
            <strong>Envío a:</strong><br>
            ${order.shipping?.street || ''}${order.shipping?.interior ? ', ' + order.shipping.interior : ''}<br>
            ${order.shipping?.neighborhood || ''}<br>
            ${order.shipping?.city || ''}, ${order.shipping?.state || ''} ${order.shipping?.cp || ''}
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 30px;">
          <a href="https://www.playmahjoy.com/mis-pedidos.html" 
             style="display: inline-block; background: #6B0F2A; color: #fff; text-decoration: none; padding: 14px 30px; border-radius: 30px; font-weight: 600; font-size: 14px;">
            Ver mis pedidos
          </a>
        </div>
      </div>
      
      <p style="color: #999; font-size: 12px; text-align: center; margin-top: 30px;">
        ¿Preguntas? Contáctanos en info@playmahjoy.com<br>
        <a href="https://www.playmahjoy.com" style="color: #C76BA4;">www.playmahjoy.com</a>
      </p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MAH JOY <pedidos@playmahjoy.com>',
        to: email,
        subject: `📦 Recibimos tu pedido #${order.orderId}`,
        html: html
      })
    });

    const result = await response.json();
    if (response.ok) {
      console.log(`[email] ✅ Order received email sent to ${email}`);
      return true;
    } else {
      console.error(`[email] ❌ Failed:`, result);
      return false;
    }
  } catch (err) {
    console.error('[email] Error:', err);
    return false;
  }
}

// Send admin notification email when new order comes in
async function sendAdminOrderNotification(order) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL = process.env.ADMIN_ORDER_EMAIL || 'info@playmahjoy.com';
  
  if (!RESEND_API_KEY) {
    console.log('[email] Resend API key not configured, skipping admin notification');
    return false;
  }

  const items = order.items || order.cart || [];
  const shippingCost = order.shipping_cost || order.shipping?.cost || 0;
  const itemsTotal = items.reduce((sum, i) => sum + ((i.price || 0) * (i.qty || 1)), 0);
  const total = order.total || (itemsTotal + shippingCost);
  
  const itemsList = items
    .map(i => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${i.name || '—'}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">×${i.qty || 1}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${((i.price || 0) * (i.qty || 1)).toLocaleString('es-MX')}</td></tr>`)
    .join('');

  const addr = order.shipping_street || order.shipping?.street || '';
  const interior = order.shipping_interior || order.shipping?.neighborhood || '';
  const city = order.shipping_city || order.shipping?.city || '';
  const state = order.shipping_state || order.shipping?.state || '';
  const cp = order.shipping_cp || order.shipping?.cp || '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #722F37; color: #fff; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="margin: 0; font-size: 20px;">🛒 Nueva Orden — MAH JOY</h1>
      </div>
      
      <div style="background: #fff; border: 1px solid #e0e0e0; border-top: none; padding: 25px; border-radius: 0 0 12px 12px;">
        <p style="margin: 0 0 5px; color: #722F37; font-size: 18px; font-weight: bold;">
          Pedido #${order.orderId}
        </p>
        <p style="margin: 0 0 20px; color: #888; font-size: 14px;">
          ${new Date().toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}
        </p>
        
        <div style="background: #d4edda; color: #155724; padding: 12px; border-radius: 8px; margin-bottom: 20px; font-weight: 600;">
          ✅ Pago confirmado — ${order.source || 'PayPal'}
        </div>
        
        <h3 style="color: #333; font-size: 14px; margin: 20px 0 10px; border-bottom: 2px solid #722F37; padding-bottom: 5px;">
          👤 CLIENTE
        </h3>
        <p style="margin: 0; color: #333; line-height: 1.6;">
          <strong>${order.customer_name || ''} ${order.customer_lastname || ''}</strong><br>
          📧 ${order.customer_email || '—'}<br>
          📱 ${order.customer_phone || '—'}
        </p>
        
        <h3 style="color: #333; font-size: 14px; margin: 20px 0 10px; border-bottom: 2px solid #722F37; padding-bottom: 5px;">
          🏠 DIRECCIÓN DE ENVÍO
        </h3>
        <p style="margin: 0; color: #333; line-height: 1.6; background: #f9f9f9; padding: 12px; border-radius: 8px;">
          ${addr}<br>
          ${interior ? interior + '<br>' : ''}
          ${city}, ${state}<br>
          CP ${cp}
        </p>
        
        <h3 style="color: #333; font-size: 14px; margin: 20px 0 10px; border-bottom: 2px solid #722F37; padding-bottom: 5px;">
          📦 PRODUCTOS
        </h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          ${itemsList}
          <tr style="background: #f9f9f9;">
            <td colspan="2" style="padding: 8px;">📦 Envío</td>
            <td style="padding: 8px; text-align: right;">$${shippingCost.toLocaleString('es-MX')}</td>
          </tr>
          <tr style="font-weight: bold; color: #722F37; font-size: 16px;">
            <td colspan="2" style="padding: 12px 8px;">TOTAL</td>
            <td style="padding: 12px 8px; text-align: right;">$${total.toLocaleString('es-MX')} MXN</td>
          </tr>
        </table>
        
        <div style="margin-top: 25px; text-align: center;">
          <a href="https://proax.app" style="display: inline-block; background: #722F37; color: #fff; text-decoration: none; padding: 12px 25px; border-radius: 8px; font-weight: 600;">
            Ver en Proax →
          </a>
        </div>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MAH JOY Orders <pedidos@playmahjoy.com>',
        to: ADMIN_EMAIL,
        subject: `🛒 Nueva orden #${order.orderId} — $${total.toLocaleString('es-MX')} MXN`,
        html: html
      })
    });

    const result = await response.json();
    if (response.ok) {
      console.log(`[email] ✅ Admin notification sent to ${ADMIN_EMAIL}`);
      return true;
    } else {
      console.error(`[email] ❌ Admin notification failed:`, result);
      return false;
    }
  } catch (err) {
    console.error('[email] Admin notification error:', err);
    return false;
  }
}

// Send payment confirmed email (when we detect payment)
async function sendOrderConfirmationEmail(order) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.log('[email] Resend API key not configured, skipping email');
    return false;
  }

  const email = order.customer?.email;
  if (!email) {
    console.log('[email] No customer email, skipping');
    return false;
  }

  const itemsList = (order.items || [])
    .map(i => `• ${i.name} x${i.qty || 1} - $${i.price?.toFixed(2) || '0'} MXN`)
    .join('\n');

  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #6B0F2A; font-size: 28px; margin: 0;">¡Gracias por tu compra!</h1>
      </div>
      
      <p style="color: #333; font-size: 16px; line-height: 1.6;">
        Hola <strong>${order.customer?.name || ''}</strong>,
      </p>
      
      <p style="color: #333; font-size: 16px; line-height: 1.6;">
        Tu pedido ha sido confirmado y estamos preparándolo para envío.
      </p>
      
      <div style="background: #FDF8FB; border-radius: 12px; padding: 20px; margin: 20px 0;">
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #999; text-transform: uppercase; letter-spacing: 1px;">
          Pedido #${order.orderId}
        </p>
        <div style="border-top: 1px solid #f0e4ec; padding-top: 15px; margin-top: 10px;">
          ${(order.items || []).map(i => `
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0e4ec;">
              <span style="color: #333;">${i.name} x${i.qty || 1}</span>
              <span style="color: #6B0F2A; font-weight: 600;">$${i.price?.toFixed(2) || '0'} MXN</span>
            </div>
          `).join('')}
          <div style="display: flex; justify-content: space-between; padding: 15px 0 0 0; font-size: 18px; font-weight: bold;">
            <span style="color: #6B0F2A;">Total</span>
            <span style="color: #6B0F2A;">$${order.total?.toFixed(2) || '0'} MXN</span>
          </div>
        </div>
      </div>
      
      ${order.trackingNumber ? `
        <div style="background: #E8F5E9; border-radius: 12px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0; color: #2E7D32; font-weight: 600;">
            📦 Número de rastreo: <strong>${order.trackingNumber}</strong>
          </p>
        </div>
      ` : ''}
      
      <div style="margin-top: 30px;">
        <p style="color: #333; font-size: 14px; line-height: 1.6;">
          <strong>Dirección de envío:</strong><br>
          ${order.shipping?.street || ''}${order.shipping?.interior ? ', ' + order.shipping.interior : ''}<br>
          ${order.shipping?.neighborhood || ''}<br>
          ${order.shipping?.city || ''}, ${order.shipping?.state || ''} ${order.shipping?.cp || ''}
        </p>
      </div>
      
      <div style="text-align: center; margin-top: 30px;">
        <a href="https://www.playmahjoy.com/mis-pedidos.html" 
           style="display: inline-block; background: #6B0F2A; color: #fff; text-decoration: none; padding: 14px 30px; border-radius: 30px; font-weight: 600; font-size: 14px;">
          Ver mis pedidos
        </a>
      </div>
      
      <p style="color: #999; font-size: 12px; text-align: center; margin-top: 40px;">
        ¿Preguntas? Contáctanos en info@playmahjoy.com o por WhatsApp<br>
        <a href="https://www.playmahjoy.com" style="color: #C76BA4;">www.playmahjoy.com</a>
      </p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'MAH JOY <pedidos@playmahjoy.com>',
        to: email,
        subject: `✨ ¡Pedido confirmado! #${order.orderId}`,
        html: html
      })
    });

    const result = await response.json();
    if (response.ok) {
      console.log(`[email] ✅ Confirmation sent to ${email}`);
      return true;
    } else {
      console.error(`[email] ❌ Failed:`, result);
      return false;
    }
  } catch (err) {
    console.error('[email] Error:', err);
    return false;
  }
}

// Generate only from a paid order's persisted, accepted shipping snapshot.
app.post('/api/shipping/create', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await shippingQuotes.generate(req.body);
    if (pendingOrders.has(result.orderId)) {
      const order = pendingOrders.get(result.orderId);
      order.status = 'shipped';
      order.trackingNumber = result.trackingNumber;
      order.labelUrl = result.labelUrl;
      order.shippedAt = new Date().toISOString();
      pendingOrders.set(result.orderId, order);
    }
    res.json(result);
  } catch (error) {
    res.status(error.status || 503).json({error:'Could not verify shipment. Please review the order.', error_code:error.code || 'SHIPPING_FULFILLMENT_UNAVAILABLE'});
  }
});

// ─── CentumPay Webhook ───────────────────────────────────────────────────────

app.post('/api/centumpay/webhook', (_req, res) => {
  // The existing authenticated polling worker verifies payments with CentumPay.
  // Unauthenticated notifications are advisory only and cannot change payment state.
  res.status(202).json({ok:true,status:'verification_pending'});
});

// Get order status
app.get('/api/orders/:orderId', (req, res) => {
  const order = pendingOrders.get(req.params.orderId);
  if (order) {
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order not found' });
  }
});

// List recent orders (from Neon database)
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await getOrdersFromDatabase(100);
    res.json({ orders, count: orders.length, source: 'neon' });
  } catch (err) {
    // Fallback to file backup
    const backupOrders = getAllOrdersFromBackup();
    res.json({ orders: backupOrders, count: backupOrders.length, source: 'file_backup' });
  }
});

// Get orders from today (from Neon database)
app.get('/api/orders/today', async (req, res) => {
  try {
    const orders = await getTodayOrdersFromDatabase();
    const today = new Date().toISOString().split('T')[0];
    res.json({ orders, count: orders.length, date: today, source: 'neon' });
  } catch (err) {
    res.json({ orders: [], count: 0, error: err.message });
  }
});

// Update order status (for admin panel)
app.patch('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, tracking_number } = req.body;
    
    const updates = [];
    const values = [];
    let paramCount = 1;
    
    if (status) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (tracking_number) {
      updates.push(`tracking_number = $${paramCount++}`);
      values.push(tracking_number);
    }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(orderId);
    
    await pool.query(`
      UPDATE mahjoy_orders 
      SET ${updates.join(', ')}
      WHERE order_id = $${paramCount}
    `, values);
    
    console.log(`[admin] Order ${orderId} updated: status=${status}, tracking=${tracking_number}`);
    res.json({ success: true, orderId, status, tracking_number });
  } catch (err) {
    console.error('[admin] Update order error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── CentumPay Polling (since they don't have webhooks) ──────────────────────

const processedTransactions = new Set();
const POLL_INTERVAL = 3 * 60 * 1000; // 3 minutes

async function pollCentumPayTransactions() {
  if (!CENTUMPAY_API_KEY || !CENTUMPAY_API_SECRET || !CENTUMPAY_TOTP_SECRET) {
    console.log('[poll] CentumPay not configured, skipping');
    return;
  }

  try {
    console.log('[poll] Checking CentumPay for new transactions...');
    
    const totp = generateTotp(CENTUMPAY_TOTP_SECRET);
    const authToken = crypto.createHmac('sha256', CENTUMPAY_API_SECRET)
      .update(`${CENTUMPAY_API_KEY}${totp}`, 'utf8').digest('hex');

    // Fetch recent transactions from CentumPay API
    const ecommerceUrl = CENTUMPAY_ENV === 'prod'
      ? 'https://ecommapi-centumpay.centum.mx/ecommerce'
      : 'https://test-ecommapi-centumpay.centum.mx/ecommerce';

    const payload = {
      group: 'wmx_api',
      method: 'get_transactions',
      token: authToken,
      api_key: CENTUMPAY_API_KEY,
      data: {
        limit: 20,
        status: 'approved'
      }
    };

    const response = await fetch(ecommerceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (result?.status?.code !== '0') {
      console.log('[poll] CentumPay API error or no transactions:', result?.status?.message || 'unknown');
      return;
    }

    const transactions = result?.payload || [];
    console.log(`[poll] Found ${transactions.length} approved transactions`);

    for (const tx of transactions) {
      const txId = tx.transaction_id || tx.id || tx.reference;
      const orderId = tx.my_id || tx.order_id || tx.reference;
      
      // Skip if already processed
      if (processedTransactions.has(txId)) {
        continue;
      }

      console.log(`[poll] New transaction: ${txId} for order ${orderId}`);
      processedTransactions.add(txId);

      // Find matching order
      const order = pendingOrders.get(orderId);
      
      if (order && order.status === 'pending_payment') {
        console.log(`[poll] Processing order ${orderId}...`);
        
        order.status = 'paid';
        order.paidAt = new Date().toISOString();
        order.transactionId = txId;
        pendingOrders.set(orderId, order);
        
        // Update Proax
        await updateProaxOrder(orderId, {
          status: 'paid',
          paid_at: order.paidAt,
          transaction_id: txId
        });

        // Create shipment if we have shipping data
        if (order.shipping && order.carrier) {
          try {
            console.log(`[poll] Creating shipment for ${orderId}...`);
            
            const shipRes = await fetch(`http://localhost:${PORT}/api/shipping/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-mahjoy-admin-key': process.env.MAHJOY_OPERATIONS_SECRET || process.env.PROAX_PAYPAL_SYNC_SECRET || '' },
              body: JSON.stringify({
                orderId: orderId,
                carrier: order.carrier,
                destination: {
                  name: order.customer?.name || order.shipping?.name,
                  email: order.customer?.email,
                  phone: order.shipping?.phone || order.customer?.phone,
                  street: order.shipping?.street,
                  neighborhood: order.shipping?.neighborhood,
                  city: order.shipping?.city,
                  state: order.shipping?.state,
                  postalCode: order.shipping?.cp || order.shipping?.postalCode
                }
              })
            });

            const shipData = await shipRes.json();

            if (shipData.ok) {
              console.log(`[poll] ✅ Shipment created! Tracking: ${shipData.trackingNumber}`);
              order.trackingNumber = shipData.trackingNumber;
              order.labelUrl = shipData.labelUrl;
              order.status = 'shipped';
              order.shippedAt = new Date().toISOString();
              pendingOrders.set(orderId, order);
              
              // Update Proax
              await updateProaxOrder(orderId, {
                status: 'shipped',
                tracking_number: shipData.trackingNumber,
                label_url: shipData.labelUrl,
                shipped_at: order.shippedAt
              });
              
              // Queue WhatsApp notification
              notifyAdmins(order, shipData.trackingNumber);
              // Send confirmation email to customer
              sendOrderConfirmationEmail(order);
            } else {
              console.error(`[poll] ❌ Shipment failed:`, shipData);
              // Still notify about the sale, even if shipment failed
              notifyAdmins(order, null);
              // Send confirmation email anyway
              sendOrderConfirmationEmail(order);
            }
          } catch (shipErr) {
            console.error(`[poll] Shipment error:`, shipErr);
          }
        } else {
          console.log(`[poll] Order ${orderId} paid but missing shipping data`);
        }
      } else if (order) {
        console.log(`[poll] Order ${orderId} already processed (status: ${order.status})`);
      } else {
        console.log(`[poll] Transaction ${txId} has no matching order (my_id: ${orderId})`);
      }
    }
  } catch (err) {
    console.error('[poll] Error polling CentumPay:', err);
  }
}

// Start polling after server is ready
let pollInterval;
function startPolling() {
  console.log(`[poll] Starting CentumPay polling every ${POLL_INTERVAL / 1000}s`);
  pollCentumPayTransactions(); // Initial poll
  pollInterval = setInterval(pollCentumPayTransactions, POLL_INTERVAL);
}

// Manual trigger endpoint (for testing)
app.post('/api/poll/trigger', async (req, res) => {
  await pollCentumPayTransactions();
  res.json({ ok: true, message: 'Poll triggered' });
});

// View processed transactions
app.get('/api/poll/processed', (req, res) => {
  res.json({ 
    count: processedTransactions.size,
    transactions: Array.from(processedTransactions).slice(-50)
  });
});

// Debug: Get raw CentumPay transactions
app.get('/api/poll/debug', async (req, res) => {
  try {
    const totp = generateTotp(CENTUMPAY_TOTP_SECRET);
    const authToken = crypto.createHmac('sha256', CENTUMPAY_API_SECRET)
      .update(`${CENTUMPAY_API_KEY}${totp}`, 'utf8').digest('hex');

    const ecommerceUrl = CENTUMPAY_ENV === 'prod'
      ? 'https://ecommapi-centumpay.centum.mx/ecommerce'
      : 'https://test-ecommapi-centumpay.centum.mx/ecommerce';

    const payload = {
      group: 'wmx_api',
      method: 'get_transactions',
      token: authToken,
      api_key: CENTUMPAY_API_KEY,
      data: { limit: 20 }
    };

    const response = await fetch(ecommerceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    res.json({
      env: CENTUMPAY_ENV,
      url: ecommerceUrl,
      response: result,
      pendingOrders: Array.from(pendingOrders.keys())
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// View pending orders
app.get('/api/orders/pending', (req, res) => {
  const orders = Array.from(pendingOrders.entries()).map(([id, order]) => ({
    orderId: id,
    status: order.status,
    createdAt: order.createdAt,
    customer: order.customer?.email,
    total: order.total
  }));
  res.json({ count: orders.length, orders });
});

// ─── Telegram Notifications ──────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8827648637:AAHm_XHtfcDhP2F6dk7u83v97p4lpMw8vUA';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-5458285985'; // Grupo "Envios Mahjoy"
const pendingNotifications = [];

async function sendTelegramNotification(order, trackingNumber) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[telegram] Bot token or chat ID not configured');
    return false;
  }

  const message = `🛒 *¡Nueva venta MAH JOY!*

📦 *Producto:* ${order.items?.map(i => i.name).join(', ') || 'N/A'}
💰 *Total:* $${order.total?.toFixed(2) || '0'} MXN
👤 *Cliente:* ${order.customer?.name || ''} ${order.customer?.lastname || ''}
📧 *Email:* ${order.customer?.email || 'N/A'}
📱 *Tel:* ${order.customer?.phone || order.shipping?.phone || 'N/A'}
📍 *Envío a:* ${order.shipping?.city || ''}, CP ${order.shipping?.cp || ''}
🏠 *Dirección:* ${order.shipping?.street || ''}${order.shipping?.interior ? ', ' + order.shipping.interior : ''}, ${order.shipping?.neighborhood || ''}
🚚 *Paquetería:* ${order.carrier || 'N/A'}
${trackingNumber ? `📋 *Tracking:* ${trackingNumber}` : ''}

✅ Pedido #${order.orderId}`;

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    
    const result = await response.json();
    if (result.ok) {
      console.log(`[telegram] ✅ Notification sent for order ${order.orderId}`);
      return true;
    } else {
      console.error(`[telegram] ❌ Failed:`, result);
      return false;
    }
  } catch (err) {
    console.error(`[telegram] Error:`, err);
    return false;
  }
}

async function notifyAdmins(order, trackingNumber) {
  // Send Telegram notification
  await sendTelegramNotification(order, trackingNumber);
  
  // Also queue for backup/logging
  pendingNotifications.push({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    orderId: order.orderId,
    createdAt: new Date().toISOString(),
    sent: true
  });
  
  console.log(`[notify] Sent notification for order ${order.orderId}`);
}

// Get pending notifications (for OpenClaw to poll and send via wacli)
app.get('/api/notifications/pending', (req, res) => {
  const pending = pendingNotifications.filter(n => !n.sent);
  res.json({ notifications: pending });
});

// Mark notification as sent
app.post('/api/notifications/sent', (req, res) => {
  const { id } = req.body;
  const notif = pendingNotifications.find(n => n.id === id);
  if (notif) {
    notif.sent = true;
    notif.sentAt = new Date().toISOString();
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: 'Notification not found' });
  }
});

// Manual test notification
app.post('/api/notifications/test', async (req, res) => {
  const testOrder = {
    orderId: 'test-' + Date.now(),
    items: [{ name: 'Golden Lotus Mat' }],
    total: 1374,
    customer: { name: 'Test', lastname: 'User', email: 'test@test.com', phone: '+525500000000' },
    shipping: { street: 'Av. Reforma 123', neighborhood: 'Juárez', city: 'CDMX', cp: '06600' },
    carrier: 'estafeta'
  };
  await notifyAdmins(testOrder, 'TEST123456');
  res.json({ ok: true, message: 'Test notification sent', chatId: TELEGRAM_CHAT_ID });
});

// Get bot updates to find chat ID
app.get('/api/telegram/updates', async (req, res) => {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Show current config
app.get('/api/telegram/config', (req, res) => {
  res.json({
    botConfigured: !!TELEGRAM_BOT_TOKEN,
    chatId: TELEGRAM_CHAT_ID || 'NOT SET - Add bot to group and check /api/telegram/updates'
  });
});

// ─── Catch-all route (MUST BE LAST) ──────────────────────────────────────────
// Serves index.html for any unmatched routes (SPA fallback)
app.get('*', (req, res) => {
  // Don't catch API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});
