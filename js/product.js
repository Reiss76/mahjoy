/**
 * MAH JOY — Product Detail Page
 * Loads product from products.json by ?id= or ?sku= query param
 */

const MJ_API_BASE = 'https://api-production-b888.up.railway.app';

const CATEGORY_LABELS = {
  'tiles': 'Tiles',
  'mats': 'Mats',
  'racks': 'Racks',
  'mahjoy-bags': 'Mahjoy Bags',
  'tile-bags': 'Tile Bags',
  'rack-bags': 'Rack Bags',
  'accessories': 'Accessories',
  'card-holders': 'Card Holders',
  'shufflers': 'Shufflers',
  'line-finder': 'Line Finder',
};

const CATEGORY_PAGES = {
  'tiles': 'shop-tiles.html',
  'mats': 'shop-mats.html',
  'racks': 'shop-racks.html',
  'mahjoy-bags': 'shop-mahjoy-bags.html',
  'tile-bags': 'shop-tile-bags.html',
  'rack-bags': 'shop-rack-bags.html',
  'accessories': 'shop-accessories.html',
  'card-holders': 'shop-card-holders.html',
  'shufflers': 'shop-shufflers.html',
  'line-finder': 'shop-line-finder.html',
};

// Keyword → category fallback (same as shop.js)
const CATEGORY_MAP = {
  'tiles':        ['tile', 'ficha', 'pieza'],
  'mats':         ['mat', 'tapete', 'base'],
  'racks':        ['rack', 'soporte', 'atril'],
  'mahjoy-bags':  ['mahjoy bag', 'bolsa mahjoy', 'mj bag'],
  'tile-bags':    ['tile bag', 'bolsa ficha', 'bolsa tile'],
  'rack-bags':    ['rack bag', 'bolsa rack', 'bolsa atril'],
  'accessories':  ['accessory', 'accesorio', 'set', 'kit'],
  'card-holders': ['card holder', 'porta carta'],
  'shufflers':    ['shuffler', 'mezclador'],
  'line-finder':  ['line finder', 'buscador'],
};

function resolveImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('/api/public/media')) {
    return MJ_API_BASE + url.replace('/api/public/media', '/public/media');
  }
  if (url.startsWith('/public/media')) {
    return MJ_API_BASE + url;
  }
  return url;
}

function formatPrice(price) {
  const num = parseFloat(price);
  if (!num || num === 0) return 'Consultar precio';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
}

function guessCategory(product) {
  if (product.category) return product.category;
  const text = ((product.name || '') + ' ' + (product.sku || '') + ' ' + (product.description || '')).toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    if (keywords.some(kw => text.includes(kw))) return cat;
  }
  return null;
}

function buildRelatedCard(product) {
  const imgSrc = resolveImageUrl(product.primary_image_url);
  const cat = guessCategory(product);
  return `
    <div class="mj-product-card" onclick="window.location='product.html?id=${product.id}'" style="cursor:pointer;">
      <div class="mj-product-img-wrap">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${product.name}" class="mj-product-img" loading="lazy">`
          : `<div class="mj-product-img-placeholder"><span>✦</span></div>`}
      </div>
      <div class="mj-product-info">
        ${product.sku ? `<div class="mj-product-sku">${product.sku}</div>` : ''}
        <div class="mj-product-name">${product.name}</div>
        <div class="mj-product-price">${formatPrice(product.price)}</div>
      </div>
    </div>`;
}

function showError() {
  document.getElementById('pdp-loading').style.display = 'none';
  document.getElementById('pdp-error').style.display = 'flex';
}

async function loadProduct() {
  const params = new URLSearchParams(window.location.search);
  const productId = params.get('id') ? parseInt(params.get('id')) : null;
  const productSku = params.get('sku');

  if (!productId && !productSku) { showError(); return; }

  let data;
  try {
    const res = await fetch('products.json');
    data = await res.json();
  } catch (e) {
    showError(); return;
  }

  const products = data.products || [];
  const product = productId
    ? products.find(p => p.id === productId)
    : products.find(p => p.sku === productSku);

  if (!product) { showError(); return; }

  // Resolve category
  const cat = guessCategory(product);
  const catLabel = CATEGORY_LABELS[cat] || cat || 'Shop';
  const catPage  = CATEGORY_PAGES[cat] || 'shop.html';

  // Resolve images
  const images = (product.images && product.images.length > 0)
    ? product.images.map(resolveImageUrl).filter(Boolean)
    : product.primary_image_url ? [resolveImageUrl(product.primary_image_url)] : [];
  const mainImg = images[0] || null;

  // --- Populate DOM ---
  document.title = `${product.name} — MAH JOY`;
  document.getElementById('page-title').textContent = `${product.name} — MAH JOY`;

  // Breadcrumb
  document.getElementById('pdp-cat-link').textContent = catLabel;
  document.getElementById('pdp-cat-link').href = catPage;
  document.getElementById('pdp-breadcrumb-name').textContent = product.name;

  // Main image
  if (mainImg) {
    document.getElementById('pdp-main-img').src = mainImg;
    document.getElementById('pdp-main-img').alt = product.name;
  } else {
    document.getElementById('pdp-main-img').style.display = 'none';
    document.querySelector('.mj-pdp-main-img-wrap').innerHTML =
      '<div class="mj-product-img-placeholder" style="aspect-ratio:1;min-height:300px;"><span>✦</span></div>';
  }

  // Thumbnails (if more than 1 image)
  const thumbsEl = document.getElementById('pdp-thumbnails');
  if (images.length > 1) {
    thumbsEl.innerHTML = images.map((url, i) => `
      <img src="${url}" alt="${product.name} ${i+1}"
           class="mj-pdp-thumb ${i === 0 ? 'active' : ''}"
           onclick="
             document.getElementById('pdp-main-img').src='${url}';
             document.querySelectorAll('.mj-pdp-thumb').forEach(t=>t.classList.remove('active'));
             this.classList.add('active');
           " loading="lazy">`).join('');
  }

  // Category badge
  document.getElementById('pdp-category-badge').textContent = catLabel;

  // Name, SKU, price, description
  document.getElementById('pdp-name').textContent = product.name;
  document.getElementById('pdp-sku').textContent = product.sku || '';
  document.getElementById('pdp-price').textContent = formatPrice(product.price);

  const descEl = document.getElementById('pdp-description');
  if (product.description) {
    descEl.textContent = product.description;
    descEl.style.display = 'block';
  } else {
    descEl.style.display = 'none';
  }

  // Stock
  const stockEl = document.getElementById('pdp-stock');
  if (product.stock > 5) {
    stockEl.innerHTML = '<span class="mj-pdp-stock-badge in">● En stock</span>';
  } else if (product.stock > 0) {
    stockEl.innerHTML = `<span class="mj-pdp-stock-badge low">● Últimas ${product.stock} piezas</span>`;
  } else {
    stockEl.innerHTML = '<span class="mj-pdp-stock-badge out">● Agotado</span>';
    document.getElementById('pdp-order-btn').style.opacity = '0.4';
    document.getElementById('pdp-order-btn').style.pointerEvents = 'none';
  }

  // Order button with product info pre-filled in contact URL
  const contactUrl = `contact.html?product=${encodeURIComponent(product.name)}&sku=${encodeURIComponent(product.sku || '')}`;
  document.getElementById('pdp-order-btn').href = contactUrl;

  // Meta
  document.getElementById('pdp-meta-cat').textContent = catLabel;
  document.getElementById('pdp-meta-sku').textContent = product.sku || '—';
  document.getElementById('pdp-meta-stock').textContent =
    product.stock > 0 ? `${product.stock} disponibles` : 'Sin stock';

  // WhatsApp share
  const waText = `Hola! Me interesa este producto de MAH JOY:\n*${product.name}*\n${window.location.href}`;
  document.getElementById('pdp-share-wa').href =
    `https://wa.me/?text=${encodeURIComponent(waText)}`;

  // Related products (same category, exclude current)
  const related = products
    .filter(p => p.id !== product.id && guessCategory(p) === cat)
    .slice(0, 4);
  const relatedEl = document.getElementById('pdp-related');
  if (related.length > 0) {
    relatedEl.innerHTML = related.map(buildRelatedCard).join('');
  } else {
    document.querySelector('.mj-pdp-related').style.display = 'none';
  }

  // Back to category link
  document.getElementById('pdp-back-cat').href = catPage;
  document.getElementById('pdp-back-cat').textContent = `Ver todos los ${catLabel} →`;

  // Show content
  document.getElementById('pdp-loading').style.display = 'none';
  document.getElementById('pdp-content').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', loadProduct);
