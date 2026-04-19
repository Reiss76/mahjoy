/**
 * MAH JOY — Checkout Page
 * Reads product from hash/query, populates summary, handles form submit
 */

const MJ_API_BASE = 'https://api-production-b888.up.railway.app';
const MJ_WA_NUMBER = '525500000000'; // TODO: cambiar por número real de Mahjoy
const MJ_CENTUMPAY_ENDPOINT = '/api/centumpay/checkout';

const CATEGORY_LABELS = {
  'tiles':'Tiles','mats':'Mats','racks':'Racks','mahjoy-bags':'Mahjoy Bags',
  'tile-bags':'Tile Bags','rack-bags':'Rack Bags','accessories':'Accessories',
  'card-holders':'Card Holders','shufflers':'Shufflers','line-finder':'Line Finder',
};
const CATEGORY_PAGES = {
  'tiles':'shop-tiles.html','mats':'shop-mats.html','racks':'shop-racks.html',
  'mahjoy-bags':'shop-mahjoy-bags.html','tile-bags':'shop-tile-bags.html',
  'rack-bags':'shop-rack-bags.html','accessories':'shop-accessories.html',
  'card-holders':'shop-card-holders.html','shufflers':'shop-shufflers.html',
  'line-finder':'shop-line-finder.html',
};
const CATEGORY_MAP = {
  'tiles':['tile','ficha','pieza'],'mats':['mat','tapete','base'],
  'racks':['rack','soporte','atril'],'mahjoy-bags':['mahjoy bag','bolsa mahjoy'],
  'tile-bags':['tile bag','bolsa ficha'],'rack-bags':['rack bag','bolsa rack'],
  'accessories':['accessory','accesorio','set','kit'],
  'card-holders':['card holder','porta carta'],'shufflers':['shuffler','mezclador'],
  'line-finder':['line finder','buscador'],
};

let currentProduct = null;
let qty = 1;
let appliedDiscount = null; // { code, vendorCode, vendorName, pct }

function getDiscountedTotal() {
  if (!currentProduct) return 0;
  const sub = (parseFloat(currentProduct.price) || 0) * qty;
  if (!appliedDiscount || appliedDiscount.pct <= 0) return sub;
  return sub * (1 - appliedDiscount.pct / 100);
}

function resolveImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('/api/public/media')) return MJ_API_BASE + url.replace('/api/public/media', '/public/media');
  if (url.startsWith('/public/media')) return MJ_API_BASE + url;
  return url;
}

function formatPrice(price) {
  const num = parseFloat(price);
  if (!num || num === 0) return 'Consultar';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
}

function formatPriceNum(price) {
  return parseFloat(price) || 0;
}

function guessCategory(p) {
  if (p.category) return p.category;
  const text = ((p.name||'')+(p.sku||'')+(p.description||'')).toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_MAP)) {
    if (kws.some(k => text.includes(k))) return cat;
  }
  return null;
}

function updateTotals() {
  if (!currentProduct) return;
  const unit = formatPriceNum(currentProduct.price);
  const sub = unit * qty;
  document.getElementById('co-subtotal').textContent = unit ? formatPrice(sub) : 'Consultar';

  // Discount row
  const discRow = document.getElementById('co-discount-row');
  if (appliedDiscount && appliedDiscount.pct > 0 && unit) {
    const saving = sub * (appliedDiscount.pct / 100);
    discRow.style.display = 'flex';
    document.getElementById('co-discount-label').textContent =
      `Descuento ${appliedDiscount.pct}% (${appliedDiscount.vendorName})`;
    document.getElementById('co-discount-amount').textContent = `-${formatPrice(saving)}`;
  } else {
    discRow.style.display = 'none';
  }

  const total = getDiscountedTotal();
  document.getElementById('co-total').textContent = unit ? formatPrice(total) : 'Consultar';
  updateWaLink();
}

function changeQty(delta) {
  qty = Math.max(1, qty + delta);
  document.getElementById('co-qty-display').textContent = qty;
  document.getElementById('co-qty').value = qty;
  updateTotals();
}

function updateWaLink() {
  if (!currentProduct) return;
  const form = document.getElementById('co-form');
  const name = form.querySelector('[name=name]').value || '';
  const msg = `Hola MAH JOY! 🀄\n\nQuiero ordenar:\n*${currentProduct.name}* (${currentProduct.sku || ''})\nCantidad: ${qty}\n\n${name ? 'Mi nombre: ' + name + '\n' : ''}¿Pueden ayudarme?`;
  document.getElementById('co-wa-btn').href = `https://wa.me/${MJ_WA_NUMBER}?text=${encodeURIComponent(msg)}`;
}

async function loadCheckout() {
  // Read product ID from hash or query
  const params = new URLSearchParams(window.location.search);
  const hashVal = window.location.hash.replace('#', '').trim();
  const rawId = hashVal && !isNaN(hashVal) ? hashVal : params.get('id');
  const productId = rawId ? parseInt(rawId) : null;
  const productSku = (!productId && hashVal) ? hashVal : params.get('sku');

  if (!productId && !productSku) {
    document.getElementById('co-loading').style.display = 'none';
    document.getElementById('co-content').style.display = 'block';
    // No product specified — show empty checkout
    document.getElementById('co-name').textContent = 'Producto no especificado';
    document.getElementById('co-img-wrap').style.display = 'none';
    return;
  }

  let data;
  try {
    const res = await fetch('products.json');
    data = await res.json();
  } catch (e) {
    document.getElementById('co-loading').style.display = 'none';
    document.getElementById('co-content').style.display = 'block';
    return;
  }

  const products = data.products || [];
  const product = productId
    ? products.find(p => p.id === productId)
    : products.find(p => p.sku === productSku);

  if (!product) {
    document.getElementById('co-loading').style.display = 'none';
    document.getElementById('co-content').style.display = 'block';
    return;
  }

  currentProduct = product;
  const cat = guessCategory(product);
  const catLabel = CATEGORY_LABELS[cat] || cat || 'Shop';
  const catPage  = CATEGORY_PAGES[cat] || 'shop.html';

  // Populate page title
  document.title = `Ordenar ${product.name} — MAH JOY`;

  // Breadcrumb
  const catLink = document.getElementById('co-cat-link');
  catLink.textContent = catLabel; catLink.href = catPage;
  document.getElementById('co-bc-name').textContent = product.name;

  // Image
  const imgSrc = resolveImageUrl(product.primary_image_url);
  if (imgSrc) {
    document.getElementById('co-img').src = imgSrc;
    document.getElementById('co-img').alt = product.name;
  } else {
    document.getElementById('co-img-wrap').innerHTML =
      '<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--blush);"><span style="font-size:3rem;opacity:.3;">✦</span></div>';
  }

  // Product info
  document.getElementById('co-cat-badge').textContent = catLabel;
  document.getElementById('co-name').textContent = product.name;
  document.getElementById('co-sku').textContent = product.sku || '';
  document.getElementById('co-price').textContent = formatPrice(product.price);

  updateTotals();

  // Show
  document.getElementById('co-loading').style.display = 'none';
  document.getElementById('co-content').style.display = 'block';

  // Update WA link on input change
  document.getElementById('co-form').addEventListener('input', updateWaLink);
}

// Form submit
document.addEventListener('DOMContentLoaded', () => {
  loadCheckout();

  document.getElementById('co-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = document.getElementById('co-submit');

    const data = {
      name: `${form.name.value} ${form.lastname.value}`.trim(),
      email: form.email.value,
      phone: form.phone.value,
      city: form.city.value,
      qty: parseInt(form.qty.value) || 1,
      notes: form.notes.value,
      product: currentProduct ? currentProduct.name : '—',
      sku: currentProduct ? currentProduct.sku : '—',
    };

    btn.textContent = 'Procesando pago...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    // Build cart — apply discount if active
    const basePrice = parseFloat(currentProduct?.price) || 0;
    const discountedPrice = appliedDiscount && appliedDiscount.pct > 0
      ? Math.round(basePrice * (1 - appliedDiscount.pct / 100) * 100) / 100
      : basePrice;
    const cart = currentProduct
      ? [{ name: currentProduct.name, price: discountedPrice, qty: data.qty }]
      : [];

    // Include vendor ref in order ID
    const vendorCode = window.MJVendor?.getCode() || null;
    const orderId = `mahjoy-${currentProduct?.id || ''}-${vendorCode ? vendorCode + '-' : ''}${Date.now()}`;

    try {
      // Call CentumPay proxy on Proax API
      const res = await fetch(MJ_CENTUMPAY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart,
          orderId,
          webSite: 'https://mahjoy-production.up.railway.app',
        }),
      });

      const result = await res.json();

      if (result.ok && result.checkoutUrl) {
        // Register vendor sale if applicable
        if (vendorCode && window.MJVendor) {
          const total = cart.reduce((a, i) => a + i.price * i.qty, 0);
          window.MJVendor.registerSale({
            orderId,
            productNames: cart.map(i => i.name).join(', '),
            amount: total,
          });
        }
        window.location.href = result.checkoutUrl;
      } else {
        // Fallback to WhatsApp if CentumPay fails
        const msg = [`🀄 *Nuevo pedido MAH JOY*`, ``, `*Producto:* ${data.product} (${data.sku})`,
          `*Cantidad:* ${data.qty}`, ``, `*Cliente:* ${data.name}`, `*Email:* ${data.email}`,
          `*WhatsApp:* ${data.phone}`, `*Ciudad:* ${data.city}`,
          data.notes ? `*Notas:* ${data.notes}` : ''].filter(Boolean).join('\n');
        window.open(`https://wa.me/${MJ_WA_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
        document.getElementById('co-content').style.display = 'none';
        document.getElementById('co-thanks').style.display = 'flex';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      // Network error — fallback to WhatsApp
      console.error('CentumPay error:', err);
      const msg = `🀄 Pedido MAH JOY: ${data.product} x${data.qty}\nCliente: ${data.name} | ${data.phone}`;
      window.open(`https://wa.me/${MJ_WA_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
      btn.textContent = 'Enviar pedido →';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });

  // ── Discount code handler ─────────────────────────────────────────────────
  const discInput = document.getElementById('co-discount-input');
  const discBtn   = document.getElementById('co-discount-btn');
  const discMsg   = document.getElementById('co-discount-msg');

  discBtn.addEventListener('click', async () => {
    const code = discInput.value.trim().toUpperCase();
    if (!code) return;

    discBtn.textContent = '...';
    discBtn.disabled = true;
    discMsg.style.display = 'none';

    try {
      const res = await fetch(`${MJ_API_BASE}/public/vendors/discount/${encodeURIComponent(code)}`);
      const data = await res.json();

      if (!res.ok || !data.valid) {
        discMsg.style.display = 'block';
        discMsg.style.color = '#dc2626';
        discMsg.textContent = '✗ Código no válido o expirado';
        appliedDiscount = null;
        updateTotals();
      } else {
        appliedDiscount = {
          code: data.discount_code,
          vendorCode: data.vendor_code,
          vendorName: data.vendor_name,
          pct: data.discount_pct,
        };
        // Also set vendor ref for commission tracking
        if (window.MJVendor) {
          try {
            const resp = await fetch(`${MJ_API_BASE}/public/vendors/by-code/${data.vendor_code}`);
            const vd = await resp.json();
            if (vd?.code) {
              localStorage.setItem('mj_vendor_ref', JSON.stringify({ code: vd.code, name: vd.name, ts: Date.now() }));
            }
          } catch {}
        }
        discInput.disabled = true;
        discInput.style.opacity = '.6';
        discBtn.textContent = '✓';
        discBtn.style.background = '#16a34a';
        discMsg.style.display = 'block';
        if (data.discount_pct > 0) {
          discMsg.style.color = '#16a34a';
          discMsg.textContent = `✓ ${data.discount_pct}% de descuento aplicado — referido de ${data.vendor_name} 🎉`;
        } else {
          discMsg.style.color = '#9B3E7A';
          discMsg.textContent = `✓ Código registrado — referido de ${data.vendor_name}`;
        }
        updateTotals();
      }
    } catch {
      discMsg.style.display = 'block';
      discMsg.style.color = '#dc2626';
      discMsg.textContent = '✗ No se pudo validar el código';
    } finally {
      if (!appliedDiscount) {
        discBtn.textContent = 'Aplicar';
        discBtn.disabled = false;
      }
    }
  });

  // Allow pressing Enter in discount input
  discInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); discBtn.click(); } });
});
