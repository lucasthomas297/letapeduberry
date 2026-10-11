import {depositMethod,bankAuthorizationMode} from './deposit-policy.mjs';
import {stripe,checkoutFields,paymentEnvironment,paymentEventMatchesStay} from './payment.mjs';
import {parisDay,dateNumber} from './calendar.mjs';
function parisTime(date,hour){
 const utc=dateNumber(date)+hour*3600000;
 const offset=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'}).formatToParts(new Date(utc)).find(p=>p.type==='timeZoneName').value;
 const match=offset.match(/^GMT\+(1|2)$/);if(!match)throw new Error('Fuseau d’arrivée invalide');
 return utc-Number(match[1])*3600000;
}
export function depositRequestDueAt(stay){return parisTime(stay.arrival,stay.early_arrival?14:16)-48*3600000;}
export async function refreshDeposit(stay,env) {
 env=paymentEnvironment(stay,env);
 const db=env.BERRY_DB,deposit=await db.prepare('SELECT * FROM deposits WHERE stay_id=?').bind(stay.id).first();
 if(!deposit||['released','captured','expired','failed'].includes(deposit.status))return deposit;
 if(deposit.status==='requested'){
  const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(deposit.checkout_id));
  if(session.status==='expired'||session.status==='complete')await depositEvent(session,env);
 }else if(deposit.payment_intent_id){
  await depositEvent({id:deposit.checkout_id,metadata:{reservation_id:stay.id},payment_intent:deposit.payment_intent_id},env);
 }
 return db.prepare('SELECT * FROM deposits WHERE stay_id=?').bind(stay.id).first();
}
export async function requestDueDeposits(env){
 const now=Date.now();
 const rows=await env.BERRY_DB.prepare("SELECT s.* FROM stays s LEFT JOIN deposits d ON d.stay_id=s.id WHERE s.status='confirmed' AND s.contract_accepted_at IS NOT NULL AND EXISTS(SELECT 1 FROM mail_outbox o WHERE o.stay_id=s.id AND o.kind='confirmation' AND o.sent_at IS NOT NULL) AND d.stay_id IS NULL AND s.arrival>=? AND s.arrival<=? ORDER BY s.arrival,s.early_arrival DESC,s.created_at LIMIT 20").bind(parisDay(new Date(now)),parisDay(new Date(now+2*86400000))).all();
 for(const stay of rows.results)try{if(depositMethod(stay)==='bank'&&now>=depositRequestDueAt(stay))await depositAction(stay,{action:'request'},env);}catch{ /* Retry next tick; never cancel or charge on a technical failure. */ }
}
export async function reconcileDeposits(env){
 const rows=await env.BERRY_DB.prepare("SELECT s.* FROM stays s JOIN deposits d ON d.stay_id=s.id WHERE d.status IN ('requested','authorized','review') ORDER BY coalesce(d.checked_at,'') LIMIT 20").all();
 for(const stay of rows.results)try{await refreshDeposit(stay,env);}catch{ /* Preserve uncertain status; owner can retry verification. */ }
}
export async function depositAction(stay,data,env) {
 env=paymentEnvironment(stay,env);
 if(stay.status!=='confirmed')throw new Error('Le séjour doit être confirmé.');
 const db=env.BERRY_DB;
 if(depositMethod(stay)==='cash')throw Error('Ce séjour prévoit un dépôt en espèces, sans opération Stripe.');
 if(data.action==='check'){const deposit=await refreshDeposit(stay,env);return {status:deposit?.status||'not_requested'};}
 let deposit=await db.prepare('SELECT * FROM deposits WHERE stay_id=?').bind(stay.id).first();
 if(data.action==='request') {
  if(!stay.contract_accepted_at||(stay.payment_preference==='card'&&!stay.paid_at))throw Error('Le contrat et le paiement doivent être validés avant la garantie.');
  const confirmation=await db.prepare("SELECT sent_at FROM mail_outbox WHERE stay_id=? AND kind='confirmation'").bind(stay.id).first();
  if(!confirmation?.sent_at)throw Error('Le message de confirmation doit être envoyé avant le lien de garantie.');
  const days=(Date.parse(stay.arrival+'T00:00:00Z')-Date.parse(parisDay()+'T00:00:00Z'))/86400000;
  if(days<0 || Date.now()<depositRequestDueAt(stay))throw new Error('L’empreinte doit être demandée à partir de 48 heures avant l’arrivée.');
  if(deposit)deposit=await refreshDeposit(stay,env);
  if(deposit&&!['expired','failed'].includes(deposit.status))return {status:deposit.status};
  const attempt=(deposit?.attempt||0)+1;
  const fields=checkoutFields(stay,env.SITE_ORIGIN,'deposit');
  if(bankAuthorizationMode(stay)==='extended'){
   if(env.STRIPE_EXTENDED_AUTHORIZATION_ENABLED!=='true')throw Error('Les empreintes prolongées doivent être activées auprès de Stripe avant de demander cette garantie.');
   fields['payment_method_options[card][request_extended_authorization]']='if_available';
  }
  const session=await stripe(env,'checkout/sessions',fields,'deposit-'+stay.id+'-'+attempt);
  if(!/^cs_[A-Za-z0-9_]+$/.test(session.id||'')||!session.url?.startsWith('https://checkout.stripe.com/'))throw new Error('Lien Stripe invalide');
  const time=new Date().toISOString();
  await db.batch([
   db.prepare("INSERT INTO deposits(stay_id,checkout_id,checkout_url,status,attempt) VALUES (?,?,?,'requested',?) ON CONFLICT(stay_id) DO UPDATE SET checkout_id=excluded.checkout_id,checkout_url=excluded.checkout_url,status='requested',attempt=excluded.attempt,payment_intent_id=NULL,capture_before=NULL,checked_at=NULL WHERE deposits.status IN ('expired','failed') AND deposits.attempt=excluded.attempt-1").bind(stay.id,session.id,session.url,attempt),
   db.prepare("INSERT INTO mail_outbox(id,stay_id,kind,created_at,payload) SELECT ?,?,'deposit_link',?,? WHERE changes()=1 ON CONFLICT(stay_id,kind) DO UPDATE SET id=excluded.id,created_at=excluded.created_at,payload=excluded.payload,sent_at=NULL,provider_id=NULL").bind(crypto.randomUUID(),stay.id,time,JSON.stringify({url:session.url,attempt}))
  ]);return {status:'requested'};
 }
 if(data.action==='release') {
  const claim=await db.prepare('SELECT status FROM damage_claims WHERE stay_id=?').bind(stay.id).first();
  if(claim&&claim.status!=='abandoned')throw new Error('Un dossier de retenue existe : vérifiez son traitement avant de libérer la garantie.');
  if(deposit?.status==='released')return {status:'released'};
  if(data.inspected!==true)throw new Error('Confirmez que le contrôle du logement est terminé, sans dommage.');
  if(Date.now()<parisTime(stay.departure,stay.late_departure?12:11))throw new Error('La garantie sera libérée après le départ et le contrôle du logement.');
  deposit=await refreshDeposit(stay,env);
  if(deposit?.status==='expired')return {status:'expired'};
  if(!deposit?.payment_intent_id||!['authorized','review'].includes(deposit.status))throw new Error('Aucune empreinte active à traiter.');
  const result=await stripe(env,`payment_intents/${deposit.payment_intent_id}/cancel`,{cancellation_reason:'requested_by_customer'},'release-'+deposit.payment_intent_id);
  if(result.status!=='canceled')throw new Error('Libération non confirmée');
  await db.prepare("UPDATE deposits SET status='released',released_at=? WHERE stay_id=? AND payment_intent_id=?").bind(new Date().toISOString(),stay.id,deposit.payment_intent_id).run();return {status:'released'};
 }
 throw new Error('Action non disponible. Une retenue nécessite un dossier justificatif et une décision distincte.');
}
export async function depositEvent(session,env) {
 const db=env.BERRY_DB,deposit=await db.prepare('SELECT * FROM deposits WHERE checkout_id=? AND stay_id=?').bind(session.id,session.metadata.reservation_id).first();
 if(!deposit)return; // A replaced, expired session must never update the new attempt.
 if(['released','captured','expired','failed'].includes(deposit.status))return;
 const stay=await db.prepare('SELECT * FROM stays WHERE id=?').bind(deposit.stay_id).first();
 if(!stay||!paymentEventMatchesStay(stay,env))throw Error('Mode de garantie incompatible');
 env=paymentEnvironment(stay,env);
 const time=new Date().toISOString();
 if(session.status==='expired') {if(deposit.status==='requested')await db.prepare("UPDATE deposits SET status='expired',checked_at=? WHERE stay_id=? AND checkout_id=? AND status='requested'").bind(time,deposit.stay_id,session.id).run();return;}
 const id=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;
 if(!/^pi_[A-Za-z0-9]+$/.test(id||''))throw new Error('Empreinte Stripe invalide');
 const intent=await stripe(env,'payment_intents/'+id+'?expand[]=latest_charge');
 const before=intent.latest_charge?.payment_method_details?.card?.capture_before;
 const hours=Number(env.DEPOSIT_RELEASE_HOURS||48);
 if(!Number.isInteger(hours)||hours<0||hours>168)throw new Error('Délai de contrôle invalide');
 const enough=Number(before)*1000>Math.max(Date.now(),parisTime(stay.departure,stay.late_departure?12:11)+hours*3600000);
 let status=intent.status==='requires_capture'&&intent.amount===30000&&intent.currency==='eur'&&Number.isFinite(before)&&enough?'authorized':'review';
 if(intent.status==='canceled')status='expired';
 if(intent.status==='requires_payment_method')status='failed';
 await db.prepare("UPDATE deposits SET payment_intent_id=?,capture_before=?,status=?,checked_at=? WHERE stay_id=? AND checkout_id=? AND status NOT IN ('released','captured','expired','failed')").bind(id,before?new Date(before*1000).toISOString():null,status,time,deposit.stay_id,session.id).run();
}
