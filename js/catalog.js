/** Shared Proax catalog status and calendar dates for both storefronts. */
(function () {
  function dateLabel(raw, english) {
    const match = typeof raw === 'string' && raw.match(/^\d{4}-\d{2}-\d{2}/);
    if (!match) return '';
    const date = new Date(match[0] + 'T12:00:00Z');
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(english ? 'en-US' : 'es-MX', {day: 'numeric', month: 'short', timeZone: 'UTC'});
  }
  function status(product, english) {
    const regionalSoldOut = english ? product.soldOutEn : product.soldOutEs;
    const soldOut = typeof regionalSoldOut === 'boolean' ? regionalSoldOut : product.soldOut === true || product.stock === 0;
    const comingSoon = (english ? product.comingSoonEn : product.comingSoonEs) === true;
    const presale = product.presale === true;
    let label = '';
    if (soldOut) label = english ? 'Sold Out' : 'Agotado';
    else if (presale) {
      const date = dateLabel(product.presaleDate || product.comingSoonDate, english);
      label = (english ? 'Pre-order' : 'Pre venta') + (date ? ' · ' + (english ? 'Ships ' : 'Envío ') + date : '');
    } else if (comingSoon) {
      const date = dateLabel(product.comingSoonDate, english);
      label = 'Coming Soon' + (date ? ' · ' + date : '');
    }
    return {soldOut, comingSoon, presale, label};
  }
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function card(product, image, price, english) {
    const state = status(product, english);
    const element = document.createElement('a');
    element.href = state.soldOut ? '#' : 'product.html#' + product.id;
    element.className = 'mj-prod-card' + (state.soldOut ? ' mj-sold-out' : '') + (state.presale ? ' mj-presale' : '');
    const badge = state.label ? '<span class="mj-coming-soon-badge" style="background:var(--orchid);">' + escape(state.label) + '</span>' : '';
    element.innerHTML = badge + (image ? '<img src="' + escape(image) + '" alt="' + escape(product.name) + '" class="mj-prod-card-img" style="' + (state.soldOut ? 'opacity:0.7;' : '') + '" onerror="this.style.display=\'none\'">' : '<div class="mj-prod-card-img" style="height:200px;"></div>')
      + '<div class="mj-prod-card-body"><div class="mj-prod-card-name" title="' + escape(product.name) + '">' + escape(product.name) + '</div><div class="mj-prod-card-price">' + escape(price) + '</div>'
      + (state.soldOut ? '' : '<span style="display:inline-block;margin-top:10px;background:var(--burgundy);color:#fff;font-family:Plus Jakarta Sans,sans-serif;font-size:.7rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:8px 18px;border-radius:999px;">' + (english ? 'View Product' : 'Ver producto') + '</span>') + '</div>';
    return element;
  }
  function price(product, english) {
    const usd = product.priceUsd ?? product.price_usd;
    const currency = english || (window.MJCurrency && window.MJCurrency.get() === 'USD') ? 'USD' : 'MXN';
    const raw = Number(currency === 'USD' ? usd : product.price);
    return Number.isFinite(raw) && raw > 0 ? '$' + raw.toFixed(2) + ' ' + currency : '';
  }
  window.MJCatalog = {dateLabel, status, card, price};
})();
