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
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
    
    .mj-upsell-overlay {
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
    
    .mj-upsell-overlay.visible {
      opacity: 1;
    }
    
    .mj-upsell-popup {
      background: ${COLORS.cream};
      border-radius: 24px;
      max-width: 440px;
      width: 100%;
      overflow: hidden;
      transform: scale(0.9) translateY(20px);
      transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 25px 60px -12px rgba(107, 15, 42, 0.35);
    }
    
    .mj-upsell-overlay.visible .mj-upsell-popup {
      transform: scale(1) translateY(0);
    }
    
    .mj-upsell-header {
      background: linear-gradient(145deg, ${COLORS.blush} 0%, ${COLORS.cream} 100%);
      padding: 28px 24px;
      text-align: center;
      position: relative;
      border-bottom: 1px solid rgba(199, 107, 164, 0.15);
    }
    
    .mj-upsell-close {
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
    
    .mj-upsell-close:hover {
      background: ${COLORS.blush};
      transform: scale(1.1) rotate(90deg);
    }
    
    .mj-upsell-badge {
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
    
    .mj-upsell-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 28px;
      font-weight: 700;
      font-style: italic;
      color: ${COLORS.burgundy};
      margin: 0 0 8px 0;
      line-height: 1.2;
    }
    
    .mj-upsell-subtitle {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 14px;
      color: #777;
      margin: 0;
      font-weight: 500;
    }
    
    .mj-upsell-discount-highlight {
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
    
    .mj-upsell-product {
      padding: 16px;
      max-height: 42vh;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }
    
    .mj-upsell-product-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    
    .mj-upsell-product-card {
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
    
    .mj-upsell-product-card:hover {
      background: ${COLORS.blush};
      border-color: ${COLORS.orchid};
      transform: translateY(-2px);
    }
    
    .mj-upsell-product-card.selected {
      background: ${COLORS.blush};
      border-color: ${COLORS.burgundy};
      box-shadow: 0 4px 16px rgba(107, 15, 42, 0.15);
    }
    
    .mj-upsell-product-image {
      width: 80px;
      height: 80px;
      border-radius: 12px;
      object-fit: cover;
      margin-bottom: 10px;
      box-shadow: 0 4px 12px rgba(107, 15, 42, 0.1);
    }
    
    .mj-upsell-product-info {
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    
    .mj-upsell-product-name {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px;
      font-weight: 700;
      color: ${COLORS.burgundy};
      margin: 0 0 6px 0;
      line-height: 1.3;
    }
    
    .mj-upsell-product-prices {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: center;
    }
    
    .mj-upsell-price-original {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      color: #aaa;
      text-decoration: line-through;
    }
    
    .mj-upsell-price-discount {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 16px;
      font-weight: 800;
      color: ${COLORS.burgundy};
    }
    
    .mj-upsell-savings {
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 11px;
      color: ${COLORS.orchid};
      font-weight: 700;
      margin-top: 4px;
    }
    
    .mj-upsell-actions {
      padding: 8px 24px 24px;
      display: flex;
      gap: 12px;
    }
    
    .mj-upsell-btn {
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
    
    .mj-upsell-btn-secondary {
      background: white;
      color: ${COLORS.burgundy};
      border: 2px solid ${COLORS.blush};
    }
    
    .mj-upsell-btn-secondary:hover {
      background: ${COLORS.blush};
      border-color: ${COLORS.orchid};
    }
    
    .mj-upsell-btn-primary {
      background: ${COLORS.burgundy};
      color: white;
      box-shadow: 0 4px 16px rgba(107, 15, 42, 0.3);
    }
    
    .mj-upsell-btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(107, 15, 42, 0.4);
      background: #7A1230;
    }
    
    .mj-upsell-footer {
      padding: 14px 24px;
      background: ${COLORS.blush};
      text-align: center;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      color: ${COLORS.orchid};
      font-weight: 600;
    }
    
    @media (max-width: 480px) {
      .mj-upsell-popup {
        border-radius: 20px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
      }
      
      .mj-upsell-header {
        padding: 20px 16px;
        flex-shrink: 0;
      }
      
      .mj-upsell-title {
        font-size: 24px;
      }
      
      .mj-upsell-discount-highlight {
        font-size: 26px;
        padding: 6px 16px;
      }
      
      .mj-upsell-subtitle {
        font-size: 13px;
      }
      
      .mj-upsell-product {
        flex: 1;
        overflow-y: auto;
        max-height: none;
        padding: 12px;
      }
      
      .mj-upsell-product-grid {
        gap: 10px;
      }
      
      .mj-upsell-product-image {
        width: 65px;
        height: 65px;
      }
      
      .mj-upsell-actions {
        flex-shrink: 0;
        padding: 12px 16px 20px;
        flex-direction: column;
        gap: 10px;
      }
      
      .mj-upsell-btn {
        padding: 14px 20px;
        font-size: 14px;
      }
      
      .mj-upsell-footer {
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
          <div class="mj-upsell-badge">OFERTA ESPECIAL</div>
          <h2 class="mj-upsell-title">Protege tus Racks</h2>
          <div class="mj-upsell-discount-highlight">10% OFF</div>
          <p class="mj-upsell-subtitle">en tu Rack Bag al agregar ahora</p>
        </div>
        
        <div class="mj-upsell-product">
          <div class="mj-upsell-product-grid">
            ${products.map((p, i) => `
              <div class="mj-upsell-product-card ${i === 0 ? 'selected' : ''}" data-product-index="${i}">
                <img class="mj-upsell-product-image" src="${p.image_url}" alt="${p.name}" />
                <div class="mj-upsell-product-info">
                  <h3 class="mj-upsell-product-name">${p.name}</h3>
                  <div class="mj-upsell-product-prices">
                    <span class="mj-upsell-price-original">${formatPrice(p.original_price)}</span>
                    <span class="mj-upsell-price-discount">${formatPrice(p.discount_price)}</span>
                  </div>
                  <div class="mj-upsell-savings">Ahorras ${formatPrice(p.original_price - p.discount_price)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="mj-upsell-actions">
          <button class="mj-upsell-btn mj-upsell-btn-secondary" data-action="skip">
            No, gracias
          </button>
          <button class="mj-upsell-btn mj-upsell-btn-primary" data-action="add">
            Agregar al carrito
          </button>
        </div>
        
        <div class="mj-upsell-footer">
          Descuento aplicado automáticamente
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
    showToast(`${selectedProduct.name} agregado con 10% de descuento`);
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
