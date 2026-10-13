function invalid(code='INVALID_SHIPPING_POSTAL_CODE') {const error=Object.assign(new Error(code),{code,status:409});throw error;}
function postalCodeOf(value,country) {
  if(typeof value!=='string')invalid();
  const postal=value.trim();
  if(country==='US' && /^\d{5}(?:[- ]\d{4})?$/.test(postal))return postal.replace(' ','-');
  if(country==='MX' && /^\d{5}$/.test(postal))return postal;
  invalid();
}
function postalBase(value,country) {return postalCodeOf(value,country).slice(0,5);}
function samePostal(a,b,country) {return postalBase(a,country)===postalBase(b,country);}
function locationText(value) {return typeof value==='string'?value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' '):'';}
function sameLocation(a,b) {
  if(!a || !b || a.country!==b.country || !samePostal(a.postalCode,b.postalCode,a.country))return false;
  for(const field of ['city','state']) {
    if(a[field]!==undefined && b[field]!==undefined && locationText(a[field])!==locationText(b[field])) {
      const aliases=Array.isArray(a[field+'_aliases'])?a[field+'_aliases']:[];
      if(!aliases.some(alias=>locationText(alias)===locationText(b[field])))return false;
    }
  }
  return true;
}
module.exports={postalCodeOf,postalBase,samePostal,locationText,sameLocation};
