const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
for(const lang of ['', 'en/']) {
 test(lang+'bundle collections filter explicit metadata, preserve prices, and retain all view',async()=>{
  const source=fs.readFileSync(path.join(root,lang,'shop-bundles.html'),'utf8');
  const script=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(s=>s.includes("var MJ_API="));
  for(const type of ['essentials','ultimate','','unknown']) {
   const cards=[],heading={};const grid={innerHTML:'',appendChild:c=>cards.push(c)};
   const nodes={};
   const context={URLSearchParams,location:{search:'?type='+type},Intl,console,Promise,document:{addEventListener:()=>{},title:'',getElementById:id=>id==='bundle-heading'?heading:grid,querySelectorAll:()=>[],createElement:()=>({})},MJBundleAvailability:()=>'',fetch:async()=>({ok:true,json:async()=>[
    {id:1,name:'Ultimate name but Essentials metadata',bundle_type:'essentials',price:100,price_usd:10},
    {id:2,name:'Other',bundle_type:'ultimate',price:200,price_usd:20},
    {id:3,name:'Legacy unclassified',price:300,price_usd:30}
   ]})};
   vm.runInNewContext(script,context);await new Promise(r=>setImmediate(r));
   assert.equal(cards.length,type==='essentials'||type==='ultimate'?1:3);
   if(type==='essentials')assert.match(cards[0].innerHTML,/Ultimate name but Essentials metadata/);
   assert.match(source,/data-bundle-type="essentials"/);assert.match(source,/data-bundle-type="ultimate"/);
  }
 });
}
test('every common Shop menu exposes both nested collections',()=>{
 for(const dir of [root,path.join(root,'en')])for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.html'))){
  const source=fs.readFileSync(path.join(dir,file),'utf8');
  if(/href="shop-bundles.html" class="w-dropdown-link mj-shop-link"/.test(source)){
   assert.match(source,/href="shop-bundles.html\?type=essentials"/,file);
   assert.match(source,/href="shop-bundles.html\?type=ultimate"/,file);
  }
 }
});
