/**
 * MAH JOY — Cart System
 * localStorage-based cart, works across all pages
 */

const MJ_CART_KEY = 'mj_cart';

// ─── Cart data ────────────────────────────────────────────────────────────────

function getCart() {
  try { return JSON.parse(localStorage.getItem(MJ_CART_KEY) || '[]'); }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(MJ_CART_KEY, JSON.stringify(cart));
  updateCartBadge();
  window.dispatchEvent(new CustomEvent('mj:cartUpdated', { detail: cart }));
}

function addToCart(product, qty = 1) {
  const cart = getCart();
  const idx = cart.findIndex(i => i.id === product.id);
  if (idx >= 0) {
    cart[idx].qty += qty;
  } else {
    cart.push({
      id: product.id,
      sku: product.sku,
      name: product.name,
      price: parseFloat(product.price) || 0,
      image: product.primary_image_url || null,
      qty,
    });
  }
  saveCart(cart);
  showAddedFeedback();
}

function removeFromCart(productId) {
  saveCart(getCart().filter(i => i.id !== productId));
}

function updateQty(productId, qty) {
  const cart = getCart();
  const idx = cart.findIndex(i => i.id === productId);
  if (idx >= 0) {
    if (qty <= 0) cart.splice(idx, 1);
    else cart[idx].qty = qty;
  }
  saveCart(cart);
}

function clearCart() { saveCart([]); }

function cartTotal() {
  return getCart().reduce((acc, i) => acc + i.price * i.qty, 0);
}

function cartCount() {
  return getCart().reduce((acc, i) => acc + i.qty, 0);
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function updateCartBadge() {
  const count = cartCount();
  document.querySelectorAll('.mj-cart-badge').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

// ─── Feedback toast ───────────────────────────────────────────────────────────

function showAddedFeedback() {
  let toast = document.getElementById('mj-cart-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mj-cart-toast';
    toast.style.cssText = `
      position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);
      background:var(--burgundy);color:#fff;
      font-family:'Plus Jakarta Sans',sans-serif;font-size:.85rem;font-weight:600;
      padding:.75rem 1.5rem;border-radius:999px;
      box-shadow:0 4px 20px rgba(107,15,42,.3);
      z-index:9999;transition:opacity .3s;opacity:0;pointer-events:none;
      white-space:nowrap;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = '✓ Agregado al carrito';
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// ─── Cart icon injection (nav) ────────────────────────────────────────────────

function injectCartIcon() {
  // Add cart icon to nav if not already there
  const navMenus = document.querySelectorAll('.nav-menu');
  navMenus.forEach(nav => {
    if (nav.querySelector('.mj-cart-nav')) return;
    const cartLink = document.createElement('a');
    cartLink.href = 'cart.html';
    cartLink.className = 'nav-link w-inline-block mj-cart-nav';
    cartLink.style.cssText = 'position:relative;';
    cartLink.innerHTML = `
      <div class="nav-link-text" style="display:flex;align-items:center;gap:.4rem;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
        Carrito
      </div>
      <span class="mj-cart-badge" style="
        display:none;position:absolute;top:-4px;right:-8px;
        background:var(--orchid);color:#fff;
        font-family:'Plus Jakarta Sans',sans-serif;font-size:.6rem;font-weight:800;
        width:18px;height:18px;border-radius:50%;
        align-items:center;justify-content:center;
        line-height:1;
      ">0</span>
    `;
    nav.appendChild(cartLink);
  });
  updateCartBadge();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  injectCartIcon();
  updateCartBadge();
});

// Expose globally
window.MJCart = { getCart, addToCart, removeFromCart, updateQty, clearCart, cartTotal, cartCount };
