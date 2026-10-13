// Provider estimates are comparison data, never a locally calculated promise date.
const UNITS = {days:1440, hours:60};
// Aliases confirmed in live Envia deliveryDate responses (2026-10-13).
const UNIT_ALIASES = {days:'days',day:'days',hours:'hours',hour:'hours',hrs:'hours'};
function textWindow(value) {
  const text = String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (/^(?:dia siguiente|next day)$/.test(text)) return {min:1,max:1,unit:'days'};
  if (/^(?:mismo dia|same day)$/.test(text)) return {min:0,max:0,unit:'days'};
  const match = text.match(/^(\d+)(?:\s*(?:[-–—]|a|to)\s*(\d+))?\s*(dias?(?:\s+habiles)?|business days?|days?|horas?|hours?)?$/);
  if (!match) return null;
  const min=Number(match[1]),max=Number(match[2] ?? match[1]);
  const unit=/^(?:hor|hour)/.test(match[3] || '')?'hours':'days';
  if (min>max || max>365 || !Number.isSafeInteger(max)) return null;
  return {min,max,unit};
}
function deliveryEstimate(value, detailed) {
  const text=typeof value==='string' ? value.trim().slice(0,150)
    : typeof value==='number' && Number.isFinite(value) && value>=0 ? String(value) : '';
  const window=textWindow(text);
  let structured=null,minutes=null;
  if (detailed && typeof detailed==='object' && !Array.isArray(detailed)
    && Number.isSafeInteger(detailed.dateDifference) && detailed.dateDifference>=0
    && Object.hasOwn(UNIT_ALIASES,detailed.timeUnit) && detailed.dateDifference*UNITS[UNIT_ALIASES[detailed.timeUnit]]<=365*1440) {
    structured={dateDifference:detailed.dateDifference,timeUnit:detailed.timeUnit};
    if (typeof detailed.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(detailed.date)) structured.date=detailed.date;
    if (typeof detailed.time==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(detailed.time)) structured.time=detailed.time;
    minutes=detailed.dateDifference*UNITS[UNIT_ALIASES[detailed.timeUnit]];
  }
  // Compare like units: a next-business-day label and an hours estimate need
  // not contradict each other. Do not invent holiday/cutoff calendar rules.
  const conflicting=!!(structured && window && UNIT_ALIASES[structured.timeUnit]===window.unit
    && (structured.dateDifference<window.min || structured.dateDifference>window.max));
  return {text,structured,minutes:conflicting?null:minutes ?? (window?window.max*UNITS[window.unit]:null),
    status:conflicting?'conflicting':minutes!==null || window?'known':'unknown'};
}
function duration(rate) {return typeof rate.delivery_minutes==='number' && Number.isFinite(rate.delivery_minutes) && rate.delivery_minutes>=0 ? rate.delivery_minutes : Infinity;}
function identity(rate) {return rate.carrier.toLowerCase()+':'+rate.service;}
function stable(a,b) {return identity(a).localeCompare(identity(b));}
function recommendShipping(rates) {
  const valid=rates.filter(rate=>rate && typeof rate.price==='number' && Number.isFinite(rate.price) && rate.price>0);
  const byPrice=[...valid].sort((a,b)=>Math.round(a.price*100)-Math.round(b.price*100) || duration(a)-duration(b) || stable(a,b));
  const seen=new Set(),unique=byPrice.filter(rate=>{const id=identity(rate);if(seen.has(id))return false;seen.add(id);return true;});
  if(!unique.length)return [];
  const economical=unique[0];
  const fastest=unique.filter(rate=>Number.isFinite(duration(rate))).sort((a,b)=>duration(a)-duration(b) || Math.round(a.price*100)-Math.round(b.price*100) || stable(a,b))[0];
  if(fastest && identity(fastest)===identity(economical))return [{kind:'both',rate:economical}];
  return [{kind:'economical',rate:economical},...(fastest?[{kind:'fastest',rate:fastest}]:[])];
}
module.exports={deliveryEstimate,recommendShipping};
