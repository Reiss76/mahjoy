/**
 * MAH JOY - Rack Bag Upsell Popup
 * 
 * Muestra un popup sugiriendo Rack Bags con 10% de descuento
 * cuando el usuario agrega Racks al carrito.
 * 
 * INSTALACIÓN EN FRAMER:
 * 1. Ve a Site Settings > Custom Code > End of <body> tag
 * 2. Pega este código completo dentro de <script>...</script>
 */

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  
  const CONFIG = {
    API_URL: 'https://proax.app/api/public/mahjoy/upsell',
    CART_KEY: 'mj_cart',
    SHOWN_KEY: 'mj_upsell_shown', // Para no mostrar el popup más de 1 vez por sesión
    PROMO_CODE: 'RACKBAG10',
    DISCOUNT_PCT: 10,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTILOS DEL POPUP
  // ═══════════════════════════════════════════════════════════════════════════
  
  // MAH JOY Brand Colors
  const COLORS = {
    burgundy: '#6B0F2A',
    burgundyDark: '#4A0A1D',
    orchid: '#C76BA4',
    blush: '#F5E8F0',
    cream: '#FAF6F0',
  };

  const STYLES = `
    .mj-upsell-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(107, 15, 42, 0.4);
      backdrop-filter: blur(4px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s ease;
      padding: 16px;
    }
    
    .mj-upsell-overlay.visible {
      opacity: 1;
    }
    
    .mj-upsell-popup {
      background: ${COLORS.cream};
      border-radius: 20px;
      max-width: 420px;
      width: 100%;
      overflow: hidden;
      transform: scale(0.9) translateY(20px);
      transition: transform 0.3s ease;
      box-shadow: 0 25px 50px -12px rgba(107, 15, 42, 0.3);
    }
    
    .mj-upsell-overlay.visible .mj-upsell-popup {
      transform: scale(1) translateY(0);
    }
    
    .mj-upsell-header {
      background: linear-gradient(135deg, ${COLORS.blush} 0%, ${COLORS.cream} 100%);
      padding: 24px;
      text-align: center;
      position: relative;
    }
    
    .mj-upsell-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      border: none;
      background: white;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      color: ${COLORS.burgundy};
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(107, 15, 42, 0.15);
    }
    
    .mj-upsell-close:hover {
      background: ${COLORS.blush};
      transform: scale(1.1);
    }
    
    .mj-upsell-badge {
      display: inline-block;
      background: ${COLORS.burgundy};
      color: white;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    
    .mj-upsell-title {
      font-size: 22px;
      font-weight: 700;
      color: ${COLORS.burgundy};
      margin: 0 0 8px 0;
      font-family: inherit;
    }
    
    .mj-upsell-subtitle {
      font-size: 14px;
      color: #666;
      margin: 0;
    }
    
    .mj-upsell-product {
      padding: 24px;
    }
    
    .mj-upsell-product-card {
      display: flex;
      gap: 16px;
      padding: 16px;
      background: white;
      border-radius: 16px;
      cursor: pointer;
      transition: all 0.2s;
      border: 2px solid transparent;
    }
    
    .mj-upsell-product-card:hover {
      background: ${COLORS.blush};
      border-color: ${COLORS.orchid};
    }
    
    .mj-upsell-product-card.selected {
      background: ${COLORS.blush};
      border-color: ${COLORS.burgundy};
    }
    
    .mj-upsell-product-image {
      width: 100px;
      height: 100px;
      border-radius: 12px;
      object-fit: cover;
      flex-shrink: 0;
    }
    
    .mj-upsell-product-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    
    .mj-upsell-product-name {
      font-size: 16px;
      font-weight: 600;
      color: ${COLORS.burgundy};
      margin: 0 0 8px 0;
    }
    
    .mj-upsell-product-prices {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .mj-upsell-price-original {
      font-size: 14px;
      color: #999;
      text-decoration: line-through;
    }
    
    .mj-upsell-price-discount {
      font-size: 18px;
      font-weight: 700;
      color: ${COLORS.burgundy};
    }
    
    .mj-upsell-savings {
      font-size: 12px;
      color: ${COLORS.orchid};
      font-weight: 600;
      margin-top: 4px;
    }
    
    .mj-upsell-actions {
      padding: 0 24px 24px;
      display: flex;
      gap: 12px;
    }
    
    .mj-upsell-btn {
      flex: 1;
      padding: 14px 24px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      font-family: inherit;
    }
    
    .mj-upsell-btn-secondary {
      background: ${COLORS.blush};
      color: ${COLORS.burgundy};
    }
    
    .mj-upsell-btn-secondary:hover {
      background: #eddde6;
    }
    
    .mj-upsell-btn-primary {
      background: linear-gradient(135deg, ${COLORS.burgundy} 0%, ${COLORS.burgundyDark} 100%);
      color: white;
    }
    
    .mj-upsell-btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(107, 15, 42, 0.4);
    }
    
    .mj-upsell-footer {
      padding: 16px 24px;
      background: ${COLORS.blush};
      text-align: center;
      font-size: 12px;
      color: ${COLORS.orchid};
    }
    
    @media (max-width: 480px) {
      .mj-upsell-popup {
        border-radius: 16px;
      }
      
      .mj-upsell-product-card {
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      
      .mj-upsell-product-image {
        width: 120px;
        height: 120px;
      }
    }
  `;

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════════════════
  
  function getCart() {
    try {
      const cart = localStorage.getItem(CONFIG.CART_KEY);
      return cart ? JSON.parse(cart) : [];
    } catch (e) {
      return [];
    }
  }

  function setCart(cart) {
    localStorage.setItem(CONFIG.CART_KEY, JSON.stringify(cart));
    // Disparar evento para que Framer actualice el contador
    window.dispatchEvent(new Event('storage'));
    window.dispatchEvent(new CustomEvent('cartUpdated', { detail: cart }));
  }

  function hasRacks(cart) {
    return cart.some(item => 
      /\brack\b/i.test(item.name || '') && !/bag/i.test(item.name || '')
    );
  }

  function hasRackBags(cart) {
    return cart.some(item => /rack bag/i.test(item.name || ''));
  }

  function formatPrice(price) {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POPUP UI
  // ═══════════════════════════════════════════════════════════════════════════
  
  let popupElement = null;
  let selectedProduct = null;

  function injectStyles() {
    if (document.getElementById('mj-upsell-styles')) return;
    const style = document.createElement('style');
    style.id = 'mj-upsell-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function createPopup(products) {
    injectStyles();
    
    if (products.length === 0) return null;
    
    // Seleccionar el primer producto por defecto
    selectedProduct = products[0];
    
    const overlay = document.createElement('div');
    overlay.className = 'mj-upsell-overlay';
    overlay.innerHTML = `
      <div class="mj-upsell-popup">
        <div class="mj-upsell-header">
          <button class="mj-upsell-close" aria-label="Cerrar">×</button>
          <div class="mj-upsell-badge">🎁 OFERTA ESPECIAL</div>
          <h2 class="mj-upsell-title">¡Protege tus Racks!</h2>
          <p class="mj-upsell-subtitle">Llévate un Rack Bag con 10% de descuento</p>
        </div>
        
        <div class="mj-upsell-product">
          ${products.map((p, i) => `
            <div class="mj-upsell-product-card ${i === 0 ? 'selected' : ''}" data-product-index="${i}">
              <img class="mj-upsell-product-image" src="${p.image_url}" alt="${p.name}" />
              <div class="mj-upsell-product-info">
                <h3 class="mj-upsell-product-name">${p.name}</h3>
                <div class="mj-upsell-product-prices">
                  <span class="mj-upsell-price-original">${formatPrice(p.original_price)}</span>
                  <span class="mj-upsell-price-discount">${formatPrice(p.discount_price)}</span>
                </div>
                <div class="mj-upsell-savings">¡Ahorras ${formatPrice(p.original_price - p.discount_price)}!</div>
              </div>
            </div>
          `).join('')}
        </div>
        
        <div class="mj-upsell-actions">
          <button class="mj-upsell-btn mj-upsell-btn-secondary" data-action="skip">
            No, gracias
          </button>
          <button class="mj-upsell-btn mj-upsell-btn-primary" data-action="add">
            ¡Sí, agregar! 🛒
          </button>
        </div>
        
        <div class="mj-upsell-footer">
          Código de descuento aplicado automáticamente
        </div>
      </div>
    `;
    
    // Event listeners
    overlay.querySelector('.mj-upsell-close').addEventListener('click', closePopup);
    overlay.querySelector('[data-action="skip"]').addEventListener('click', closePopup);
    overlay.querySelector('[data-action="add"]').addEventListener('click', () => addToCart(products));
    
    // Click outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePopup();
    });
    
    // Product selection (si hay múltiples)
    overlay.querySelectorAll('.mj-upsell-product-card').forEach(card => {
      card.addEventListener('click', () => {
        overlay.querySelectorAll('.mj-upsell-product-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedProduct = products[parseInt(card.dataset.productIndex)];
      });
    });
    
    return overlay;
  }

  function showPopup(products) {
    // No mostrar si ya se mostró en esta sesión
    if (sessionStorage.getItem(CONFIG.SHOWN_KEY)) return;
    
    popupElement = createPopup(products);
    if (!popupElement) return;
    
    document.body.appendChild(popupElement);
    
    // Trigger animation
    requestAnimationFrame(() => {
      popupElement.classList.add('visible');
    });
    
    // Marcar como mostrado
    sessionStorage.setItem(CONFIG.SHOWN_KEY, 'true');
  }

  function closePopup() {
    if (!popupElement) return;
    
    popupElement.classList.remove('visible');
    setTimeout(() => {
      popupElement.remove();
      popupElement = null;
      selectedProduct = null;
    }, 300);
  }

  function addToCart(products) {
    if (!selectedProduct) return;
    
    const cart = getCart();
    
    // Agregar el Rack Bag con precio con descuento
    const newItem = {
      id: selectedProduct.product_id,
      sku: `RACKBAG-${selectedProduct.product_id}`,
      name: selectedProduct.name,
      price: selectedProduct.discount_price, // Precio con descuento
      original_price: selectedProduct.original_price,
      image: selectedProduct.image_url,
      qty: 1,
      promo_code: CONFIG.PROMO_CODE,
    };
    
    // Verificar si ya existe
    const existingIndex = cart.findIndex(item => item.id === newItem.id);
    if (existingIndex >= 0) {
      cart[existingIndex].qty += 1;
    } else {
      cart.push(newItem);
    }
    
    setCart(cart);
    closePopup();
    
    // Mostrar confirmación
    showToast(`✅ ${selectedProduct.name} agregado con 10% de descuento`);
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
  // API & LÓGICA PRINCIPAL
  // ═══════════════════════════════════════════════════════════════════════════
  
  async function fetchUpsellProducts() {
    try {
      const response = await fetch(CONFIG.API_URL);
      if (!response.ok) throw new Error('API error');
      const data = await response.json();
      return data.products || [];
    } catch (e) {
      console.error('[MJ Upsell] Error fetching products:', e);
      return [];
    }
  }

  async function checkAndShowUpsell() {
    const cart = getCart();
    
    // Solo mostrar si hay Racks y NO hay Rack Bags
    if (hasRacks(cart) && !hasRackBags(cart)) {
      const products = await fetchUpsellProducts();
      if (products.length > 0) {
        showPopup(products);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OBSERVADOR DE CARRITO
  // ═══════════════════════════════════════════════════════════════════════════
  
  let lastCartJson = localStorage.getItem(CONFIG.CART_KEY);

  function watchCart() {
    // Revisar cambios cada 500ms
    setInterval(() => {
      const currentCartJson = localStorage.getItem(CONFIG.CART_KEY);
      if (currentCartJson !== lastCartJson) {
        lastCartJson = currentCartJson;
        checkAndShowUpsell();
      }
    }, 500);
    
    // También escuchar evento storage (para cambios desde otras pestañas)
    window.addEventListener('storage', (e) => {
      if (e.key === CONFIG.CART_KEY) {
        lastCartJson = e.newValue;
        checkAndShowUpsell();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INICIALIZACIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  
  function init() {
    console.log('[MJ Upsell] Inicializado');
    watchCart();
    
    // Verificar al cargar (por si ya hay Racks en el carrito)
    setTimeout(checkAndShowUpsell, 1000);
  }

  // Iniciar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
