const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/product.js','utf8');
const start=source.indexOf('  const descMap = window.MJ_DESCRIPTIONS || {};');
const end=source.indexOf('  if (descText || specsArr.length)',start);
assert.ok(start>=0 && end>start,'Locate the actual shared product rendering description/specification path');
function rendered(product,english=false) {
  const context={window:{},product};vm.createContext(context);
  vm.runInContext(fs.readFileSync(english?'js/product-descriptions-en.js':'js/product-descriptions.js','utf8'),context);
  vm.runInContext(source.slice(start,end)+'\nwindow.rendered={description:descText,specs:specsArr};',context);
  return {result:JSON.parse(JSON.stringify(context.window.rendered)),bag:JSON.parse(JSON.stringify(context.window.MJ_SPECS.RAKBAG)),
    racks:JSON.parse(JSON.stringify(context.window.MJ_SPECS.RACK)),white:context.window.MJ_DESCRIPTIONS['rack blanco']?JSON.parse(JSON.stringify(context.window.MJ_DESCRIPTIONS['rack blanco'])):null};
}
for(const english of [false,true]) {
  const market=english?'English':'Spanish';
  test(`${market} Vino uses the same bag descriptions/specs as other Rack Bags, without claiming racks are included`,()=>{
    const vino=rendered({sku:'RACK-BAG006',name:'Rack Bag Vino'},english);
    assert.deepEqual(vino.result,{description:vino.bag.description,specs:vino.bag.specs});
    assert.doesNotMatch(vino.result.specs.join(' '),/4 Racks|4 Pushers/i);
    for(let index=1;index<=5;index++) {
      for(const sku of ['RAKBAG-'+String(index).padStart(3,'0'),'RAKBAG'+String(index).padStart(3,'0')]) {
        assert.deepEqual(rendered({sku,name:'Rack Bag color '+index},english).result,vino.result);
      }
    }
  });
  test(`${market} Rack Bag names and normalized SKU select the existing bag category before the RACK prefix`,()=>{
    for(const product of [{sku:' rack-bag006 ',name:'Vino'},{sku:'RACK-VINO',name:'RackBagVino'},
      {sku:'UNKNOWN',name:'  Rack Bag Vino  '}]) {
      const view=rendered(product,english);assert.deepEqual(view.result,{description:view.bag.description,specs:view.bag.specs});
    }
  });
  test(`${market} real rack products keep their original rack specifications and named overrides`,()=>{
    for(const sku of ['RACK-VERDE','RACK-NEGRO']) {
      const view=rendered({sku,name:'Rack color'},english);assert.deepEqual(view.result,{description:view.racks.description,specs:view.racks.specs});
    }
    const white=rendered({sku:'RACK-BLANCO',name:'Rack Blanco'},english);
    if(white.white)assert.deepEqual(white.result,{description:white.white.description,specs:white.white.specs});
    else assert.deepEqual(white.result,{description:white.racks.description,specs:white.racks.specs});
  });
}
