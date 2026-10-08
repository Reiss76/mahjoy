function shippingError(code) {
  const error=new Error(code);error.code=code;return error;
}
function cents(value) {
  const amount=Number(value);
  if(!Number.isFinite(amount) || amount<0)throw shippingError('SHIPPING_AMOUNT_MISMATCH');
  return Math.round(amount*100);
}
function verifyPayPalShippingAmount(payload,quote) {
  const units=payload?.purchase_units;
  if(!Array.isArray(units) || units.length!==1)throw shippingError('SHIPPING_AMOUNT_MISMATCH');
  const unit=units[0],currency=unit.amount?.currency_code;
  if(currency!==quote.currency)throw shippingError('SHIPPING_AMOUNT_MISMATCH');
  const lines=(unit.items || []).filter(i=>!i.sku && /^(shipping|envío)$/i.test(i.name));
  if(lines.length>1)throw shippingError('SHIPPING_AMOUNT_MISMATCH');
  let amount=cents(unit.amount?.breakdown?.shipping?.value ?? 0);
  for(const line of lines) {
    if(Number(line.quantity)!==1 || line.unit_amount?.currency_code!==currency)throw shippingError('SHIPPING_AMOUNT_MISMATCH');
    amount+=cents(line.unit_amount.value);
  }
  if(amount!==cents(quote.price) || amount<=0)throw shippingError('SHIPPING_AMOUNT_MISMATCH');
  return quote;
}
function verifyCardShipping(body,verifyQuote) {
  const currency=body.currency || 'MXN';
  const quote=verifyQuote(body.shipping_quote_token,{
    items:body.cart,currency,postalCode:body.shipping_cp,country:body.shipping_country || body.country || 'MX'
  });
  if(!/^\d{5}$/.test(String(body.shipping_cp || '')))throw shippingError('SHIPPING_ADDRESS_MISMATCH');
  if(cents(body.shipping_cost)!==cents(quote.price))throw shippingError('SHIPPING_AMOUNT_MISMATCH');
  return quote;
}
module.exports={verifyPayPalShippingAmount,verifyCardShipping};
