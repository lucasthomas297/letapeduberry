import {depositMethod,depositSummary} from './deposit-policy.mjs';
import {mailDate,guestMailText} from './mail-format.mjs';
import {stripeConfigured} from './payment.mjs';
import {boundedDeadline,parisArrivalAt} from './booking-timing.mjs';
import {alertOverdueDeposits,depositTimeoutReason} from './deposit-deadline.mjs';
import {queueGuestMessages,scheduledGuestMessage,guestMessageKinds,guestMessageWindows} from './guest-message-schedule.mjs';
import {reconcileDamageClaims} from './damage.mjs';
import {contractPdf,descriptionPdf} from './contract-pdf.mjs';
import availability from './availability-worker.mjs';
import {overlaps,parisDay} from './calendar.mjs';
import {validateStay} from './stay.mjs';
import {flowFetch} from './booking-flow.mjs';
import {contractReady,savedDocumentModel} from './contract.mjs';
import {calendarExport} from './calendar-export.mjs';
import {requestDueDeposits,reconcileDeposits} from './deposit.mjs';
import {reconcilePayments} from './payment-reconciliation.mjs';
import {reconcileCancellations} from './cancellation.mjs';
const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const ready=env=>env.REQUESTS_ENABLED==='true' && contractReady(env) && env.ACCESS_ISSUER && env.ACCESS_AUD && env.OWNER_EMAIL && stripeConfigured(env) && env.BERRY_DB && env.RESEND_API_KEY && env.CONTACT_FROM && env.SITE_ORIGIN==='https://letapeduberry.fr' && env.AIRBNB_ICAL && env.BOOKING_ICAL && env.REQUEST_RATE_LIMITER;
// Retry mail with the same provider key, without deleting or duplicating the stay.
export async function sendQueuedMail(env,{testOnly=false}={}) {
 // Provider deduplication lasts 24 h; older ambiguous sends need manual review.
 const cutoff=new Date(Date.now()-23*3600000).toISOString();
 const queue=await env.BERRY_DB.prepare(`SELECT o.id AS mail_id,o.kind,o.payload,s.* FROM mail_outbox o JOIN stays s ON s.id=o.stay_id WHERE o.sent_at IS NULL AND o.created_at>=? ORDER BY o.created_at LIMIT 20`).bind(cutoff).all();
 for(const stay of queue.results) {
  const physicalDeposit=depositMethod(stay)==='cash';
  if(physicalDeposit&&['deposit_link','deposit_overdue'].includes(stay.kind)){await env.BERRY_DB.prepare("UPDATE mail_outbox SET sent_at=?,provider_id='suppressed-cash-deposit' WHERE id=? AND sent_at IS NULL").bind(new Date().toISOString(),stay.mail_id).run();continue;}
  if(stay.status==='cancelled'&&['payment_link','confirmation','deposit_link'].includes(stay.kind)){await env.BERRY_DB.prepare("UPDATE mail_outbox SET sent_at=?,provider_id='suppressed-cancelled' WHERE id=? AND sent_at IS NULL").bind(new Date().toISOString(),stay.mail_id).run();continue;}
  if(stay.kind==='damage_notice'){const claim=await env.BERRY_DB.prepare('SELECT status FROM damage_claims WHERE stay_id=?').bind(stay.id).first();if(claim?.status==='abandoned'){await env.BERRY_DB.prepare("UPDATE mail_outbox SET sent_at=?,provider_id='suppressed-abandoned' WHERE id=? AND sent_at IS NULL").bind(new Date().toISOString(),stay.mail_id).run();continue;}}
  const owner=['owner_request','deposit_overdue'].includes(stay.kind);
  if(stay.kind==='deposit_overdue'){
   const deposit=await env.BERRY_DB.prepare('SELECT status FROM deposits WHERE stay_id=?').bind(stay.id).first();
   if(stay.status!=='confirmed'||deposit?.status==='authorized'){await env.BERRY_DB.prepare("UPDATE mail_outbox SET sent_at=?,provider_id='suppressed-resolved' WHERE id=?").bind(new Date().toISOString(),stay.mail_id).run();continue;}
  }
  const extra=JSON.parse(stay.payload||'{}');
  const dates=`Arrivée : ${mailDate(stay.arrival)}\nDépart : ${mailDate(stay.departure)}\nVoyageurs : ${stay.guests}\nTotal : ${(stay.total_cents/100).toFixed(2)} €`;
  let text=owner?`Nouvelle demande de séjour\nRéférence : ${stay.id.slice(0,8)}\n${dates}\nTarif : ${stay.rate==='fixed'?'Non remboursable':'Remboursable'}\nArrivée anticipée : ${stay.early_arrival?'oui':'non'}\nDépart tardif : ${stay.late_departure?'oui':'non'}\nDépôt de garantie : ${physicalDeposit?'300 € en espèces, rendez-vous à l’arrivée et au départ':'300 € par empreinte bancaire standard'}\nPaiement souhaité : ${stay.payment_preference==='card'?'carte':'espèces'}\nNom : ${stay.customer_name}\nE-mail : ${stay.customer_email}\nTéléphone : ${stay.customer_phone}\nCommentaire : ${stay.comment}\nAssurance déclarée : ${mailDate(stay.insurance_accepted_at,{time:true})}\nRèglement accepté : ${stay.rules_version}, le ${mailDate(stay.rules_accepted_at,{time:true})}\n\nConsulter et accepter / refuser : ${env.SITE_ORIGIN}/gestion.html#${stay.id}\nEn attente de votre validation. Aucun paiement n’a été effectué.`:
   `Bonjour ${stay.customer_name},\n\nNous avons enregistré votre demande de séjour.\nRéférence : ${stay.id.slice(0,8)}\n${dates}\n\nCette demande ne constitue pas une réservation confirmée. Aucun paiement n’a été effectué. Nous vous répondrons après vérification des disponibilités.\n\nL’Étape du Berry`;
  const subjects={cash_deposit_received:'Reçu du dépôt de garantie en espèces',cash_deposit_returned:'Restitution du dépôt de garantie en espèces',owner_request:'Nouvelle demande de séjour',guest_acknowledgement:'Votre demande de séjour',payment_link:'Votre séjour accepté — contrat et paiement',confirmation:'Votre réservation est confirmée',payment_receipt:'Reçu de votre règlement en espèces',decision:'Votre demande de séjour',deposit_link:'Votre garantie bancaire avant l’arrivée',cancellation:'Annulation de votre séjour',refund_update:'Confirmation de votre remboursement',damage_notice:'Dépôt de garantie — dommage constaté',damage_receipt:'Dépôt de garantie — retenue effectuée',damage_withdrawal:'Dépôt de garantie — retenue abandonnée'};
  if(stay.kind==='payment_link')text=`Bonjour ${stay.customer_name},\n\nVotre demande est acceptée.\n${dates}\n\nLisez et acceptez votre contrat, puis réglez votre séjour ici : ${extra.url}\nÉchéance de paiement : ${mailDate(extra.deadline,{time:true})}. Vous disposez de 12 heures maximum après acceptation de la demande, sans dépasser l’heure d’arrivée.\n${depositSummary(stay)}\n${extra.message||''}\nLa réservation définitive sera confirmée après paiement.\nL’Étape du Berry`;
  if(stay.kind==='payment_link'&&stay.payment_preference==='cash')text=`Bonjour ${stay.customer_name},\n\nVotre demande avec paiement en espèces à l’arrivée est acceptée.\n${dates}\n\nLisez la fiche descriptive et acceptez votre contrat ici : ${extra.url}\nVous disposez de 12 heures maximum pour accepter le contrat, sans dépasser l’heure d’arrivée, jusqu’à ${mailDate(extra.deadline,{time:true})}. Aucun paiement en ligne du séjour n’est demandé. La réservation sera confirmée après votre acceptation. Le montant intégral sera réglé en espèces à l’arrivée, contre reçu.\n${depositSummary(stay)}\n${extra.message||''}\nL’Étape du Berry`;
  if(stay.kind==='decision')text=`Bonjour ${stay.customer_name},\n\nNous ne pouvons pas donner suite à votre demande du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)}. Aucun paiement n’a été effectué.\n${extra.message||''}\nL’Étape du Berry`;
  if(stay.kind==='confirmation')text=`Bonjour ${stay.customer_name},\n\n${stay.payment_preference==='cash'?'Votre contrat a été accepté et votre réservation est confirmée. Le séjour reste à régler intégralement en espèces à l’arrivée, contre reçu.':'Votre paiement a été reçu et votre réservation est confirmée.'}\n${dates}\nRéférence : ${stay.id.slice(0,8)}\n\nVous trouverez votre contrat, le règlement intérieur et la fiche descriptive en pièces jointes. Votre acceptation a été enregistrée le ${mailDate(stay.contract_accepted_at,{time:true})}. Arrivée ${stay.early_arrival?'dès 14 h':'à partir de 16 h'}, départ ${stay.late_departure?'jusqu’à 12 h':'avant 11 h'}.\n${depositSummary(stay)}\nVous avez déclaré être titulaire d’une assurance responsabilité civile vie privée d’occupant d’immeuble pris en location temporaire (risque villégiature).\n\nL’Étape du Berry`;
  if(stay.kind==='payment_receipt')text=`Bonjour ${stay.customer_name},\n\nNous confirmons avoir reçu votre règlement intégral en espèces de ${(stay.total_cents/100).toFixed(2)} € pour le séjour du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)}.\nRéférence du reçu : ${stay.id}\nDate d’encaissement : ${mailDate(stay.paid_at,{time:true})}\nSolde restant dû : 0,00 €\n${depositSummary(stay)}\n\n${env.OWNER_NAME} — L’Étape du Berry\n${env.OWNER_ADDRESS}\nSIRET : ${env.OWNER_SIRET}\ncontact@letapeduberry.fr`;
  if(stay.kind==='cash_deposit_received')text=`Bonjour ${stay.customer_name},\n\nNous confirmons avoir reçu en main propre votre dépôt de garantie de 300,00 € en espèces, distinct du prix du séjour du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)}.\nRéférence : ${stay.contract_number||stay.id}\nRemis le : ${extra.time}\nIl sera restitué en main propre le jour du départ, après contrôle du logement et sous déduction des frais justifiés pour dommages.\n${env.OWNER_NAME} — L’Étape du Berry\ncontact@letapeduberry.fr`;
  if(stay.kind==='cash_deposit_returned')text=`Bonjour ${stay.customer_name},\n\nNous confirmons la restitution en main propre de ${(extra.amount/100).toFixed(2)} € en espèces sur votre dépôt de garantie de 300,00 €.\nRéférence : ${stay.contract_number||stay.id}\nRestitué le : ${extra.time}\n${extra.retained?'Retenue : '+(extra.retained/100).toFixed(2)+' €. Motif et justificatifs : '+extra.reason:'Aucune retenue.'}\n${env.OWNER_NAME} — L’Étape du Berry\ncontact@letapeduberry.fr`;
  if(stay.kind==='deposit_link'){
   const confirmation=await env.BERRY_DB.prepare("SELECT sent_at FROM mail_outbox WHERE stay_id=? AND kind='confirmation'").bind(stay.id).first();
   if(stay.status!=='confirmed'||!stay.contract_accepted_at||(stay.payment_preference==='card'&&!stay.paid_at)||!confirmation?.sent_at||Date.now()>=parisArrivalAt(stay))continue;
  }
  if(stay.kind==='deposit_link')text=`Bonjour ${stay.customer_name},\n\nAvant votre arrivée, veuillez autoriser l’empreinte bancaire de 300 € prévue au contrat : ${extra.url}\nVeuillez valider cette empreinte avant le ${new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(boundedDeadline(Date.now(),stay)))} (heure de Paris). Le délai maximal est de 12 heures après cet e-mail, limité à l’heure d’arrivée pour une réservation de dernière minute. Sans validation, les consignes d’accès et le code ne seront pas envoyés ; nous vous contacterons avant toute décision d’annulation.\nIl s’agit d’une autorisation distincte du paiement du séjour, sans débit immédiat. En cas de difficulté, contactez-nous pour réessayer ou utiliser une autre carte.\nL’Étape du Berry`;
  if(stay.kind==='deposit_overdue'){subjects.deposit_overdue='Garantie bancaire non validée à l’échéance';text=`L’échéance de validation de la garantie de 300 € est dépassée.\nVoyageur : ${stay.customer_name}\n${dates}\n\nLe code d’accès reste bloqué. Aucune annulation automatique n’a été faite. Contactez le voyageur pour distinguer une difficulté bancaire d’un refus.\nConsulter le séjour et décider : ${env.SITE_ORIGIN}/gestion.html#${stay.id}`; }
  if(stay.kind==='cancellation')text=`Bonjour ${stay.customer_name},\n\nVotre séjour du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)} est annulé.\nMotif : ${extra.reason}\n${extra.refundCents>0?'Montant à rembourser : '+(extra.refundCents/100).toFixed(2)+' €. '+(stay.payment_preference==='cash'?'Le loueur vous contactera pour le remboursement du règlement en espèces.':'Le remboursement sera traité sur la carte utilisée pour le paiement ; son affichage dépend de votre banque.'):'Aucun remboursement n’est à effectuer.'}\n${extra.retainedCents>0?'Montant conservé selon le contrat : '+(extra.retainedCents/100).toFixed(2)+' €.':''}\n${extra.owedCents>0?'Montant restant dû selon le contrat : '+(extra.owedCents/100).toFixed(2)+' €. Contactez-nous pour faire le point ; aucun prélèvement automatique ne sera effectué.':''}\n${physicalDeposit?'Le dépôt en espèces est distinct du règlement ; s’il a déjà été remis, contactez-nous pour sa restitution en main propre.':'La garantie bancaire est distincte du règlement et, si elle est encore active, sa libération sera traitée séparément.'}\nVous pouvez répondre à cet e-mail pour toute question.\nL’Étape du Berry`;
  if(stay.kind==='cancellation'&&extra.reason===depositTimeoutReason)text=`Bonjour ${stay.customer_name},\n\n${depositTimeoutReason}\n\nNous vous confirmons donc l’annulation de votre réservation du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)}. Les accès au logement ne seront pas transmis.\n\n${extra.refundCents>0?'Montant à rembourser : '+(extra.refundCents/100).toFixed(2)+' €. Le traitement vous sera confirmé séparément.':'Aucun remboursement n’est à effectuer.'}\n${extra.retainedCents>0?'Montant conservé selon le contrat : '+(extra.retainedCents/100).toFixed(2)+' €.':''}\n${extra.owedCents>0?'Montant restant dû selon le contrat : '+(extra.owedCents/100).toFixed(2)+' €. Aucun prélèvement automatique ne sera effectué.':''}\n\nVous pouvez répondre à cet e-mail pour toute question.\n\nBien cordialement,\nL’Étape du Berry`;
  if(stay.kind==='damage_notice')text=`Bonjour ${stay.customer_name},\n\nÀ la suite du contrôle de votre séjour du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)}, un dommage a été constaté : ${extra.reason}\nJustificatifs : ${extra.evidence}\nMontant de la retenue envisagée : ${(extra.amount/100).toFixed(2)} €, sur le dépôt de garantie de 300 €. Aucun prélèvement n’est confirmé par ce message. Vous pouvez répondre à cet e-mail pour obtenir les pièces justificatives et nous faire part de vos observations.\nL’Étape du Berry`;
  if(stay.kind==='damage_withdrawal')text=`Bonjour ${stay.customer_name},\n\nLa retenue envisagée pour votre séjour du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)} est abandonnée. Aucun prélèvement de ce dossier n’a été engagé. La libération de votre garantie sera traitée séparément.\nL’Étape du Berry`;
  if(stay.kind==='damage_receipt')text=`Bonjour ${stay.customer_name},\n\nUne retenue de ${(extra.amount/100).toFixed(2)} € a été effectuée sur votre garantie bancaire pour le séjour du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)}.\nMotif : ${extra.reason}\nJustificatifs : ${extra.evidence}\nLe solde non prélevé de la garantie est libéré ; son affichage dépend de votre banque. Vous pouvez répondre à cet e-mail pour toute question.\nL’Étape du Berry`;
  if(stay.kind==='refund_update')text=`Bonjour ${stay.customer_name},\n\nNous confirmons le traitement de votre remboursement de ${(extra.amount/100).toFixed(2)} € pour le séjour annulé du ${mailDate(stay.arrival)} au ${mailDate(stay.departure)}.\n${stay.payment_preference==='cash'?'Le remboursement du règlement en espèces a été enregistré par le loueur.':'Le remboursement a été effectué sur la carte utilisée pour le paiement. Le délai d’affichage dépend de votre banque.'}\nL’Étape du Berry`;
  if(guestMessageKinds.includes(stay.kind)){
   if(env.GUEST_MESSAGES_ENABLED!=='true')continue;
   const window=guestMessageWindows(stay).find(w=>w.kind===stay.kind);
   if(stay.status!=='confirmed'||Date.now()>=window.until){
    await env.BERRY_DB.prepare("UPDATE mail_outbox SET sent_at=?,provider_id='suppressed-stale' WHERE id=? AND sent_at IS NULL").bind(new Date().toISOString(),stay.mail_id).run();continue;
   }
   try{
    const confirmation=await env.BERRY_DB.prepare("SELECT sent_at FROM mail_outbox WHERE stay_id=? AND kind='confirmation'").bind(stay.id).first();
    if(!confirmation?.sent_at)continue;
    const deposit=await env.BERRY_DB.prepare('SELECT * FROM deposits WHERE stay_id=?').bind(stay.id).first();
    const message=scheduledGuestMessage(stay,stay.kind,env,deposit);text=message.text;subjects[stay.kind]=message.subject;
   }catch{continue;}
  }
  try {
   const receipt=stay.contract_html+'\n<!-- Trace technique d’acceptation conservée séparément : '+stay.contract_accepted_at+' ; hash '+stay.contract_hash+' -->';
   let attachments;
   if(stay.kind==='confirmation'&&stay.contract_html){
    const encode=bytes=>btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));
    attachments=[{filename:'contrat-location.pdf',content:encode(await contractPdf(receipt,{accepted:Boolean(stay.contract_accepted_at),acceptedAt:stay.contract_accepted_at,signer:stay.contract_signer}))}];
    if(savedDocumentModel(stay.contract_html))attachments.push({filename:'fiche-descriptive.pdf',content:encode(await descriptionPdf(stay.contract_html))});
   }
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`berry-${stay.mail_id}`},body:JSON.stringify({from:env.CONTACT_FROM,to:[owner?'contact@letapeduberry.fr':stay.customer_email],reply_to:owner?stay.customer_email:'contact@letapeduberry.fr',subject:(testOnly?'TEST — ':'')+(stay.kind==='payment_link'&&stay.payment_preference==='cash'?'Votre séjour accepté — contrat à confirmer':subjects[stay.kind]||'Votre séjour')+' — L’Étape du Berry',text:(testOnly?'ESSAI TECHNIQUE : aucune réservation ni aucun paiement réel. Les dates et le voyageur ci-dessous sont fictifs.\n\n':'')+(owner?text:guestMailText(text)),attachments}),signal:AbortSignal.timeout(12000)});
   const result=await response.json();
   if(response.ok && result.id)await env.BERRY_DB.prepare('UPDATE mail_outbox SET sent_at=?,provider_id=? WHERE id=? AND sent_at IS NULL').bind(new Date().toISOString(),result.id,stay.mail_id).run();
  } catch { /* Keep the queue entry; retry without exposing personal data in logs. */ }
 }
}
export default {
 async scheduled(controller,env,ctx) {if(ready(env))ctx.waitUntil((async()=>{
  await reconcilePayments(env);
  await reconcileDeposits(env);
 await reconcileDamageClaims(env);
  await reconcileCancellations(env);
  await env.BERRY_DB.prepare("UPDATE stays SET status='expired',flow_stage='expired' WHERE status='awaiting_payment' AND stripe_checkout_id IS NULL AND payment_due_at<=?").bind(new Date().toISOString()).run();
  await sendQueuedMail(env);
  await requestDueDeposits(env);
  await sendQueuedMail(env);
  await alertOverdueDeposits(env);
  await queueGuestMessages(env);
  await sendQueuedMail(env);
 })());},
 async fetch(request,env,ctx) {
  const url=new URL(request.url);
  if(url.pathname.startsWith('/calendrier/direct/')) {
   try{return await calendarExport(request,env);}catch{return new Response('Calendrier indisponible',{status:503});}
  }
  if(url.pathname.startsWith('/api/admin/') || url.pathname.startsWith('/api/guest/') || url.pathname==='/api/stripe/webhook') {
   if(!env.BERRY_DB)return json(503,{error:'Service non configuré'});
   try{const response=await flowFetch(request,env)||json(404,{error:'Introuvable'});if(response.ok && request.method==='POST' && url.pathname!=='/api/admin/mail-test' && (url.pathname.startsWith('/api/admin/') || url.pathname==='/api/stripe/webhook'||url.pathname==='/api/guest/accept'))ctx.waitUntil((async()=>{await sendQueuedMail(env);await requestDueDeposits(env);await sendQueuedMail(env);await queueGuestMessages(env);await sendQueuedMail(env);})());return response;}catch{return json(503,{error:'Service momentanément indisponible'});}
  }
  if(url.pathname==='/api/availability')return availability.fetch(request,env);
  if(url.pathname==='/api/status')return request.method==='GET'?json(200,{requests_ready:Boolean(ready(env))}):json(405,{error:'Méthode interdite'});
  if(url.pathname!=='/api/request')return json(404,{error:'Introuvable'});
  if(request.method!=='POST')return json(405,{error:'Méthode interdite'});
  if(request.headers.get('Origin')!==url.origin)return json(403,{error:'Origine interdite'});
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json(415,{error:'Format invalide'});
  if(!ready(env))return json(503,{error:'Les demandes de réservation ne sont pas encore activées.'});
  const key=request.headers.get('Idempotency-Key');
  if(!key || !/^[a-f0-9-]{36}$/.test(key))return json(400,{error:'Identifiant de demande invalide.'});
  try {
   if(!(await env.REQUEST_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'})).success)return json(429,{error:'Trop de tentatives. Réessayez dans une minute.'});
   const reader=request.body?.getReader();if(!reader)return json(400,{error:'Demande manquante.'});
   let size=0;const chunks=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return json(413,{error:'Demande trop volumineuse.'});}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   let details;
   try{details=validateStay(JSON.parse(new TextDecoder().decode(bytes)),parisDay());}catch(error){return json(400,{error:error.message});}
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(details))))).map(b=>b.toString(16).padStart(2,'0')).join('');
   const existing=await env.BERRY_DB.prepare('SELECT id,payload_hash FROM stays WHERE request_key=?').bind(key).first();
   if(existing)return existing.payload_hash===hash?json(200,{reference:existing.id.slice(0,8)}):json(409,{error:'La demande a changé. Veuillez recommencer.'});
   const calendar=await availability.fetch(new Request(url.origin+'/api/availability'),env);
   if(!calendar.ok)return calendar;
   if(overlaps(details.arrival,details.departure,(await calendar.json()).busy))return json(409,{error:'Ces dates ne sont plus disponibles.'});
   const id=crypto.randomUUID(),timestamp=new Date().toISOString();
   await env.BERRY_DB.batch([
    env.BERRY_DB.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at,comment,customer_address,insurance_accepted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,key,hash,details.arrival,details.departure,details.name,details.email,details.phone,details.guests,details.rate,Number(details.early),Number(details.late),details.totalCents,details.payment,details.rulesVersion,timestamp,timestamp,details.comment,details.address,timestamp),
    ...['owner_request','guest_acknowledgement'].map(kind=>env.BERRY_DB.prepare('INSERT INTO mail_outbox(id,stay_id,kind,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),id,kind,timestamp))
   ]);
   ctx.waitUntil(sendQueuedMail(env));
   return json(201,{reference:id.slice(0,8)});
  } catch {return json(503,{error:'Service momentanément indisponible. Veuillez réessayer.'});}
 }
};
