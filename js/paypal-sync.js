// Save only the PayPal ID and delivery hints; the server verifies money and items.
window.MJPayPalSync = {
  async save(details, hints = {}) {
    if (details.status !== 'COMPLETED') throw new Error('PayPal payment is not completed');
    const orderId = details.id;
    const key = 'mj_paypal_sync_' + orderId;
    const payload = {...hints, paypalOrderId:orderId};
    try {
      try { localStorage.setItem(key,JSON.stringify(payload)); } catch (_) { /* server receipt still persists */ }
      const response = await fetch('/api/orders/paypal-express',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true});
      if (!response.ok) throw new Error('Receipt not saved');
      const result = await response.json();
      try { localStorage.removeItem(key); } catch (_) { /* harmless duplicate retry */ }
      return result;
    } catch (_) {
      const english = typeof document !== 'undefined' && document.documentElement.lang === 'en';
      const error = new Error(english
        ? 'Your payment was received. Saving the order is pending. Please contact us with PayPal ID ' + orderId + '. Do not pay again.'
        : 'Tu pago ya fue recibido. El pedido está pendiente de guardarse. Contáctanos con el ID de PayPal ' + orderId + '. No vuelvas a pagar.');
      error.code = 'PAYMENT_RECEIVED_SYNC_PENDING';
      throw error;
    }
  },
  errorMessage(error, fallback) {
    return ['PAYMENT_RECEIVED_SYNC_PENDING','PAYMENT_STATUS_UNCERTAIN'].includes(error?.code) ? error.message : fallback;
  }
};
// Retry receipts after a connection interruption, without capturing another payment.
window.addEventListener('DOMContentLoaded', () => {
  Object.keys(localStorage).filter(k=>k.startsWith('mj_paypal_sync_')).forEach(async key=>{
    try { const payload=JSON.parse(localStorage.getItem(key)); const response=await fetch('/api/orders/paypal-express',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(response.ok)localStorage.removeItem(key); } catch (_) { /* retained for next visit */ }
  });
});
