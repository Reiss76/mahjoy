const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const mediaQuery = '?key=products%2Fgolden-lotus.jpeg&v=2';
const cases = [
  ['/api/public/media' + mediaQuery, 'https://proax.app/api/public/media' + mediaQuery],
  ['/public/media' + mediaQuery, 'https://proax.app/api/public/media' + mediaQuery],
  ['https://cdn.example.com/bundle.jpeg', 'https://cdn.example.com/bundle.jpeg'],
  ['images/bundles/bundle.jpg', 'images/bundles/bundle.jpg'],
];

for (const lang of ['', 'en/']) {
  test(`${lang}bundle detail and cart resolve media against the catalog origin`, async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', lang, 'bundle-detail.html'), 'utf8');
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).find(source => source.includes('const MJ_API ='));

    for (const [image, expected] of cases) {
      const bundle = {
        id: 29, sku: 'BUNDLE-29', name: 'Golden Lotus',
        price: 6000, price_usd: 340, image, products: [],
      };
      const content = { innerHTML: '' };
      const storage = new Map();
      const context = {
        URLSearchParams, Intl, console,
        window: { location: { search: '?id=29' } },
        document: {
          getElementById: () => content,
          querySelectorAll: () => [],
        },
        localStorage: {
          getItem: key => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
        },
        MJBundleAvailability: () => '',
        fetch: async url => {
          assert.equal(url, 'https://proax.app/api/public/mahjoy/bundles');
          return { json: async () => [bundle] };
        },
      };

      vm.runInNewContext(script, context);
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(content.innerHTML.includes(`src="${expected}"`));
      assert.equal(context.document.title, 'Golden Lotus — MAH JOY');

      context.buyBundle(bundle);
      let cart = JSON.parse(storage.get('mj_cart'));
      assert.equal(cart[0].image, expected);
      assert.equal(cart[0].price, 6000);
      assert.equal(cart[0].price_usd, 340);
      assert.equal(context.window.location.href, 'checkout.html?bundle=29');

      // Adding a bundle already stored by an older page repairs its relative image too.
      cart[0].image = image;
      storage.set('mj_cart', JSON.stringify(cart));
      context.buyBundle(bundle);
      cart = JSON.parse(storage.get('mj_cart'));
      assert.equal(cart.length, 1);
      assert.equal(cart[0].qty, 2);
      assert.equal(cart[0].image, expected);
    }
  });

  test(`${lang}bundle components show their matching catalog photos without changing prices`, async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', lang, 'bundle-detail.html'), 'utf8');
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map(match => match[1]).find(source => source.includes('const MJ_API ='));
    const bundle = {
      id: 15, name: 'Tennis Club', price: 14700, price_usd: 945,
      products: [
        {sku: 'Bag-pink', name: 'Bag Pink', quantity: 1, price: 2400, price_usd: 160},
        {sku: 'MAT-012', name: 'Mat Tennis Club', quantity: 2, price: 1200, price_usd: 80},
        {id: 64, name: 'Sensu Tile', quantity: 1, price: 6000, price_usd: 380},
        {sku: 'direct', name: 'Direct image', image: 'https://cdn.example.com/direct.jpg'},
        {sku: 'missing', name: 'No photo'},
      ],
      // Item order differs from the price summary, so positions cannot match photos.
      items: [
        {sku: 'mat-012', primary_image_url: '/public/media?key=products%2Fmat.jpeg&v=2'},
        {product_id: 64, primary_image_url: 'https://cdn.example.com/tiles.jpg'},
        {sku: 'Bag-pink', primary_image_url: '/api/public/media?key=products%2Fbag.jpeg&v=2'},
      ],
    };
    const original = JSON.stringify(bundle);
    const content = {innerHTML: ''};
    vm.runInNewContext(script, {
      URLSearchParams, Intl, console,
      window: {location: {search: '?id=15'}},
      document: {getElementById: () => content},
      MJBundleAvailability: () => '',
      fetch: async () => ({json: async () => [bundle]}),
    });
    await new Promise(resolve => setImmediate(resolve));
    const rows = content.innerHTML.split('<div class="mj-bundle-product">').slice(1);
    for (const [index, image] of [
      'https://proax.app/api/public/media?key=products%2Fbag.jpeg&v=2',
      'https://proax.app/api/public/media?key=products%2Fmat.jpeg&v=2',
      'https://cdn.example.com/tiles.jpg', 'https://cdn.example.com/direct.jpg',
    ].entries()) assert.ok(rows[index].includes(`src="${image}"`));
    assert.ok(!rows[4].includes('<img '), 'Keep the placeholder only when no photo exists');
    assert.ok(rows[1].includes('2× MAT-012'));
    assert.ok(rows[1].includes(lang ? '$160.00' : '$2,400.00'));
    assert.equal(JSON.stringify(bundle), original, 'Rendering must not mutate catalog data');
  });
}

for (const lang of ['', 'en/']) {
  test(`${lang}checkout resolves bundle photos before rendering and exposing the cart item`, async () => {
    for (const [image, expected] of cases) {
      for (const field of ['image', 'image_key']) {
        const bundle = {id: 15, name: 'Tennis Club', price: 14700, price_usd: 945, [field]: image};
        const elements = new Map();
        const getElementById = id => {
          if (id === 'co-wa-btn') return null;
          if (!elements.has(id)) elements.set(id, {style: {}, addEventListener() {}});
          return elements.get(id);
        };
        const context = {
          URLSearchParams, Intl, console: {log() {}, error() {}},
          window: {
            location: {pathname: `/${lang}checkout.html`, search: '?bundle=15', hash: ''},
            addEventListener() {}, MJShippingCheckout: {subscribe() {}, refresh() {}},
          },
          document: {getElementById, addEventListener() {}},
          fetch: async () => ({ok: true, json: async () => ({bundles: [bundle]})}),
        };
        vm.createContext(context);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/checkout.js'), 'utf8'), context);
        await context.loadCheckout();
        assert.equal(getElementById('co-img').src, expected);
        assert.equal(getElementById('co-img').alt, bundle.name);
        assert.equal(context.window.MJCheckoutProduct.primary_image_url, expected);
        assert.equal(context.window.MJCheckoutProduct.images[0], expected);
        assert.equal(context.window.MJCheckoutProduct.price, 14700);
        assert.equal(context.window.MJCheckoutProduct.price_usd, 945);
        assert.equal(getElementById('co-total').textContent, lang ? '$945.00' : '$14,700.00');
      }
    }
  });
}
