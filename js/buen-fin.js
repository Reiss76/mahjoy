/* MAH JOY · Buen Fin. Server time and checkout rules are authoritative. */
(function () {
  'use strict';
  if (window.location.pathname.startsWith('/en/')) return;
  const START = Date.parse('2026-11-13T06:00:00Z');
  const END = Date.parse('2026-11-18T06:00:00Z');
  const KEY = 'mj_buen_fin_2026_seen';
  let data = null, anchor = Date.now(), tick = performance.now(), modal = null, priorFocus = null;
  let loaded = false, wasActive = false, quoteSequence = 0, panelTimer, modalTimer, boundaryTimer;
  const baseline = [];
  const money = value => new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN', maximumFractionDigits:0 }).format(value);
  const clock = () => anchor + performance.now() - tick;
  const active = () => clock() >= START && clock() < END;
  const storage = (key,value) => { try { if(value === undefined) return sessionStorage.getItem(key); sessionStorage.setItem(key,value); } catch (_) {} };
  function node(tag,className,text) {
    const element=document.createElement(tag);
    if(className) element.className=className;
    if(text !== undefined) element.textContent=text;
    return element;
  }
  function emit() { window.dispatchEvent(new CustomEvent('mj:buen-fin', {detail:{active:active()}})); }
  function close() {
    if(!modal) return;
    modal.remove(); modal=null;
    document.body.classList.remove('mj-bf-modal-open');
    if(priorFocus && priorFocus.isConnected) priorFocus.focus();
  }
  function heading(parent,tag,className,text) { const element=node(tag,className,text);parent.appendChild(element);return element; }
  function open() {
    if(!active() || !data || modal) return;
    priorFocus=document.activeElement;
    modal=node('div','mj-bf-overlay');
    const dialog=node('section','mj-bf-dialog');
    dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','mj-bf-title');
    const dismiss=node('button','mj-bf-close','×');dismiss.type='button';dismiss.setAttribute('aria-label','Cerrar promoción');dismiss.addEventListener('click',close);
    dialog.appendChild(dismiss);
    heading(dialog,'p','mj-bf-eyebrow','MAH JOY · MÉXICO');
    const title=heading(dialog,'h2','mj-bf-title','Buen Fin');title.id='mj-bf-title';
    heading(dialog,'p','mj-bf-intro','Más juego. Un regalo para ti.');
    heading(dialog,'p','mj-bf-dates','Del 13 al 17 de noviembre de 2026');
    const tiers=node('ol','mj-bf-tiers');
    for(const tier of data.tiers || []) {
      const card=node('li','mj-bf-tier');
      const picture=tier.options[0];
      if(picture?.image) {const img=node('img');img.src=picture.image;img.alt=tier.name;img.width=160;img.height=140;card.appendChild(img);}
      heading(card,'p','mj-bf-threshold','Compra '+money(tier.minimum)+' MXN');
      heading(card,'h3','mj-bf-gift',tier.name);
      heading(card,'p','mj-bf-free','DE REGALO');tiers.appendChild(card);
    }
    dialog.appendChild(tiers);
    heading(dialog,'p','mj-bf-terms','Recibe el regalo del nivel más alto que alcance tu compra. Sobre productos después de descuentos, sin incluir envío. Un regalo por pedido; colores sujetos a disponibilidad.');
    const shop=node('a','mj-bf-shop','Elegir mis productos');shop.href='/shop-tiles.html';dialog.appendChild(shop);
    const more=node('button','mj-bf-later','Seguir viendo');more.type='button';more.addEventListener('click',close);dialog.appendChild(more);
    heading(dialog,'p','mj-bf-cutoff','Válido al completar el pago antes de las 00:00 del 18 de noviembre, hora de Ciudad de México.');
    modal.appendChild(dialog);
    modal.addEventListener('click',event=>{if(event.target===modal)close();});
    modal.addEventListener('keydown',event=>{
      if(event.key==='Escape') {event.preventDefault();close();}
      if(event.key==='Tab') {
        const controls=dialog.querySelectorAll('a[href],button:not([disabled]),select');
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey && document.activeElement===first) {event.preventDefault();last.focus();}
        else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
      }
    });
    document.body.appendChild(modal);document.body.classList.add('mj-bf-modal-open');dismiss.focus();storage(KEY,'1');
  }
  function setState() {
    if(!document.body) return;
    const enabled=active();
    document.body.classList.toggle('mj-buen-fin-active',enabled);
    let launcher=document.getElementById('mj-bf-launcher');
    if(enabled && !launcher) {
      launcher=node('button','mj-bf-launcher','Buen Fin · Regalos por tu compra');launcher.id='mj-bf-launcher';launcher.type='button';launcher.addEventListener('click',open);document.body.appendChild(launcher);
    } else if(!enabled) {
      launcher?.remove();close();document.getElementById('mj-bf-cart')?.remove();
      clearTimeout(modalTimer);baseline.splice(0).forEach(run=>run());
    }
    if(enabled !== wasActive) {wasActive=enabled;emit();}
    if(enabled && data) {
      if(!storage(KEY) && !modalTimer && !document.getElementById('mj-shipping-checkout')) modalTimer=setTimeout(open,1500);
    }
  }
  async function status() {
    try {
      const response=await fetch('/api/promotions/buen-fin',{cache:'no-store'}),result=await response.json();
      if(Number.isFinite(result.server_time)) {anchor=result.server_time;tick=performance.now();}
      if(!response.ok) throw Error('Unavailable');
      data=result;
    } catch (_) { /* Payment remains server-validated; retry at the next clock tick. */ }
    loaded=true;setState();schedulePanel();
    clearTimeout(boundaryTimer);
    const boundary=clock()<START?START:clock()<END?END:null;
    if(boundary)boundaryTimer=setTimeout(()=>{setState();status();},Math.max(1,boundary-clock()));
  }
  const ready=status();
  function whenNormal(run) {
    ready.then(()=>{if(active())baseline.push(run);else run();});
  }
  function currentItems() {
    if(document.getElementById('cart-items')) return window.MJCart?.getCart?.() || [];
    const product=window.MJCheckoutProduct;
    if(product) return [{...product,qty:Number(document.getElementById('co-qty')?.value || 1)}];
    return [];
  }
  function schedulePanel() {clearTimeout(panelTimer);panelTimer=setTimeout(updatePanel,150);}
  async function updatePanel() {
    if(!active() || !loaded) return;
    const host=document.getElementById('cart-summary') || document.getElementById('mj-buen-fin-checkout');
    if(!host) return;
    let panel=document.getElementById('mj-bf-cart');
    if(!panel) {panel=node('section','mj-bf-cart');panel.id='mj-bf-cart';panel.setAttribute('aria-label','Tu regalo de Buen Fin');host.prepend(panel);}
    const items=currentItems();
    if(!items.length) {panel.hidden=true;return;}
    panel.hidden=false;
    const sequence=++quoteSequence;
    try {
      const discount=window.MJAppliedDiscount || window.cartDiscount;
      const response=await fetch('/api/checkout/prices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,currency:'MXN',discount_code:discount?.code || null})});
      const result=await response.json();
      if(sequence!==quoteSequence || !active()) return;
      if(!response.ok)throw Error('Unavailable');
      const promotion=result.buen_fin;
      if(!promotion?.active) {panel.remove();return;}
      panel.replaceChildren();
      heading(panel,'p','mj-bf-eyebrow','BUEN FIN · 13–17 NOV');
      const tier=promotion.eligible;
      if(!tier) {
        heading(panel,'h2','mj-bf-panel-title','Tu próxima partida viene con regalo');
        heading(panel,'p','mj-bf-panel-copy','Te faltan '+money(Math.max(0,4000-promotion.subtotal))+' MXN para recibir un Line Finder.');
        storage('mj_buen_fin_2026_gift','');
      } else {
        heading(panel,'h2','mj-bf-panel-title',tier.name+' de regalo');
        heading(panel,'p','mj-bf-panel-copy','Se añadirá automáticamente a tu pedido por $0.00 MXN.');
        if(tier.options.length) {
          const saved=storage('mj_buen_fin_2026_gift');
          const chosen=tier.options.find(option=>option.sku===saved) || tier.options[0];
          storage('mj_buen_fin_2026_gift',chosen.sku);
          const row=node('div','mj-bf-selection');
          const img=node('img');img.src=chosen.image;img.alt=chosen.name;img.width=72;img.height=72;row.appendChild(img);
          const label=node('label','mj-bf-label','Elige tu regalo');
          const select=node('select');select.setAttribute('aria-label','Color del regalo Buen Fin');
          tier.options.forEach(option=>{const choice=node('option',null,option.name);choice.value=option.sku;select.appendChild(choice);});select.value=chosen.sku;
          select.addEventListener('change',()=>{storage('mj_buen_fin_2026_gift',select.value);const option=tier.options.find(o=>o.sku===select.value);img.src=option.image;img.alt=option.name;});
          label.appendChild(select);row.appendChild(label);panel.appendChild(row);
        } else heading(panel,'p','mj-bf-panel-copy','El regalo de este nivel está agotado. Revisa disponibilidad antes de pagar.');
        const next=promotion.tiers.find(value=>value.minimum>promotion.subtotal);
        if(next)heading(panel,'p','mj-bf-next','Con '+money(next.minimum-promotion.subtotal)+' MXN más, tu regalo cambia a '+next.name+'.');
      }
      heading(panel,'p','mj-bf-panel-terms','Un regalo por pedido, según el nivel más alto. No incluye envío. Pago completado antes del 18 de noviembre (hora CDMX).');
    } catch (_) {
      if(sequence!==quoteSequence || !active())return;
      panel.replaceChildren();heading(panel,'p','mj-bf-panel-copy','No pudimos verificar tu regalo.');
      const retry=node('button','mj-bf-retry','Reintentar');retry.type='button';retry.addEventListener('click',updatePanel);panel.appendChild(retry);
    }
  }
  window.MJBuenFin={active,ready,whenNormal,open,selectedGift:()=>active()?storage('mj_buen_fin_2026_gift') || undefined:undefined};
  document.addEventListener('DOMContentLoaded',()=>{ready.then(setState);schedulePanel();window.MJShippingCheckout?.subscribe(schedulePanel);});
  for(const event of ['mj:cartUpdated','mj:cartPrices','mj:discountChanged'])window.addEventListener(event,schedulePanel);
  document.addEventListener('change',event=>{if(event.target.id==='co-qty')schedulePanel();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)status();});
  setInterval(()=>{const changed=wasActive!==active();setState();if(changed || (active() && !data))status();},15000);
})();
