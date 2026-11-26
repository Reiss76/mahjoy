/* Quick purchase uses the same bundle identity and prices as the existing cart. */
(function (root) {
  function isImmediate(bundle, english) {
    var regionalSoldOut = english ? bundle.soldOutEn : bundle.soldOutEs;
    var comingSoon = english ? bundle.comingSoonEn : bundle.comingSoonEs;
    return bundle.active !== false && !bundle.presale && !bundle.presaleDate &&
      !bundle.presale_date && !bundle.comingSoon && !comingSoon &&
      regionalSoldOut !== true && !bundle.soldOut && bundle.stock !== 0;
  }

  function buy(bundle, image, english) {
    if (!isImmediate(bundle, english)) return false;
    var price = Number(english ? (bundle.priceUsd ?? bundle.price_usd) : bundle.price);
    if (!Number.isFinite(price) || price <= 0) return false;
    var cart = root.MJCart.getCart();
    var id = 'bundle-' + bundle.id;
    var sku = bundle.sku || 'BUNDLE-' + bundle.id;
    var index = cart.findIndex(function (item) { return item.id === id || item.sku === sku; });
    var item = {
      id: id, sku: sku, name: bundle.name, price: Number(bundle.price),
      price_usd: bundle.priceUsd ?? bundle.price_usd ?? null,
      image: image || null, qty: index >= 0 ? cart[index].qty + 1 : 1, isBundle: true
    };
    if (index >= 0) cart[index] = item;
    else cart.push(item);
    root.MJCart.saveCart(cart);
    root.location.href = 'cart.html';
    return true;
  }

  function mount(card, bundle, image, english) {
    var body = card.querySelector('.mj-prod-card-body');
    var actions = document.createElement('div');
    actions.className = 'mj-bundle-actions';
    var price = Number(english ? (bundle.priceUsd ?? bundle.price_usd) : bundle.price);
    if (isImmediate(bundle, english) && Number.isFinite(price) && price > 0) {
      var status = document.createElement('p');
      status.className = 'mj-bundle-ready';
      status.textContent = english ? 'Available · Ready to ship' : 'Disponible · Entrega inmediata';
      body.appendChild(status);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'mj-bundle-buy';
      button.textContent = english ? 'Buy now' : 'Comprar ahora';
      button.setAttribute('aria-label', button.textContent + ' — ' + bundle.name);
      button.addEventListener('click', function () {
        button.disabled = true;
        try {
          if (buy(bundle, image, english)) return;
        } catch (error) {
          // Storage may be unavailable in restricted/private browser sessions.
        }
        button.disabled = false;
        status.setAttribute('role', 'alert');
        status.textContent = english ? 'Could not open your cart. Please try again.' : 'No se pudo abrir el carrito. Intenta de nuevo.';
      });
      actions.appendChild(button);
    }
    var detail = document.createElement('a');
    detail.className = 'mj-bundle-view';
    detail.href = 'bundle-detail.html?id=' + encodeURIComponent(bundle.id);
    detail.textContent = english ? 'View set' : 'Ver set';
    detail.setAttribute('aria-label', detail.textContent + ' — ' + bundle.name);
    actions.appendChild(detail);
    body.appendChild(actions);
  }
  root.MJBundlePurchase = { isImmediate: isImmediate, buy: buy, mount: mount };
})(typeof window === 'undefined' ? globalThis : window);
