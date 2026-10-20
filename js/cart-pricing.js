/** Verified cart display prices; payment still requires its own strict quote. */
(function () {
  const currency=window.location.pathname.startsWith('/en/')?'USD':'MXN',english=currency==='USD';
  let phase='loading',verifiedKey='',sequence=0;
  const listeners=new Set();
  const cart=()=>{const value=window.MJCart.getCart();return Array.isArray(value)?value:[];};
  const key=items=>JSON.stringify(items.map(item=>[String(item.sku||item.id||item.name||'').trim().toLowerCase(),Number(item.qty)]));
  const amount=value=>value!=null&&Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
  function current(){return phase==='ready'&&verifiedKey===key(cart());}
  function unitPrice(item, discountPct=0){
    if(!current())return null;
    const base=amount(currency==='USD'?(item.price_usd??item.priceUsd):item.price);
    if(base==null)return null;
    const rate=Math.max(Number(discountPct)||0,Number(item.upsell_discount_pct)||0);
    return Math.round(base*(1-rate/100)*100)/100;
  }
  function summary(discountPct=0){
    const items=cart(),ready=current();
    const complete=ready&&items.every(item=>unitPrice(item,discountPct)!=null);
    const unavailable=ready?items.filter(item=>item.cart_status!=='available'):[];
    const subtotal=complete?items.reduce((sum,item)=>sum+Math.round(unitPrice(item,discountPct)*100)*Number(item.qty),0)/100:null;
    let message='';
    if(!ready)message=phase==='error'?(english?'Could not update prices. Please retry.':'No se pudieron actualizar los precios. Intenta de nuevo.'):(english?'Updating prices…':'Actualizando precios…');
    else if(unavailable.length) {
      const names=unavailable.map(item=>item.name||item.sku).join(', ');
      message=unavailable.some(item=>item.cart_status==='sold_out')
        ?(english?names+' is currently unavailable. Remove unavailable items to continue.':names+' no está disponible por ahora. Retira los productos no disponibles para continuar.')
        :(english?'A product has no available price. Please review your cart.':'Un producto no tiene precio disponible. Revisa tu carrito.');
    }
    return {phase:ready?'ready':phase,subtotal,message,canPay:complete&&!unavailable.length&&items.length>0,retry:phase==='error'};
  }
  function notify(){
    for(const listener of listeners){try{listener(summary());}catch(error){console.error('[Cart prices]',error.message);}}
    window.dispatchEvent(new CustomEvent('mj:cartPrices'));
  }
  async function refresh(){
    const version=++sequence,snapshot=JSON.parse(JSON.stringify(cart())),requestedKey=key(snapshot);
    if(!snapshot.length){phase='ready';verifiedKey=requestedKey;notify();return [];}
    phase='loading';notify();
    try {
      const response=await fetch('/api/cart/prices',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},
        ...(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?{signal:AbortSignal.timeout(15000)}:{}),
        body:JSON.stringify({currency,items:snapshot})});
      const result=await response.json();
      if(version!==sequence)return cart();
      if(key(cart())!==requestedKey)return refresh();
      if(!response.ok||!Array.isArray(result.items)||result.items.length!==snapshot.length)throw new Error('Invalid prices');
      const updated=result.items.map((p,index)=>{
        if(!p||Number(p.qty)!==Number(snapshot[index].qty)||!['available','sold_out','unavailable','price_unavailable'].includes(p.cart_status)
          ||(snapshot[index].sku&&String(snapshot[index].sku).trim().toLowerCase()!==String(p.sku).toLowerCase()))throw new Error('Invalid prices');
        return {...snapshot[index],id:snapshot[index].id??p.id,sku:p.sku,name:p.name,price:amount(p.price),price_usd:amount(p.price_usd),
          image:p.image||snapshot[index].image,cart_status:p.cart_status,upsell_discount_pct:Number(p.upsell_discount_pct)||0};
      });
      phase='ready';verifiedKey=key(updated);window.MJCart.saveCart(updated);notify();return updated;
    } catch(error) {
      if(version===sequence){phase='error';notify();}
      return cart();
    }
  }
  window.MJCartPricing={refresh,summary,unitPrice,subscribe(listener){listeners.add(listener);listener(summary());return()=>listeners.delete(listener);},
    requireReady(){const status=summary();if(!status.canPay)throw new Error(status.message||(english?'Review your cart prices before paying.':'Revisa los precios del carrito antes de pagar.'));}};
  const cartChanged=()=>{if(verifiedKey!==key(cart()))refresh();};
  window.addEventListener('mj:cartUpdated',cartChanged);
  window.addEventListener('cartUpdated',cartChanged);
  window.addEventListener('storage',event=>{if(event.key===null||event.key==='mj_cart')cartChanged();});
  document.addEventListener('DOMContentLoaded',()=>refresh());
})();
