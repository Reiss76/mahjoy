const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/paypal-confirmation.js','utf8');
const orderId='8SA12345AB678901C';
function ui(url='https://www.playmahjoy.com/en/checkout.html?qty=2#42',stored=new Map(),blocked=false) {
  const nodes={};
  const node=id=>nodes[id] ||= {style:{},textContent:'',hidden:false,innerHTML:'',querySelector:selector=>node(id+selector)};
  const location=new URL(url),window={location,sessionStorage:{getItem:key=>{if(blocked)throw Error('blocked');return stored.get(key);},setItem:(key,value)=>{if(blocked)throw Error('blocked');stored.set(key,value);}},history:{replaceState(_a,_b,url){window.location=new URL(url,window.location);}},scrollTo(){}};
  const ctx={window,document:{getElementById:node},URL,URLSearchParams,Intl,console};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {window,node,nodes,stored,ctx,api:window.MJPayPalConfirmation};
}
function receipt(currency='USD') {return {id:orderId,status:'COMPLETED',purchase_units:[{payments:{captures:[{status:'COMPLETED',amount:{value:'16.12',currency_code:currency}}]}}]};}

test('completed receipt shows the amount and preserves the original product context',()=>{
  const f=ui();f.api.show(receipt());
  assert.equal(f.node('co-content').style.display,'none');
  assert.equal(f.node('co-thanks').style.display,'flex');
  assert.equal(f.node('co-thanks[data-receipt-title]').textContent,'Payment received');
  assert.match(f.node('co-thanks[data-receipt-total]').textContent,/16\.12.*USD/);
  assert.equal(f.window.location.hash,'#42');assert.equal(f.window.location.searchParams.get('qty'),'2');
  assert.equal(f.window.location.searchParams.get('order'),orderId);
  const next=ui(f.window.location.href,f.stored);assert.equal(next.api.restore(),true);
  assert.equal(next.node('co-thanks[data-receipt-title]').textContent,'Payment received');
});
test('a URL alone never claims a successful payment, and old broken return links hide payment controls',()=>{
  const f=ui('https://www.playmahjoy.com/en/checkout.html?payment=success&method=paypal&order='+orderId);
  assert.equal(f.api.restore(),true);
  assert.equal(f.node('co-content').style.display,'none');
  assert.equal(f.node('co-thanks[data-receipt-title]').textContent,'Check your payment status');
  assert.match(f.node('co-thanks[data-receipt-message]').textContent,/before trying to pay again/);
});
test('unfinished or malformed receipts cannot become confirmed, including a different order in the URL',()=>{
  const f=ui();assert.throws(()=>f.api.show({...receipt(),status:'APPROVED'}),/PAYMENT_NOT_CONFIRMED/);
  assert.throws(()=>f.api.show({...receipt(),id:'<script>alert(1)<\/script>'}),/PAYMENT_NOT_CONFIRMED/);
  f.api.show(receipt());
  const other=ui('https://www.playmahjoy.com/en/checkout.html?payment=success&order=7BB12345AB678901D',f.stored);
  other.api.restore();assert.equal(other.node('co-thanks[data-receipt-title]').textContent,'Check your payment status');
});
test('private storage failures do not lose the current receipt, but reload cannot invent one',()=>{
  const f=ui(undefined,undefined,true);f.api.show(receipt());
  assert.equal(f.node('co-thanks[data-receipt-title]').textContent,'Payment received');
  const next=ui(f.window.location.href,undefined,true);assert.equal(next.api.restore(),true);
  assert.equal(next.node('co-thanks[data-receipt-title]').textContent,'Check your payment status');
});
test('Spanish receipt and pending-save state remain explicit and never expose a second payment',()=>{
  const f=ui('https://www.playmahjoy.com/checkout.html#42');f.api.show(receipt('MXN'),{syncPending:true});
  assert.equal(f.node('co-thanks[data-receipt-title]').textContent,'Pago recibido');
  assert.match(f.node('co-thanks[data-receipt-message]').textContent,/No vuelvas a pagar/);
  assert.match(f.node('co-thanks[data-receipt-total]').textContent,/MXN/);
});

const fixtureSource=fs.readFileSync('tests/paypal-native-client.test.js','utf8').split("for(const currency of ['MXN','USD'])for(const kind")[0];
const harness={require,Buffer,setImmediate,console};vm.createContext(harness);vm.runInContext(fixtureSource,harness);
for(const currency of ['MXN','USD'])for(const kind of ['normal','express'])test(`${kind} ${currency} confirms in place after capture without the broken redirect`,async()=>{
  const f=harness.fixture(currency),address='https://www.playmahjoy.com'+(currency==='USD'?'/en':'')+'/checkout.html?qty=1#42';
  const view=ui(address,f.stored);
  f.ctx.URL=URL;f.ctx.URLSearchParams=URLSearchParams;f.ctx.Intl=Intl;
  Object.assign(f.ctx.window,{location:view.window.location,history:view.window.history,scrollTo(){}});
  f.node('co-thanks').querySelector=selector=>f.node('receipt'+selector);
  vm.runInContext(source,f.ctx);
  const prior=f.ctx.fetch;
  f.ctx.fetch=async(path,init)=>{
    const result=await prior(path,init);
    return path.endsWith('/paypal/create')?{ok:true,json:async()=>({...await result.json(),id:orderId})}:result;
  };
  if(kind==='express')f.ctx.window.MJPayPal={complete:f.ctx.window.MJPayPalConfirmation.show};
  const options=await harness.entrypoint(f,kind,currency);
  await options.createOrder({},{});await options.onApprove({orderID:orderId});
  assert.equal(f.node('co-content').style.display,'none');
  assert.equal(f.node('co-thanks').style.display,'flex');
  assert.equal(f.node('receipt[data-receipt-title]').textContent,currency==='USD'?'Payment received':'Pago recibido');
  assert.equal(f.alerts.length,0);
  assert.equal(f.requests.filter(request=>request.path.endsWith('/paypal/capture')).length,1);
});
