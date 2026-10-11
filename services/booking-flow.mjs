import {depositMethod,depositSummary,bankAuthorizationMode} from './deposit-policy.mjs';
import {cashDepositAction} from './cash-deposit.mjs';
import {depositDeadline} from './deposit-deadline.mjs';
import {ownerHealth} from './owner-health.mjs';
import {sendDeliveryTest,deliveryTestPage} from './mail-delivery-test.mjs';
import {boundedDeadline,parisArrivalAt} from './booking-timing.mjs';
import {damageAction} from './damage.mjs';
import {contractPdf,descriptionPdf} from './contract-pdf.mjs';
import {adminAuthorized} from './admin-auth.mjs';
import {renderContract,renderContractModel,contractReady,escapeHtml,savedDocumentModel,ownerTaxBreakdown} from './contract.mjs';
import {stripe,checkoutFields,digest,webhookEvent,stripeWebhookModeMatches} from './payment.mjs';
import availability from './availability-worker.mjs';
import {overlaps} from './calendar.mjs';
import {depositAction,depositEvent,refreshDeposit} from './deposit.mjs';
import {cancellationPlan,cancelStay,acknowledgeCashRefund,processCancellation} from './cancellation.mjs';
const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function queueMail(db,id,kind,time,payload={}) {
 return db.prepare('INSERT OR IGNORE INTO mail_outbox(id,stay_id,kind,created_at,payload) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),id,kind,time,JSON.stringify(payload));
}
const originOK=(request)=>request.headers.get('Origin')===new URL(request.url).origin;
async function boundedText(request,maxBytes) {
 const reader=request.body?.getReader();if(!reader)throw new Error('Message absent');
 let size=0;const chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw new Error('Message trop volumineux');}chunks.push(value);}
 const bytes=new Uint8Array(size);let index=0;for(const chunk of chunks){bytes.set(chunk,index);index+=chunk.length;}
 return new TextDecoder().decode(bytes);
}
async function smallJson(request) {
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('Format invalide');
 return JSON.parse(await boundedText(request,10000));
}
// In the same transaction, queue a decision only if its preceding UPDATE won.
function queueDecision(db,id,kind,time,payload={}) {
 return db.prepare('INSERT OR IGNORE INTO mail_outbox(id,stay_id,kind,created_at,payload) SELECT ?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),id,kind,time,JSON.stringify(payload));
}
export async function flowFetch(request,env) {
 const url=new URL(request.url),path=url.pathname;
 if(path.startsWith('/api/admin/')) {
  if(!await adminAuthorized(request,env))return json(403,{error:'Connexion privée requise.'});
  if(path==='/api/admin/mail-test') {
   if(request.method==='GET')return deliveryTestPage();
   if(request.method!=='POST')return json(405,{error:'Méthode interdite'});
   if(!originOK(request))return json(403,{error:'Origine interdite'});
   const {sendQueuedMail}=await import('./request-worker.mjs');
   const result=await sendDeliveryTest(env,sendQueuedMail);
   return result.accepted?deliveryTestPage(true):json(503,{error:'Le message test n’a pas été accepté. Aucun dossier créé.'});
  }
  if(path==='/api/admin/health')return request.method==='GET'?json(200,await ownerHealth(env)):json(405,{error:'Méthode interdite'});
  if(path==='/api/admin/contract.pdf' || path==='/api/admin/description.pdf') {
   if(request.method!=='GET')return json(405,{error:'Méthode interdite'});
   const id=url.searchParams.get('id');
   if(!id||id.length>100)return json(400,{error:'Référence invalide.'});
   const stay=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE id=?').bind(id).first();
   if(!stay)return json(404,{error:'Demande introuvable.'});
   try {
    // Preview is read-only. Preserve the frozen document after the owner decision.
    const html=stay.contract_html||renderContract(stay,env);
    const descriptive=path.endsWith('/description.pdf');
    if(descriptive&&!savedDocumentModel(html))return json(404,{error:'Fiche indisponible pour ce contrat archivé.'});
    const bytes=descriptive?await descriptionPdf(html):await contractPdf(html,{accepted:Boolean(stay.contract_accepted_at),acceptedAt:stay.contract_accepted_at,signer:stay.contract_signer});
    return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="'+(descriptive?'fiche-descriptive':'contrat-location')+'.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
   }catch{return json(409,{error:'Le document ne peut pas être préparé : vérifiez les données du séjour et la ventilation du prix.'});}
  }
  if(path==='/api/admin/stays' && request.method==='GET') {
   const rows=await env.BERRY_DB.prepare(`SELECT s.contract_html,cd.received_at AS cash_deposit_received_at,cd.returned_at AS cash_deposit_returned_at,cd.returned_cents AS cash_deposit_returned_cents,cd.retained_reason AS cash_deposit_retained_reason,s.id,s.arrival,s.departure,s.status,s.flow_stage,s.customer_name,s.customer_email,s.customer_phone,s.customer_address,s.comment,s.guests,s.rate,s.early_arrival,s.late_departure,s.total_cents,s.payment_preference,s.payment_due_at,s.paid_at,CASE WHEN s.contract_html IS NULL OR instr(s.contract_html,'berry-document-model')>0 THEN 1 ELSE 0 END AS description_available,d.status AS deposit_status,(SELECT sent_at FROM mail_outbox WHERE stay_id=s.id AND kind='deposit_link') AS deposit_link_sent_at,d.capture_before,d.checked_at,dc.status AS damage_status,dc.amount_cents AS damage_amount,c.refund_cents,c.refund_status,c.retained_cents,c.owed_cents,c.deposit_done,
    (SELECT COUNT(*) FROM mail_outbox o WHERE o.stay_id=s.id AND o.sent_at IS NULL) AS unsent_notifications
    FROM stays s LEFT JOIN cash_deposits cd ON cd.stay_id=s.id LEFT JOIN deposits d ON d.stay_id=s.id LEFT JOIN cancellations c ON c.stay_id=s.id LEFT JOIN damage_claims dc ON dc.stay_id=s.id ORDER BY s.created_at DESC LIMIT 100`).all();
   return json(200,{stays:rows.results.map(stay=>{const {contract_html,...publicStay}=stay;return {...publicStay,tax_details:ownerTaxBreakdown(stay,env),deposit_method:depositMethod(stay),deposit_deadline:depositMethod(stay)==='bank'?depositDeadline(stay.deposit_link_sent_at,stay):null};})});
  }
  if(['/api/admin/cancellation-preview','/api/admin/cancel','/api/admin/cancellation-check','/api/admin/cash-refunded'].includes(path)&&request.method==='POST'){
   if(!originOK(request))return json(403,{error:'Origine interdite'});
   let data;try{data=await smallJson(request);}catch{return json(400,{error:'Demande invalide'});}
   const stay=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE id=?').bind(data.id).first();
   if(!stay)return json(404,{error:'Séjour introuvable.'});
   try{
    if(path.endsWith('cancellation-preview'))return json(200,{plan:await cancellationPlan(stay,data)});
    if(path.endsWith('cash-refunded'))return json(200,await acknowledgeCashRefund(stay,data,env));
    if(path.endsWith('cancellation-check')){await processCancellation(stay,env);return json(200,{ok:true});}
    return json(200,await cancelStay(stay,data,env));
   }catch(error){return json(409,{error:error.message});}
  }
  if(path==='/api/admin/cash-received' && request.method==='POST') {
   if(!originOK(request))return json(403,{error:'Origine interdite'});
   let data;try{data=await smallJson(request);}catch{return json(400,{error:'Encaissement invalide'});}
   const stay=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE id=?').bind(data.id).first();
   if(!stay||stay.status!=='confirmed'||stay.payment_preference!=='cash')return json(409,{error:'Ce séjour ne prévoit pas un règlement en espèces confirmé.'});
   if(data.received!==true||data.amountCents!==stay.total_cents)return json(400,{error:'Confirmez la réception du montant intégral du séjour.'});
   if(stay.paid_at)return json(200,{ok:true,alreadyRecorded:true});
   const time=new Date().toISOString();
   await env.BERRY_DB.batch([
    env.BERRY_DB.prepare("UPDATE stays SET paid_at=?,cash_received_by=?,flow_stage='paid' WHERE id=? AND status='confirmed' AND payment_preference='cash' AND paid_at IS NULL").bind(time,env.OWNER_EMAIL,stay.id),
    queueDecision(env.BERRY_DB,stay.id,'payment_receipt',time)
   ]);
   return json(200,{ok:true});
  }
  if(path==='/api/admin/cash-deposit' && request.method==='POST') {
   if(!originOK(request))return json(403,{error:'Origine interdite'});
   let data;try{data=await smallJson(request);}catch{return json(400,{error:'Demande invalide'});}
   const stay=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE id=?').bind(data.id).first();
   if(!stay)return json(404,{error:'Séjour introuvable'});
   try{return json(200,await cashDepositAction(stay,data,env));}catch(error){return json(409,{error:error.message});}
  }
  if(path==='/api/admin/deposit' && request.method==='POST') {
   if(!originOK(request))return json(403,{error:'Origine interdite'});
   let data;try{data=await smallJson(request);}catch{return json(400,{error:'Demande invalide'});}
   const stay=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE id=?').bind(data.id).first();
   if(!stay)return json(404,{error:'Séjour introuvable'});
   if(depositMethod(stay)==='cash')return json(409,{error:'Ce séjour prévoit un dépôt en espèces, sans opération Stripe.'});
   try{return json(200,await (data.action?.startsWith('damage-')?damageAction(stay,data,env):depositAction(stay,data,env)));}catch(error){return json(409,{error:error.message});}
  }
  if(path!=='/api/admin/decision' || request.method!=='POST')return json(405,{error:'Méthode interdite'});
  if(!originOK(request))return json(403,{error:'Origine interdite'});
  let data;try{data=await smallJson(request);}catch{return json(400,{error:'Demande invalide'});}
  const stay=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE id=?').bind(data.id).first();
  if(!stay || stay.status!=='pending')return json(409,{error:'Cette demande a déjà été traitée.'});
  const time=new Date().toISOString();
  const message=typeof data.message==='string'?data.message.trim():'';
  if(message.length>2000)return json(400,{error:'Message trop long'});
  if(data.action==='decline') {
   await env.BERRY_DB.batch([env.BERRY_DB.prepare("UPDATE stays SET status='declined',decision_message=? WHERE id=? AND status='pending'").bind(message,stay.id),queueDecision(env.BERRY_DB,stay.id,'decision',time,{message})]);
   return json(200,{ok:true});
  }
  if(data.action!=='approve')return json(400,{error:'Décision invalide'});
  if(depositMethod(stay)==='bank'&&bankAuthorizationMode(stay)==='extended'&&env.STRIPE_EXTENDED_AUTHORIZATION_ENABLED!=='true')return json(409,{error:'Stripe doit autoriser les empreintes prolongées avant l’acceptation de ce séjour. Aucun lien de paiement n’a été envoyé.'});
  if(!stay.insurance_accepted_at)return json(409,{error:'Le voyageur doit confirmer son assurance avant acceptation de cette demande.'});
  if(!contractReady(env))return json(503,{error:'Le contrat doit être complété et validé avant acceptation.'});
  if(!['card','cash'].includes(stay.payment_preference))return json(409,{error:'Mode de paiement invalide.'});
  if(parisArrivalAt(stay)-Date.now()<(stay.payment_preference==='card'?31*60000:1))return json(409,{error:'L’heure d’arrivée est trop proche ou déjà passée. Contactez le voyageur avant de convenir de nouvelles dates.'});
  const calendar=await availability.fetch(new Request(url.origin+'/api/availability'),env);
  if(!calendar.ok)return calendar;
  if(overlaps(stay.arrival,stay.departure,(await calendar.json()).busy))return json(409,{error:'Dates devenues indisponibles.'});
  const token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await digest(token);
  const html=renderContract(stay,env),hash=await digest(html),deadline=boundedDeadline(Date.now(),stay);
  try {
   await env.BERRY_DB.batch([
    env.BERRY_DB.prepare("UPDATE stays SET status='awaiting_payment',flow_stage='contract',decision_message=?,contract_html=?,contract_hash=?,guest_token_hash=?,payment_due_at=?,owner_accepted_at=? WHERE id=? AND status='pending'").bind(message,html,hash,tokenHash,deadline,time,stay.id),
    queueDecision(env.BERRY_DB,stay.id,'payment_link',time,{url:env.SITE_ORIGIN+'/sejour.html#'+token,message,deadline})
   ]);
  }catch{return json(409,{error:'Impossible de bloquer ces dates. Veuillez actualiser la demande.'});}
  return json(200,{ok:true,deadline});
 }
 if(path==='/api/guest/deposit-status'){
  if(request.method!=='GET')return json(405,{error:'Méthode interdite'});
  const sessionId=url.searchParams.get('session_id');
  if(!/^cs_[A-Za-z0-9_]{10,200}$/.test(sessionId||''))return json(403,{error:'Lien de garantie invalide.'});
  const stay=await env.BERRY_DB.prepare('SELECT s.* FROM stays s JOIN deposits d ON d.stay_id=s.id WHERE d.checkout_id=?').bind(sessionId).first();
  if(!stay)return json(404,{error:'Garantie introuvable.'});
  try{const deposit=await refreshDeposit(stay,env);return json(200,{status:deposit.status,reference:stay.contract_number||stay.id.slice(0,8)});}catch{return json(503,{error:'Vérification bancaire momentanément indisponible.'});}
 }
 if(path==='/api/guest/stay' || path==='/api/guest/accept' || path==='/api/guest/payment-status' || path==='/api/guest/contract.pdf' || path==='/api/guest/description.pdf') {
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  if(!token || !/^[a-f0-9-]{72}$/.test(token))return json(403,{error:'Lien de séjour invalide.'});
  const stay=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE guest_token_hash=?').bind(await digest(token)).first();
  if(!stay)return json(404,{error:'Séjour introuvable.'});
  if(path==='/api/guest/contract.pdf' || path==='/api/guest/description.pdf') {
   if(request.method!=='GET')return json(405,{error:'Méthode interdite'});
   if(!stay.contract_html)return json(404,{error:'Contrat indisponible.'});
   const descriptive=path.endsWith('/description.pdf');
   if(descriptive&&!savedDocumentModel(stay.contract_html))return json(404,{error:'Fiche indisponible pour ce contrat archivé.'});
   const bytes=descriptive?await descriptionPdf(stay.contract_html):await contractPdf(stay.contract_html,{accepted:Boolean(stay.contract_accepted_at),acceptedAt:stay.contract_accepted_at,signer:stay.contract_signer});
   return new Response(bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+(descriptive?'fiche-descriptive-':'contrat-location-')+stay.id.slice(0,8)+'.pdf"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(path==='/api/guest/payment-status') {
   if(request.method!=='GET')return json(405,{error:'Méthode interdite'});
   return json(200,{status:stay.status,reference:stay.id.slice(0,8)});
  }

  if(path==='/api/guest/stay' && request.method==='GET' && (stay.status==='confirmed' || (stay.status==='awaiting_payment' && Date.parse(stay.payment_due_at)>Date.now())))return json(200,{status:stay.status,depositMethod:depositMethod(stay),depositSummary:depositSummary(stay),payment:stay.payment_preference,paid:Boolean(stay.paid_at),reference:stay.id.slice(0,8),arrival:stay.arrival,departure:stay.departure,totalCents:stay.total_cents,deadline:stay.payment_due_at,descriptionAvailable:Boolean(savedDocumentModel(stay.contract_html)),contractHtml:stay.contract_accepted_at&&savedDocumentModel(stay.contract_html)?renderContractModel({...savedDocumentModel(stay.contract_html),accepted:true,acceptedAt:stay.contract_accepted_at,signer:stay.contract_signer}):stay.contract_html,contractHash:stay.contract_hash,checkoutUrl:stay.checkout_url});
  if(path==='/api/guest/accept'&&request.method==='POST'&&stay.status==='awaiting_payment'&&depositMethod(stay)==='bank'&&bankAuthorizationMode(stay)==='extended'&&env.STRIPE_EXTENDED_AUTHORIZATION_ENABLED!=='true')return json(503,{error:'La garantie bancaire de ce séjour doit être activée avant sa confirmation. Contactez-nous ; aucun paiement n’est demandé.'});
  if(path==='/api/guest/accept'&&request.method==='POST'&&stay.payment_preference==='cash'&&stay.status==='confirmed')return json(200,{confirmed:true});
  if(stay.status!=='awaiting_payment' || Date.parse(stay.payment_due_at)<=Date.now())return json(410,{error:stay.payment_preference==='cash'?'Ce lien d’acceptation n’est plus disponible. Contactez-nous.':'Ce lien de paiement n’est plus disponible. Contactez-nous.'});

  if(request.method!=='POST')return json(405,{error:'Méthode interdite'});
  if(!originOK(request))return json(403,{error:'Origine interdite'});
  let data;try{data=await smallJson(request);}catch{return json(400,{error:'Acceptation invalide'});}
  if(data.accepted!==true || data.depositAccepted!==true || data.contractHash!==stay.contract_hash || typeof data.signer!=='string' || data.signer.trim()!==stay.customer_name)return json(400,{error:'Veuillez lire et accepter le contrat et le dépôt de garantie, puis saisir votre nom.'});
  if(!contractReady(env))return json(503,{error:'Paiement non activé.'});
  if(stay.payment_preference==='cash') {
   const acceptedAt=new Date().toISOString();
   await env.BERRY_DB.batch([
    env.BERRY_DB.prepare("UPDATE stays SET status='confirmed',flow_stage='cash_due',contract_accepted_at=?,contract_signer=? WHERE id=? AND status='awaiting_payment' AND payment_preference='cash' AND payment_due_at>?").bind(acceptedAt,data.signer.trim(),stay.id,acceptedAt),
    queueDecision(env.BERRY_DB,stay.id,'confirmation',acceptedAt)
   ]);
   const result=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE id=?').bind(stay.id).first();
   if(result?.status!=='confirmed')return json(410,{error:'Le délai d’acceptation a expiré. Contactez-nous.'});
   return json(200,{confirmed:true});
  }
  if(stay.checkout_url)return json(200,{url:stay.checkout_url});
  if(Date.parse(stay.payment_due_at)-Date.now()<31*60000)return json(410,{error:'Le délai de paiement touche à sa fin. Contactez-nous pour un nouveau lien.'});
  const acceptedAt=new Date().toISOString();
  await env.BERRY_DB.prepare('UPDATE stays SET contract_accepted_at=COALESCE(contract_accepted_at,?),contract_signer=COALESCE(contract_signer,?) WHERE id=?').bind(acceptedAt,data.signer.trim(),stay.id).run();
  let session;try{session=await stripe(env,'checkout/sessions',checkoutFields(stay,env.SITE_ORIGIN),'stay-'+stay.id);}catch{return json(503,{error:'Paiement momentanément indisponible. Votre acceptation est conservée.'});}
  if(!session.id || !session.url?.startsWith('https://checkout.stripe.com/'))return json(502,{error:'Réponse de paiement invalide'});
  await env.BERRY_DB.prepare("UPDATE stays SET stripe_checkout_id=?,checkout_url=?,flow_stage='payment' WHERE id=? AND status='awaiting_payment'").bind(session.id,session.url,stay.id).run();
  return json(200,{url:session.url});
 }
 if(path==='/api/stripe/webhook') {
  if(request.method!=='POST')return json(405,{error:'Méthode interdite'});
  const length=Number(request.headers.get('Content-Length'));
  if(request.headers.has('Content-Length') && (!Number.isInteger(length) || length<1 || length>1000000))return json(413,{error:'Événement trop volumineux ou taille invalide'});
  let event;try{event=await webhookEvent(await boundedText(request,1000000),request.headers.get('Stripe-Signature')||'',env.STRIPE_WEBHOOK_SECRET);}catch{return json(400,{error:'Signature invalide'});}
  if(!event.id || !stripeWebhookModeMatches(event,env))return json(400,{error:'Événement hors mode Stripe configuré'});
  if(await env.BERRY_DB.prepare('SELECT id FROM stripe_events WHERE id=?').bind(event.id).first())return json(200,{received:true});
  if(!['checkout.session.completed','checkout.session.expired'].includes(event.type))return json(200,{received:true});
  const session=event.data?.object;
  if(session?.metadata?.purpose==='deposit') {
   try{await depositEvent(session,env);return json(200,{received:true});}catch{return json(409,{error:'Empreinte à vérifier'});}
  }
  if(session?.metadata?.purpose!=='stay')return json(200,{received:true});
  return processStaySession(session,event.type,event.id,env);
 }
 return null;
}
// Stripe webhook and authenticated API reconciliation share the same checks.
export async function processStaySession(session,type,eventId,env) {
 if(!['checkout.session.completed','checkout.session.expired'].includes(type) || session?.metadata?.purpose!=='stay')return json(400,{error:'Événement de séjour invalide'});
 if(await env.BERRY_DB.prepare('SELECT id FROM stripe_events WHERE id=?').bind(eventId).first())return json(200,{received:true});
  const stay=await env.BERRY_DB.prepare('SELECT * FROM stays WHERE id=? AND stripe_checkout_id=?').bind(session.metadata.reservation_id,session.id).first();
  if(!stay)return json(409,{error:'Session non rattachée. Nouvelle tentative nécessaire.'});
  if(type==='checkout.session.completed' && (session.payment_status!=='paid' || session.amount_total!==stay.total_cents || session.currency!=='eur' || !stay.contract_accepted_at))return json(409,{error:'Paiement à vérifier'});
  if(!['awaiting_payment','confirmed'].includes(stay.status))return json(409,{error:'État du séjour à vérifier manuellement'});
  const timestamp=new Date().toISOString(),paid=type==='checkout.session.completed';
  const statements=[env.BERRY_DB.prepare('INSERT INTO stripe_events(id,processed_at) VALUES (?,?)').bind(eventId,timestamp)];
  if(paid)statements.push(env.BERRY_DB.prepare("UPDATE stays SET status='confirmed',flow_stage='paid',paid_at=COALESCE(paid_at,?),stripe_payment_intent_id=? WHERE id=?").bind(timestamp,session.payment_intent,stay.id),queueMail(env.BERRY_DB,stay.id,'confirmation',timestamp));
  else statements.push(env.BERRY_DB.prepare("UPDATE stays SET status='expired',flow_stage='expired' WHERE id=? AND status='awaiting_payment'").bind(stay.id));
  await env.BERRY_DB.batch(statements);return json(200,{received:true});
}
export {smallJson};
