/* One signed shipping selection shared by every checkout button. */
(function () {
  let configuration = null;
  let destination = { postalCode: '', country: '' };
  let contextKey = '';
  let quotedKey = '';
  let rates = [];
  let selectedRate = null;
  let requestNumber = 0;
  let loading = false;
  let notice = '';
  let payPalNative = false;
  let cardMode = false;
  const listeners = new Set();
  const orders = new Map();
  const english = () => configuration?.currency === 'USD' || window.location?.pathname?.startsWith('/en/');
  const message = (es, en) => english() ? en : es;
  function shippingError(code, text) {
    const error = new Error(text || errorMessage(code));
    error.code = code;
    return error;
  }
  function errorMessage(code) {
    if (/PACKAG(?:E|ING).*PROFILE_REQUIRED/.test(code)) return message('Este pedido requiere una cotización de envío personalizada. Contacta a MAH JOY para completar tu compra.', 'This order requires a personalized shipping quote. Contact MAH JOY to complete your purchase.');
    if (/EXPIRED/.test(code)) return message('La cotización caducó. Calcula el envío otra vez.', 'The shipping quote expired. Calculate shipping again.');
    if (/ADDRESS|DESTINATION/.test(code)) return message('La dirección cambió. Vuelve al carrito y cotiza el envío para ese código postal y país.', 'The address changed. Return to the cart and quote shipping for that postal code and country.');
    if (/CURRENCY|MARKET/.test(code)) return message('El envío debe cotizarse en la moneda de esta tienda.', 'Shipping must be quoted in this store’s currency.');
    if (/UNAVAILABLE|NO_RATES|PACKAGE/.test(code)) return message('No pudimos obtener una cotización válida. Intenta otra vez o contacta a MAH JOY antes de pagar.', 'We could not obtain a valid shipping quote. Try again or contact MAH JOY before paying.');
    return message('Calcula y selecciona un servicio de envío válido antes de pagar.', 'Calculate shipping and select a valid service before paying.');
  }
  function normalizedPostal(value, country) {
    const text = String(value || '').trim();
    return country === 'US' && /^\d{5}-\d{4}$/.test(text) ? text.slice(0, 5) : text;
  }
  function merchandise(items) {
    return (items || []).filter(item => !(!item.sku && /^(shipping|env[ií]o)$/i.test(item.name || '')));
  }
  function itemsKey(items) {
    const quantities = new Map();
    for (const item of merchandise(items)) {
      const qty = Number(item.qty ?? item.quantity ?? 1);
      const identity = item.sku ? 'sku:' + String(item.sku).trim().toLowerCase() : 'name:' + String(item.name || '').trim().toLowerCase();
      if (!Number.isInteger(qty) || qty < 1 || identity === 'name:') throw shippingError('SHIPPING_CART_INVALID');
      quantities.set(identity, (quantities.get(identity) || 0) + qty);
    }
    if (!quantities.size) throw shippingError('SHIPPING_CART_INVALID');
    return JSON.stringify([...quantities].sort((a, b) => a[0].localeCompare(b[0])));
  }
  function currentItems() { return configuration?.items?.() || []; }
  function currentKey() {
    let key;
    try { key = itemsKey(currentItems()); } catch (_) { key = 'empty'; }
    return JSON.stringify([destination.country, destination.postalCode, configuration?.currency, key]);
  }
  function state() { return { rates: rates.slice(), selected: selectedRate, loading, notice, destination: { ...destination }, currency: configuration?.currency, payPalNative, cardMode }; }
  function applyPaymentLayout() {
    const contact=document.getElementById('mj-paypal-delivery-contact'),phone=document.getElementById('mj-paypal-delivery-phone');
    const phoneRequired=payPalNative && configuration?.currency==='MXN' && !cardMode;
    if(contact)contact.hidden=!phoneRequired;
    if(phone)phone.required=phoneRequired;
    const cardSection = document.getElementById('mj-card-checkout');
    if (cardSection && payPalNative) cardSection.hidden = !cardMode;
    const container = document.getElementById('mj-shipping-checkout');
    if (container) {
      container.hidden = payPalNative && !cardMode;
      if (payPalNative && cardMode) {
        const target = document.getElementById('mj-card-shipping');
        if (target && container.parentNode !== target) target.append(container);
      }
    }
    const form = document.getElementById('co-form');
    if (form && payPalNative) form.style.display = cardMode ? 'flex' : 'none';
    for (const id of ['mj-product-form-divider','mj-product-form-title']) {
      const node = document.getElementById(id);
      if (node) {
        node.hidden = payPalNative && !cardMode;
        if (id === 'mj-product-form-divider') node.style.display = node.hidden ? 'none' : 'flex';
      }
    }
    const cardButton = document.getElementById('mj-card-open-product');
    if (cardButton) cardButton.hidden = !payPalNative || configuration?.currency !== 'MXN' || cardMode;
    const hint = document.getElementById('mj-paypal-shipping-note');
    if (hint) hint.textContent = payPalNative
      ? message('El envío se calcula con tu dirección en PayPal. Revisa el total antes de pagar.', 'Shipping is calculated using your PayPal address. Review the total before paying.')
      : message('Calcula y selecciona el envío antes de pagar. Usa esa misma dirección en PayPal.', 'Calculate and select shipping before paying. Use that same address in PayPal.');
  }
  function setPayPalNativeMode(value) { payPalNative = value === true; applyPaymentLayout(); emit(); }
  function showCardFields() {
    cardMode = true;
    const section = document.getElementById('mj-card-checkout'); if (section) section.hidden = false;
    applyPaymentLayout(); emit();
  }
  function showPayPalFields() {
    if (!payPalNative) return;
    cardMode = false;
    applyPaymentLayout(); emit();
  }
  function emit() {
    window.MJShippingCost = selectedRate?.price || 0;
    window.MJShippingCurrency = configuration?.currency;
    for (const listener of listeners) listener(state());
  }
  function invalidate(text = '') {
    requestNumber++;
    rates = [];
    selectedRate = null;
    quotedKey = '';
    loading = false;
    notice = text;
    emit();
  }
  function refresh() {
    const key = currentKey();
    if (key !== contextKey) {
      contextKey = key;
      invalidate();
    }
  }
  function configure(options) {
    if (!['MXN', 'USD'].includes(options.currency) || typeof options.items !== 'function') throw shippingError('SHIPPING_CURRENCY_INVALID');
    configuration = options;
    destination.country = options.country || (options.currency === 'USD' ? 'US' : 'MX');
    contextKey = currentKey();
    invalidate();
  }
  function setDestination(postalCode, country) {
    destination = { postalCode: normalizedPostal(postalCode, country), country: String(country || '').toUpperCase() };
    refresh();
  }
  function expiry(value) {
    if (value == null) return null;
    const parsed = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function serviceLabel(rate) {
    return [rate.carrier_name, rate.service_name, rate.delivery_description].filter(Boolean).join(' · ');
  }
  async function quote() {
    refresh();
    if (!configuration || !/^\d{5}$/.test(destination.postalCode) || !['MX', 'US'].includes(destination.country)) throw shippingError('SHIPPING_DESTINATION_INVALID');
    if (destination.country === 'US' && configuration.currency !== 'USD') throw shippingError('SHIPPING_MARKET_INVALID');
    const items = merchandise(currentItems()).map(item => ({ id: item.id, sku: item.sku, name: item.name, qty: Number(item.qty ?? item.quantity ?? 1) }));
    itemsKey(items);
    invalidate();
    const sequence = ++requestNumber;
    const key = contextKey;
    loading = true;
    notice = message('Calculando envío…', 'Calculating shipping…');
    emit();
    try {
      const response = await fetch('/api/shipping/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: destination.postalCode, country: destination.country, currency: configuration.currency, items })
      });
      const result = await response.json();
      if (!response.ok) throw shippingError(result.error_code || 'SHIPPING_QUOTE_UNAVAILABLE');
      refresh();
      if (sequence !== requestNumber || key !== contextKey) throw shippingError('SHIPPING_DESTINATION_CHANGED');
      const now = Date.now();
      const valid = (Array.isArray(result.quotes) ? result.quotes : []).map(rate => ({
        id: String(rate.id || ''), carrier: String(rate.carrier || ''), service: String(rate.service || ''),
        carrier_name: String(rate.carrier_name || rate.carrierDescription || rate.carrier || ''),
        service_name: String(rate.service_name || rate.serviceDescription || rate.service || ''),
        delivery_description: String(rate.delivery_description || ''),
        drop_off: rate.drop_off == null ? null : Number(rate.drop_off),
        days: String(rate.days ?? ''), price: Number(rate.price), currency: rate.currency,
        quote_token: rate.quote_token, expiresAt: expiry(rate.expires_at ?? result.expires_at)
      })).filter(rate => rate.id && rate.carrier && rate.service && Number.isFinite(rate.price) && rate.price > 0
        && rate.currency === configuration.currency && typeof rate.quote_token === 'string' && rate.quote_token.trim()
        && (rate.expiresAt === null || rate.expiresAt > now));
      if (!valid.length) throw shippingError('SHIPPING_NO_RATES');
      rates = valid.sort((a, b) => a.price - b.price);
      quotedKey = key;
      notice = message('Selecciona el servicio de envío.', 'Select your shipping service.');
      return rates.slice();
    } catch (error) {
      if (sequence === requestNumber) invalidate(errorMessage(error.code || 'SHIPPING_QUOTE_UNAVAILABLE'));
      if (/^(SHIPPING_|INVALID_SHIPPING_|PACKAGE_|PACKAGING_)/.test(error.code || '')) throw error;
      throw shippingError('SHIPPING_QUOTE_UNAVAILABLE');
    } finally {
      if (sequence === requestNumber) { loading = false; emit(); }
    }
  }
  function selectRate(index) {
    refresh();
    const rate = rates[Number(index)];
    if (!rate || quotedKey !== contextKey) throw shippingError('SHIPPING_QUOTE_REQUIRED');
    if (rate.expiresAt !== null && rate.expiresAt <= Date.now()) { invalidate(); throw shippingError('SHIPPING_QUOTE_EXPIRED'); }
    selectedRate = rate;
    notice = message('Envío seleccionado. Puedes continuar al pago.', 'Shipping selected. You can continue to payment.');
    emit();
    return rate;
  }
  function requireForPayment(currency, items = currentItems()) {
    refresh();
    if (!selectedRate || quotedKey !== contextKey) throw shippingError('SHIPPING_QUOTE_REQUIRED');
    if (currency !== configuration.currency) throw shippingError('SHIPPING_CURRENCY_INVALID');
    if (itemsKey(items) !== itemsKey(currentItems())) throw shippingError('SHIPPING_CART_CHANGED');
    if (selectedRate.expiresAt !== null && selectedRate.expiresAt <= Date.now()) { invalidate(); throw shippingError('SHIPPING_QUOTE_EXPIRED'); }
    return { ...selectedRate, postalCode: destination.postalCode, country: destination.country, contextKey };
  }
  function rememberOrder(orderId, selection) { orders.set(orderId, { ...selection }); }
  function requireForCapture(orderId) {
    const order = orders.get(orderId);
    if (!order) throw shippingError('SHIPPING_QUOTE_REQUIRED');
    refresh();
    if (order.addressRejected || contextKey !== order.contextKey || configuration?.currency !== order.currency
      || (selectedRate && selectedRate.quote_token !== order.quote_token)) throw shippingError('SHIPPING_QUOTE_CHANGED');
    // Proax distinguishes an expired APPROVED order from an already completed receipt.
    // Always preserve the original token; a retry may recover a lost completed response.
    return { ...order };
  }
  function addressChange(data, actions) {
    try {
      const selection = requireForCapture(data.orderID || data.orderId);
      const address = data.shippingAddress || data.shipping_address || {};
      const country = String(address.countryCode || address.country_code || '').toUpperCase();
      const postalCode = normalizedPostal(address.postalCode || address.postal_code, country);
      if (country !== selection.country || postalCode !== selection.postalCode) {
        orders.set(data.orderID || data.orderId, { ...selection, addressRejected: true });
        invalidate(errorMessage('SHIPPING_ADDRESS_MISMATCH'));
        return actions.reject();
      }
      return Promise.resolve();
    } catch (error) {
      notice = error.message;
      emit();
      return actions.reject();
    }
  }
  function optionsChange(data, actions) {
    try {
      const selection = requireForCapture(data.orderID || data.orderId);
      const option = data.selectedShippingOption || data.selected_shipping_option;
      if (!option || option.id !== selection.id) throw shippingError('SHIPPING_QUOTE_CHANGED');
      return Promise.resolve();
    } catch (error) { notice = error.message; emit(); return actions.reject(); }
  }
  function paypalCallbacks() { return { onShippingAddressChange: addressChange, onShippingOptionsChange: optionsChange }; }
  function subscribe(listener) { listeners.add(listener); listener(state()); return () => listeners.delete(listener); }

  function mount() {
    const container = document.getElementById('mj-shipping-checkout');
    if (!container) return;
    const currency = container.dataset.currency;
    const cart = container.dataset.kind === 'cart';
    configure({ currency, items: () => cart ? window.MJCart?.getCart() || [] : (window.MJCheckoutProduct ? [{
      ...window.MJCheckoutProduct, qty: Number(document.getElementById('co-qty')?.value || 1)
    }] : []) });
    const countryLabel = message('País de envío', 'Shipping country');
    const postalLabel = message('Código postal', 'Postal code');
    if (!document.getElementById('mj-shipping-style')) {
      const style = document.createElement('style'); style.id = 'mj-shipping-style';
      style.textContent = '#mj-shipping-checkout{font-size:14px;line-height:1.4;text-transform:none;font-weight:400}#mj-shipping-checkout fieldset{min-width:0}#mj-shipping-checkout legend{font-size:14px;font-weight:600;text-transform:none}#mj-shipping-checkout label{font-size:12px;line-height:1.4;text-transform:none;font-weight:400;min-width:0}#mj-shipping-checkout input,#mj-shipping-checkout select,#mj-shipping-checkout button{font-size:14px;line-height:1.4;text-transform:none;font-weight:400;min-width:0}#mj-shipping-checkout .mj-shipping-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:12px;align-items:end}#mj-shipping-checkout #mj-shipping-rates span{font-size:14px;line-height:1.4;text-transform:none;font-weight:400}#mj-shipping-checkout #mj-shipping-status{font-size:12px;line-height:1.4;text-transform:none}@media(max-width:600px){#mj-shipping-checkout .mj-shipping-fields{grid-template-columns:repeat(2,minmax(0,1fr))}#mj-shipping-checkout #mj-shipping-calculate{grid-column:1/-1}}';
      document.head.append(style);
    }
    container.innerHTML = `<fieldset style="border:1px solid #ddd;border-radius:10px;padding:14px;margin:14px 0;text-align:left;"><legend>${message('Envío', 'Shipping')}</legend><div class="mj-shipping-fields"><label>${countryLabel}<select id="mj-shipping-country" style="display:block;width:100%;padding:9px;border:1px solid #bbb;border-radius:6px;"><option value="MX">${message('México','Mexico')}</option><option value="US">United States</option></select></label><label>${postalLabel}<input id="mj-shipping-postal" inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="[0-9]{5}" style="display:block;width:100%;padding:9px;border:1px solid #bbb;border-radius:6px;"></label><button id="mj-shipping-calculate" type="button" style="padding:10px 14px;background:var(--burgundy,#6b0f2a);color:white;border:0;border-radius:6px;cursor:pointer;">${message('Calcular envío', 'Calculate shipping')}</button></div><p id="mj-shipping-status" role="status" aria-live="polite" style="margin:10px 0;"></p><div id="mj-shipping-rates" role="group" aria-label="${message('Servicios de envío', 'Shipping services')}"></div></fieldset>`;
    const country = document.getElementById('mj-shipping-country');
    const postal = document.getElementById('mj-shipping-postal');
    const button = document.getElementById('mj-shipping-calculate');
    const status = document.getElementById('mj-shipping-status');
    const choices = document.getElementById('mj-shipping-rates');
    const longPostal = document.getElementById('co-cp');
    const longCountry = document.getElementById('co-country');
    country.value = destination.country;
    function synchronize(input, sourceCountry) {
      postal.value = input.value;
      country.value = sourceCountry.value;
      if (longPostal) longPostal.value = postal.value;
      if (longCountry) longCountry.value = country.value;
      setDestination(postal.value, country.value);
    }
    postal.addEventListener('input', () => synchronize(postal, country));
    country.addEventListener('change', () => {
      synchronize(postal, country);
      const wanted = 'USD';
      if (country.value === 'US' && currency !== 'USD') {
        const url = new URL(window.location.href);
        url.pathname = wanted === 'USD' ? (url.pathname.startsWith('/en/') ? url.pathname : '/en' + url.pathname) : url.pathname.replace(/^\/en\//, '/');
        url.searchParams.set('country', country.value);
        window.location.assign(url.href);
      }
    });
    if (longPostal) longPostal.addEventListener('input', () => synchronize(longPostal, longCountry || country));
    if (longCountry) longCountry.addEventListener('change', () => synchronize(longPostal || postal, longCountry));
    button.addEventListener('click', async () => {
      try { synchronize(postal, country); await quote(); } catch (error) { status.textContent = error.message; }
    });
    subscribe(snapshot => {
      button.disabled = snapshot.loading;
      status.textContent = snapshot.notice || message('Indica el código postal para calcular el envío antes de pagar.', 'Enter your postal code to calculate shipping before paying.');
      choices.replaceChildren();
      snapshot.rates.forEach((rate, index) => {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;gap:9px;align-items:center;margin:8px 0;padding:10px;border:1px solid #ddd;border-radius:7px;cursor:pointer;';
        const input = document.createElement('input');
        input.type = 'radio'; input.name = 'shipping_option'; input.value = String(index); input.checked = rate === snapshot.selected;
        input.addEventListener('change', () => { try { selectRate(index); } catch (error) { status.textContent = error.message; } });
        const text = document.createElement('span');
        text.textContent = `${serviceLabel(rate)}${rate.days ? ' · ' + rate.days : ''} · ${new Intl.NumberFormat(english() ? 'en-US' : 'es-MX', { style: 'currency', currency }).format(rate.price)} ${currency}`;
        label.append(input, text); choices.append(label);
      });
    });
    if (longPostal?.value) synchronize(longPostal, longCountry || country);
    window.addEventListener('mj:cartUpdated', refresh);
    applyPaymentLayout();
  }
  window.MJShippingCheckout = { configure, setDestination, quote, selectRate, refresh, invalidate, state, subscribe,
    requireForPayment, rememberOrder, requireForCapture, paypalCallbacks, errorMessage, itemsKey, serviceLabel,
    setPayPalNativeMode, showCardFields, showPayPalFields };
  document.addEventListener('DOMContentLoaded', mount);
})();
