/** The 2026 cards section uses the same published catalog and market prices as the shop. */
(function () {
  const grid = document.getElementById('mj-prod-grid');
  if (!grid) return;
  const english = window.location.pathname.startsWith('/en/');
  const api = 'https://proax.app/api';

  function showMessage(message, retry) {
    const state = document.createElement('div');
    state.className = 'mj-cards-state';
    state.setAttribute('role', retry ? 'alert' : 'status');
    const text = document.createElement('p');
    text.textContent = message;
    state.appendChild(text);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = english ? 'Try again' : 'Reintentar';
      button.addEventListener('click', load);
      state.appendChild(button);
    }
    grid.replaceChildren(state);
  }

  function imageUrl(product) {
    const value = product.image || product.primary_image_url || (product.published_image_urls || [])[0] || (product.images || [])[0];
    if (!value) return null;
    if (value.startsWith('http')) return value;
    if (value.startsWith('/api/public/media')) return 'https://proax.app' + value;
    if (value.startsWith('/public/media')) return api + value;
    return api + '/public/media?key=' + encodeURIComponent(value);
  }

  async function load() {
    grid.setAttribute('aria-busy', 'true');
    showMessage(english ? 'Loading cards…' : 'Cargando tarjetas…');
    try {
      const response = await fetch(api + '/public/mahjoy/catalog/products', {cache: 'no-store'});
      if (!response.ok) throw new Error('Catalog unavailable');
      const data = await response.json();
      const products = Array.isArray(data) ? data : data.products;
      if (!Array.isArray(products)) throw new Error('Invalid catalog');
      const cards = MJCatalog.prioritize(products.filter(MJCatalog.is2026Card), english);
      if (!cards.length) {
        showMessage(english ? '2026 cards will appear here when they are available.' : 'Las tarjetas 2026 se mostrarán aquí cuando estén disponibles.');
        return;
      }
      grid.replaceChildren(...cards.map(product => MJCatalog.card(product, imageUrl(product), MJCatalog.price(product, english), english)));
    } catch (_) {
      showMessage(english ? 'We could not load the cards. Please try again.' : 'No pudimos cargar las tarjetas. Intenta de nuevo.', true);
    } finally {
      grid.setAttribute('aria-busy', 'false');
    }
  }

  load();
})();
