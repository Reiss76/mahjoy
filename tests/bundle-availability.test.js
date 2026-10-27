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
