/**
 * MAH JOY — PayPal Checkout Integration
 * Uses PayPal JS SDK for client-side payment
 */

const MJ_PAYPAL_API = 'https://proax.app/api/public/mahjoy';

// Wait for DOM and PayPal SDK to load
document.addEventListener('DOMContentLoaded', function() {
  // Give checkout.js time to initialize
  setTimeout(initPayPalButton, 500);
});

function initPayPalButton() {
  const container = document.getElementById('paypal-button-container');
  if (!container) return;
  
  // Check if PayPal SDK loaded
  if (typeof paypal === 'undefined') {
    console.error('PayPal SDK not loaded');
    container.innerHTML = '<p style="color:#999;font-size:.8rem;text-align:center;">PayPal no disponible</p>';
    return;
  }

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
      
      // Build order items
      const items = [{
        name: currentProduct.name.substring(0, 127), // PayPal limit
        unit_amount: {
          currency_code: 'MXN',
          value: discountedPrice.toFixed(2)
        },
        quantity: qty.toString()
      }];
      
      // Add shipping as item if present
      if (shippingCost > 0) {
        items.push({
          name: 'Envío',
          unit_amount: {
            currency_code: 'MXN',
            value: shippingCost.toFixed(2)
          },
          quantity: '1'
        });
      }
      
      return actions.order.create({
        intent: 'CAPTURE',
        purchase_units: [{
          description: 'MAH JOY - ' + currentProduct.name,
          amount: {
            currency_code: 'MXN',
            value: total.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: 'MXN',
                value: total.toFixed(2)
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
      // Restore button
      initPayPalButton();
    }
  }).render('#paypal-button-container');
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
