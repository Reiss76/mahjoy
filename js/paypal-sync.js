// Save only the PayPal ID and delivery hints; the server verifies money and items.
window.MJPayPalSync = {
  async save(details, hints = {}) {
    if (details.status !== 'COMPLETED') throw new Error('PayPal payment is not completed');
    const orderId = details.id;
    const key = 'mj_paypal_sync_' + orderId;
    const payload = {...hints, paypalOrderId:orderId};
    localStorage.setItem(key,JSON.stringify(payload));
    const response = await fetch('/api/orders/paypal-express',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true});
    if (!response.ok) throw new Error('Your payment was received, but saving the order is pending. Please contact us with PayPal ID ' + orderId + '. Do not pay again.');
    localStorage.removeItem(key);
    return response.json();
  }
};
// Retry receipts after a connection interruption, without capturing another payment.
window.addEventListener('DOMContentLoaded', () => {
  Object.keys(localStorage).filter(k=>k.startsWith('mj_paypal_sync_')).forEach(async key=>{
    try { const payload=JSON.parse(localStorage.getItem(key)); const response=await fetch('/api/orders/paypal-express',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(response.ok)localStorage.removeItem(key); } catch (_) { /* retained for next visit */ }
  });
});
