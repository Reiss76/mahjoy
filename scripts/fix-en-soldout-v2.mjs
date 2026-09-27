import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const enDir = '/Users/adrianroman/Proax/mahjoy/en';

// The BROKEN pattern (has soldOutBadge but doesn't use it)
const brokenPattern = /prods\.forEach\(p=>\{\s*const isSoldOut=p\.stock===0\|\|p\.soldOut===true;[\s\S]*?const card=document\.createElement\('a'\);card\.href='product\.html#'\+p\.id;card\.className='mj-prod-card';[\s\S]*?grid\.appendChild\(card\);\s*\}\);/;

// The CORRECT replacement
const correctBlock = `prods.forEach(p=>{
        const isSoldOut=p.stock===0||p.soldOut===true;
        const soldOutBadge=isSoldOut?'<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-15deg);width:120px;height:120px;border-radius:50%;background:rgba(107,15,42,0.85);color:white;display:flex;align-items:center;justify-content:center;font-family:Playfair Display,Georgia,serif;font-weight:700;font-style:italic;font-size:22px;text-align:center;line-height:1.2;box-shadow:0 4px 20px rgba(107,15,42,0.3);z-index:10;">SOLD<br>OUT!</div>':'';
        const imgStyle=isSoldOut?'opacity:0.7;':'';
        const img=imgUrl(p);
        const price=p.price_usd?'$'+Number(p.price_usd).toFixed(2)+' USD':'Contact for price';
        const card=document.createElement('a');card.href=isSoldOut?'#':'product.html#'+p.id;card.className='mj-prod-card'+(isSoldOut?' mj-sold-out':'');
        card.innerHTML='<div style="position:relative;">'+soldOutBadge+(img?'<img src="'+img+'" alt="'+p.name+'" class="mj-prod-card-img" style="'+imgStyle+'" onerror="this.style.display=\\'none\\'">':'<div class="mj-prod-card-img" style="height:200px;display:flex;align-items:center;justify-content:center;'+imgStyle+'"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C76BA4" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg></div>')+'</div><div class="mj-prod-card-body"><div class="mj-prod-card-name" title="'+p.name+'">'+p.name+'</div><div class="mj-prod-card-price">'+price+'</div>'+(isSoldOut?'':'<span style="display:inline-block;margin-top:10px;background:var(--burgundy);color:#fff;font-family:Plus Jakarta Sans,sans-serif;font-size:.7rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:8px 18px;border-radius:999px;">View Product</span>')+'</div>';
        grid.appendChild(card);
      });`;

// Get all EN shop files
const enFiles = readdirSync(enDir).filter(f => f.startsWith('shop-') && f.endsWith('.html') && f !== 'shop-bundles.html');

let updated = 0;
for (const file of enFiles) {
  const filePath = join(enDir, file);
  let content = readFileSync(filePath, 'utf-8');
  
  // Check if file has the broken pattern (has isSoldOut but doesn't properly use it)
  if (content.includes('const isSoldOut=p.stock===0||p.soldOut===true;') && 
      content.includes("card.href='product.html#'+p.id;card.className='mj-prod-card';")) {
    
    // Replace the broken forEach block
    if (brokenPattern.test(content)) {
      const newContent = content.replace(brokenPattern, correctBlock);
      if (newContent !== content) {
        writeFileSync(filePath, newContent);
        console.log('✅ Fixed:', file);
        updated++;
      }
    } else {
      console.log('⚠️  Pattern mismatch:', file);
    }
  } else if (content.includes("card.href=isSoldOut?'#':'product.html#'+p.id")) {
    console.log('✓ Already OK:', file);
  } else {
    console.log('❓ Unknown state:', file);
  }
}

console.log('\\nTotal fixed:', updated);
