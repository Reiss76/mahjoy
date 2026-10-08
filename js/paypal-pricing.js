(function () {
  function checkoutError(result,fallback) {
    const code = result.error_code || result.error || '';
    if (/^(SHIPPING_|INVALID_SHIPPING_)/.test(code) || code === 'ORDER_ID_MISMATCH') return window.MJShippingCheckout?.errorMessage(code) || 'Select a valid shipping quote before paying.';
    if(result.error_code==='DISCOUNT_USD_ONLY' || result.error==='DISCOUNT_USD_ONLY')return window.location?.pathname?.includes('/en/')
      ? 'This code is only valid in the EN store when paying in USD.'
      : 'Este código solo funciona en la tienda EN al pagar en USD.';
    return result.error || fallback;
  }
  async function quote(items, currency, discountCode) {
    const response = await fetch('/api/checkout/prices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, currency, discount_code: discountCode || null })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(checkoutError(result,'Could not verify prices. Please try again.'));
    return result.items;
  }
  async function refreshCart(currency) {
    const cart = window.MJCart.getCart();
    if (!cart.length) return cart;
    const prices = await quote(cart, currency);
    // Reconcile against the latest cart in case quantities changed during the request.
    const latest = window.MJCart.getCart();
    const updated = latest.map(item => {
      const p = prices.find(p => item.sku ? String(p.sku).toLowerCase() === String(item.sku).toLowerCase() : String(p.id) === String(item.id));
      return p ? { ...item, price: p.price, price_usd: p.price_usd, sku: p.sku, name: p.name, image: p.image || item.image } : item;
    });
    window.MJCart.saveCart(updated);
    return updated;
  }
  async function create(actions, payload) {
    const units = payload.purchase_units;
    if (!units || units.length !== 1) throw new Error('Invalid checkout');
    const unit = units[0], currency = unit.amount.currency_code;
    const items = unit.items || [];
    const shippingItem = i => !i.sku && /^(shipping|env[ií]o)$/i.test(i.name);
    const merchandise = items.filter(i => !shippingItem(i));
    if (!window.MJShippingCheckout) throw new Error('Shipping must be selected before paying. Please reload the page.');
    const selection = window.MJShippingCheckout.requireForPayment(currency, merchandise);
    const discount = window.MJAppliedDiscount || window.cartDiscount;
    const prices = await quote(merchandise, currency, discount && discount.code);
    let cents = 0, legacyShippingCents = 0;
    for (let n = 0; n < items.length; n++) {
      const item = items[n], value = Number(item.unit_amount.value), qty = Number(item.quantity);
      if (item.unit_amount.currency_code !== currency || !Number.isFinite(value) || value <= 0 || !Number.isInteger(qty) || qty < 1) {
        throw new Error('A product has no valid price. Please refresh your cart before paying.');
      }
      if (!shippingItem(item)) {
        const p = prices[merchandise.indexOf(item)];
        if (Math.round(value * 100) !== Math.round(p.unit_price * 100)) {
          throw new Error('Prices have changed. Please refresh the page and review your total before paying.');
        }
      }
      if (shippingItem(item)) legacyShippingCents += Math.round(value * 100) * qty;
      else cents += Math.round(value * 100) * qty;
    }
    const breakdown = unit.amount.breakdown || {};
    if (Object.values(breakdown).some(amount => amount.currency_code !== currency)) throw new Error('Mixed checkout currencies are not allowed.');
    const shipping = Number(breakdown.shipping && breakdown.shipping.value || 0);
    if (Math.round(Number(breakdown.item_total && breakdown.item_total.value) * 100) !== cents + legacyShippingCents || !Number.isFinite(shipping) || shipping < 0
      || Math.round(Number(unit.amount.value) * 100) !== cents + legacyShippingCents + Math.round(shipping * 100)) throw new Error('Invalid checkout total. Please refresh the page.');
    const current = window.MJShippingCheckout.requireForPayment(currency, merchandise);
    if (selection.quote_token !== current.quote_token || selection.contextKey !== current.contextKey) throw new Error(window.MJShippingCheckout.errorMessage('SHIPPING_QUOTE_CHANGED'));
    unit.items = merchandise;
    unit.amount.breakdown = { ...breakdown,
      item_total: { currency_code: currency, value: (cents / 100).toFixed(2) },
      shipping: { currency_code: currency, value: selection.price.toFixed(2) }
    };
    unit.amount.value = ((cents + Math.round(selection.price * 100)) / 100).toFixed(2);
    unit.shipping = { ...unit.shipping, options: [{ id: selection.id, label: ((selection.carrier_name || selection.carrier) + ' · ' + (selection.service_name || selection.service)).slice(0, 127),
      type: 'SHIPPING', selected: true, amount: { currency_code: currency, value: selection.price.toFixed(2) } }] };
    payload.application_context = { ...payload.application_context, shipping_preference: 'GET_FROM_FILE' };
    // PayPal collects contact details in its checkout, with no extra storefront form.
    // Its Contact Module currently supports US checkout only. Required collection
    // is controlled separately by the merchant's Contact Telephone Number setting.
    if (currency === 'USD') {
      payload.payment_source = { ...payload.payment_source, paypal: {
        ...payload.payment_source?.paypal, experience_context: {
          ...payload.payment_source?.paypal?.experience_context,
          contact_preference: 'UPDATE_CONTACT_INFO'
        }
      }};
    }
    const result = await checkoutRequest('create', {payload,discount_code:discount && discount.code,shipping_quote_token:selection.quote_token});
    window.MJShippingCheckout.rememberOrder(result.id, selection);
    return result.id;
  }
  async function checkoutRequest(action,body) {
    let response,result;
    try {
      response=await fetch('/api/checkout/paypal/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      result=await response.json();
    } catch(error) {
      if(action==='capture')throw paymentStatusError(body.orderId);
      throw error;
    }
    if(!response.ok) {
      if(result.error==='US_REQUIRES_USD'){goToUsMarket();return new Promise(function(){});}
      const safeErrors=['DISCOUNT_USD_ONLY','INVALID_ORDER','CHECKOUT_NOT_FOUND','CHECKOUT_MISMATCH','CURRENCY_MISMATCH','ORDER_NOT_APPROVED','PRICE_MISMATCH','PAYPAL_RECEIPT_UNAVAILABLE','CHECKOUT_UNAVAILABLE','ORDER_ID_MISMATCH'];
      const code = result.error_code || result.error || '';
      if(action==='capture' && !safeErrors.includes(code) && !/^(SHIPPING_|INVALID_SHIPPING_)/.test(code))throw paymentStatusError(body.orderId);
      const error = new Error(checkoutError(result,'Could not verify payment. Please try again.'));
      error.code = code;
      throw error;
    }
    if(action==='capture' && result.status!=='COMPLETED')throw paymentStatusError(body.orderId);
    return result;
  }
  function paymentStatusError(orderId) {
    const english=window.location?.pathname?.startsWith('/en/') || document.documentElement?.lang?.startsWith('en');
    const error=new Error(english
      ? 'We are verifying your PayPal payment. Do not pay again. Contact us with PayPal order ID '+orderId+'.'
      : 'Estamos verificando tu pago de PayPal. No vuelvas a pagar. Contáctanos con el ID de pedido PayPal '+orderId+'.');
    error.code='PAYMENT_STATUS_UNCERTAIN';
    return error;
  }
  function goToUsMarket() {
    const url=new URL(window.location.href);
    if(!url.pathname.startsWith('/en/'))url.pathname='/en'+url.pathname;
    url.searchParams.set('country','US');
    const qty=document.getElementById('co-qty')?.value;
    if(qty)url.searchParams.set('qty',qty);
    window.location.assign(url.href);
  }
  function requireMarket(country,currency,actions) {
    if(country==='US' && currency!=='USD') {
      Promise.resolve(actions.reject()).then(goToUsMarket);
      return false;
    }
    return true;
  }
  async function capture(orderId) {
    if (!window.MJShippingCheckout) throw new Error('A shipping quote is required before payment.');
    const selection = window.MJShippingCheckout.requireForCapture(orderId);
    return checkoutRequest('capture',{orderId,shipping_quote_token:selection.quote_token});
  }
  function shippingPrice(cost, sourceCurrency, targetCurrency) {
    const value = Number(cost);
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid shipping price');
    if (!['MXN','USD'].includes(sourceCurrency) || !['MXN','USD'].includes(targetCurrency)) throw new Error('Invalid shipping currency');
    if (sourceCurrency !== targetCurrency) throw new Error('Shipping must be quoted in the checkout currency. No currency conversion is allowed.');
    return Math.round(value*100)/100;
  }
  document.addEventListener('DOMContentLoaded', function() {
    const country=document.getElementById('co-country');
    if(country)country.addEventListener('change',function(){
      if(country.value==='US' && !window.location.pathname.startsWith('/en/'))goToUsMarket();
    });
  });
  window.MJPayPalPricing = { quote, refreshCart, create, capture, requireMarket, shippingPrice };
})();
