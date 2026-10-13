const test=require('node:test'),assert=require('node:assert/strict');
const {verifyPayPalShippingAmount,verifyCardShipping}=require('../lib/shipping-payment');
const quote={price:429,currency:'MXN'};
function payload(shipping='429.00') {
  return {purchase_units:[{amount:{currency_code:'MXN',breakdown:{shipping:{currency_code:'MXN',value:shipping}}},items:[{sku:'MAT-PIEL',quantity:'1',unit_amount:{currency_code:'MXN',value:'1330.00'}}]}]};
}
test('429 quoted shipment cannot be charged as the former 250 fallback',()=>{
  assert.equal(verifyPayPalShippingAmount(payload(),quote),quote);
  for(const amount of ['250.00','0','NaN','-1'])assert.throws(()=>verifyPayPalShippingAmount(payload(amount),quote),/SHIPPING_AMOUNT_MISMATCH/);
  const missing=payload();delete missing.purchase_units[0].amount.breakdown.shipping;assert.throws(()=>verifyPayPalShippingAmount(missing,quote),/SHIPPING_AMOUNT_MISMATCH/);
});
test('a shipping line is accepted once and cannot be combined with another shipping charge',()=>{
  const p=payload('0');p.purchase_units[0].items.push({name:'Envío',quantity:'1',unit_amount:{currency_code:'MXN',value:'429.00'}});
  verifyPayPalShippingAmount(p,quote);
  p.purchase_units[0].amount.breakdown.shipping.value='429.00';assert.throws(()=>verifyPayPalShippingAmount(p,quote));
  p.purchase_units[0].amount.breakdown.shipping.value='0';p.purchase_units[0].items.push(p.purchase_units[0].items[1]);assert.throws(()=>verifyPayPalShippingAmount(p,quote));
});
test('card checkout binds its address, merchandise and currency to a verified quote',()=>{
  const body={shipping_quote_token:'signed',cart:[{sku:'MAT-PIEL',qty:1}],currency:'MXN',shipping_cp:'85219',shipping_country:'MX',shipping_cost:429};
  const verify=(token,context)=>{assert.equal(token,'signed');assert.deepEqual(context,{items:body.cart,currency:'MXN',postalCode:'85219',country:'MX'});return quote};
  assert.equal(verifyCardShipping(body,verify),quote);
  assert.throws(()=>verifyCardShipping({...body,shipping_cost:250},()=>quote),/SHIPPING_AMOUNT_MISMATCH/);
  assert.throws(()=>verifyCardShipping({...body,shipping_cp:''},()=>quote),/SHIPPING_ADDRESS_MISMATCH/);
  assert.throws(()=>verifyCardShipping(body,()=>{throw Error('SHIPPING_QUOTE_EXPIRED')}),/SHIPPING_QUOTE_EXPIRED/);
});
test('address guard retains equivalent valid US ZIP+4 while Mexico still requires five digits',()=>{
 const body={cart:[{sku:'A',qty:1}],currency:'USD',shipping_cp:'60601-1234',shipping_country:'US',shipping_cost:30,shipping_quote_token:'signed'};
 assert.equal(verifyCardShipping(body,()=>({price:30,currency:'USD'})).price,30);
 assert.throws(()=>verifyCardShipping({...body,shipping_cp:'60601-123'},()=>quote),/SHIPPING_ADDRESS_MISMATCH/);
});
