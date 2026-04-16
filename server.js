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

    const payload = {
      group: 'wmx_api',
      method: 'get_token',
      token: authToken,
      api_key: CENTUMPAY_API_KEY,
      data: {
        web_site: site,
        order_details: { wl_name: 'wl_centumpay', my_id: myOrderId },
        tx_info: {
          cart: {
            description: `Compra MAH JOY (${cart.length} producto${cart.length > 1 ? 's' : ''})`,
            concept: cart.map(l => ({ item: l.name, cant: Number(l.qty), price: Number(l.price) })),
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
});
