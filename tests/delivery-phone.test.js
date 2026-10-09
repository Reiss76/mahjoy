const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeMxDeliveryPhone}=require('../js/delivery-phone');
test('Mexican delivery phones accept national or +52 format with ordinary separators and return one canonical value',()=>{
  for(const input of ['5551234567','(55) 5123 4567','55-5123-4567','525551234567','+52 (55) 5123 4567'])assert.equal(normalizeMxDeliveryPhone(input),'+525551234567');
});
test('missing and invalid delivery contacts are rejected rather than replaced with a generic telephone',()=>{
  for(const input of [undefined,null,'','  '])assert.throws(()=>normalizeMxDeliveryPhone(input),error=>error.code==='NATIVE_SHIPPING_PHONE_REQUIRED');
  for(const input of ['555123456','55512345678','+15551234567','+5215551234567','5551234567 ext 10','5551234567\nTOKEN',5551234567])assert.throws(()=>normalizeMxDeliveryPhone(input),error=>error.code==='NATIVE_SHIPPING_PHONE_INVALID');
});
