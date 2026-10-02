const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {normalizePhone,registerCheckoutContact}=require('../lib/checkout-contact');
test('phone validation rejects blanks, letters, placeholders and invalid lengths; keeps international numbers',()=>{
  for(const p of ['', 'hello', '0000000000', '+00000000000', '123', '1111111111', '+1234567890123456']) assert.throws(()=>normalizePhone(p,'USD'));
  assert.equal(normalizePhone('(555) 123-4567','USD'),'+15551234567');
  assert.equal(normalizePhone('55 1234 5678','MXN'),'+525512345678');
  assert.equal(normalizePhone('+44 20 7946 0123','USD'),'+442079460123');
});
test('contact API stores only a normalized phone under an opaque reference and fails closed on DB errors',async()=>{
  let handler;const queries=[];
  registerCheckoutContact({post:(path,fn)=>{assert.equal(path,'/api/checkout/contact');handler=fn;}}, {query:async(...args)=>{queries.push(args);}});
  const res={set(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};
  await handler({body:{phone:'',currency:'MXN'}},res);assert.equal(res.statusCode,400);assert.equal(queries.length,0);
  await handler({body:{phone:'55 1234 5678',currency:'MXN'}},res);
  assert.match(res.body.contact_id,/^[a-f0-9-]{36}$/);assert.equal(queries[1][1][1],'+525512345678');assert.equal(res.body.phone,undefined);
  registerCheckoutContact({post:(_,fn)=>handler=fn},{query:async()=>{throw new Error('private database detail');}});
  await handler({body:{phone:'+15551234567',currency:'USD'}},res);assert.equal(res.statusCode,503);assert(!JSON.stringify(res.body).includes('private database'));
});
test('all PayPal entry points require a phone before any network request or SDK order creation',async()=>{
  for(const file of ['cart.html','en/cart.html','checkout.html','en/checkout.html']) assert(fs.readFileSync(file,'utf8').includes('js/paypal-phone.js'));
  const ctx={window:{MJPayPalPhone:{requirePhone(){throw new Error('Phone required');}}},fetch(){throw new Error('Network must not run');}};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),ctx);
  await assert.rejects(()=>ctx.window.MJPayPalPricing.create({order:{create(){throw new Error('SDK must not run');}}},{}),/Phone required/);
});
test('phone validation rejects the PayPal click before opening a popup',()=>{
  const input={value:'',setCustomValidity(){},focus(){},reportValidity(){},addEventListener(){}};
  const error={textContent:''},field={style:{},querySelector:()=>input};
  const document={readyState:'complete',getElementById:id=>id==='paypal-phone-error'?error:{before(){}},createElement:()=>field,querySelectorAll:()=>[]};
  const ctx={window:{},location:{pathname:'/cart.html'},document};vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/paypal-phone.js','utf8'),ctx);
  let resolved=0,rejected=0;const actions={resolve:()=>resolved++,reject:()=>rejected++};
  ctx.window.MJPayPalPhone.onClick({},actions);assert.equal(rejected,1);assert.equal(resolved,0);assert.match(error.textContent,/teléfono válido/);
  input.value='+525512345678';ctx.window.MJPayPalPhone.onClick({},actions);assert.equal(resolved,1);
});
test('cart update listeners refresh summary within their own scope in both markets',()=>{
  for(const file of ['cart.html','en/cart.html']) {
    const listeners=[];const node={style:{},textContent:'',innerHTML:''};
    const ctx={window:{MJCart:{getCart:()=>[]},MJPayPalPhone:{},addEventListener:(_,fn)=>listeners.push(fn)},document:{getElementById:()=>node,addEventListener(){}},console};
    vm.createContext(ctx);const scripts=[...fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
    for(const code of scripts.filter(s=>s.includes('function renderCart()')||s.includes('function initPayPalCart()')))vm.runInContext(code,ctx);
    assert.equal(listeners.length,2);assert.doesNotThrow(()=>listeners.forEach(fn=>fn()));
  }
});
