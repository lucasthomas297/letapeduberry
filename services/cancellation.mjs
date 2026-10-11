import {depositMethod} from './deposit-policy.mjs';
import {savedDocumentModel} from './contract.mjs';
import {stripe,digest,paymentEnvironment} from './payment.mjs';
import {depositRequestDueAt,refreshDeposit} from './deposit.mjs';
const mail=(db,id,kind,payload={})=>db.prepare('INSERT OR IGNORE INTO mail_outbox(id,stay_id,kind,created_at,payload) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),id,kind,new Date().toISOString(),JSON.stringify(payload));
export async function cancellationPlan(stay,data){
 if(stay.status!=='confirmed')throw Error('Seuls les séjours confirmés peuvent être annulés ici.');
 const arrival=depositRequestDueAt(stay)+48*3600000,now=Date.now();
 if(now>=arrival)throw Error('Le séjour a commencé : son annulation nécessite un calcul tenant compte des nuits effectuées. Contactez le voyageur avant de traiter ce cas.');
 if(!['guest','owner','exception','guarantee_refusal'].includes(data.cause))throw Error('Indiquez qui demande l’annulation.');
 const notifiedAt=data.notifiedAt||new Date(now).toISOString(),notified=Date.parse(notifiedAt),created=Date.parse(stay.created_at);
 if(!Number.isFinite(notified)||notified>now||(Number.isFinite(created)&&notified<created))throw Error('Date de demande d’annulation invalide.');
 const model=savedDocumentModel(stay.contract_html);
 if(!model||model.price?.total!==stay.total_cents||(!Number.isInteger(model.price.tax)||model.price.tax<0||model.price.tax>stay.total_cents))throw Error('La ventilation du contrat archivé doit être vérifiée manuellement avant annulation.');
 const reason=typeof data.reason==='string'?data.reason.trim():'';
 if(reason.length<3||reason.length>2000)throw Error('Précisez le motif de l’annulation.');
 const rate=model.rate||(model.cancellation?.[0]?.includes('non remboursable')?'fixed':'flex');
 if(data.cause==='guarantee_refusal'&&data.refusalConfirmed!==true)throw Error('Confirmez le refus volontaire du voyageur : un échec bancaire ne suffit pas.');
 const full=['owner','exception'].includes(data.cause)||(data.cause==='guest'&&rate==='flex'&&notified<=arrival-24*3600000);
 const refundable=full?stay.total_cents:model.price.tax;
 const paid=Boolean(stay.paid_at);
 if(stay.payment_preference==='card'&&(!paid||!/^pi_[A-Za-z0-9]+$/.test(stay.stripe_payment_intent_id||'')))throw Error('Le paiement par carte doit être vérifié avant annulation.');
 const plan={id:stay.id,cause:data.cause,refusalConfirmed:data.cause==='guarantee_refusal',reason,notifiedAt:new Date(notified).toISOString(),deadline:new Date(arrival-24*3600000).toISOString(),full,payment:stay.payment_preference,totalCents:stay.total_cents,taxCents:model.price.tax,refundCents:paid?refundable:0,retainedCents:paid?stay.total_cents-refundable:0,owedCents:paid?0:stay.total_cents-refundable};
 return {...plan,hash:await digest(JSON.stringify(plan))};
}
async function cancelGuarantee(stay,env){
 env=paymentEnvironment(stay,env);
 if(depositMethod(stay)==='cash'){const row=await env.BERRY_DB.prepare('SELECT returned_at FROM cash_deposits WHERE stay_id=?').bind(stay.id).first();return !row||Boolean(row.returned_at);}
 let deposit=await refreshDeposit(stay,env);
 if(!deposit||['released','expired','failed'].includes(deposit.status))return true;
 if(deposit.status==='captured')return false;
 if(deposit.status==='requested'){
  const session=await stripe(env,'checkout/sessions/'+deposit.checkout_id+'/expire',{},'cancel-deposit-session-'+deposit.checkout_id);
  if(session.status!=='expired')throw Error('Expiration de la garantie non confirmée');
  await env.BERRY_DB.prepare("UPDATE deposits SET status='expired' WHERE stay_id=? AND checkout_id=? AND status='requested'").bind(stay.id,deposit.checkout_id).run();return true;
 }
 if(deposit.payment_intent_id){
  const result=await stripe(env,'payment_intents/'+deposit.payment_intent_id+'/cancel',{cancellation_reason:'requested_by_customer'},'cancel-deposit-'+deposit.payment_intent_id);
  if(result.status!=='canceled')throw Error('Libération non confirmée');
  await env.BERRY_DB.prepare("UPDATE deposits SET status='released',released_at=? WHERE stay_id=? AND payment_intent_id=?").bind(new Date().toISOString(),stay.id,deposit.payment_intent_id).run();return true;
 }
 return false;
}
export async function processCancellation(stay,env){
 env=paymentEnvironment(stay,env);
 const db=env.BERRY_DB,cancel=await db.prepare('SELECT * FROM cancellations WHERE stay_id=?').bind(stay.id).first();
 if(!cancel)return;
 if(cancel.refund_status==='pending')try{
  // Never re-create an ambiguous refund once Stripe's idempotency window has elapsed.
  if(!cancel.stripe_refund_id&&Date.now()-Date.parse(cancel.cancelled_at)>23*3600000){await db.prepare("UPDATE cancellations SET refund_status='failed' WHERE stay_id=? AND stripe_refund_id IS NULL").bind(stay.id).run();}
  else{
   const result=cancel.stripe_refund_id?await stripe(env,'refunds/'+cancel.stripe_refund_id):await stripe(env,'refunds',{payment_intent:stay.stripe_payment_intent_id,amount:String(cancel.refund_cents),reason:'requested_by_customer','metadata[reservation_id]':stay.id},'cancel-refund-'+stay.id);
   if(!/^re_[A-Za-z0-9]+$/.test(result.id||'')||result.amount!==cancel.refund_cents||result.currency!=='eur'||result.payment_intent!==stay.stripe_payment_intent_id)throw Error('Remboursement à vérifier');
   const state=result.status==='succeeded'?'succeeded':['failed','canceled'].includes(result.status)?'failed':'pending';
   const time=new Date().toISOString();
   await db.batch([db.prepare('UPDATE cancellations SET stripe_refund_id=?,refund_status=?,refund_completed_at=? WHERE stay_id=? AND refund_status=\'pending\'').bind(result.id,state,state==='succeeded'?time:null,stay.id),...(state==='succeeded'?[mail(db,stay.id,'refund_update',{amount:cancel.refund_cents})]:[])]);
  }
 }catch{/* Keep the amount and key unchanged for a safe retry. */}
 if(!cancel.deposit_done)try{if(await cancelGuarantee(stay,env))await db.prepare('UPDATE cancellations SET deposit_done=1 WHERE stay_id=?').bind(stay.id).run();}catch{/* The cancellation stays visible with guarantee release pending. */}
}
export async function cancelStay(stay,data,env){
 const db=env.BERRY_DB,existing=await db.prepare('SELECT * FROM cancellations WHERE stay_id=?').bind(stay.id).first();
 if(existing){await processCancellation(stay,env);return {ok:true};}
 const plan=await cancellationPlan(stay,data);
 if(data.confirmed!==true||data.planHash!==plan.hash)throw Error('Vérifiez le montant et confirmez l’annulation.');
 const time=new Date().toISOString(),state=plan.refundCents===0?'none':stay.payment_preference==='cash'?'manual':'pending';
 await db.batch([
  db.prepare("INSERT INTO cancellations(stay_id,cause,reason,notified_at,cancelled_at,owner_email,refund_cents,retained_cents,owed_cents,refund_status) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM stays WHERE id=? AND status='confirmed')").bind(stay.id,plan.cause,plan.reason,plan.notifiedAt,time,env.OWNER_EMAIL,plan.refundCents,plan.retainedCents,plan.owedCents,state,stay.id),
  db.prepare("UPDATE stays SET status='cancelled',flow_stage='cancelled' WHERE id=? AND status='confirmed' AND EXISTS(SELECT 1 FROM cancellations WHERE stay_id=?)").bind(stay.id,stay.id),
  mail(db,stay.id,'cancellation',plan)
 ]);
 await processCancellation({...stay,status:'cancelled'},env);return {ok:true};
}
export async function acknowledgeCashRefund(stay,data,env){
 const db=env.BERRY_DB,row=await db.prepare('SELECT * FROM cancellations WHERE stay_id=?').bind(stay.id).first();
 if(!row||stay.payment_preference!=='cash'||data.refunded!==true||data.amountCents!==row.refund_cents)throw Error('Confirmez le remboursement réellement effectué en espèces.');
 if(row.refund_status==='succeeded')return {ok:true};
 if(row.refund_status!=='manual')throw Error('Aucun remboursement en espèces à enregistrer.');
 const time=new Date().toISOString();
 await db.batch([db.prepare("UPDATE cancellations SET refund_status='succeeded',refund_completed_at=?,owner_email=? WHERE stay_id=? AND refund_status='manual'").bind(time,env.OWNER_EMAIL,stay.id),mail(db,stay.id,'refund_update',{amount:row.refund_cents})]);return {ok:true};
}
export async function reconcileCancellations(env){
 const rows=await env.BERRY_DB.prepare("SELECT s.* FROM stays s JOIN cancellations c ON c.stay_id=s.id WHERE c.refund_status='pending' OR c.deposit_done=0 ORDER BY c.cancelled_at LIMIT 20").all();
 for(const stay of rows.results)await processCancellation(stay,env);
}
