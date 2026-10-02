const { randomUUID } = require('crypto');
function normalizePhone(value, currency) {
  const text = String(value || '').trim();
  if (!/^\+?[\d\s().-]+$/.test(text) || text.length > 40) throw new Error('PHONE_REQUIRED');
  let digits = text.replace(/\D/g, '');
  if (/^0|^(\d)\1+$/.test(digits)) throw new Error('PHONE_REQUIRED');
  if (!text.startsWith('+') && digits.length === 10) digits = (currency === 'MXN' ? '52' : '1') + digits;
  if (digits.length < 8 || digits.length > 15 || /^0|^(\d)\1+$/.test(digits)) throw new Error('PHONE_REQUIRED');
  return '+' + digits;
}
const CONTACT_SCHEMA = `CREATE TABLE IF NOT EXISTS mahjoy_checkout_contacts (
  token UUID PRIMARY KEY, phone VARCHAR(16) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
function registerCheckoutContact(app, pool) {
  let ready;
  app.post('/api/checkout/contact', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let phone;
    try {
      if (!['MXN','USD'].includes(req.body?.currency)) throw new Error('INVALID_CURRENCY');
      phone = normalizePhone(req.body?.phone, req.body.currency);
    } catch (_) { return res.status(400).json({error:'A valid phone number is required before paying.'}); }
    try {
      if (!ready) ready = pool.query(CONTACT_SCHEMA).catch(e => { ready = null; throw e; });
      await ready;
      const token = randomUUID();
      await pool.query('INSERT INTO mahjoy_checkout_contacts(token,phone) VALUES($1,$2)', [token,phone]);
      return res.json({contact_id:token});
    } catch (_) { return res.status(503).json({error:'Could not save your contact details. Please try again.'}); }
  });
}
module.exports = { normalizePhone, registerCheckoutContact, CONTACT_SCHEMA };
