/**
 * Mahjoy — Currency toggle MXN / USD
 * Adds a MXN|USD toggle to the nav bar.
 * Prices rendered with class .mj-price are updated on toggle.
 * Exchange rate: 1 USD = 18 MXN (approximate).
 */
(function () {
  const RATE = 18;
  const KEY = 'mj_currency';

  function getCurrency() { return localStorage.getItem(KEY) || 'MXN'; }

  function setCurrency(c) {
    localStorage.setItem(KEY, c);
    updatePrices();
    updateToggleUI();
  }

  function updatePrices() {
    const isMXN = getCurrency() === 'MXN';
    document.querySelectorAll('[data-price-mxn]').forEach(el => {
      const raw = parseFloat(el.dataset.priceMxn || 0);
      if (!raw) return;
      el.textContent = isMXN
        ? '$' + raw.toFixed(2) + ' MXN'
        : '$' + (raw / RATE).toFixed(2) + ' USD';
    });
  }

  function updateToggleUI() {
    const cur = getCurrency();
    document.querySelectorAll('.mj-cur-mxn').forEach(el => el.classList.toggle('active', cur === 'MXN'));
    document.querySelectorAll('.mj-cur-usd').forEach(el => el.classList.toggle('active', cur === 'USD'));
  }

  function injectToggle() {
    const navMenu = document.querySelector('.nav-menu');
    if (!navMenu || document.getElementById('mj-currency-toggle')) return;

    const toggle = document.createElement('div');
    toggle.id = 'mj-currency-toggle';
    toggle.className = 'mj-currency-toggle';
    toggle.innerHTML = '<span class="mj-cur-mxn">MXN</span><span class="mj-cur-sep">|</span><span class="mj-cur-usd">USD</span>';
    toggle.addEventListener('click', function () {
      setCurrency(getCurrency() === 'MXN' ? 'USD' : 'MXN');
    });
    navMenu.appendChild(toggle);
    updateToggleUI();
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectToggle();
    updatePrices();
  });

  // Expose globally so shop pages can use it
  window.MJCurrency = {
    get: getCurrency,
    format: function (mxnPrice) {
      const raw = parseFloat(mxnPrice || 0);
      if (!raw) return '';
      const isMXN = getCurrency() === 'MXN';
      return isMXN ? '$' + raw.toFixed(2) + ' MXN' : '$' + (raw / RATE).toFixed(2) + ' USD';
    }
  };
})();
