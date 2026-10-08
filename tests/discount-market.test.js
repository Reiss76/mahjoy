const {installShippingFixture}=require('./shipping-client-fixtures');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {resolveCheckoutQuote}=require('../lib/checkout-prices');
const {registerPayPalCheckout}=require('../lib/paypal-checkout');
const product={sku:'TEST',name:'Test',price:6000,priceUsd:380};
test('server quotes request the actual checkout currency and independently priced USD discounts',async()=>{
 let requested;
 const fetcher=async url=>url.includes('/discount/')?(requested=new URL(url),{ok:true,json:async()=>({valid:true,discount_code:'USONLY',discount_pct:40,discount_usd_only:true})}):{ok:true,json:async()=>({products:[product]})};
 const body={items:[{sku:'TEST',qty:1}],discount_code:'usonly'};
 const usd=await resolveCheckoutQuote('https://proax.test',{...body,currency:'USD'},fetcher);
 assert.equal(usd.items[0].unit_price,228);assert.equal(usd.items[0].price,6000);assert.equal(usd.discount_code,'USONLY');assert.equal(requested.searchParams.get('currency'),'USD');assert.equal(requested.searchParams.get('market'),'EN');
 await assert.rejects(()=>resolveCheckoutQuote('https://proax.test',{...body,currency:'MXN'},fetcher),{code:'DISCOUNT_USD_ONLY'});
 assert.equal(requested.searchParams.get('currency'),'MXN');assert.equal(requested.searchParams.get('market'),'ES');
});
test('a rejected MXN coupon prevents the proxy from issuing any PayPal creation request',async()=>{
 const handlers={};let posts=0;
 registerPayPalCheckout({post:(path,fn)=>handlers[path]=fn},'https://proax.test',async(url,options)=>{
  if(options.method==='POST')posts++;
  return url.includes('/discount/')?{ok:false,json:async()=>({error_code:'DISCOUNT_USD_ONLY'})}:{ok:true,json:async()=>({products:[product]})};
 });
 const res={set(){},status(n){this.statusCode=n;return this},json(body){this.body=body}};
 await handlers['/api/checkout/paypal/create']({body:{discount_code:'USONLY',discountPct:0,payload:{purchase_units:[{amount:{currency_code:'MXN'},items:[{sku:'TEST',quantity:'1'}]}]}}},res);
 assert.equal(res.statusCode,400);assert.equal(res.body.error_code,'DISCOUNT_USD_ONLY');assert.equal(posts,0);
});
test('real cart code handlers send the market and clear a rejected coupon without stale totals',async()=>{
 for(const english of [false,true]){
  const file=english?'en/cart.html':'cart.html',elements={};let requested,code='LEGACY';
  const element=id=>elements[id]||(elements[id]={style:{},textContent:'',value:'LEGACY'});
  const ctx={console,window:{MJCart:{getCart:()=>[{...product,price_usd:380,qty:1}]},addEventListener(){}},document:{getElementById:element,addEventListener(){}},fetch:async url=>{requested=new URL(url);return code==='LEGACY'?{ok:true,json:async()=>({valid:true,discount_pct:10})}:english?{ok:true,json:async()=>({valid:true,discount_pct:40})}:{ok:false,json:async()=>({error_code:'DISCOUNT_USD_ONLY'})};}};
  installShippingFixture(ctx,{currency:english?'USD':'MXN'});vm.createContext(ctx);const scripts=[...fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);vm.runInContext(scripts.find(s=>s.includes('function initPayPalCart()')),ctx);
  await ctx.window.applyCartDiscount();assert.equal(ctx.window.cartDiscount.pct,10);assert.equal(element('cart-discount-row').style.display,'flex');
  code='USONLY';element('cart-discount-code').value=code;await ctx.window.applyCartDiscount();
  assert.equal(requested.searchParams.get('market'),english?'EN':'ES');assert.equal(requested.searchParams.get('currency'),english?'USD':'MXN');
  if(english){assert.equal(ctx.window.cartDiscount.pct,40);assert.equal(element('cart-total').textContent,'$253.00');}
  else{assert.equal(ctx.window.cartDiscount,null);assert.equal(element('cart-discount-row').style.display,'none');assert.equal(element('cart-total').textContent,'$6250.00');assert.match(element('cart-discount-msg').textContent,/EN.*USD/);}
 }
});
test('PayPal errors explain the USD-only restriction in the current storefront language',async()=>{
 for(const english of [false,true]){
  const ctx={document:{addEventListener(){}},window:{location:{pathname:english?'/en/cart.html':'/cart.html'}},fetch:async()=>({ok:false,json:async()=>({error:'DISCOUNT_USD_ONLY',error_code:'DISCOUNT_USD_ONLY'})})};
  installShippingFixture(ctx);vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/paypal-pricing.js','utf8'),ctx);
  await assert.rejects(()=>ctx.window.MJPayPalPricing.capture('TESTORDER123456'),english?/only valid.*EN.*USD/:/solo funciona.*EN.*USD/);
 }
});
