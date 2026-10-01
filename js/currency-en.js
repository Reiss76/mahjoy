/** Each storefront uses its own published prices; the control switches markets. */
(function () {
  const isEnglish = window.location.pathname.includes('/en/');
  const currency = isEnglish ? 'USD' : 'MXN';
  function injectToggle() {
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu || document.getElementById('mj-currency-toggle')) return;
    const toggle = document.createElement('a');
    toggle.id = 'mj-currency-toggle';
    toggle.className = 'mj-currency-toggle';
    toggle.href = (isEnglish ? window.location.pathname.replace(/^\/en\//, '/') : '/en' + window.location.pathname) + window.location.search + window.location.hash;
    toggle.setAttribute('aria-label', isEnglish ? 'Switch to Mexico store (MXN)' : 'Cambiar a tienda Estados Unidos (USD)');
    toggle.innerHTML = '<span class="mj-cur-mxn'+(isEnglish?'':' active')+'">MXN</span><span class="mj-cur-sep">|</span><span class="mj-cur-usd'+(isEnglish?' active':'')+'">USD</span>';
    navMenu.appendChild(toggle);
  }
  document.addEventListener('DOMContentLoaded', injectToggle);
  window.MJCurrency = {
    get: () => currency,
    format: function (mxnPrice, usdPrice) {
      const source = isEnglish ? usdPrice : mxnPrice;
      if (source == null || !Number.isFinite(Number(source)) || Number(source) <= 0) return '';
      return '$' + Number(source).toFixed(2) + ' ' + currency;
    }
  };
})();
