/**
 * MAH JOY — Shop Catalog
 * Fetches live inventory from Proax API and renders product cards.
 */

const MJ_API = 'https://api-production-b888.up.railway.app/public/shop/mahjoy/products';

// Category keyword map — matches product names/SKUs to category pages
const CATEGORY_MAP = {
  'tiles':         ['tile', 'ficha', 'pieza'],
  'mats':          ['mat', 'tapete', 'base'],
  'racks':         ['rack', 'rack', 'soporte', 'atril'],
  'mahjoy-bags':   ['mahjoy bag', 'bolsa mahjoy', 'mj bag'],
  'tile-bags':     ['tile bag', 'bolsa ficha', 'bolsa tile'],
  'rack-bags':     ['rack bag', 'bolsa rack', 'bolsa atril'],
  'accessories':   ['accessory', 'accesorio', 'set', 'kit'],
  'card-holders':  ['card holder', 'porta carta', 'card'],
  'shufflers':     ['shuffler', 'mezclador', 'revolvedor'],
  'line-finder':   ['line finder', 'buscador', 'guía'],
};

function formatPrice(price) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(price);
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
    ? (product.primary_image_url.startsWith('/api/public')
        ? 'https://api-production-b888.up.railway.app' + product.primary_image_url
        : product.primary_image_url)
    : null;

  return `
    <div class="mj-product-card">
      <div class="mj-product-img-wrap">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${product.name}" class="mj-product-img" loading="lazy">`
          : `<div class="mj-product-img-placeholder"><span>✦</span></div>`
        }
        ${product.stock <= 5 && product.stock > 0 ? `<div class="mj-product-badge">Últimas ${product.stock}</div>` : ''}
      </div>
      <div class="mj-product-info">
        ${product.sku ? `<div class="mj-product-sku">${product.sku}</div>` : ''}
        <div class="mj-product-name">${product.name}</div>
        ${product.description ? `<div class="mj-product-desc">${product.description}</div>` : ''}
        <div class="mj-product-price">${formatPrice(product.price)}</div>
      </div>
      <a href="contact.html" class="mj-product-cta">Ordenar</a>
    </div>
  `;
}

function buildEmptyState(categoryLabel) {
  return `
    <div class="mj-empty-state">
      <div class="mj-empty-icon">✦</div>
      <div class="mj-empty-title">Próximamente</div>
      <p class="mj-empty-text">Los productos de <strong>${categoryLabel}</strong> estarán disponibles muy pronto.</p>
    </div>
  `;
}

function buildErrorState() {
  return `
    <div class="mj-empty-state">
      <div class="mj-empty-icon">⚠</div>
      <div class="mj-empty-title">No se pudo cargar el catálogo</div>
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

    let products = data.products || [];

    // Filter by category if specified
    if (category) {
      const keywords = CATEGORY_MAP[category] || [];
      products = products.filter(p => {
        const text = (p.name + ' ' + (p.sku || '') + ' ' + (p.description || '')).toLowerCase();
        return keywords.some(kw => text.includes(kw));
      });
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
