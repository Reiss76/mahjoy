const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('js/bundle-availability.js','utf8'),context);
test('bundle dates display as estimates in both languages without time-zone drift',()=>{
 assert.match(context.MJBundleAvailability({presale:true,presaleDate:'2026-12-10'},false),/Preventa.*10.*2026/);
 assert.match(context.MJBundleAvailability({presale_date:'2026-12-10'},true),/Pre-order.*Dec 10, 2026/);
 for(const value of [null,'wrong','2026-02-30'])assert.equal(context.MJBundleAvailability({presale_date:value},true),'');
});
test('bundle pages use the canonical independent-price catalog and display preorder metadata',()=>{
 for(const f of ['shop-bundles.html','en/shop-bundles.html','bundle-detail.html','en/bundle-detail.html']){
  const source=fs.readFileSync(f,'utf8');assert.match(source,/\/public\/mahjoy\/bundles/);assert.match(source,/MJBundleAvailability\(/);
  assert.doesNotMatch(source,/\/public\/shop\/mahjoy\/bundles/);
 }
});

test('new USD quotes and cart display use the saved bundle price, independently of MXN and component prices',async()=>{
 const {resolveCheckoutQuote,resolveCartDisplayPrices}=require('../lib/checkout-prices');
 const fetcher=async url=>({ok:true,json:async()=>url.includes('/bundles')?[{id:7,name:'Fixture bundle',price:14700,price_usd:810.50,presale:true,presaleDate:'2026-12-10',items:[{product_price_usd:9999}]}]:{products:[]}});
 const input={currency:'USD',items:[{id:'bundle-7',sku:'BUNDLE-7',qty:2,price_usd:1}]};
 const quote=await resolveCheckoutQuote('https://catalog.test',input,fetcher);
 assert.equal(quote.items[0].unit_price,810.50);
 const display=await resolveCartDisplayPrices('https://catalog.test',input,fetcher);
 assert.equal(display.items[0].price_usd,810.50);
 const mxn=await resolveCheckoutQuote('https://catalog.test',{...input,currency:'MXN'},fetcher);
 assert.equal(mxn.items[0].unit_price,14700);
});
