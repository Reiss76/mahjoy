/** MAH JOY — server-verified PayPal checkout. */
(function() {
'use strict';
let paypalButtonRendered = false;
let rendering = null;
const isEnCheckout = window.location.pathname.includes('/en/');
const PAYPAL_CURRENCY = isEnCheckout ? 'USD' : 'MXN';

function productItems() {
  const product = window.MJCheckoutProduct;
  const qty = Number(document.getElementById('co-qty')?.value || document.getElementById('co-form')?.qty?.value || 1);
  return product ? [{...product, qty}] : [];
}
function createProductOrder(data, actions) {
  const product = window.MJCheckoutProduct;
  if (!product) throw new Error(isEnCheckout ? 'Product unavailable. Please reload the page.' : 'Producto no disponible. Recarga la página.');
  const qty = productItems()[0].qty;
  const selected = window.MJPayPalPricing.selectionForPayPal(PAYPAL_CURRENCY, [{...product, qty}]);
  const basePrice = Number(isEnCheckout ? (product.priceUsd ?? product.price_usd) : product.price);
  const discount = window.MJAppliedDiscount;
  const unitPrice = discount?.pct > 0 ? Math.round(basePrice * (1-discount.pct/100) * 100)/100 : basePrice;
  const subtotal = unitPrice * qty;
  return window.MJPayPalPricing.create(actions, {
    intent:'CAPTURE', purchase_units:[{description:'MAH JOY - '+product.name,
      items:[{name:product.name.substring(0,127),sku:product.sku || '',quantity:String(qty),unit_amount:{currency_code:PAYPAL_CURRENCY,value:unitPrice.toFixed(2)}}],
      amount:{currency_code:PAYPAL_CURRENCY,value:(subtotal+selected.price).toFixed(2),breakdown:{
        item_total:{currency_code:PAYPAL_CURRENCY,value:subtotal.toFixed(2)},
        shipping:{currency_code:PAYPAL_CURRENCY,value:selected.price.toFixed(2)}
      }} }],application_context:{brand_name:'MAH JOY',shipping_preference:'GET_FROM_FILE',user_action:'PAY_NOW'}
  });
}
function buttonOptions() {
  const callbacks = window.MJPayPalPricing.buttonCallbacks(PAYPAL_CURRENCY, productItems);
  return {
    style:{layout:'horizontal',color:'blue',shape:'pill',label:'paypal',tagline:false,height:45},
    // PayPal collects its own address with GET_FROM_FILE. The shared callbacks
    // enforce the signed quote and delivery-phone policy; co-form is for cards.
    ...callbacks,
    createOrder:createProductOrder,
    onApprove:async function(data) {
      try {
        const receipt = await window.MJPayPalPricing.capture(data.orderID);
        await window.MJPayPalSync.save(receipt, {discount_code:window.MJAppliedDiscount?.code || null,vendor_code:window.MJVendor?.getCode() || null});
        showPaymentSuccess(receipt);
      } catch (error) { alert(window.MJPayPalSync.errorMessage(error,error.message)); }
    },
    onError:function(error) { alert(window.MJPayPalSync.errorMessage(error,error.message)); }
  };
}
async function initPayPalButton() {
  if (rendering) return rendering;
  const container = document.getElementById('paypal-button-container');
  if (!container || paypalButtonRendered || typeof paypal === 'undefined') return;
  rendering = (async function() {
    await window.MJPayPalPricing.init();
    container.innerHTML = '';
    await window.MJPayPalPricing.renderButtons('#paypal-button-container',buttonOptions);
    paypalButtonRendered = true;
  })();
  try { await rendering; } finally { rendering = null; }
}
async function processPayPalPayment() {
  await window.MJPayPalPricing.init();
  try { window.MJPayPalPricing.selectionForPayPal(PAYPAL_CURRENCY, productItems()); }
  catch (error) { alert(error.message); return; }
  if (typeof paypal === 'undefined') { alert(isEnCheckout ? 'PayPal is unavailable. Please try again shortly.' : 'PayPal no está disponible. Intenta de nuevo en unos minutos.'); return; }
  if (!window.MJCheckoutProduct) { alert(isEnCheckout ? 'Product unavailable. Please reload the page.' : 'Producto no disponible. Recarga la página.'); return; }
  const container = document.getElementById('paypal-button-container');
  if (container) container.style.display = 'block';
  await initPayPalButton();
  const button = document.querySelector?.('#paypal-button-container .paypal-button');
  if (button) button.click();
}
function setupPayPalStaticButton() {
  const button = document.getElementById('paypal-static-btn');
  if (!button || button.getAttribute?.('onclick') || button._paypalHandlerAttached) return;
  button._paypalHandlerAttached = true;
  button.addEventListener('click',function() { processPayPalPayment().catch(error => alert(error.message)); });
}
function tryInitPayPal(retries) {
  if (typeof paypal !== 'undefined' && document.getElementById('paypal-button-container') && window.MJCheckoutProduct) {
    initPayPalButton().catch(error => console.error('[PayPal]',error.message));
  } else if (retries > 0) setTimeout(function() { tryInitPayPal(retries-1); },1000);
}
function showPaymentSuccess(details) {
  const content = document.getElementById('co-content'); if (content) content.style.display = 'none';
  const thanks = document.getElementById('co-thanks');
  if (thanks) thanks.style.display = 'block';
  else alert(isEnCheckout ? 'Payment received. Thank you for your purchase.' : 'Pago recibido. Gracias por tu compra.');
  window.scrollTo?.({top:0,behavior:'smooth'});
}
window.initPayPalWhenReady = function() {};
window.MJPayPal = {init:initPayPalButton,pay:processPayPalPayment};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',function() { setupPayPalStaticButton(); setTimeout(function() {tryInitPayPal(10);},1000); });
else { setupPayPalStaticButton(); setTimeout(function() {tryInitPayPal(10);},1000); }
})();
