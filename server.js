/**
 * MAH JOY — Custom server
 * Serves static files + handles CentumPay checkout proxy server-side
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// CentumPay credentials from env
const CENTUMPAY_API_KEY    = process.env.CENTUMPAY_API_KEY;
const CENTUMPAY_API_SECRET = process.env.CENTUMPAY_API_SECRET;
const CENTUMPAY_TOTP_SECRET= process.env.CENTUMPAY_TOTP_SECRET;
const CENTUMPAY_API_HASH   = process.env.CENTUMPAY_API_HASH;
const CENTUMPAY_ENV        = (process.env.CENTUMPAY_ENV || 'prod').toLowerCase();

app.use(express.json());

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
    if (!CENTUMPAY_API_KEY || !CENTUMPAY_API_SECRET || !CENTUMPAY_TOTP_SECRET || !CENTUMPAY_API_HASH) {
      return res.status(500).json({ error: 'CentumPay no configurado' });
    }

    const { cart = [], orderId, webSite } = req.body;
    if (!cart.length) return res.status(400).json({ error: 'Cart vacío' });

    const totp = generateTotp(CENTUMPAY_TOTP_SECRET);
    const authToken = crypto.createHmac('sha256', CENTUMPAY_API_SECRET)
      .update(`${CENTUMPAY_API_KEY}${totp}`, 'utf8').digest('hex');

    const subtotal = cart.reduce((acc, l) => acc + Number(l.price) * Number(l.qty), 0);
    const total = Number(subtotal.toFixed(2));
    const myOrderId = orderId || `mahjoy-${Date.now()}`;
    const site = webSite || `https://${req.headers.host}`;

    // Return URL after successful payment
    const returnUrl = `${site}/checkout.html?payment=success&order=${encodeURIComponent(myOrderId)}`;
    
    const payload = {
      group: 'wmx_api',
      method: 'get_token',
      token: authToken,
      api_key: CENTUMPAY_API_KEY,
      data: {
        web_site: site,
        return_url: returnUrl,
        success_url: returnUrl,
        callback_url: returnUrl,
        order_details: { wl_name: 'wl_centumpay', my_id: myOrderId },
        tx_info: {
          cart: {
            description: `Compra MAH JOY (${cart.length} producto${cart.length > 1 ? 's' : ''})`,
            concept: cart.map(l => ({ item: l.name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), cant: Number(l.qty), price: Number(l.price) })),
            discount: 0,
            subtotal,
            total,
          },
        },
      },
    };

    const ecommerceUrl = CENTUMPAY_ENV === 'prod'
      ? 'https://ecommapi-centumpay.centum.mx/ecommerce'
      : 'https://test-ecommapi-centumpay.centum.mx/ecommerce';

    const tokenRes = await fetch(ecommerceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const tokenJson = await tokenRes.json();
    if (tokenJson?.status?.code !== '0') {
      return res.status(502).json({ error: 'CentumPay rechazó la orden', centum: tokenJson });
    }

    const saleToken = Array.isArray(tokenJson?.payload)
      ? tokenJson.payload[0]?.token
      : tokenJson?.payload?.token || null;

    if (!saleToken) return res.status(502).json({ error: 'CentumPay no regresó token' });

    const checkoutBase = CENTUMPAY_ENV === 'prod'
      ? 'https://api-centumpay.centum.mx/CheckOut'
      : 'https://test-api-centumpay.centum.mx/CheckOut';

    const checkoutUrl = `${checkoutBase}?ApiKey=${encodeURIComponent(CENTUMPAY_API_KEY)}&Token=${encodeURIComponent(saleToken)}&Hash=${encodeURIComponent(CENTUMPAY_API_HASH)}`;

    return res.json({ ok: true, checkoutUrl, orderId: myOrderId });
  } catch (err) {
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

// ─── Static files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html',
}));

// Fallback: serve index.html for any unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
const ENVIA_ORIGIN_CP = process.env.ENVIA_ORIGIN_CP || '66278'; // Default: Monterrey
const ENVIA_API_URL = 'https://api.envia.com/ship/rate/';

app.post('/api/shipping/quote', async (req, res) => {
  if (!ENVIA_API_KEY) {
    return res.status(500).json({ error: 'Shipping not configured' });
  }

  const { destination, items } = req.body;
  
  if (!destination || destination.length !== 5) {
    return res.status(400).json({ error: 'Invalid postal code' });
  }

  try {
    // Calculate package dimensions based on items
    // Default: medium box for mahjong sets
    const weight = items?.reduce((sum, i) => sum + (i.weight || 2), 0) || 2;
    
    // Envia.com API requires full address structure
    const payload = {
      origin: {
        name: 'Mah Joy',
        company: 'Mah Joy',
        email: 'info@playmahjoy.com',
        phone: '5530395891',
        street: 'Av. Vasconcelos',
        number: '1000',
        district: 'Del Valle',
        city: 'San Pedro Garza García',
        state: 'NL',
        country: 'MX',
        postalCode: ENVIA_ORIGIN_CP
      },
      destination: {
        name: 'Cliente',
        phone: '5500000000',
        street: 'Calle',
        number: '1',
        district: 'Colonia',
        city: 'Ciudad',
        state: 'MX', // Will be determined from CP
        country: 'MX',
        postalCode: destination
      },
      packages: [{
        content: 'Mahjong Set',
        amount: 1,
        type: 'box',
        weight: weight,
        insurance: 0,
        declaredValue: 3000,
        weightUnit: 'KG',
        lengthUnit: 'CM',
        dimensions: {
          length: 40,
          width: 30,
          height: 15
        }
      }],
      shipment: {
        type: 1
      }
    };

    // Query multiple carriers in parallel
    const carriers = ['fedex', 'dhl', 'estafeta', 'paquetexpress'];
    
    const fetchCarrierQuotes = async (carrier) => {
      try {
        const carrierPayload = { ...payload, shipment: { ...payload.shipment, carrier } };
        const response = await fetch(ENVIA_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ENVIA_API_KEY}`
          },
          body: JSON.stringify(carrierPayload)
        });
        const data = await response.json();
        const rates = data.data || data || [];
        if (Array.isArray(rates)) {
          return rates.map(q => ({
            id: q.carrier_service_code || q.serviceCode || `${carrier}-${q.service}`,
            carrier: q.carrier || carrier,
            service: q.service || q.serviceName || 'Standard',
            days: q.delivery_days || q.deliveryDays || q.estimated_delivery || '2-5',
            price: parseFloat(q.total_price || q.totalPrice || q.amount || q.price || 0)
          })).filter(q => q.price > 0);
        }
        return [];
      } catch (e) {
        console.error(`Error fetching ${carrier}:`, e.message);
        return [];
      }
    };

    const allQuotes = await Promise.all(carriers.map(fetchCarrierQuotes));
    const quotes = allQuotes.flat().sort((a, b) => a.price - b.price);
    
    if (quotes.length > 0) {
      res.json({ quotes });
    } else {
      res.json({ error: 'No shipping options available' });
    }
  } catch (err) {
    console.error('Envia.com API error:', err);
    res.status(500).json({ error: 'Shipping calculation failed' });
  }
});

// ─── Envia.com Shipment Creation ─────────────────────────────────────────────

const ENVIA_CREATE_URL = 'https://api.envia.com/ship/generate/';

// In-memory order storage (in production, use a database)
const pendingOrders = new Map();

// Save order for later shipment creation
app.post('/api/orders/save', async (req, res) => {
  try {
    const { orderId, customer, shipping, items, carrier, shippingCost, total } = req.body;
    
    if (!orderId || !shipping || !customer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    pendingOrders.set(orderId, {
      orderId,
      customer,
      shipping,
      items,
      carrier,
      shippingCost,
      total,
      status: 'pending_payment',
      createdAt: new Date().toISOString()
    });
    
    console.log(`[orders] Saved order ${orderId}`);
    res.json({ ok: true, orderId });
  } catch (err) {
    console.error('[orders] Save error:', err);
    res.status(500).json({ error: 'Failed to save order' });
  }
});

// Create shipment with Envia.com
app.post('/api/shipping/create', async (req, res) => {
  try {
    const { orderId, carrier, destination, packageInfo } = req.body;
    
    if (!destination || !destination.postalCode || !destination.name) {
      return res.status(400).json({ error: 'Missing destination info' });
    }

    // Map state abbreviations to full names for Envia
    const stateMap = {
      'AGS': 'Aguascalientes', 'BC': 'Baja California', 'BCS': 'Baja California Sur',
      'CAM': 'Campeche', 'CHIS': 'Chiapas', 'CHIH': 'Chihuahua', 'CDMX': 'Ciudad de Mexico',
      'COAH': 'Coahuila', 'COL': 'Colima', 'DGO': 'Durango', 'GTO': 'Guanajuato',
      'GRO': 'Guerrero', 'HGO': 'Hidalgo', 'JAL': 'Jalisco', 'MEX': 'Estado de Mexico',
      'MICH': 'Michoacan', 'MOR': 'Morelos', 'NAY': 'Nayarit', 'NL': 'Nuevo Leon',
      'OAX': 'Oaxaca', 'PUE': 'Puebla', 'QRO': 'Queretaro', 'QROO': 'Quintana Roo',
      'SLP': 'San Luis Potosi', 'SIN': 'Sinaloa', 'SON': 'Sonora', 'TAB': 'Tabasco',
      'TAMPS': 'Tamaulipas', 'TLAX': 'Tlaxcala', 'VER': 'Veracruz', 'YUC': 'Yucatan', 'ZAC': 'Zacatecas'
    };

    const payload = {
      origin: {
        name: 'Mah Joy',
        company: 'Mah Joy',
        email: 'info@playmahjoy.com',
        phone: '5530395891',
        street: 'Av. Vasconcelos',
        number: '1000',
        district: 'Del Valle',
        city: 'San Pedro Garza Garcia',
        state: 'NL',
        country: 'MX',
        postalCode: ENVIA_ORIGIN_CP
      },
      destination: {
        name: destination.name || 'Cliente',
        email: destination.email || '',
        phone: destination.phone || '5500000000',
        street: destination.street || '',
        number: destination.number || 'S/N',
        district: destination.neighborhood || destination.district || '',
        city: destination.city || '',
        state: stateMap[destination.state] || destination.state || '',
        country: 'MX',
        postalCode: destination.postalCode || destination.cp
      },
      packages: [{
        content: packageInfo?.content || 'Mahjong Set',
        amount: packageInfo?.amount || 1,
        type: 'box',
        weight: packageInfo?.weight || 2,
        insurance: 0,
        declaredValue: packageInfo?.declaredValue || 3000,
        weightUnit: 'KG',
        lengthUnit: 'CM',
        dimensions: packageInfo?.dimensions || { length: 40, width: 30, height: 15 }
      }],
      shipment: {
        carrier: carrier || 'estafeta',
        type: 1
      },
      settings: {
        printFormat: 'PDF',
        printSize: 'STOCK_4X6'
      }
    };

    console.log(`[shipping] Creating shipment for order ${orderId}:`, JSON.stringify(payload, null, 2));

    const response = await fetch(ENVIA_CREATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ENVIA_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('[shipping] Envia response:', JSON.stringify(data, null, 2));

    if (data.meta === 'generate' && data.data && data.data[0]) {
      const shipment = data.data[0];
      const result = {
        ok: true,
        orderId,
        trackingNumber: shipment.trackingNumber || shipment.tracking || shipment.carrier_tracking_number,
        carrier: shipment.carrier || carrier,
        labelUrl: shipment.label || shipment.labelUrl || null,
        estimatedDelivery: shipment.estimated_delivery || null
      };
      
      // Update order status
      if (pendingOrders.has(orderId)) {
        const order = pendingOrders.get(orderId);
        order.status = 'shipped';
        order.trackingNumber = result.trackingNumber;
        order.labelUrl = result.labelUrl;
        order.shippedAt = new Date().toISOString();
        pendingOrders.set(orderId, order);
      }
      
      console.log(`[shipping] Created shipment:`, result);
      return res.json(result);
    } else {
      console.error('[shipping] Envia error:', data);
      return res.status(502).json({ 
        error: 'Shipment creation failed', 
        details: data.error || data.message || data 
      });
    }
  } catch (err) {
    console.error('[shipping] Create error:', err);
    res.status(500).json({ error: 'Shipment creation failed', details: String(err) });
  }
});

// ─── CentumPay Webhook ───────────────────────────────────────────────────────

app.post('/api/centumpay/webhook', async (req, res) => {
  try {
    console.log('[webhook] CentumPay notification received:', JSON.stringify(req.body, null, 2));
    
    const { status, order_id, my_id, amount, reference } = req.body;
    const orderId = my_id || order_id || reference;
    
    // Verify payment was successful
    if (status === 'approved' || status === 'success' || status === 'completed') {
      console.log(`[webhook] Payment confirmed for order ${orderId}`);
      
      // Get saved order
      const order = pendingOrders.get(orderId);
      
      if (order) {
        order.status = 'paid';
        order.paidAt = new Date().toISOString();
        pendingOrders.set(orderId, order);
        
        // Auto-create shipment if we have all the data
        if (order.shipping && order.carrier) {
          console.log(`[webhook] Auto-creating shipment for ${orderId}...`);
          
          try {
            // Call our own shipping create endpoint
            const shipRes = await fetch(`http://localhost:${PORT}/api/shipping/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
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
              console.log(`[webhook] Shipment created! Tracking: ${shipData.trackingNumber}`);
              
              // TODO: Send notification to customer via WhatsApp/Email
              // For now, just log it
              console.log(`[webhook] Would notify customer: ${order.customer?.email || order.customer?.phone}`);
            } else {
              console.error(`[webhook] Shipment creation failed:`, shipData);
            }
          } catch (shipErr) {
            console.error(`[webhook] Shipment error:`, shipErr);
          }
        }
        
        return res.json({ ok: true, message: 'Payment processed' });
      } else {
        console.log(`[webhook] Order ${orderId} not found in pending orders`);
        return res.json({ ok: true, message: 'Payment received but order not found' });
      }
    } else {
      console.log(`[webhook] Payment status: ${status} (not confirmed)`);
      return res.json({ ok: true, message: 'Notification received' });
    }
  } catch (err) {
    console.error('[webhook] Error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
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

// List recent orders (for admin)
app.get('/api/orders', (req, res) => {
  const orders = Array.from(pendingOrders.values())
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
  res.json({ orders });
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

        // Create shipment if we have shipping data
        if (order.shipping && order.carrier) {
          try {
            console.log(`[poll] Creating shipment for ${orderId}...`);
            
            const shipRes = await fetch(`http://localhost:${PORT}/api/shipping/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
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
              pendingOrders.set(orderId, order);
            } else {
              console.error(`[poll] ❌ Shipment failed:`, shipData);
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
