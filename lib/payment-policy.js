// Reject retired payment entry points before any provider call or order write.
function registerPaymentPolicy(app) {
  const retired = ['/api/centumpay/checkout', '/api/payments/centumpay/checkout', '/api/poll/trigger'];
  app.all(retired, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.status(410).json({
      ok: false,
      error_code: 'PAYPAL_ONLY',
      error: 'Mahjoy accepts online payments only through PayPal. Reload the store to continue.',
    });
  });
}
module.exports = { registerPaymentPolicy };
