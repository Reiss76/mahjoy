const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
for(const file of ['cart.html','en/cart.html'])test(`${file}: old card handlers only focus PayPal and cannot start a payment`,async()=>{
 let requests=0,focus=0,clears=0;const ctx={window:{location:{pathname:'/'+file},MJCart:{getCart:()=>[],clearCart(){clears++;}},addEventListener(){}},
  document:{getElementById:()=>({scrollIntoView(){focus++;},style:{},addEventListener(){}}),addEventListener(){}},fetch(){requests++;}};
 vm.createContext(ctx);const scripts=[...fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
 vm.runInContext(scripts.find(s=>s.includes('function renderCart()')),ctx);
 await ctx.proceedToCheckout({preventDefault(){}});assert.equal(requests,0);assert.equal(clears,0);assert.equal(focus,1);
});
test('all active storefront checkout entrypoints contain no Centum checkout request or card checkout button',()=>{
 for(const file of ['cart.html','en/cart.html','checkout.html','en/checkout.html','js/checkout.js']) {
  const source=fs.readFileSync(file,'utf8');assert.doesNotMatch(source,/\/api\/(?:payments\/)?centumpay\/checkout|MJ_CENTUMPAY_ENDPOINT/);
  assert.doesNotMatch(source,/id="mj-card-(?:open|open-product|form)"/);
 }
});
