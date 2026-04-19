/**
 * MAH JOY — Vendor referral tracking
 * Captures ?ref=CODE from URL and persists in localStorage
 * Attaches vendor code to all checkout flows
 */
(function () {
  const STORAGE_KEY = 'mj_vendor_ref';
  const API_BASE = 'https://api-production-b888.up.railway.app';

  // Capture ref from URL
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  if (ref) {
    // Validate ref exists and store it
    fetch(`${API_BASE}/public/vendors/by-code/${encodeURIComponent(ref.toUpperCase())}`)
      .then(r => r.json())
      .then(data => {
        if (data?.code) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            code: data.code,
            name: data.name,
            ts: Date.now(),
          }));
          // Show subtle badge
          showVendorBadge(data.name);
        }
      })
      .catch(() => {});
  }

  // Get current vendor ref (expires after 30 days)
  window.MJVendor = {
    getRef: function () {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        // Expire after 30 days
        if (Date.now() - data.ts > 30 * 24 * 60 * 60 * 1000) {
          localStorage.removeItem(STORAGE_KEY);
          return null;
        }
        return data;
      } catch { return null; }
    },
    getCode: function () {
      return window.MJVendor.getRef()?.code || null;
    },
    // Register a sale with the current vendor ref
    registerSale: async function ({ orderId, productNames, amount }) {
      const ref = window.MJVendor.getRef();
      if (!ref?.code) return;
      try {
        await fetch(`${API_BASE}/public/vendors/sales`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vendor_code: ref.code,
            order_id: orderId,
            product_names: productNames,
            amount: amount,
            source: 'web',
          }),
        });
      } catch (e) {
        console.warn('[vendor-ref] sale registration failed:', e);
      }
    },
  };

  function showVendorBadge(vendorName) {
    const badge = document.createElement('div');
    badge.style.cssText = [
      'position:fixed', 'bottom:5rem', 'left:50%', 'transform:translateX(-50%)',
      'background:var(--burgundy,#6B0F2A)', 'color:#fff',
      "font-family:'Plus Jakarta Sans',sans-serif", 'font-size:.8rem', 'font-weight:700',
      'padding:.6rem 1.4rem', 'border-radius:999px',
      'box-shadow:0 4px 20px rgba(107,15,42,.3)',
      'z-index:9999', 'pointer-events:none',
      'animation:fadeInUp .4s ease',
    ].join(';');
    badge.innerHTML = `🎉 Comprando con referido de <strong>${vendorName}</strong>`;
    document.body.appendChild(badge);

    const style = document.createElement('style');
    style.textContent = `@keyframes fadeInUp{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
    document.head.appendChild(style);

    setTimeout(() => badge.remove(), 4000);
  }
})();
