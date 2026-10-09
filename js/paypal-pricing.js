(function () {
  let configuration = { nativeShipping: false };
  let initialization = null;
  const nativeOrders = new Map();
  const purchasedCarts = new Map();
  const storageKey = 'mj_paypal_native_orders_v1';
  function loadOrders() {
    try {
      const saved = JSON.parse(window.sessionStorage?.getItem(storageKey) || '{}');
      for (const [id, order] of Object.entries(saved)) {
        if (/^[A-Za-z0-9-]{1,64}$/.test(id) && validCheckoutRef(order?.checkout_ref)) nativeOrders.set(id, order);
      }
    } catch (_) { /* Storage may be disabled; in-page recovery still works. */ }
  }
  function saveOrders() {
    try { window.sessionStorage?.setItem(storageKey, JSON.stringify(Object.fromEntries(nativeOrders))); } catch (_) {}
  }
  function validCheckoutRef(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value); }
  function nativeShippingEnabled() { return configuration.nativeShipping === true; }
  function init() {
    if (!initialization) initialization = (async function() {
      try {
        const response = await fetch('/api/checkout/paypal/config', { method: 'GET', cache: 'no-store',
          ...(typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? {signal:AbortSignal.timeout(5000)} : {}) });
        const result = await response.json();
        configuration = { nativeShipping: response.ok && result.nativeShipping === true };
      } catch (_) { configuration = { nativeShipping: false }; }
      window.MJShippingCheckout?.setPayPalNativeMode?.(nativeShippingEnabled());
      if (window.dispatchEvent && typeof Event === 'function') window.dispatchEvent(new Event('mj:paypalConfigured'));
      return { ...configuration };
    })();
    return initialization;
  }
  function uncertainOrder() { return [...nativeOrders].find(([, order]) => order.capturePending)?.[0]; }
  function deliveryPhoneForPayPal(currency) {
    if(!nativeShippingEnabled() || currency!=='MXN')return undefined;
    const input=document.getElementById('mj-paypal-delivery-phone');
    try {
      if(!window.MJDeliveryPhone)throw Object.assign(new Error('NATIVE_SHIPPING_PHONE_INVALID'),{code:'NATIVE_SHIPPING_PHONE_INVALID'});
      return window.MJDeliveryPhone.normalizeMxDeliveryPhone(input?.value);
    } catch(error) {
      input?.focus?.();
      const localized=new Error(checkoutError({error_code:error.code},'Enter a valid delivery phone.'));
      localized.code=error.code;throw localized;
    }
  }
  function selectionForPayPal(currency, items) {
    const pending = uncertainOrder();
    if (pending) throw paymentStatusError(pending);
    if (nativeShippingEnabled()) return { price: 0, pending: true, currency };
    if (!window.MJShippingCheckout) throw new Error('Shipping must be selected before paying. Please reload the page.');
    return window.MJShippingCheckout.requireForPayment(currency, items);
  }
  // Call after init(): native shipping is updated by PayPal's server callback.
  function buttonCallbacks(currency, items) {
    const callbacks = nativeShippingEnabled() ? {} : window.MJShippingCheckout.paypalCallbacks();
    return { ...callbacks,
      onInit: function(_data, actions) {
        if (nativeShippingEnabled() && !uncertainOrder()) actions.enable();
        else {
          actions.disable();
          window.MJShippingCheckout.subscribe(function(state) { if (state.selected && !uncertainOrder()) actions.enable(); else actions.disable(); });
        }
      },
      onClick: function(_data, actions) {
        if (nativeShippingEnabled()) window.MJShippingCheckout?.showPayPalFields?.();
        try { selectionForPayPal(currency, typeof items === 'function' ? items() : items);deliveryPhoneForPayPal(currency); }
        catch (error) { alert(error.message); return actions.reject(); }
        return actions.resolve();
      }
    };
  }
  loadOrders();
  function checkoutError(result,fallback) {
    const code = result.error_code || result.error || '';
    if (/^(NATIVE_SHIPPING_|NATIVE_CHECKOUT_)/.test(code)) {
      const english=window.location?.pathname?.startsWith('/en/');
      if(code==='NATIVE_SHIPPING_PHONE_REQUIRED' || code==='NATIVE_SHIPPING_PHONE_INVALID')return english
        ? 'Enter a 10-digit Mexican delivery phone number, with +52 if you include the country code.'
        : 'Ingresa un teléfono de entrega de 10 dígitos. Si incluyes la clave de país, usa +52.';
      if (code === 'NATIVE_SHIPPING_UNAVAILABLE') return english
        ? 'Automatic PayPal shipping is unavailable. Refresh your cart to continue.'
        : 'El envío automático de PayPal no está disponible. Actualiza el carrito para continuar.';
      if (code === 'NATIVE_SHIPPING_EXPIRED') return english
        ? 'Your checkout session expired. Open PayPal again to review shipping and the total.'
        : 'Tu sesión de pago caducó. Abre PayPal de nuevo para revisar el envío y el total.';
      if (['NATIVE_SHIPPING_NOT_READY','NATIVE_SHIPPING_REQUIRED','NATIVE_SHIPPING_QUOTE_INVALID'].includes(code)) return english
        ? 'Shipping has not been confirmed. Review your address in PayPal before continuing.'
        : 'El envío aún no está confirmado. Revisa tu dirección en PayPal antes de continuar.';
      return english ? 'Could not recover this PayPal checkout. Contact MAH JOY before paying again.'
        : 'No pudimos recuperar este checkout de PayPal. Contacta a MAH JOY antes de volver a pagar.';
    }
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
  async function create(actions, inputPayload, options = {}) {
    // Freeze the clicked products before any price or shipping request can finish.
    const payload = JSON.parse(JSON.stringify(inputPayload));
    const units = payload.purchase_units;
    if (!units || units.length !== 1) throw new Error('Invalid checkout');
    const unit = units[0], currency = unit.amount.currency_code;
    const items = unit.items || [];
    const shippingItem = i => !i.sku && /^(shipping|env[ií]o)$/i.test(i.name);
    const merchandise = items.filter(i => !shippingItem(i));
    if (!['MXN','USD'].includes(currency)) throw new Error('Invalid checkout currency');
    const selection = selectionForPayPal(currency, merchandise);
    // A phone edited after opening PayPal must not replace the order's contact.
    const deliveryPhone = deliveryPhoneForPayPal(currency);
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
        if (!p || Math.round(value * 100) !== Math.round(p.unit_price * 100)) {
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
    const current = selectionForPayPal(currency, merchandise);
    if (!nativeShippingEnabled() && (selection.quote_token !== current.quote_token || selection.contextKey !== current.contextKey)) throw new Error(window.MJShippingCheckout.errorMessage('SHIPPING_QUOTE_CHANGED'));
    unit.items = merchandise;
    unit.amount.breakdown = { item_total: { currency_code: currency, value: (cents / 100).toFixed(2) } };
    if (!nativeShippingEnabled()) unit.amount.breakdown.shipping = { currency_code: currency, value: selection.price.toFixed(2) };
    unit.amount.value = ((cents + Math.round(selection.price * 100)) / 100).toFixed(2);
    if (nativeShippingEnabled()) delete unit.shipping;
    else unit.shipping = { ...unit.shipping, options: [{ id: selection.id, label: ((selection.carrier_name || selection.carrier) + ' · ' + (selection.service_name || selection.service)).slice(0, 127),
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
    const result = await checkoutRequest('create', {payload,discount_code:discount && discount.code,
      ...(nativeShippingEnabled() ? {native_shipping:true,...(deliveryPhone===undefined?{}:{delivery_phone:deliveryPhone})} : {shipping_quote_token:selection.quote_token})});
    const snapshot = options.cart ? merchandise.map(item => ({ sku:item.sku, name:item.name, qty:Number(item.quantity) })) : null;
    if (nativeShippingEnabled()) {
      if (!validCheckoutRef(result.checkout_ref) || result.shipping_state !== 'PENDING' || !/^[A-Za-z0-9-]{1,64}$/.test(result.id || '')) throw new Error('Could not prepare PayPal checkout. Please reload the page.');
      nativeOrders.set(result.id, {checkout_ref:result.checkout_ref, currency, cart:snapshot, capturePending:false,...(deliveryPhone===undefined?{}:{delivery_phone:deliveryPhone})});
      saveOrders();
    } else window.MJShippingCheckout.rememberOrder(result.id, selection);
    if (snapshot) purchasedCarts.set(result.id, snapshot);
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
      const safeErrors=['DISCOUNT_USD_ONLY','INVALID_ORDER','CHECKOUT_NOT_FOUND','CHECKOUT_MISMATCH','CURRENCY_MISMATCH','ORDER_NOT_APPROVED','PRICE_MISMATCH','PAYPAL_RECEIPT_UNAVAILABLE','CHECKOUT_UNAVAILABLE','ORDER_ID_MISMATCH',
        'NATIVE_SHIPPING_UNAVAILABLE','NATIVE_SHIPPING_PENDING','NATIVE_SHIPPING_EXPIRED','NATIVE_CHECKOUT_UNAUTHORIZED',
        'NATIVE_SHIPPING_UNAUTHORIZED','NATIVE_SHIPPING_SUPERSEDED','NATIVE_SHIPPING_INVALID_STATE','NATIVE_SHIPPING_NOT_READY',
        'NATIVE_SHIPPING_INVALID','NATIVE_SHIPPING_QUOTE_INVALID','NATIVE_SHIPPING_REQUIRED','NATIVE_SHIPPING_SCOPE_INVALID','NATIVE_SHIPPING_CHECKOUT_NOT_FOUND',
        'NATIVE_SHIPPING_PHONE_REQUIRED','NATIVE_SHIPPING_PHONE_INVALID'];
      const code = result.error_code || result.error || '';
      if(action==='capture' && !safeErrors.includes(code) && !/^(SHIPPING_|INVALID_SHIPPING_)/.test(code))throw paymentStatusError(body.orderId);
      const error = new Error(checkoutError(result,'Could not verify payment. Please try again.'));
      error.code = code;
      throw error;
    }
    if(action==='capture' && (result.status!=='COMPLETED' || result.id !== body.orderId))throw paymentStatusError(body.orderId);
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
    const native = nativeOrders.get(orderId);
    if (native) {
      native.capturePending = true; saveOrders();
      try {
        const result = await checkoutRequest('capture', {orderId, checkout_ref:native.checkout_ref});
        native.capturePending = false; native.completed = true; saveOrders();
        return result;
      } catch (error) {
        if (error.code !== 'PAYMENT_STATUS_UNCERTAIN') { native.capturePending = false; saveOrders(); }
        throw error;
      }
    }
    if (nativeShippingEnabled()) throw new Error('Could not recover this PayPal checkout. Contact MAH JOY before paying again.');
    if (!window.MJShippingCheckout) throw new Error('A shipping quote is required before payment.');
    const selection = window.MJShippingCheckout.requireForCapture(orderId);
    return checkoutRequest('capture',{orderId,shipping_quote_token:selection.quote_token});
  }
  function completeCart(orderId) {
    const purchased = purchasedCarts.get(orderId) || nativeOrders.get(orderId)?.cart;
    if (!purchased || !window.MJCart?.saveCart) return;
    const quantities = new Map();
    const identity = item => item.sku ? 'sku:'+String(item.sku).trim().toLowerCase() : 'name:'+String(item.name || '').trim().toLowerCase();
    purchased.forEach(item => quantities.set(identity(item), (quantities.get(identity(item)) || 0) + item.qty));
    const updated = window.MJCart.getCart().flatMap(item => {
      const key = identity(item), count = quantities.get(key) || 0, remove = Math.min(Number(item.qty), count);
      quantities.set(key, count-remove);
      return Number(item.qty) > remove ? [{...item, qty:Number(item.qty)-remove}] : [];
    });
    window.MJCart.saveCart(updated);
    purchasedCarts.delete(orderId);
    const native = nativeOrders.get(orderId); if (native) { native.cart = null; saveOrders(); }
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
  window.MJPayPalPricing = { init, nativeShippingEnabled, selectionForPayPal, buttonCallbacks, quote, refreshCart, create, capture, completeCart, requireMarket, shippingPrice };
})();
