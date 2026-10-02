const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('cart update listeners refresh summary within their own scope in both markets',()=>{
  for(const file of ['cart.html','en/cart.html']) {
    const listeners=[];const node={style:{},textContent:'',innerHTML:''};
    const ctx={window:{MJCart:{getCart:()=>[]},MJPayPalPhone:{},addEventListener:(_,fn)=>listeners.push(fn)},document:{getElementById:()=>node,addEventListener(){}},console};
    vm.createContext(ctx);const scripts=[...fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
    for(const code of scripts.filter(s=>s.includes('function renderCart()')||s.includes('function initPayPalCart()')))vm.runInContext(code,ctx);
    assert.equal(listeners.length,2);assert.doesNotThrow(()=>listeners.forEach(fn=>fn()));
  }
});
test('PayPal entry points have no storefront phone field or phone gate',()=>{
  for(const file of ['cart.html','en/cart.html','checkout.html','en/checkout.html']) {
    const html=fs.readFileSync(file,'utf8');assert(!html.includes('paypal-phone.js'));assert(!html.includes('MJPayPalPhone'));
    assert(!/<input[^>]*type="tel"[^>]*name="(?:phone|ship_phone)"/.test(html));
  }
  const pricing=fs.readFileSync('js/paypal-pricing.js','utf8');assert(!pricing.includes('/api/checkout/contact'));assert(!pricing.includes('requirePhone'));
});
