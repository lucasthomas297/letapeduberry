import {stripe,stripeObjectModeMatches} from './payment.mjs';
import {processStaySession} from './booking-flow.mjs';
// Repair missed or delayed webhook delivery using Stripe's authenticated API.
// Unverifiable states retain the dates; never infer payment from a browser return.
export async function reconcilePayments(env) {
 const rows=await env.BERRY_DB.prepare("SELECT id,stripe_checkout_id FROM stays WHERE status='awaiting_payment' AND stripe_checkout_id IS NOT NULL AND payment_due_at<=? ORDER BY payment_due_at LIMIT 20").bind(new Date().toISOString()).all();
 for(const stay of rows.results) {
  try {
   const path='checkout/sessions/'+encodeURIComponent(stay.stripe_checkout_id);
   let session=await stripe(env,path);
   if(session.id!==stay.stripe_checkout_id || !stripeObjectModeMatches(session,env) || session.metadata?.reservation_id!==stay.id || session.metadata?.purpose!=='stay')continue;
   if(session.status==='open')session=await stripe(env,path+'/expire',{},'expire-'+stay.id);
   if(session.id!==stay.stripe_checkout_id || !stripeObjectModeMatches(session,env) || session.metadata?.reservation_id!==stay.id || session.metadata?.purpose!=='stay')continue;
   const type=session.status==='expired'?'checkout.session.expired':session.status==='complete'&&session.payment_status==='paid'?'checkout.session.completed':null;
   if(type)await processStaySession(session,type,'reconcile-'+session.id+'-'+session.status,env);
  } catch { /* Keep dates blocked and retry. Never lose an unverified payment. */ }
 }
}
