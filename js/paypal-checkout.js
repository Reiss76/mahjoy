/**
 * MAH JOY — PayPal Checkout Integration
 * Uses PayPal JS SDK for client-side payment
 */
(function() {
'use strict';

var MJ_PAYPAL_API = 'https://proax.app/api/public/mahjoy';
var paypalButtonRendered = false; // Prevent duplicate renders

// Detect if EN checkout (uses USD) or ES checkout (uses MXN)
var isEnCheckout = window.location.pathname.includes('/en/');
var PAYPAL_CURRENCY = isEnCheckout ? 'USD' : 'MXN';

// Handle static PayPal button click
function setupPayPalStaticButton() {
  console.log('[PayPal] setupPayPalStaticButton called');
  const staticBtn = document.getElementById('paypal-static-btn');
  console.log('[PayPal] Button found:', !!staticBtn);
  if (staticBtn && !staticBtn._paypalHandlerAttached) {
    staticBtn._paypalHandlerAttached = true;
    console.log('[PayPal] Attaching click handler');
    staticBtn.addEventListener('click', function() {
      console.log('[PayPal] Button clicked!');
      // Validate form first
      const form = document.getElementById('co-form');
      if (form && !form.checkValidity()) {
        form.reportValidity();
        return;
      }
      
      // Check email match
      if (form) {
        const email = form.email?.value?.trim();
        const emailConfirm = form.email_confirm?.value?.trim();
        if (emailConfirm && email !== emailConfirm) {
          const mismatchEl = document.getElementById('email-mismatch');
          if (mismatchEl) mismatchEl.style.display = 'block';
          document.getElementById('co-email-confirm')?.focus();
          return;
        }
      }
      
      // Check if PayPal SDK is available
      if (typeof paypal === 'undefined') {
        alert('PayPal no está disponible en este momento. Por favor usa "Pagar con tarjeta".');
        return;
      }
      
      // Check if product is loaded
      if (!window.MJCheckoutProduct) {
        alert('Error: Producto no cargado. Recarga la página.');
        return;
      }
      
      // Trigger PayPal checkout
      processPayPalPayment();
    });
  }
}

// Run setup immediately if DOM ready, otherwise wait
console.log('[PayPal] Script loaded, readyState:', document.readyState);
if (document.readyState === 'loading') {
  console.log('[PayPal] Waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', setupPayPalStaticButton);
} else {
  console.log('[PayPal] DOM ready, running setup now');
  setupPayPalStaticButton();
}

// Process PayPal payment when static button clicked
function processPayPalPayment() {
  const form = document.getElementById('co-form');
  const currentProduct = window.MJCheckoutProduct;
  const qty = parseInt(form?.qty?.value) || 1;
  const appliedDiscount = window.MJAppliedDiscount || null;
  const shippingCost = window.MJShippingCost || 0;
  
  console.log('[PayPal] processPayPalPayment - shippingCost:', shippingCost, 'window.MJShippingCost:', window.MJShippingCost);
  
  const basePrice = parseFloat(currentProduct.price) || 0;
  const discountedPrice = appliedDiscount && appliedDiscount.pct > 0
    ? Math.round(basePrice * (1 - appliedDiscount.pct / 100) * 100) / 100
    : basePrice;
  
  const productTotal = discountedPrice * qty;
  let shippingForPayPal = shippingCost;
  if (isEnCheckout && shippingCost > 0) {
    const rate = window.cachedExchangeRate || 19.5;
    shippingForPayPal = Math.round((shippingCost / rate) * 100) / 100;
  }
  const total = productTotal + shippingForPayPal;
  
  console.log('[PayPal] FINAL VALUES:', {
    basePrice,
    discountedPrice,
    productTotal,
    shippingCost,
    shippingForPayPal,
    total,
    'window.MJShippingCost': window.MJShippingCost,
    'window.MJAppliedDiscount': window.MJAppliedDiscount
  });
  
  // Alert for testing
  if (total <= productTotal && shippingCost === 0) {
    console.warn('[PayPal] WARNING: Shipping cost is $0! Check if shipping was selected.');
  }
  
  // Build items array for PayPal with individual products
  var items = [{
    name: currentProduct.name.substring(0, 127),
    sku: currentProduct.sku || '',
    unit_amount: {
      currency_code: PAYPAL_CURRENCY,
      value: discountedPrice.toFixed(2)
    },
    quantity: qty.toString()
  }];
  var itemTotal = productTotal;
  
  // Add shipping as item if present
  if (shippingForPayPal > 0) {
    items.push({
      name: isEnCheckout ? 'Shipping' : 'Envío',
      unit_amount: {
        currency_code: PAYPAL_CURRENCY,
        value: shippingForPayPal.toFixed(2)
      },
      quantity: '1'
    });
    itemTotal += shippingForPayPal;
  }
  
  // Create PayPal order
  paypal.Buttons({
    style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'paypal', height: 45 },
    createOrder: function(data, actions) {
      return actions.order.create({
        intent: 'CAPTURE',
        purchase_units: [{
          description: 'MAH JOY - ' + currentProduct.name,
          amount: {
            currency_code: PAYPAL_CURRENCY,
            value: total.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: PAYPAL_CURRENCY,
                value: itemTotal.toFixed(2)
              }
            }
          },
          items: items
        }],
        application_context: {
          brand_name: 'MAH JOY',
          shipping_preference: 'NO_SHIPPING'
        }
      });
    },
    onApprove: function(data, actions) {
      return actions.order.capture().then(function(details) {
        savePayPalOrder(details);
      });
    },
    onError: function(err) {
      console.error('PayPal error:', err);
      alert('Error de PayPal. Por favor intenta de nuevo o usa "Pagar con tarjeta".');
    }
  }).render('#paypal-button-container').then(function() {
    // Trigger click on the rendered PayPal button
    const ppBtn = document.querySelector('#paypal-button-container .paypal-button');
    if (ppBtn) ppBtn.click();
  });
}

// Expose function for checkout.js to call when product is ready
window.initPayPalWhenReady = function() {
  // No longer auto-rendering, using static button instead
};

// Also try automatic initialization with retries as backup
function tryInitPayPal(retries) {
  const hasPayPal = typeof paypal !== 'undefined';
  const hasContainer = document.getElementById('paypal-button-container');
  const hasProduct = window.MJCheckoutProduct;
  
  if (hasPayPal && hasContainer && hasProduct) {
    initPayPalButton();
  } else if (retries > 0) {
    setTimeout(function() { tryInitPayPal(retries - 1); }, 1000);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() { tryInitPayPal(10); }, 1000);
  });
} else {
  setTimeout(function() { tryInitPayPal(10); }, 1000);
}

function initPayPalButton() {
  const container = document.getElementById('paypal-button-container');
  if (!container) return;
  
  // Prevent duplicate renders
  if (paypalButtonRendered) {
    console.log('PayPal buttons already rendered');
    return;
  }
  
  // Check if PayPal SDK loaded (may be blocked by Safari privacy settings)
  if (typeof paypal === 'undefined') {
    console.error('PayPal SDK not loaded - may be blocked by browser privacy settings');
    container.innerHTML = '<p style="color:#888;font-size:.75rem;text-align:center;padding:8px;">PayPal blocked by browser. Use Card payment or disable "Prevent Cross-Site Tracking" in Safari Settings.</p>';
    return;
  }
  
  // Clear container before rendering
  container.innerHTML = '';

  paypal.Buttons({
    style: {
      layout: 'horizontal',
      color: 'blue',
      shape: 'pill',
      label: 'paypal',
      tagline: false,
      height: 45
    },
    
    // Validate form before creating order
    onClick: function(data, actions) {
      const form = document.getElementById('co-form');
      if (!form.checkValidity()) {
        form.reportValidity();
        return actions.reject();
      }
      
      // Check email match
      const email = form.email.value.trim();
      const emailConfirm = form.email_confirm?.value.trim();
      if (emailConfirm && email !== emailConfirm) {
        document.getElementById('email-mismatch').style.display = 'block';
        document.getElementById('co-email-confirm')?.focus();
        return actions.reject();
      }
      
      return actions.resolve();
    },
    
    // Create PayPal order
    createOrder: function(data, actions) {
      const form = document.getElementById('co-form');
      const currentProduct = window.MJCheckoutProduct || null;
      const qty = parseInt(form.qty?.value) || 1;
      const appliedDiscount = window.MJAppliedDiscount || null;
      const shippingCost = window.MJShippingCost || 0;
      
      console.log('[PayPal] createOrder - shippingCost:', shippingCost, 'window.MJShippingCost:', window.MJShippingCost);
      
      if (!currentProduct) {
        alert('No se encontró el producto');
        return actions.reject();
      }
      
      // Calculate price
      const basePrice = parseFloat(currentProduct.price) || 0;
      const discountedPrice = appliedDiscount && appliedDiscount.pct > 0
        ? Math.round(basePrice * (1 - appliedDiscount.pct / 100) * 100) / 100
        : basePrice;
      
      const productTotal = discountedPrice * qty;
      const total = productTotal + shippingCost;
      
      // Build order items - use USD for EN, MXN for ES
      const items = [{
        name: currentProduct.name.substring(0, 127), // PayPal limit
        unit_amount: {
          currency_code: PAYPAL_CURRENCY,
          value: discountedPrice.toFixed(2)
        },
        quantity: qty.toString()
      }];
      
      // Add shipping as item if present
      // For EN checkout, shipping from Envia is MXN - need to convert to USD
      let shippingForPayPal = shippingCost;
      if (isEnCheckout && shippingCost > 0) {
        const rate = window.cachedExchangeRate || 19.5;
        shippingForPayPal = Math.round((shippingCost / rate) * 100) / 100;
      }
      
      if (shippingForPayPal > 0) {
        items.push({
          name: 'Shipping',
          unit_amount: {
            currency_code: PAYPAL_CURRENCY,
            value: shippingForPayPal.toFixed(2)
          },
          quantity: '1'
        });
      }
      
      // Calculate final total with converted shipping
      const finalTotal = productTotal + shippingForPayPal;
      
      return actions.order.create({
        intent: 'CAPTURE',
        purchase_units: [{
          description: 'MAH JOY - ' + currentProduct.name,
          amount: {
            currency_code: PAYPAL_CURRENCY,
            value: finalTotal.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: PAYPAL_CURRENCY,
                value: finalTotal.toFixed(2)
              }
            }
          },
          items: items
        }],
        application_context: {
          brand_name: 'MAH JOY',
          shipping_preference: 'NO_SHIPPING'
        }
      });
    },
    
    // Handle approved payment
    onApprove: function(data, actions) {
      // Show processing state
      const container = document.getElementById('paypal-button-container');
      container.innerHTML = '<p style="text-align:center;color:var(--burgundy);font-family:Plus Jakarta Sans,sans-serif;font-weight:600;">Procesando pago...</p>';
      
      return actions.order.capture().then(function(details) {
        console.log('PayPal payment captured:', details);
        
        // Save order to our system
        savePayPalOrder(details);
      });
    },
    
    onCancel: function(data) {
      console.log('PayPal payment cancelled');
    },
    
    onError: function(err) {
      console.error('PayPal error:', err);
      alert('Error al procesar el pago con PayPal. Por favor intenta de nuevo.');
      // Don't re-render — buttons still exist
    }
  }).render('#paypal-button-container').then(function() {
    paypalButtonRendered = true;
    console.log('PayPal buttons rendered successfully');
  }).catch(function(err) {
    console.error('PayPal render error:', err);
    // Silent fail - just leave empty, user can use card
  });
}

async function savePayPalOrder(paypalDetails) {
  const form = document.getElementById('co-form');
  const currentProduct = window.MJCheckoutProduct || null;
  const qty = parseInt(form.qty?.value) || 1;
  const appliedDiscount = window.MJAppliedDiscount || null;
  const shippingCost = window.MJShippingCost || 0;
  
  // Calculate total
  const basePrice = parseFloat(currentProduct?.price) || 0;
  const discountedPrice = appliedDiscount && appliedDiscount.pct > 0
    ? Math.round(basePrice * (1 - appliedDiscount.pct / 100) * 100) / 100
    : basePrice;
  const productTotal = discountedPrice * qty;
  const total = productTotal + shippingCost;
  
  // Build cart
  const cart = currentProduct
    ? [{ name: currentProduct.name, price: discountedPrice, qty: qty }]
    : [];
  if (shippingCost > 0) {
    cart.push({ name: 'Envio', price: shippingCost, qty: 1 });
  }
  
  // Order data
  const orderData = {
    order_id: 'paypal-' + paypalDetails.id,
    customer_name: `${form.name.value} ${form.lastname.value}`.trim(),
    customer_email: form.email.value.trim(),
    customer_phone: form.phone.value.trim(),
    items: cart,
    subtotal: productTotal,
    shipping: shippingCost,
    total: total,
    status: 'paid',
    payment_method: 'paypal',
    payment_id: paypalDetails.id,
    shipping_address: {
      street: form.street?.value || '',
      neighborhood: form.neighborhood?.value || '',
      cp: form.cp?.value || '',
      city: form.city?.value || '',
      state: form.state?.value || '',
      notes: form.notes?.value || ''
    },
    discount_code: appliedDiscount?.code || null,
    vendor_code: window.MJVendor?.getCode() || null
  };
  
  try {
    // Save to Proax
    const res = await fetch(MJ_PAYPAL_API + '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    
    const result = await res.json();
    console.log('Order saved:', result);
  } catch (err) {
    console.error('Error saving order:', err);
    // Don't block user — payment already captured
  }
  
  // Show success
  showPaymentSuccess(paypalDetails);
}

function showPaymentSuccess(details) {
  // Hide checkout form
  const content = document.getElementById('co-content');
  if (content) content.style.display = 'none';
  
  // Show thank you
  const thanks = document.getElementById('co-thanks');
  if (thanks) {
    thanks.style.display = 'block';
    // Pre-fill name from PayPal if available
    const payerName = details.payer?.name?.given_name || '';
    if (payerName) {
      const form = document.getElementById('co-form');
      const name = form?.name?.value || '';
      // Update success message
    }
  } else {
    // Fallback if no thanks section
    alert('¡Pago exitoso! Tu pedido ha sido procesado. Gracias por tu compra.');
  }
  
  // Clear cart
  if (typeof mjCartClear === 'function') mjCartClear();
  
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Expose for checkout.js
window.MJPayPal = {
  init: initPayPalButton
};

})(); // End IIFE
