/**
 * MAH JOY — Shop Catalog
 * Fetches live inventory from Proax API and renders product cards.
 */

// Fetch en vivo desde Proax API — siempre sincronizado con el inventario
const MJ_API_BASE = 'https://api-production-b888.up.railway.app';
const MJ_API = MJ_API_BASE + '/public/shop/mahjoy/products';

// Hidden products (SKUs to exclude from shop)
const MJ_HIDDEN_SKUS = ['Rack-007', 'RACK-007'];

// Coming Soon products (show with badge, no buy button)
const MJ_COMING_SOON_SKUS = ['MAT-COWV', 'Rack-brown'];

// Category matching — SKU-prefix based (precise, no false positives)
// SKU patterns: TILE-* | MAT-* | RACK-* | RAKBAG-* | RACK-BAG* | BAG-tile* | BAG-lila|pink|blue|rouge|fiucsa | LINE-* | SHUF-*
function matchCategory(product, category) {
  const sku = (product.sku || '').toUpperCase();
  const name = (product.name || '').toLowerCase();

  switch (category) {
    case 'tiles':
      return sku.startsWith('TILE-');
    case 'mats':
      return sku.startsWith('MAT-') || sku.startsWith('MAT');
    case 'racks':
      return (sku.startsWith('RACK-') || sku.startsWith('RACK')) &&
             !sku.includes('BAG') && !sku.startsWith('RAKBAG');
    case 'rack-bags':
      return sku.startsWith('RAKBAG') || (sku.startsWith('RACK') && sku.includes('BAG'));
    case 'tile-bags':
      return sku.startsWith('BAG-TILE') || name.includes('tile bag');
    case 'mahjoy-bags':
      // Bags that are NOT tile bags: BAG-lila, BAG-pink, BAG-blue, BAG-rouge, BAG-fiucsa, etc.
      return sku.startsWith('BAG-') && !sku.startsWith('BAG-TILE');
    case 'shufflers':
      return sku.startsWith('SHUF-');
    case 'line-finder':
      return sku.startsWith('LINE-');
    case 'card-holders':
      return sku.startsWith('FOLIO-') || name.includes('card holder');
    case 'accessories':
      // Everything EXCEPT tiles, mats, and racks (without bag)
      const isTile = sku.startsWith('TILE-');
      const isMat = sku.startsWith('MAT-') || sku.startsWith('MAT');
      const isRackOnly = (sku.startsWith('RACK-') || sku.startsWith('RACK')) && !sku.includes('BAG');
      return !isTile && !isMat && !isRackOnly;
    default:
      return false;
  }
}

// Legacy map kept for reference (not used for filtering)
const CATEGORY_MAP = {};

// Check if we're on English version
const isEnglishShop = window.location.pathname.includes('/en/');

// Translations for shop
const TS = isEnglishShop ? {
  viewProduct: 'View Product',
  comingSoon: 'Coming Soon',
  lastFew: 'Only',
  lastFewSuffix: 'left',
  emptyTitle: 'Coming Soon',
  emptyText: 'products will be available very soon.',
  errorTitle: 'Could not load catalog',
  errorText: 'Please try again later.',
  contactPrice: 'Contact for price'
} : {
  viewProduct: 'Ver producto',
  comingSoon: 'Coming Soon',
  lastFew: 'Últimas',
  lastFewSuffix: '',
  emptyTitle: 'Próximamente',
  emptyText: 'productos estarán disponibles muy pronto.',
  errorTitle: 'No se pudo cargar el catálogo',
  errorText: 'Intenta de nuevo más tarde.',
  contactPrice: 'Consultar precio'
};

function formatPrice(price, priceUsd) {
  if (isEnglishShop && priceUsd) {
    const num = parseFloat(priceUsd);
    if (!num || num === 0) return TS.contactPrice;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  }
  const num = parseFloat(price);
  if (!num || num === 0) return TS.contactPrice;
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
}

function getProductPrice(product) {
  return formatPrice(product.price, product.price_usd);
}

function getProductCategory(product) {
  const text = (product.name + ' ' + (product.sku || '') + ' ' + (product.description || '')).toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some(kw => text.includes(kw))) return cat;
  }
  return null;
}

function buildProductCard(product) {
  const imgSrc = product.primary_image_url
    ? (product.primary_image_url.startsWith('/api/public/media')
        ? 'https://api-production-b888.up.railway.app' + product.primary_image_url.replace('/api/public/media', '/public/media')
        : product.primary_image_url.startsWith('/public/media')
          ? 'https://api-production-b888.up.railway.app' + product.primary_image_url
          : product.primary_image_url)
    : null;

  const isComingSoon = MJ_COMING_SOON_SKUS.includes(product.sku);

  return `
    <div class="mj-product-card" ${!isComingSoon ? `onclick="window.location='product.html#${product.id}'" style="cursor:pointer;"` : 'style="cursor:default;"'}>
      <div class="mj-product-img-wrap">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${product.name}" class="mj-product-img" loading="lazy"${isComingSoon ? ' style="opacity:0.7;"' : ''}>`
          : `<div class="mj-product-img-placeholder"><span>✦</span></div>`
        }
        ${isComingSoon ? `<div class="mj-product-badge" style="background:var(--orchid);color:#fff;">${TS.comingSoon}</div>` : ''}
        ${!isComingSoon && product.stock <= 5 && product.stock > 0 ? `<div class="mj-product-badge">${TS.lastFew} ${product.stock} ${TS.lastFewSuffix}</div>` : ''}
      </div>
      <div class="mj-product-info">
        ${product.sku ? `<div class="mj-product-sku">${product.sku}</div>` : ''}
        <div class="mj-product-name">${product.name}</div>
        ${product.description ? `<div class="mj-product-desc">${product.description}</div>` : ''}
        <div class="mj-product-price">${getProductPrice(product)}</div>
      </div>
      ${isComingSoon 
        ? `<span class="mj-product-cta" style="opacity:0.5;cursor:default;">${TS.comingSoon}</span>`
        : `<a href="javascript:void(0)" onclick="window.location='product.html#${product.id}'" class="mj-product-cta">${TS.viewProduct}</a>`
      }
    </div>
  `;
}

function buildEmptyState(categoryLabel) {
  return `
    <div class="mj-empty-state">
      <div class="mj-empty-icon">✦</div>
      <div class="mj-empty-title">${TS.emptyTitle}</div>
      <p class="mj-empty-text">Los productos de <strong>${categoryLabel}</strong> estarán disponibles muy pronto.</p>
    </div>
  `;
}

function buildErrorState() {
  return `
    <div class="mj-empty-state">
      <div class="mj-empty-icon">⚠</div>
      <div class="mj-empty-title">${TS.errorTitle}</div>
      <p class="mj-empty-text">Intenta de nuevo más tarde.</p>
    </div>
  `;
}

async function loadShopProducts({ containerId, category = null, categoryLabel = 'esta categoría' }) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Loading state
  container.innerHTML = `
    <div class="mj-loading">
      <div class="mj-loading-spinner"></div>
      <span>Cargando catálogo…</span>
    </div>
  `;

  try {
    const res = await fetch(MJ_API);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    // Normalizar URLs de imágenes (la API puede devolver paths relativos)
    let products = (data.products || []).map(p => ({
      ...p,
      primary_image_url: p.primary_image_url
        ? (p.primary_image_url.startsWith('http')
            ? p.primary_image_url
            : MJ_API_BASE + p.primary_image_url.replace('/api/public/media', '/public/media'))
        : null,
      images: (p.images || []).map(u =>
        u.startsWith('http') ? u : MJ_API_BASE + u.replace('/api/public/media', '/public/media')
      ),
    }));

    // Filter out hidden products
    products = products.filter(p => !MJ_HIDDEN_SKUS.includes(p.sku));

    // Filter by category if specified — SKU-based matching
    if (category) {
      products = products.filter(p => matchCategory(p, category));
    }

    if (products.length === 0) {
      container.innerHTML = buildEmptyState(categoryLabel);
      return;
    }

    container.innerHTML = `<div class="mj-product-grid">${products.map(buildProductCard).join('')}</div>`;
  } catch (err) {
    console.error('MJ Shop error:', err);
    container.innerHTML = buildErrorState();
  }
}

// Auto-init: reads data-category and data-label from the container element
document.addEventListener('DOMContentLoaded', () => {
  const container = document.querySelector('[data-mj-shop]');
  if (!container) return;
  loadShopProducts({
    containerId: container.id,
    category: container.dataset.category || null,
    categoryLabel: container.dataset.label || 'esta categoría',
  });
});


/* ─── Mobile nav dropdown toggle ─── */
document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.querySelector('.mj-shop-toggle');
  const list   = document.querySelector('.nav-menu .mj-shop-list');
  if (!toggle || !list) return;

  toggle.addEventListener('click', function (e) {
    e.stopPropagation();
    const isOpen = list.classList.contains('mj-open');
    list.classList.toggle('mj-open', !isOpen);
    toggle.setAttribute('aria-expanded', String(!isOpen));
  });
});
