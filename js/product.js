/**
 * MAH JOY — Product Detail Page
 * Loads product from products.json by ?id= or ?sku= query param
 */

const MJ_API_BASE = 'https://proax.app';

// Products that are actually IN STOCK (not presale)
// If SKU is not in this list and stock > 0, show as "Pre venta"
const IN_STOCK_SKUS = [
  // Tiles
  'TILE-dina', 'TILE-heri', 'TILE-impe', 'TILE-Kale', 'TILE-mythos', 'TILE-sensu',
  // Mats (including Apres Ski, Apres Snow, Noel)
  'MAT-PIEL', 'MAT-snow2', 'MAT-snow1', 'MAT-Merry',
  // Racks (all except Golden Brown/Rack-brown)
  'Rack-007', 'RACK-COSMIC', 'RACK-BLUE', 'RACK-fucsia', 'RACK-VERDE', 'RACK-002', 'RACK-PINK', 'RACK-RED',
  // Rack Bags (all)
  'RAKBAG-001', 'RAKBAG-002', 'RAKBAG-003', 'RAKBAG-004', 'RAKBAG-005', 'RACK-BAG006',
  // Mahjoy Bags
  'Bag-blue', 'Bag-fiucsa', 'BAG-lila', 'Bag-pink', 'Bag-rouge',
  // Card Holders
  'Folio-1', 'Folio-2',
  // Tile Bags (including velvet)
  'BAG-tilelila', 'BAG-tilepink', 'BAG-tile001', 'BAG-tile002', 'BAG-tile003',
  // Line Finders
  'LINE-001', 'LINE-002', 'LINE-003', 'LINE-005',
  // Shufflers
  'SHUF-001', 'SHUF-002', 'SHUF-003', 'SHUF-004',
];

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

// Check if we're on English version
const isEnglish = window.location.pathname.includes('/en/');

// Translations
const T = isEnglish ? {
  inStock: '● In Stock',
  lowStock: '● Only a few left',
  outOfStock: '● Out of Stock',
  presale: '● Pre-order · Ships Oct 10',
  buyNow: 'Buy Now →',
  addToCart: 'Add to Cart',
  adding: 'Adding...',
  added: '✓ Added!',
  contactPrice: 'Contact for price'
} : {
  inStock: '● En stock',
  lowStock: '● Pocas piezas disponibles',
  outOfStock: '● Agotado',
  presale: '● Pre venta · Envío Oct 10',
  buyNow: 'Comprar ahora →',
  addToCart: 'Agregar al carrito',
  adding: 'Agregando...',
  added: '✓ Agregado!',
  contactPrice: 'Consultar precio'
};

function formatPrice(price, priceUsd) {
  if (isEnglish && priceUsd) {
    const num = parseFloat(priceUsd);
    if (!num || num === 0) return 'Contact for price';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  }
  const num = parseFloat(price);
  if (!num || num === 0) return T.contactPrice;
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
}

function getProductPrice(product) {
  return formatPrice(product.price, product.price_usd);
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
    <div class="mj-product-card" onclick="window.location='product.html#'+product.id" style="cursor:pointer;">
      <div class="mj-product-img-wrap">
        ${imgSrc
          ? `<img src="${imgSrc}" alt="${product.name}" class="mj-product-img" loading="lazy">`
          : `<div class="mj-product-img-placeholder"><span>✦</span></div>`}
      </div>
      <div class="mj-product-info">
        ${product.sku ? `<div class="mj-product-sku">${product.sku}</div>` : ''}
        <div class="mj-product-name">${product.name}</div>
        <div class="mj-product-price">${getProductPrice(product)}</div>
      </div>
    </div>`;
}

function showError() {
  document.getElementById('pdp-loading').style.display = 'none';
  document.getElementById('pdp-error').style.display = 'flex';
}

async function loadProduct() {
  // Hash routing: product.html#46 or product.html#MAT-001
  // Also supports legacy ?id= and ?sku= params
  const params = new URLSearchParams(window.location.search);
  const hashVal = window.location.hash.replace('#', '').trim();
  const rawId = hashVal && !isNaN(hashVal) ? hashVal : params.get('id');
  const productId = rawId ? parseInt(rawId) : null;
  const productSku = (!productId && hashVal && isNaN(parseInt(hashVal)))
    ? hashVal : params.get('sku');

  if (!productId && !productSku) { showError(); return; }

  let products;
  try {
    const res = await fetch(MJ_API_BASE + '/api/public/shop/mahjoy/products');
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    products = (data.products || []).map(p => ({
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
  } catch (e) {
    showError(); return;
  }
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
  document.getElementById('pdp-price').textContent = getProductPrice(product);

  const descEl = document.getElementById('pdp-description');
  // Use API description, fallback to local descriptions map
  const descMap = window.MJ_DESCRIPTIONS || {};
  const specsMap = window.MJ_SPECS || {};
  const nameKey = (product.name || '').toLowerCase().trim();
  const skuUpper = (product.sku || '').toUpperCase();
  const localDesc = descMap[nameKey];

  // Find specs by SKU prefix
  let localSpecs = null;
  if (skuUpper.startsWith('MAT-')) localSpecs = specsMap['MAT'];
  else if (skuUpper.startsWith('TILE-')) localSpecs = specsMap['TILE'];
  else if (skuUpper.startsWith('RAKBAG-')) localSpecs = specsMap['RAKBAG'];
  else if (skuUpper.startsWith('RACK-')) localSpecs = specsMap['RACK'];
  else if (skuUpper.startsWith('BAG-TILE')) localSpecs = specsMap['BAG-TILE'];
  else if (skuUpper.startsWith('BAG-')) localSpecs = specsMap['BAG'];
  else if (skuUpper.startsWith('SHUF-')) localSpecs = specsMap['SHUF'];
  else if (skuUpper.startsWith('LINE-')) localSpecs = specsMap['LINE'];
  else if (skuUpper.startsWith('FOLIO-')) localSpecs = specsMap['FOLIO'];
  else if (localDesc) localSpecs = localDesc;

  const descText = product.description || (localDesc && localDesc.description) || (localSpecs && localSpecs.description) || '';
  // Prefer specs from name-based description (localDesc) over SKU-based (localSpecs)
  const specsArr = (localDesc && localDesc.specs) || (localSpecs && localSpecs.specs) || [];

  if (descText || specsArr.length) {
    let html = '';
    if (descText) {
      // Split by double newlines for paragraphs
      const paragraphs = descText.split(/\n\n+/);
      paragraphs.forEach(function(p, i) {
        p = p.trim();
        if (!p) return;
        // First paragraph that looks like a title (all caps or short)
        if (i === 0 && (p === p.toUpperCase() || p.length < 30)) {
          html += '<h3 style="font-family:Playfair Display,serif;font-size:1.1rem;font-weight:600;color:var(--burgundy);margin:0 0 16px 0;letter-spacing:0.05em;">' + p + '</h3>';
        } else {
          html += '<p style="margin:0 0 14px 0;line-height:1.7;color:#444;">' + p.replace(/\n/g, '<br>') + '</p>';
        }
      });
    }
    if (specsArr.length) {
      html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(107,15,42,0.1);">';
      html += '<ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;">';
      specsArr.forEach(function(s) {
        html += '<li style="display:flex;gap:10px;align-items:flex-start;font-size:.85rem;color:rgba(107,15,42,.8);line-height:1.5;"><span style="color:var(--orchid);flex-shrink:0;font-size:0.7rem;margin-top:3px;">✦</span>' + s + '</li>';
      });
      html += '</ul></div>';
    }
    descEl.innerHTML = html;
    descEl.style.display = 'block';
  } else {
    descEl.style.display = 'none';
  }

  // Stock - check if product is presale (not in IN_STOCK_SKUS)
  const stockEl = document.getElementById('pdp-stock');
  const isInStock = IN_STOCK_SKUS.includes(product.sku);
  const isSoldOut = product.stock === 0 || product.soldOut === true;
  
  if (isSoldOut) {
    // SOLD OUT - add badge overlay and disable buttons
    stockEl.innerHTML = '<span class="mj-pdp-stock-badge out">' + T.outOfStock + '</span>';
    document.getElementById('pdp-order-btn').style.opacity = '0.4';
    document.getElementById('pdp-order-btn').style.pointerEvents = 'none';
    document.getElementById('pdp-order-btn').title = 'Este producto está agotado';
    
    // Add SOLD OUT badge to image
    const imgWrap = document.querySelector('.mj-pdp-main-img-wrap');
    if (imgWrap) {
      imgWrap.style.position = 'relative';
      const mainImg = document.getElementById('pdp-main-img');
      if (mainImg) mainImg.style.opacity = '0.7';
      
      const soldOutBadge = document.createElement('div');
      soldOutBadge.className = 'mj-sold-out-badge';
      soldOutBadge.innerHTML = 'SOLD<br>OUT!';
      soldOutBadge.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-15deg);
        width: 180px;
        height: 180px;
        border-radius: 50%;
        background: rgba(107, 15, 42, 0.85);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Playfair Display', Georgia, serif;
        font-weight: 700;
        font-style: italic;
        font-size: 32px;
        text-align: center;
        line-height: 1.1;
        letter-spacing: 0.02em;
        z-index: 10;
        box-shadow: 0 4px 20px rgba(107, 15, 42, 0.3);
      `;
      imgWrap.appendChild(soldOutBadge);
    }
  } else if (!isInStock) {
    // Has stock but not in IN_STOCK list = presale
    stockEl.innerHTML = '<span class="mj-pdp-stock-badge presale" style="color:var(--orchid);font-weight:700;">' + T.presale + '</span>';
  } else if (product.stock > 5) {
    stockEl.innerHTML = '<span class="mj-pdp-stock-badge in">' + T.inStock + '</span>';
  } else {
    stockEl.innerHTML = '<span class="mj-pdp-stock-badge low">' + T.lowStock + '</span>';
  }

  // Order button with product info pre-filled in contact URL
  const contactUrl = `checkout.html#${product.id}`;
  document.getElementById('pdp-order-btn').href = contactUrl;
  document.getElementById('pdp-order-btn').textContent = T.buyNow;

  // ── Agregar al carrito ──────────────────────────────────────────────────
  const ctaWrap = document.querySelector('.mj-pdp-cta-wrap');
  if (ctaWrap) {
    const addBtn = document.createElement('button');
    addBtn.id = 'pdp-add-cart-btn';
    addBtn.style.cssText = [
      'display:block','width:100%','text-align:center',
      'background:transparent','color:var(--burgundy)',
      "font-family:'Plus Jakarta Sans',sans-serif",'font-size:.95rem','font-weight:700',
      'letter-spacing:.06em','text-transform:uppercase',
      'padding:1.05rem 2rem','border-radius:999px',
      'border:2.5px solid var(--burgundy)','cursor:pointer',
      'transition:all .2s','margin-bottom:0',
    ].join(';');
    addBtn.textContent = T.addToCart;
    addBtn.onmouseenter = () => { addBtn.style.background='var(--burgundy)'; addBtn.style.color='#fff'; };
    addBtn.onmouseleave = () => { addBtn.style.background='transparent'; addBtn.style.color='var(--burgundy)'; };
    addBtn.onclick = () => {
      // Save to localStorage directly (no MJCart dependency)
      try {
        const cart = JSON.parse(localStorage.getItem('mj_cart') || '[]');
        const idx = cart.findIndex(i => i.id === product.id);
        if (idx >= 0) { cart[idx].qty += 1; }
        else { cart.push({ id: product.id, sku: product.sku, name: product.name,
          price: parseFloat(product.price) || 0, image: product.primary_image_url || null, qty: 1 }); }
        localStorage.setItem('mj_cart', JSON.stringify(cart));
        // Update all cart badges (header + mobile menu)
        const total = cart.reduce((a, i) => a + i.qty, 0);
        // Header badge
        const headerBadge = document.getElementById('header-cart-badge');
        if (headerBadge) {
          headerBadge.textContent = total;
          headerBadge.style.display = total > 0 ? 'block' : 'none';
        }
        // Mobile menu badges
        document.querySelectorAll('.mj-cart-badge').forEach(el => {
          el.textContent = total; el.style.display = total > 0 ? 'flex' : 'none';
        });
        // Trigger global update if available
        if (window.updateCartBadge) window.updateCartBadge();
      } catch(e) { console.error(e); }
      addBtn.textContent = T.added;
      addBtn.style.background = 'var(--burgundy)';
      addBtn.style.color = '#fff';
      setTimeout(() => {
        addBtn.textContent = T.addToCart;
        addBtn.style.background = 'transparent';
        addBtn.style.color = 'var(--burgundy)';
      }, 2200);
    };
    ctaWrap.insertBefore(addBtn, ctaWrap.firstChild);
    
    // Disable Add to Cart if sold out
    if (isSoldOut) {
      addBtn.disabled = true;
      addBtn.style.opacity = '0.4';
      addBtn.style.cursor = 'not-allowed';
      addBtn.style.pointerEvents = 'none';
      addBtn.title = 'Este producto está agotado';
    }
  }

  // Meta
  document.getElementById('pdp-meta-cat').textContent = catLabel;
  document.getElementById('pdp-meta-sku').textContent = product.sku || '—';
  document.getElementById('pdp-meta-stock').textContent =
    product.stock > 0 ? 'Disponible' : 'Sin stock';

  // WhatsApp share
  const waText = `Hola! Me interesa este producto de MAH JOY:\n*${product.name}*\n${window.location.href}`;
  document.getElementById('pdp-share-wa').href =
    `https://wa.me/?text=${encodeURIComponent(waText)}`;

  // Related products (same category, exclude current) — optional section
  const relatedEl = document.getElementById('pdp-related');
  if (relatedEl) {
    const related = products
      .filter(p => p.id !== product.id && guessCategory(p) === cat)
      .slice(0, 4);
    if (related.length > 0) {
      relatedEl.innerHTML = related.map(buildRelatedCard).join('');
    } else {
      const relatedSection = document.querySelector('.mj-pdp-related');
      if (relatedSection) relatedSection.style.display = 'none';
    }
  }

  // Back to category link — optional
  const backCatEl = document.getElementById('pdp-back-cat');
  if (backCatEl) {
    backCatEl.href = catPage;
    backCatEl.textContent = `Ver todos los ${catLabel} →`;
  }

  // Show content
  document.getElementById('pdp-loading').style.display = 'none';
  document.getElementById('pdp-content').style.display = 'block';
  
  // Meta Pixel: ViewContent event
  if (typeof fbq === 'function') {
    fbq('track', 'ViewContent', {
      content_name: product.name,
      content_ids: [product.sku || product.id],
      content_type: 'product',
      value: parseFloat(product.price) || 0,
      currency: 'MXN'
    });
  }
}

document.addEventListener('DOMContentLoaded', loadProduct);
