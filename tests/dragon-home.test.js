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
test('original desktop and mobile motions are complete with normalized orientations',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(root,'assets/dragon/motion.json')));
 const raw=fs.readFileSync(path.join(root,'assets/dragon/motion.bin'));
 assert.equal(data.profiles.desktop.count,12);assert.equal(data.profiles.mobile.count,9);
 let expected=0;
 for(const profile of Object.values(data.profiles)){
  assert.equal(profile.offset,expected);
  expected+=(profile.steps+1)*profile.count*7;
  assert.ok(profile.impacts.length>0 && profile.impacts.every(i=>i.time>=0&&i.time<=profile.duration));
 }
 assert.equal(raw.length,expected*2);
 for(let o=0;o<raw.length;o+=14){
  const q=[6,8,10,12].map(k=>raw.readInt16LE(o+k)/32767);
  assert.ok(Math.abs(Math.hypot(...q)-1)<.0001);
 }
});
