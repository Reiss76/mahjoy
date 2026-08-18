/**
 * Mahjoy — Envío México (envia.com)
 * Cotiza envío en tiempo real según código postal
 */
(function() {
  const ORIGIN_CP = ''; // TODO: Set origin postal code
  const API_ENDPOINT = '/api/shipping/quote'; // Server-side proxy

  window.MJShipping = {
    // Get shipping quote
    async getQuote(destCP, items) {
      if (!destCP || destCP.length !== 5) {
        return { error: 'Código postal inválido' };
      }
      
      try {
        const res = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: ORIGIN_CP,
            destination: destCP,
            items: items
          })
        });
        return await res.json();
      } catch (err) {
        console.error('Shipping quote error:', err);
        return { error: 'No se pudo calcular el envío' };
      }
    },

    // Format quote for display
    formatQuotes(quotes) {
      if (!quotes || !quotes.length) return '<p>No hay opciones de envío disponibles.</p>';
      
      return quotes.map(q => `
        <label class="mj-shipping-option">
          <input type="radio" name="shipping" value="${q.id}" data-price="${q.price}">
          <span class="mj-carrier">${q.carrier}</span>
          <span class="mj-service">${q.service}</span>
          <span class="mj-days">${q.days} días</span>
          <span class="mj-price">$${q.price.toFixed(2)} MXN</span>
        </label>
      `).join('');
    }
  };
})();
