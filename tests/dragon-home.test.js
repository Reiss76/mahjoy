const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'..');
test('the production server serves every published dragon asset without exposing build scripts',()=>{
 const {publicAsset}=require('../lib/web-security');
 for(const file of fs.readdirSync(path.join(root,'assets/dragon'))) assert(publicAsset('/assets/dragon/'+file),file);
 for(const file of ['/assets/dragon/secret.json','/assets/dragon/../../server.js','/scripts/dragon/bake.mjs']) assert(!publicAsset(file),file);
});
test('both storefronts retain a navigable fallback and load the dragon below categories',()=>{
 for(const file of ['index.html','en/index.html']) {
  const html=fs.readFileSync(path.join(root,file),'utf8');
  assert.ok(html.indexOf('id="mahjoy-dragon"')>html.indexOf('id="shop"'));
  assert.ok(html.indexOf('id="mahjoy-dragon"')<html.indexOf('class="mj-tagline"'));
  assert.match(html,/class="mj-dragon-fallback"[^>]*src="\/images\/home-tiles.jpg"/);
  assert.match(html,/class="mj-dragon-link" href="shop-tiles.html"/);
  assert.match(html,/aria-pressed="false"/);
 }
});
test('production dragon motion is complete and finite with normalized orientations',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(root,'assets/dragon/motion.json')));
 const raw=fs.readFileSync(path.join(root,'assets/dragon/motion.bin'));
 assert.equal(data.count,144);assert.equal(data.fps,90);
 assert.equal(raw.length,(data.steps+1)*data.count*7*2);
 for(let o=0;o<raw.length;o+=14){
  const q=[6,8,10,12].map(k=>raw.readInt16LE(o+k)/32767);
  assert.ok(Math.abs(Math.hypot(...q)-1)<.0001);
 }
 assert.ok(data.impacts.length>0 && data.impacts.every(i=>i.time>=0&&i.time<=data.duration));
});
