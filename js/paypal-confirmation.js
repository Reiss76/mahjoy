/** A completed capture is the only source of a local payment confirmation. */
(function () {
  'use strict';
  const KEY = 'mj_paypal_confirmations_v1';
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const validId = value => typeof value === 'string' && /^[A-Z0-9]{10,30}$/.test(value);
  const english = () => window.location.pathname.startsWith('/en/');
  const params = () => new URLSearchParams(window.location.search);
  function isReturn() { return params().get('payment') === 'success'; }
  function read() {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function summarize(receipt) {
    if (!receipt || receipt.status !== 'COMPLETED' || !validId(receipt.id)) throw new Error('PAYMENT_NOT_CONFIRMED');
    const captureAmounts = (receipt.purchase_units || []).flatMap(unit => (unit.payments?.captures || []).filter(capture => capture.status === 'COMPLETED').map(capture => capture.amount));
    const amounts = captureAmounts.length ? captureAmounts : (receipt.purchase_units || []).map(unit => unit.amount);
    const currency = amounts[0]?.currency_code;
    const consistent = amounts.length > 0 && ['MXN','USD'].includes(currency) && amounts.every(amount => amount?.currency_code === currency && Number.isFinite(Number(amount.value)) && Number(amount.value) >= 0);
    return { id:receipt.id, status:'COMPLETED', savedAt:Date.now(), ...(consistent ? {currency,total:Math.round(amounts.reduce((sum,amount) => sum+Number(amount.value),0)*100)/100} : {}) };
  }
  function remember(receipt) {
    const summary = summarize(receipt);
    try {
      const stored = read(); stored[summary.id] = summary;
      const recent = Object.values(stored).filter(value => validId(value?.id) && Date.now()-value.savedAt < MAX_AGE).sort((a,b) => b.savedAt-a.savedAt).slice(0,12);
      window.sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(recent.map(value => [value.id,value]))));
    } catch (_) { /* The visible receipt works even when private storage is blocked. */ }
    return summary;
  }
  function render(summary, confirmed, syncPending) {
    ['co-loading','co-content','co-complete','co-shipping-form'].forEach(id => { const node=document.getElementById(id); if(node)node.style.display='none'; });
    const target = document.getElementById('co-thanks');
    if (!target) return;
    const en=english(), id=validId(summary?.id)?summary.id:null;
    target.style.display='flex';
    target.innerHTML = '<div style="max-width:520px;margin:auto"><h2 data-receipt-title style="font-family:var(--font-display,Georgia,serif);font-size:2.4rem;color:var(--burgundy,#6b0f2a);margin:0 0 1rem"></h2><p data-receipt-message style="font-family:var(--font-ui,Arial,sans-serif);color:#71344b;line-height:1.7;margin:0 0 1rem"></p><p data-receipt-reference style="font-weight:600;overflow-wrap:anywhere;color:var(--burgundy,#6b0f2a)"></p><p data-receipt-total style="font-size:1.4rem;color:var(--burgundy,#6b0f2a)"></p><a data-receipt-link style="display:inline-block;margin-top:1.5rem;padding:1rem 2rem;border-radius:999px;background:var(--burgundy,#6b0f2a);color:#fff;text-decoration:none"></a></div>';
    target.querySelector('[data-receipt-title]').textContent=confirmed?(en?'Payment received':'Pago recibido'):(en?'Check your payment status':'Consulta el estado de tu pago');
    target.querySelector('[data-receipt-message]').textContent=confirmed
      ? syncPending?(en?'Your payment was received. Your order confirmation is still being saved. Do not pay again. Contact us with the PayPal reference below.':'Tu pago fue recibido. La confirmación del pedido sigue guardándose. No vuelvas a pagar. Contáctanos con la referencia de PayPal.')
        :(en?'Thank you for your purchase. Keep your PayPal reference for any questions about this order.':'Gracias por tu compra. Conserva tu referencia de PayPal para cualquier consulta sobre este pedido.')
      :(en?'We cannot restore a verified receipt in this browser. Check your PayPal activity or contact us before trying to pay again.':'No podemos recuperar un comprobante verificado en este navegador. Revisa tu actividad en PayPal o contáctanos antes de intentar pagar de nuevo.');
    target.querySelector('[data-receipt-reference]').textContent=id?'PayPal: '+id:'';
    const total = target.querySelector('[data-receipt-total]');
    if(confirmed && ['MXN','USD'].includes(summary.currency) && Number.isFinite(summary.total))total.textContent=new Intl.NumberFormat(en?'en-US':'es-MX',{style:'currency',currency:summary.currency}).format(summary.total)+' '+summary.currency;
    else total.hidden=true;
    const link=target.querySelector('[data-receipt-link]');
    link.textContent=confirmed&&!syncPending?(en?'Continue shopping':'Seguir comprando'):(en?'Contact MAH JOY':'Contactar a MAH JOY');
    link.href=confirmed&&!syncPending?'index.html#shop':'mailto:info@playmahjoy.com?subject='+encodeURIComponent('PayPal '+(id || 'MAH JOY'));
    if(confirmed && window.MJWallet)void window.MJWallet.attach(target,id);
    window.scrollTo?.({top:0,behavior:'smooth'});
  }
  function show(receipt, options={}) {
    const summary=remember(receipt);
    // Preserve the product/bundle query and hash, while making reload restoration explicit.
    try {
      const url=new URL(window.location.href);url.searchParams.set('payment','success');url.searchParams.set('order',summary.id);url.searchParams.set('method','paypal');
      window.history.replaceState(null,'',url.pathname+url.search+url.hash);
    } catch (_) {}
    render(summary,true,options.syncPending===true);
  }
  function restore() {
    if(!isReturn())return false;
    const id=params().get('order'), cached=validId(id)?read()[id]:null;
    const confirmed=cached?.id===id && cached.status==='COMPLETED' && Number.isFinite(cached.savedAt) && Date.now()-cached.savedAt>=0 && Date.now()-cached.savedAt<MAX_AGE;
    render(confirmed?cached:{id},confirmed,false);
    return true;
  }
  window.MJPayPalConfirmation={show,restore,isReturn};
})();
