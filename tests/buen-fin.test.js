const test=require('node:test'),assert=require('node:assert/strict');
const {START,END,TIERS,active,summary,applyGift}=require('../lib/buen-fin');
const {resolveCheckoutQuote}=require('../lib/checkout-prices');
const {registerPayPalCheckout}=require('../lib/paypal-checkout');
const products=[{id:1,sku:'TILE-TEST',name:'Tiles',price:6000,priceUsd:380},...TIERS.flatMap(t=>t.skus.map((sku,index)=>({id:10+t.minimum+index,sku,name:t.name,price:800,priceUsd:50,image:'https://example.test/product.jpg'})))];
const fetcher=async()=>({ok:true,json:async()=>({products})});
const quote=amount=>({items:[{sku:'TEST',qty:1,unit_price:amount}],_catalog:products});
const payload=(amount=6000,currency='MXN')=>({intent:'CAPTURE',purchase_units:[{items:[{sku:'TILE-TEST',name:'Tiles',quantity:'1',unit_amount:{currency_code:currency,value:amount.toFixed(2)}}],amount:{currency_code:currency,value:amount.toFixed(2),breakdown:{item_total:{currency_code:currency,value:amount.toFixed(2)}}}}]});
test('Mexico City window includes all of November 13-17 and excludes midnight on the 18th',()=>{
 assert.equal(active(START-1),false);assert.equal(active(START),true);assert.equal(active(END-1),true);assert.equal(active(END),false);
 assert.equal(summary(products,quote(20000).items,'USD',START).eligible,null);
 for(const [subtotal,expected] of [[3999.99,null],[4000,4000],[7999.99,4000],[8000,8000],[11999.99,8000],[12000,12000],[100000,12000]])assert.equal(summary(products,quote(subtotal).items,'MXN',START).eligible?.minimum ?? null,expected);
});
test('gift eligibility uses independently verified net merchandise, never browser prices or shipping',async()=>{
 const q=await resolveCheckoutQuote('https://catalog.test',{items:[{sku:'TILE-TEST',qty:1,price:999999}],currency:'MXN'},fetcher);
 assert.equal(q.items[0].unit_price,6000);assert.equal(JSON.stringify(q).includes('_catalog'),false);
 assert.equal(summary(q._catalog,q.items,'MXN',START).eligible.minimum,4000);
 const p=payload();const before=structuredClone(p);const result=applyGift(p,q,undefined,START);
 assert.deepEqual(p,before);assert.equal(result.payload.purchase_units[0].items.length,2);assert.equal(result.payload.purchase_units[0].amount.value,'6000.00');
 assert.equal(result.prices.at(-1).unit_price,0);assert.equal(result.prices.at(-1).sku,'LINE-005');
 assert.equal(result.payload.purchase_units[0].items.at(-1).unit_amount.value,'0.00');
});
test('a higher threshold gives exactly one appropriate available gift; selected colors are validated',()=>{
 const q=quote(12000),p=payload(12000);const result=applyGift(p,q,'BAG-tilelila',START);
 assert.equal(result.prices.length,2);assert.equal(result.prices.at(-1).sku,'BAG-tilelila');
 assert.throws(()=>applyGift(p,q,'LINE-005',START),/BUEN_FIN_GIFT_CHANGED/);
 q._catalog=products.map(p=>/^BAG-tile/i.test(p.sku)?{...p,soldOutEs:true}:p);
 assert.throws(()=>applyGift(p,q,undefined,START),/BUEN_FIN_GIFT_UNAVAILABLE/);
 assert.equal(applyGift(p,q,undefined,END).prices.length,1);
});
test('native checkout signs the zero-price gift and includes it in the physical packing preflight',async()=>{
 const previous=process.env.PROAX_PAYPAL_SYNC_SECRET;process.env.PROAX_PAYPAL_SYNC_SECRET='fixture-only';
 try {
  const routes={};let forwarded,packed;
  registerPayPalCheckout({post:(p,fn)=>routes[p]=fn},'https://catalog.test',async(url,options)=>{
   if(url.includes('/catalog/'))return fetcher();
   forwarded=JSON.parse(options.body);return{status:200,ok:true,json:async()=>({id:'TESTORDER12345'})};
  },undefined,undefined,{now:()=>START,preflight:async body=>{packed=body.items;return{physical_items:body.items.map(p=>({sku:p.sku,qty:p.qty}))};}});
  const response={set(){},status(n){this.statusCode=n;return this;},json(body){this.body=body;}};
  await routes['/api/checkout/paypal/create']({body:{native_shipping:true,payload:payload(),buen_fin_gift_sku:'LINE-003',prices:[{sku:'FORGED',unit_price:0}]}},response);
  assert.equal(response.statusCode,200);assert.equal(packed.length,2);assert.equal(packed.at(-1).sku,'LINE-003');assert.equal(forwarded.physicalItems.length,2);assert.equal(forwarded.prices.at(-1).promotion,'buen-fin-2026');
  assert.equal(forwarded.payload.purchase_units[0].amount.value,'6000.00');
 }finally{if(previous===undefined)delete process.env.PROAX_PAYPAL_SYNC_SECRET;else process.env.PROAX_PAYPAL_SYNC_SECRET=previous;}
});

test('slow coupon validation publishes a gift refresh only after the accepted discount is installed',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),{installShippingFixture}=require('./shipping-client-fixtures');
 const elements={},events=[];let finish;
 const element=id=>elements[id]||(elements[id]={style:{},textContent:'',value:'SLOW'});
 const ctx={console,CustomEvent:class{constructor(type){this.type=type;}},window:{MJCart:{getCart:()=>[{sku:'TEST',price:12000,qty:1}]},addEventListener(){},dispatchEvent:event=>events.push({type:event.type,pct:ctx.window.cartDiscount?.pct})},document:{getElementById:element,addEventListener(){}},fetch:()=>new Promise(resolve=>{finish=resolve;})};
 installShippingFixture(ctx,{currency:'MXN'});vm.createContext(ctx);
 const scripts=[...fs.readFileSync('cart.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 vm.runInContext(scripts.find(s=>s.includes('function initPayPalCart()')),ctx);
 const pending=ctx.window.applyCartDiscount();assert.equal(events.length,0);
 finish({ok:true,json:async()=>({valid:true,discount_pct:25})});await pending;
 assert.equal(ctx.window.cartDiscount.pct,25);assert.deepEqual(events,[{type:'mj:discountChanged',pct:25}]);
 const rejected=ctx.window.applyCartDiscount();finish({ok:false,json:async()=>({valid:false})});await rejected;
 assert.equal(ctx.window.cartDiscount,null);assert.deepEqual(events.at(-1),{type:'mj:discountChanged',pct:undefined});
});
