/**
 * MAH JOY - Tile Bag Upsell Popup
 * 
 * Muestra un popup sugiriendo Tile Bags con 10% de descuento
 * cuando el usuario agrega Tiles al carrito o hace compra directa.
 * 
 * Funciona en ES y EN.
 */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  
  const CONFIG = {
    API_URL: 'https://api-production-b888.up.railway.app/public/shop/mahjoy/products',
    CART_KEY: 'mj_cart',
    SHOWN_KEY: 'mj_tilebag_upsell_shown',
    PROMO_CODE: 'TILEBAG10',
    DISCOUNT_PCT: 10,
  };

  // Detectar idioma
  const isEnglish = window.location.pathname.includes('/en/');
  
  const TEXTS = {
    badge: isEnglish ? 'SPECIAL OFFER' : 'OFERTA ESPECIAL',
    title: isEnglish ? 'Protect your Tiles' : 'Protege tus Tiles',
    discount: '10% OFF',
    subtitle: isEnglish ? 'on your Tile Bag when you add now' : 'en tu Tile Bag al agregar ahora',
    savings: isEnglish ? 'Save' : 'Ahorras',
    noThanks: isEnglish ? 'No, thanks' : 'No, gracias',
    addToCart: isEnglish ? 'Add to cart' : 'Agregar al carrito',
    footer: isEnglish ? 'Discount applied automatically' : 'Descuento aplicado automáticamente',
    toast: isEnglish ? 'added with 10% discount' : 'agregado con 10% de descuento',
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTILOS DEL POPUP
  // ═══════════════════════════════════════════════════════════════════════════
  
  const COLORS = {
    burgundy: '#6B0F2A',
    burgundyDark: '#4A0A1D',
    orchid: '#C76BA4',
    blush: '#F5E8F0',
    cream: '#FAF6F0',
  };

  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    
    .mj-tilebag-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(107, 15, 42, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s ease;
      padding: 16px;
    }
    
    .mj-tilebag-overlay.visible {
      opacity: 1;
    }
    
    .mj-tilebag-popup {
      background: ${COLORS.cream};
      border-radius: 24px;
      max-width: 440px;
      width: 100%;
      overflow: hidden;
      transform: scale(0.9) translateY(20px);
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 25px 60px -12px rgba(107, 15, 42, 0.35);
    }
    
    .mj-tilebag-overlay.visible .mj-tilebag-popup {
      transform: scale(1) translateY(0);
    }
    
    .mj-tilebag-header {
      background: linear-gradient(145deg, ${COLORS.blush} 0%, ${COLORS.cream} 100%);
      padding: 28px 24px;
      text-align: center;
      position: relative;
      border-bottom: 1px solid rgba(199, 107, 164, 0.15);
    }
    
    .mj-tilebag-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 36px;
      height: 36px;
      border: none;
      background: white;
      border-radius: 50%;
      cursor: pointer;
      font-size: 20px;
      color: ${COLORS.burgundy};
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      box-shadow: 0 2px 12px rgba(107, 15, 42, 0.12);
    }
    
    .mj-tilebag-close:hover {
      background: ${COLORS.blush};
      transform: scale(1.1) rotate(90deg);
    }
    
    .mj-tilebag-badge {
      display: inline-block;
      background: ${COLORS.burgundy};
      color: white;
      padding: 8px 20px;
      border-radius: 999px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 16px;
    }
    
    .mj-tilebag-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 28px;
      font-weight: 700;
      font-style: italic;
      color: ${COLORS.burgundy};
      margin: 0 0 8px 0;
      line-height: 1.2;
    }
    
    .mj-tilebag-discount {
      display: inline-block;
      background: linear-gradient(135deg, ${COLORS.burgundy} 0%, #8B1538 100%);
      color: white;
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 32px;
      font-weight: 900;
      padding: 8px 20px;
      border-radius: 12px;
      margin: 16px 0 8px;
      letter-spacing: -0.02em;
    }
    
    .mj-tilebag-subtitle {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      color: #777;
      margin: 0;
      font-weight: 500;
    }
    
    .mj-tilebag-products {
      padding: 16px;
      max-height: 42vh;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    
    .mj-tilebag-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    
    .mj-tilebag-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 14px 10px;
      background: white;
      border-radius: 16px;
      cursor: pointer;
      transition: all 0.25s ease;
      border: 2px solid transparent;
      box-shadow: 0 2px 8px rgba(107, 15, 42, 0.06);
    }
    
    .mj-tilebag-card:hover {
      background: ${COLORS.blush};
      border-color: ${COLORS.orchid};
      transform: translateY(-2px);
    }
    
    .mj-tilebag-card.selected {
      background: ${COLORS.blush};
      border-color: ${COLORS.burgundy};
      box-shadow: 0 4px 16px rgba(107, 15, 42, 0.15);
    }
    
    .mj-tilebag-img {
      width: 80px;
      height: 80px;
      border-radius: 12px;
      object-fit: cover;
      margin-bottom: 10px;
      box-shadow: 0 4px 12px rgba(107, 15, 42, 0.1);
    }
    
    .mj-tilebag-name {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px;
      font-weight: 700;
      color: ${COLORS.burgundy};
      margin: 0 0 6px 0;
      line-height: 1.3;
    }
    
    .mj-tilebag-prices {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: center;
    }
    
    .mj-tilebag-price-old {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      color: #aaa;
      text-decoration: line-through;
    }
    
    .mj-tilebag-price-new {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 16px;
      font-weight: 800;
      color: ${COLORS.burgundy};
    }
    
    .mj-tilebag-savings {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 11px;
      color: ${COLORS.orchid};
      font-weight: 700;
      margin-top: 4px;
    }
    
    .mj-tilebag-actions {
      padding: 8px 24px 24px;
      display: flex;
      gap: 12px;
    }
    
    .mj-tilebag-btn {
      flex: 1;
      padding: 16px 24px;
      border-radius: 999px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.25s ease;
      border: none;
      letter-spacing: 0.02em;
    }
    
    .mj-tilebag-btn-secondary {
      background: white;
      color: ${COLORS.burgundy};
      border: 2px solid ${COLORS.blush};
    }
    
    .mj-tilebag-btn-secondary:hover {
      background: ${COLORS.blush};
      border-color: ${COLORS.orchid};
    }
    
    .mj-tilebag-btn-primary {
      background: ${COLORS.burgundy};
      color: white;
      box-shadow: 0 4px 16px rgba(107, 15, 42, 0.3);
    }
    
    .mj-tilebag-btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(107, 15, 42, 0.4);
      background: #7A1230;
    }
    
    .mj-tilebag-footer {
      padding: 14px 24px;
      background: ${COLORS.blush};
      text-align: center;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      color: ${COLORS.orchid};
      font-weight: 600;
    }
    
    @media (max-width: 480px) {
      .mj-tilebag-popup {
        border-radius: 20px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
      }
      
      .mj-tilebag-header {
        padding: 20px 16px;
        flex-shrink: 0;
      }
      
      .mj-tilebag-title {
        font-size: 24px;
      }
      
      .mj-tilebag-discount {
        font-size: 26px;
        padding: 6px 16px;
      }
      
      .mj-tilebag-products {
        flex: 1;
        overflow-y: auto;
        max-height: none;
        padding: 12px;
      }
      
      .mj-tilebag-grid {
        gap: 10px;
      }
      
      .mj-tilebag-img {
        width: 65px;
        height: 65px;
      }
      
      .mj-tilebag-actions {
        flex-shrink: 0;
        padding: 12px 16px 20px;
        flex-direction: column;
        gap: 10px;
      }
      
      .mj-tilebag-btn {
        padding: 14px 20px;
        font-size: 14px;
      }
      
      .mj-tilebag-footer {
        padding: 12px;
        flex-shrink: 0;
      }
    }
  `;

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════════════════
  
  function getCart() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.CART_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function setCart(cart) {
    localStorage.setItem(CONFIG.CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('cartUpdated', { detail: cart }));
    if (window.updateCartBadge) window.updateCartBadge();
  }

  function hasTiles(cart) {
    return cart.some(item => 
      /\btile[s]?\b/i.test(item.name || '') && !/bag/i.test(item.name || '')
    );
  }

  function hasTileBags(cart) {
    return cart.some(item => /tile bag/i.test(item.name || ''));
  }

  function formatPrice(price) {
    const currency = isEnglish ? 'USD' : 'MXN';
    const locale = isEnglish ? 'en-US' : 'es-MX';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  }

  function resolveImageUrl(url) {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    const base = 'https://api-production-b888.up.railway.app';
    if (url.startsWith('/api/public/media')) {
      return base + url.replace('/api/public/media', '/public/media');
    }
    if (url.startsWith('/public/media')) {
      return base + url;
    }
    return url;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POPUP UI
  // ═══════════════════════════════════════════════════════════════════════════
  
  let popupElement = null;
  let selectedProduct = null;
  let pendingCheckoutUrl = null;

  function injectStyles() {
    if (document.getElementById('mj-tilebag-styles')) return;
    const style = document.createElement('style');
    style.id = 'mj-tilebag-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function createPopup(products) {
    injectStyles();
    if (!products.length) return null;
    
    selectedProduct = products[0];
    
    const overlay = document.createElement('div');
    overlay.className = 'mj-tilebag-overlay';
    overlay.innerHTML = `
      <div class="mj-tilebag-popup">
        <div class="mj-tilebag-header">
          <button class="mj-tilebag-close" aria-label="Cerrar">×</button>
          <div class="mj-tilebag-badge">${TEXTS.badge}</div>
          <h2 class="mj-tilebag-title">${TEXTS.title}</h2>
          <div class="mj-tilebag-discount">${TEXTS.discount}</div>
          <p class="mj-tilebag-subtitle">${TEXTS.subtitle}</p>
        </div>
        
        <div class="mj-tilebag-products">
          <div class="mj-tilebag-grid">
            ${products.map((p, i) => `
              <div class="mj-tilebag-card ${i === 0 ? 'selected' : ''}" data-index="${i}">
                <img class="mj-tilebag-img" src="${p.image}" alt="${p.name}" />
                <h3 class="mj-tilebag-name">${p.name}</h3>
                <div class="mj-tilebag-prices">
                  <span class="mj-tilebag-price-old">${formatPrice(p.original_price)}</span>
                  <span class="mj-tilebag-price-new">${formatPrice(p.discount_price)}</span>
                </div>
                <div class="mj-tilebag-savings">${TEXTS.savings} ${formatPrice(p.original_price - p.discount_price)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="mj-tilebag-actions">
          <button class="mj-tilebag-btn mj-tilebag-btn-secondary" data-action="skip">
            ${TEXTS.noThanks}
          </button>
          <button class="mj-tilebag-btn mj-tilebag-btn-primary" data-action="add">
            ${TEXTS.addToCart}
          </button>
        </div>
        
        <div class="mj-tilebag-footer">${TEXTS.footer}</div>
      </div>
    `;
    
    // Event listeners
    overlay.querySelector('.mj-tilebag-close').addEventListener('click', () => closePopup(false));
    overlay.querySelector('[data-action="skip"]').addEventListener('click', () => closePopup(true));
    overlay.querySelector('[data-action="add"]').addEventListener('click', () => addToCartAndClose(products));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(false); });
    
    // Product selection
    overlay.querySelectorAll('.mj-tilebag-card').forEach(card => {
      card.addEventListener('click', () => {
        overlay.querySelectorAll('.mj-tilebag-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedProduct = products[parseInt(card.dataset.index)];
      });
    });
    
    return overlay;
  }

  function showPopup(products, checkoutUrl = null) {
    if (sessionStorage.getItem(CONFIG.SHOWN_KEY)) return;
    
    popupElement = createPopup(products);
    if (!popupElement) return;
    
    pendingCheckoutUrl = checkoutUrl;
    document.body.appendChild(popupElement);
    requestAnimationFrame(() => popupElement.classList.add('visible'));
    sessionStorage.setItem(CONFIG.SHOWN_KEY, 'true');
  }

  function closePopup(proceedToCheckout = false) {
    if (!popupElement) return;
    
    popupElement.classList.remove('visible');
    setTimeout(() => {
      popupElement.remove();
      popupElement = null;
      
      // If user clicked "No, gracias" and there was a pending checkout, proceed
      if (proceedToCheckout && pendingCheckoutUrl) {
        window.location.href = pendingCheckoutUrl;
      }
      pendingCheckoutUrl = null;
      selectedProduct = null;
    }, 300);
  }

  function addToCartAndClose(products) {
    if (!selectedProduct) return;
    
    const cart = getCart();
    const newItem = {
      id: selectedProduct.id,
      sku: selectedProduct.sku,
      name: selectedProduct.name,
      price: selectedProduct.discount_price,
      original_price: selectedProduct.original_price,
      image: selectedProduct.image,
      qty: 1,
      promo_code: CONFIG.PROMO_CODE,
    };
    
    const existingIndex = cart.findIndex(item => item.id === newItem.id);
    if (existingIndex >= 0) {
      cart[existingIndex].qty += 1;
    } else {
      cart.push(newItem);
    }
    
    setCart(cart);
    showToast(`${selectedProduct.name} ${TEXTS.toast}`);
    
    // If there was a pending checkout, proceed after adding
    const checkoutUrl = pendingCheckoutUrl;
    closePopup(false);
    
    if (checkoutUrl) {
      setTimeout(() => { window.location.href = checkoutUrl; }, 500);
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: #1a1a1a;
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 100000;
      transition: transform 0.3s ease;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    
    setTimeout(() => {
      toast.style.transform = 'translateX(-50%) translateY(100px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FETCH TILE BAGS
  // ═══════════════════════════════════════════════════════════════════════════
  
  async function fetchTileBags() {
    try {
      const res = await fetch(CONFIG.API_URL);
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      
      // Filter to only Tile Bags
      const tileBags = (data.products || []).filter(p => 
        /tile bag/i.test(p.name || '') || /bolsa.*tile/i.test(p.name || '')
      );
      
      return tileBags.map(p => {
        const price = parseFloat(p.price) || 0;
        return {
          id: p.id,
          sku: p.sku,
          name: p.name,
          original_price: price,
          discount_price: Math.round(price * (1 - CONFIG.DISCOUNT_PCT / 100)),
          image: resolveImageUrl(p.primary_image_url),
        };
      });
    } catch (e) {
      console.error('[MJ TileBag Upsell] Error:', e);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGER LOGIC
  // ═══════════════════════════════════════════════════════════════════════════
  
  async function checkAndShowUpsell(checkoutUrl = null) {
    if (sessionStorage.getItem(CONFIG.SHOWN_KEY)) return;
    
    const cart = getCart();
    
    // Only show if cart has Tiles but no Tile Bags
    if (hasTiles(cart) && !hasTileBags(cart)) {
      const products = await fetchTileBags();
      if (products.length > 0) {
        showPopup(products, checkoutUrl);
      } else if (checkoutUrl) {
        // No tile bags available, proceed to checkout
        window.location.href = checkoutUrl;
      }
    } else if (checkoutUrl) {
      // No tiles in cart, proceed to checkout
      window.location.href = checkoutUrl;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVERS
  // ═══════════════════════════════════════════════════════════════════════════
  
  let lastCartJson = localStorage.getItem(CONFIG.CART_KEY);

  function watchCart() {
    // Watch for cart changes
    setInterval(() => {
      const currentJson = localStorage.getItem(CONFIG.CART_KEY);
      if (currentJson !== lastCartJson) {
        lastCartJson = currentJson;
        checkAndShowUpsell();
      }
    }, 500);
    
    window.addEventListener('storage', (e) => {
      if (e.key === CONFIG.CART_KEY) {
        lastCartJson = e.newValue;
        checkAndShowUpsell();
      }
    });
  }

  function interceptBuyNow() {
    // Intercept clicks on "Comprar ahora" / "Buy now" buttons
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href*="checkout.html"]');
      if (!link) return;
      
      // Check if this is a Tiles product page
      const productName = document.querySelector('#pdp-name, .product-name, h1')?.textContent || '';
      const isTilesProduct = /\btile[s]?\b/i.test(productName) && !/bag/i.test(productName);
      
      if (isTilesProduct && !sessionStorage.getItem(CONFIG.SHOWN_KEY)) {
        e.preventDefault();
        e.stopPropagation();
        
        // Add product to cart first (mimic add-to-cart behavior)
        const cart = getCart();
        const productId = window.location.hash.replace('#', '') || 
                          new URLSearchParams(window.location.search).get('id');
        
        if (productId) {
          // The product should already be in cart or will be handled by checkout
          // Just show the upsell with the checkout URL as pending
          checkAndShowUpsell(link.href);
        }
      }
    }, true);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════════════════════
  
  function init() {
    console.log('[MJ TileBag Upsell] Initialized');
    watchCart();
    interceptBuyNow();
    setTimeout(checkAndShowUpsell, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
