import {stripe} from './payment.mjs';
import {refreshDeposit} from './deposit.mjs';
function departureAt(stay){
 const hour=stay.late_departure?12:11,utc=Date.parse(stay.departure+'T00:00:00Z')+hour*3600000;
 const offset=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'}).formatToParts(new Date(utc)).find(p=>p.type==='timeZoneName').value;
 return utc-Number(offset.replace('GMT+',''))*3600000;
}
function validateClaim(data){
 if(!Number.isInteger(data.amountCents)||data.amountCents<1||data.amountCents>30000)throw Error('Indiquez un montant entre 0,01 € et 300 €.');
 for(const field of ['reason','evidence'])if(typeof data[field]!=='string'||data[field].trim().length<10||data[field].length>2000)throw Error('Précisez le dommage et les références des justificatifs (10 à 2 000 caractères).');
}
async function activeIntent(claim,env){
 const intent=await stripe(env,'payment_intents/'+claim.payment_intent_id+'?expand[]=latest_charge');
 if(intent.id!==claim.payment_intent_id||intent.currency!=='eur'||intent.amount!==30000)throw Error('Le montant ou la devise de la garantie doit être vérifié.');
 return intent;
}
function canCapture(intent,amount){
 const expiry=intent.latest_charge?.payment_method_details?.card?.capture_before;
 if(intent.status!=='requires_capture'||!Number.isFinite(expiry)||expiry*1000<=Date.now()||!Number.isInteger(intent.amount_capturable)||intent.amount_capturable<amount)throw Error('La garantie n’est plus disponible pour ce prélèvement. Vérifiez-la dans Stripe.');
}
async function complete(claim,intent,env){
 if(intent.id!==claim.payment_intent_id||intent.currency!=='eur'||intent.status!=='succeeded'||intent.amount_received!==claim.amount_cents)throw Error('Le résultat bancaire doit être vérifié avant toute nouvelle action.');
 const now=new Date().toISOString(),db=env.BERRY_DB;
 await db.batch([
  db.prepare("UPDATE damage_claims SET status='captured',captured_at=? WHERE stay_id=? AND status='capturing'").bind(now,claim.stay_id),
  db.prepare("UPDATE deposits SET status='captured',checked_at=? WHERE stay_id=? AND payment_intent_id=?").bind(now,claim.stay_id,claim.payment_intent_id),
  db.prepare("INSERT INTO mail_outbox(id,stay_id,kind,created_at,payload) VALUES (?,?,'damage_receipt',?,?) ON CONFLICT(stay_id,kind) DO NOTHING").bind(crypto.randomUUID(),claim.stay_id,now,JSON.stringify({amount:claim.amount_cents,reason:claim.reason,evidence:claim.evidence}))
 ]);
 return {status:'captured',amountCents:claim.amount_cents};
}
export async function damageAction(stay,data,env){
 if(stay.status!=='confirmed')throw Error('Le séjour doit être confirmé.');
 if(Date.now()<departureAt(stay))throw Error('La retenue se prépare après le départ et le contrôle du logement.');
 const db=env.BERRY_DB;
 let claim=await db.prepare('SELECT * FROM damage_claims WHERE stay_id=?').bind(stay.id).first();
 if(data.action==='damage-read')return {claim};
 if(data.action==='damage-prepare'){
  if(Date.now()>departureAt(stay)+48*3600000)throw Error('Le délai de contrôle de 48 heures est dépassé. Contactez le voyageur pour traiter le dommage séparément.');
  validateClaim(data);
  if(data.justified!==true)throw Error('Confirmez que les frais sont justifiés, hors usure normale.');
  if(claim)throw Error('Un dossier existe déjà. Consultez-le avant toute action.');
  const deposit=await refreshDeposit(stay,env);
  if(!deposit?.payment_intent_id||!['authorized','review'].includes(deposit.status))throw Error('Aucune garantie bancaire active.');
  canCapture(await activeIntent(deposit,env),data.amountCents);
  const now=new Date().toISOString(),payload={amount:data.amountCents,reason:data.reason.trim(),evidence:data.evidence.trim()};
  await db.batch([
   db.prepare("INSERT INTO damage_claims(stay_id,payment_intent_id,amount_cents,reason,evidence,owner_email,created_at,status) VALUES (?,?,?,?,?,?,?,'prepared')").bind(stay.id,deposit.payment_intent_id,data.amountCents,payload.reason,payload.evidence,env.OWNER_EMAIL,now),
   db.prepare("INSERT INTO mail_outbox(id,stay_id,kind,created_at,payload) VALUES (?,?,'damage_notice',?,?)").bind(crypto.randomUUID(),stay.id,now,JSON.stringify(payload))
  ]);
  return {status:'prepared',amountCents:data.amountCents};
 }
 if(!claim)throw Error('Préparez d’abord le dossier et le message au voyageur.');
 if(data.action==='damage-abandon'){
  if(data.confirmed!==true||claim.status!=='prepared')throw Error('Seul un dossier sans prélèvement engagé peut être abandonné.');
  await db.batch([
   db.prepare("UPDATE damage_claims SET status='abandoned' WHERE stay_id=? AND status='prepared'").bind(stay.id),
   db.prepare("INSERT INTO mail_outbox(id,stay_id,kind,created_at,payload) SELECT ?,?,'damage_withdrawal',?,'{}' WHERE changes()=1 ON CONFLICT(stay_id,kind) DO NOTHING").bind(crypto.randomUUID(),stay.id,new Date().toISOString())
  ]);
  return {status:'abandoned'};
 }
 if(claim.status==='abandoned')throw Error('Dossier abandonné : vous pouvez libérer la garantie.');
 if(claim.status==='captured')return {status:'captured',amountCents:claim.amount_cents};
 if(data.action==='damage-check'){
  if(claim.status!=='capturing')return {status:claim.status,amountCents:claim.amount_cents};
  const intent=await activeIntent(claim,env);
  if(intent.status==='succeeded')return complete(claim,intent,env);
  // An uncertain operation never triggers a new charge in background.
  return {status:'capturing',amountCents:claim.amount_cents};
 }
 if(data.action!=='damage-capture')throw Error('Action de retenue inconnue.');
 if(claim.status==='prepared'&&Date.now()>departureAt(stay)+48*3600000)throw Error('Le délai de contrôle de 48 heures est dépassé. Aucun nouveau prélèvement engagé.');
 if(data.confirmed!==true||data.communicated!==true||data.amountCents!==claim.amount_cents)throw Error('Confirmez le montant exact et la communication des justificatifs au voyageur.');
 const notice=await db.prepare("SELECT sent_at,provider_id FROM mail_outbox WHERE stay_id=? AND kind='damage_notice'").bind(stay.id).first();
 if(!notice?.sent_at||!notice.provider_id||notice.provider_id.startsWith('suppressed'))throw Error('Le récapitulatif doit être envoyé au voyageur avant le prélèvement.');
 const intent=await activeIntent(claim,env);
 if(claim.status==='capturing'&&intent.status==='succeeded')return complete(claim,intent,env);
 canCapture(intent,claim.amount_cents);
 if(claim.capture_started_at&&Date.now()-Date.parse(claim.capture_started_at)>23*3600000)throw Error('Cette opération est ancienne : vérifiez son résultat dans Stripe. Aucun nouveau prélèvement automatique.');
 const changed=await db.prepare("UPDATE damage_claims SET status='capturing',capture_started_at=coalesce(capture_started_at,?) WHERE stay_id=? AND status IN ('prepared','capturing')").bind(new Date().toISOString(),stay.id).run();
 if(!changed.meta?.changes)throw Error('Le dossier a changé : rechargez la page avant toute action.');
 // One immutable dossier and one stable bank key, including when a response is lost.
 const result=await stripe(env,'payment_intents/'+claim.payment_intent_id+'/capture',{amount_to_capture:String(claim.amount_cents),final_capture:'true'},'damage-'+claim.payment_intent_id);
 return complete({...claim,status:'capturing'},result,env);
}
export async function reconcileDamageClaims(env){
 const rows=await env.BERRY_DB.prepare("SELECT s.* FROM stays s JOIN damage_claims c ON c.stay_id=s.id WHERE c.status='capturing' LIMIT 20").all();
 for(const stay of rows.results)try{await damageAction(stay,{action:'damage-check'},env);}catch{/* A bank uncertainty must remain visible to the owner. */}
}
