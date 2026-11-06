const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function element(tagName = 'div') {
  return {
    tagName,
    attributes: {},
    children: [],
    listeners: {},
    style: {},
    innerHTML: '',
    textContent: '',
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
  };
}

function browser(english = false) {
  const grid = element();
  const context = {
    console,
    URLSearchParams,
    setTimeout,
    location: {
      pathname: english ? '/en/shop-cards-2026.html' : '/shop-cards-2026.html',
      search: '',
      hash: '',
    },
    document: {
      getElementById: id => id === 'mj-prod-grid' ? grid : null,
      createElement: element,
      addEventListener() {},
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('js/catalog.js'), context, {filename: 'js/catalog.js'});
  return {context, grid};
}

const fixtures = [
  {id: 201, sku: 'CARD-2026-STANDARD', name: 'Tarjeta 2026 estándar', price: 875.5, priceUsd: 68.25,
    stock: 5, primary_image_url: '/api/public/media?key=standard'},
  {id: 202, sku: 'CARD-2026-LARGE', name: '2026 Large Print Card', price: 910, price_usd: 72.5,
    stock: 8, presale: true, presaleDate: '2026-12-15', images: ['/public/media?key=large']},
  {id: 203, sku: 'TARJETA-2026', name: 'Tarjeta 2026', price: 700, priceUsd: 55,
    stock: 0, soldOutEs: true, soldOutEn: true, published_image_urls: ['/public/media?key=sold']},
  {id: 204, sku: 'CARD-2026-EXTRA', name: '2026 Card Extra', price: 650, priceUsd: 49.5,
    stock: 3, soldOutEs: false, soldOutEn: true},
  {id: 205, sku: 'FOLIO-2026', name: '2026 Card Holder', price: 300, priceUsd: 20,
    stock: 5, primary_image_url: '/api/public/media?key=holder'},
  {id: 206, sku: 'CARD-2025', name: '2025 Card', price: 600, priceUsd: 45,
    stock: 2, primary_image_url: '/api/public/media?key=old'},
];

test('2026 cards match Spanish/English metadata without including holders or other years', () => {
  const {context} = browser();
  const matches = context.MJCatalog.is2026Card;
  for (const product of [
    ...fixtures.slice(0, 4),
    {id: 111, sku: 'TJT', name: 'National Mahjong League Card', description: 'Set de 4'},
    {sku: 'CUSTOM', name: 'Tarjetas de mahjong 2026'},
    {sku: 'CUSTOM', category: 'cards-2026', name: 'Large print'},
    {sku: 'CARTAS_2026', name: 'Edición especial'},
  ]) assert.equal(matches(product), true, JSON.stringify(product));
  for (const product of [
    ...fixtures.slice(4),
    {sku: 'CARD-HOLDER-2026', name: 'Pink Card Holder'},
    {sku: 'CH-2026', name: 'Portatarjetas 2026'},
    {sku: 'FOLIO-2026', name: 'Tarjetas 2026'},
    {sku: 'MAT-2026', name: 'Tapete 2026'},
    {sku: 'CARD-2027', name: '2027 Card'},
    {sku: 'TJT', name: 'National Mahjong League Card 2027'},
    {sku: 'CARD-20260', name: 'Card edition'},
    {sku: 'CARD-20265', name: 'Card edition'},
    {},
  ]) assert.equal(matches(product), false, JSON.stringify(product));
});

test('both markets render all matching cards with existing prices, images, and preorder/sold-out behavior', async () => {
  const before = JSON.stringify(fixtures);
  for (const english of [false, true]) {
    const {context, grid} = browser(english);
    const requests = [];
    context.fetch = async (url, options) => {
      requests.push({url, options});
      return {ok: true, json: async () => ({products: fixtures})};
    };
    vm.runInContext(read('js/cards-2026.js'), context, {filename: 'js/cards-2026.js'});
    await flush();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://proax.app/api/public/mahjoy/catalog/products');
    assert.equal(requests[0].options.cache, 'no-store');
    assert.equal(grid.attributes['aria-busy'], 'false');
    assert.equal(grid.children.length, 4);
    const expectedOrder = english ? [201, 202, 203, 204] : [201, 204, 202, 203];
    for (const [index, id] of expectedOrder.entries()) {
      const product = fixtures.find(item => item.id === id);
      const soldOut = english ? product.soldOutEn : product.soldOutEs;
      assert.equal(grid.children[index].href, soldOut ? '#' : 'product.html#' + id);
      assert(grid.children[index].innerHTML.includes(product.name));
    }
    const standard = grid.children.find(card => card.href === 'product.html#201');
    assert(standard.innerHTML.includes(english ? '$68.25 USD' : '$875.50 MXN'));
    assert(standard.innerHTML.includes('https://proax.app/api/public/media?key=standard'));
    const preorder = grid.children.find(card => card.href === 'product.html#202');
    assert(preorder.className.includes('mj-presale'));
    assert(preorder.innerHTML.includes(english ? 'Pre-order' : 'Pre venta'));
    assert(preorder.innerHTML.includes(english ? 'Ships' : 'Envío'));
    assert(preorder.innerHTML.includes('15'), 'The published preorder date remains visible');
    assert(preorder.innerHTML.includes(english ? '$72.50 USD' : '$910.00 MXN'));
    assert(preorder.innerHTML.includes('https://proax.app/api/public/media?key=large'));
    assert(grid.children.some(card => card.innerHTML.includes('https://proax.app/api/public/media?key=sold')));
    assert.equal(JSON.stringify(fixtures), before, 'Rendering must not alter catalog prices or flags');
  }
});

test('a valid empty catalog has a localized empty state and clears the loading state', async () => {
  for (const english of [false, true]) {
    const {context, grid} = browser(english);
    context.fetch = async () => ({ok: true, json: async () => ({products: fixtures.slice(4)})});
    vm.runInContext(read('js/cards-2026.js'), context);
    await flush();
    assert.equal(grid.children.length, 1);
    assert.equal(grid.children[0].attributes.role, 'status');
    assert.match(grid.children[0].children[0].textContent, english ? /will appear here/ : /se mostrarán aquí/);
    assert.equal(grid.attributes['aria-busy'], 'false');
    assert.equal(grid.children[0].children.length, 1, 'Empty catalogs do not need a retry button');
  }
});

test('network, HTTP, and malformed catalog errors offer a working localized retry', async () => {
  for (const english of [false, true]) {
    for (const failure of ['network', 'http', 'shape']) {
      const {context, grid} = browser(english);
      let attempts = 0;
      context.fetch = async () => {
        attempts += 1;
        if (attempts > 1) return {ok: true, json: async () => [fixtures[0]]};
        if (failure === 'network') throw new Error('offline');
        return {ok: failure !== 'http', json: async () => ({products: null})};
      };
      vm.runInContext(read('js/cards-2026.js'), context);
      await flush();
      const state = grid.children[0];
      assert.equal(state.attributes.role, 'alert');
      assert.match(state.children[0].textContent, english ? /could not load/ : /No pudimos cargar/);
      assert.equal(grid.attributes['aria-busy'], 'false');
      const retry = state.children[1];
      assert.equal(retry.tagName, 'button');
      assert.equal(retry.type, 'button');
      assert.equal(retry.textContent, english ? 'Try again' : 'Reintentar');
      await retry.listeners.click();
      assert.equal(attempts, 2);
      assert.equal(grid.children[0].href, 'product.html#201');
      assert.equal(grid.attributes['aria-busy'], 'false');
    }
  }
});

test('product and checkout breadcrumbs prefer the cards section and its localized label', () => {
  for (const english of [false, true]) {
    for (const script of ['product', 'checkout']) {
      const {context} = browser(english);
      // Loading the checkout script subscribes to the existing shipping service.
      // No DOMContentLoaded event is dispatched, so payment and checkout flows do not run.
      context.MJShippingCheckout = {subscribe() {}};
      vm.runInContext(read('js/' + script + '.js'), context, {filename: script + '.js'});
      assert.equal(context.guessCategory({...fixtures[0], category: 'accessories'}), 'cards-2026');
      assert.equal(vm.runInContext("CATEGORY_PAGES['cards-2026']", context), 'shop-cards-2026.html');
      assert.equal(vm.runInContext("CATEGORY_LABELS['cards-2026']", context), english ? '2026 Cards' : 'Tarjetas 2026');
      const html = read((english ? 'en/' : '') + script + '.html');
      assert(html.indexOf('js/catalog.js') < html.indexOf('js/' + script + '.js'), 'Shared classifier must load before its consumer');
    }
  }
});

test('actual card-holder page loaders exclude 2026 cards in both markets', async () => {
  for (const english of [false, true]) {
    const {context, grid} = browser(english);
    context.fetch = async () => ({ok: true, json: async () => ({products: fixtures.slice(0, 5)})});
    const html = read((english ? 'en/' : '') + 'shop-card-holders.html');
    const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).find(script => script.includes('function skuMatch'));
    assert(inline, 'The production inline category loader must be exercised');
    vm.runInContext(inline, context);
    await flush();
    assert.equal(grid.children.length, 1);
    assert.equal(grid.children[0].href, 'product.html#205');
  }
});

test('every existing Shop menu links to the localized cards section', () => {
  let menus = 0;
  for (const directory of ['', 'en']) {
    const english = directory === 'en';
    for (const file of fs.readdirSync(path.join(root, directory)).filter(file => file.endsWith('.html'))) {
      const html = read(path.join(directory, file));
      for (const [, menu] of html.matchAll(/<div[^>]*class="[^"]*\bmj-shop-list\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
        menus += 1;
        const links = [...menu.matchAll(/<a href="shop-cards-2026\.html"[^>]*>([^<]+)<\/a>/g)];
        assert.equal(links.length, 1, directory + '/' + file);
        assert.equal(links[0][1], english ? '2026 Cards' : 'Tarjetas 2026');
      }
    }
  }
  assert(menus >= 42, 'Both new pages and all existing menus should be covered');
});

test('new category pages have matching language routes and load existing local assets', () => {
  for (const directory of ['', 'en']) {
    const english = directory === 'en';
    const file = path.join(directory, 'shop-cards-2026.html');
    const html = read(file);
    assert(html.includes('<html lang="' + (english ? 'en' : 'es') + '">'));
    assert(html.includes('<h1 class="mj-cat-header-title">' + (english ? '2026 Cards' : 'Tarjetas 2026') + '</h1>'));
    assert(html.includes('hreflang="es" href="https://www.playmahjoy.com/shop-cards-2026.html"'));
    assert(html.includes('hreflang="en" href="https://www.playmahjoy.com/en/shop-cards-2026.html"'));
    assert(html.indexOf('js/catalog.js') < html.indexOf('js/cards-2026.js'));
    for (const [, asset] of html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+)"/g)) {
      if (/^https?:/.test(asset)) continue;
      assert(fs.existsSync(path.resolve(root, directory, asset)), file + ': missing ' + asset);
    }
  }
});
