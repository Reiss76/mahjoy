/* Apple Wallet appears only after the server verifies ownership of this receipt. */
(function(){
 'use strict';
 const english=location.pathname.startsWith('/en/');
 async function attach(parent,orderId){
  if(!parent||! /^[A-Z0-9]{10,30}$/.test(orderId)||parent.querySelector('[data-mahjoy-wallet]'))return;
  let response;try{response=await fetch('/api/wallet/status/'+encodeURIComponent(orderId),{credentials:'same-origin',cache:'no-store'});if(!response.ok||!(await response.json()).available)return;}catch{return;}
  const box=document.createElement('section');box.dataset.mahjoyWallet='';box.style.cssText='margin:24px auto;text-align:center;max-width:360px';
  const button=document.createElement('apple-wallet-button');button.setAttribute('buttonstyle','black');button.setAttribute('compact','false');button.setAttribute('locale',english?'en-US':'es-MX');
  button.style.cssText='--apple-wallet-button-width:240px;--apple-wallet-button-height:48px;display:inline-block';
  const note=document.createElement('p');note.style.cssText='font-size:13px;line-height:1.6;margin-top:12px;color:#666';note.textContent=english?'Add your order to Wallet to receive shipping updates on your iPhone.':'Añade tu pedido a Wallet para recibir actualizaciones del envío en tu iPhone.';
  const error=document.createElement('p');error.setAttribute('role','status');error.style.cssText='font-size:13px;line-height:1.6;margin-top:12px';
  button.addEventListener('click',async()=>{
   if(button.dataset.busy)return;button.dataset.busy='true';error.textContent='';
   try{
    const result=await fetch('/api/wallet/package/'+encodeURIComponent(orderId),{credentials:'same-origin',cache:'no-store'});
    if(!result.ok)throw Error();
    const blob=await result.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Mahjoy.order';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
   }catch{error.textContent=english?'Your payment is confirmed. Wallet is not ready yet; please try again shortly.':'Tu pago está confirmado. Wallet aún no está listo; vuelve a intentarlo en unos momentos.';}finally{delete button.dataset.busy;}
  });
  box.append(button,note,error);parent.appendChild(box);
  if(!document.querySelector('[data-apple-wallet-sdk]')){const script=document.createElement('script');script.dataset.appleWalletSdk='';script.src='https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js';script.async=true;script.crossOrigin='anonymous';document.head.appendChild(script);}
 }
 window.MJWallet={attach};
 const ready=()=>{const id=new URLSearchParams(location.search).get('order');if(id)void attach(document.querySelector('.container'),id);};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();
