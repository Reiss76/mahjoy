const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(cart = []) {
  const context = { location: { href: '' }, MJCart: { getCart: () => cart, saveCart: value => { cart = value; } } };
  vm.runInNewContext(fs.readFileSync('js/bundle-purchase.js', 'utf8'), context);
  return { api: context.MJBundlePurchase, context, cart: () => cart };
}
const ready = { id: 29, sku: 'BUNDLE-29', name: 'Golden Lotus', price: '10100', price_usd: 640, presale: false };
test('quick buy keeps existing items, bundles as one line, and independent market prices', () => {
  const s = setup([{ id: 7, sku: 'OTHER', qty: 2, price: 100 }]);
  assert.equal(s.api.buy(ready, 'https://image.test/bundle.jpg', true), true);
  assert.equal(s.context.location.href, 'cart.html');
  assert.equal(s.cart().length, 2);
  assert.equal(s.cart()[1].id, 'bundle-29');
  assert.equal(s.cart()[1].price, 10100);
  assert.equal(s.cart()[1].price_usd, 640);
  assert.equal(s.cart()[1].isBundle, true);
  s.api.buy(ready, 'https://image.test/bundle.jpg', false);
  assert.equal(s.cart().length, 2);
  assert.equal(s.cart()[1].qty, 2);
  assert.equal(s.cart()[0].qty, 2);
});
test('presales, unavailable bundles, and missing market prices cannot quick buy', () => {
  for (const fields of [{presale:true}, {presale_date:'2026-12-08'}, {presaleDate:'2026-01-01'}, {active:false}, {soldOut:true}, {stock:0}, {comingSoon:true}]) {
    const s = setup();
    assert.equal(s.api.buy({...ready, ...fields}, '', true), false);
    assert.equal(s.cart().length, 0);
    assert.equal(s.context.location.href, '');
  }
  const s = setup();
  assert.equal(s.api.buy({...ready, price_usd: null}, '', true), false);
  assert.equal(s.api.buy({...ready, price_usd: null}, '', false), true);
});
