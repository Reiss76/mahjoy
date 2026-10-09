/* Delivery contact normalization shared by the browser and checkout server. */
(function(root) {
  function reject(code) { const error=new Error(code);error.code=code;throw error; }
  function normalizeMxDeliveryPhone(value) {
    if(value===undefined || value===null || (typeof value==='string' && !value.trim())) reject('NATIVE_SHIPPING_PHONE_REQUIRED');
    if(typeof value!=='string' || value.length>40 || !/^[+0-9() .-]+$/.test(value.trim())) reject('NATIVE_SHIPPING_PHONE_INVALID');
    const digits=value.trim().replace(/[() .-]/g,'');
    if(/^\d{10}$/.test(digits))return '+52'+digits;
    if(/^52\d{10}$/.test(digits))return '+'+digits;
    if(/^\+52\d{10}$/.test(digits))return digits;
    reject('NATIVE_SHIPPING_PHONE_INVALID');
  }
  const api={normalizeMxDeliveryPhone};
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.MJDeliveryPhone=api;
})(typeof window!=='undefined'?window:null);
