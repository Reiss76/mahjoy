(function () {
  async function quote(items, currency, discountCode) {
    const response = await fetch('/api/checkout/prices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, currency, discount_code: discountCode || null })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not verify prices. Please try again.');
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
    const shippingItem = i => !i.sku && /^(shipping|envío)$/i.test(i.name);
    const merchandise = items.filter(i => !shippingItem(i));
    const discount = window.MJAppliedDiscount || window.cartDiscount;
    const prices = await quote(merchandise, currency, discount && discount.code);
    let cents = 0;
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
      cents += Math.round(value * 100) * qty;
    }
    const breakdown = unit.amount.breakdown || {};
    if (Object.values(breakdown).some(amount => amount.currency_code !== currency)) throw new Error('Mixed checkout currencies are not allowed.');
    const shipping = Number(breakdown.shipping && breakdown.shipping.value || 0);
    if (Math.round(Number(breakdown.item_total && breakdown.item_total.value) * 100) !== cents || !Number.isFinite(shipping) || shipping < 0
      || Math.round(Number(unit.amount.value) * 100) !== cents + Math.round(shipping * 100)) throw new Error('Invalid checkout total. Please refresh the page.');
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
    return (await checkoutRequest('create', {payload,discount_code:discount && discount.code})).id;
  }
  async function checkoutRequest(action,body) {
    const response=await fetch('/api/checkout/paypal/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok) {
      if(result.error==='US_REQUIRES_USD'){goToUsMarket();return new Promise(function(){});}
      throw new Error(result.error || 'Could not verify payment. Please try again.');
    }
    return result;
  }
  function goToUsMarket() {
    const url=new URL(window.location.href);
    if(!url.pathname.startsWith('/en/'))url.pathname='/en'+url.pathname;
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
  async function capture(orderId) {return checkoutRequest('capture',{orderId});}
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
