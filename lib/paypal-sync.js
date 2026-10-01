const crypto = require('crypto');
function getPayPalOrderId(body) {
  const id = body.paypalOrderId || body.orderId || body.payment_id || body.order_id;
  const normalized = String(id || '').replace(/^paypal-/, '');
  return /^[A-Z0-9]{10,30}$/.test(normalized) ? normalized : null;
}
function signedRequest(orderId, hints, secret, now = Date.now()) {
  if (!secret) throw new Error('PROAX_PAYPAL_SYNC_SECRET not configured');
  const body = JSON.stringify({paypalOrderId:orderId,hints});
  const timestamp = String(now);
  return {body,headers:{'Content-Type':'application/json','x-mahjoy-timestamp':timestamp,'x-mahjoy-signature':crypto.createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex')}};
}
function registerPayPalSync(app, pool, base, saveVerifiedOrder) {
  const ready = pool.query(`CREATE TABLE IF NOT EXISTS mahjoy_paypal_sync_jobs (
    paypal_order_id text PRIMARY KEY, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text, synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
  ready.catch(error=>console.error('[paypal sync queue]',error.message));
  async function sync(id) {
    const {rows} = await pool.query(`UPDATE mahjoy_paypal_sync_jobs SET next_attempt_at=now()+interval '2 minutes',attempts=attempts+1
      WHERE paypal_order_id=$1 AND status='pending' AND next_attempt_at<=now() RETURNING *`,[id]);
    if (!rows.length) return null;
    const job = rows[0];
    try {
      const request = signedRequest(id,job.payload,process.env.PROAX_PAYPAL_SYNC_SECRET);
      const response = await fetch(base+'/api/public/mahjoy/paypal-sync',{method:'POST',...request,signal:AbortSignal.timeout(25000)});
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Proax synchronization failed: '+response.status);
      await saveVerifiedOrder(result.order);
      await pool.query(`UPDATE mahjoy_paypal_sync_jobs SET status='synced',synced_at=now(),last_error=null WHERE paypal_order_id=$1`,[id]);
      return result;
    } catch(error) {
      await pool.query(`UPDATE mahjoy_paypal_sync_jobs SET last_error=$2,next_attempt_at=now()+($3 * interval '1 second') WHERE paypal_order_id=$1`,[id,String(error.message).slice(0,500),Math.min(3600,30*Math.pow(2,Math.min(job.attempts,7)))]);
      console.error('[paypal sync]',id,error.message);
      return null;
    }
  }
  app.post('/api/orders/paypal-express',async(req,res)=>{
    const id = getPayPalOrderId(req.body);
    if (!id) return res.status(400).json({error:'Invalid PayPal order ID'});
    try {
      await ready;
      await pool.query(`INSERT INTO mahjoy_paypal_sync_jobs(paypal_order_id,payload) VALUES($1,$2)
        ON CONFLICT(paypal_order_id) DO UPDATE SET payload=EXCLUDED.payload`,[id,JSON.stringify(req.body)]);
      const result = await sync(id);
      res.status(result?200:202).json({ok:true,orderId:id,sync:result?'synced':'queued'});
    } catch(error) {
      console.error('[paypal sync enqueue]',error.message);
      res.status(503).json({error:'Could not save payment notification. Please retry.'});
    }
  });
  let processing=false;
  const timer=setInterval(async()=>{
    if(processing)return;processing=true;
    try {
      await ready;
      const {rows}=await pool.query(`SELECT paypal_order_id FROM mahjoy_paypal_sync_jobs WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 10`);
      for(const row of rows)await sync(row.paypal_order_id);
    }catch(error){console.error('[paypal sync worker]',error.message);}finally{processing=false;}
  },30000);
  timer.unref();
}
module.exports={getPayPalOrderId,signedRequest,registerPayPalSync};
