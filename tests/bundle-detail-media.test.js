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
}
