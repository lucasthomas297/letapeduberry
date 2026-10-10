import {depositMethod} from './deposit-policy.mjs';
import {parisDay} from './calendar.mjs';
// Records money actually handed over; never initiates a bank transaction.
export async function cashDepositAction(stay,data,env,now=Date.now()){
 if(depositMethod(stay)!=='cash')throw Error('Ce séjour prévoit une garantie bancaire.');
 const db=env.BERRY_DB,row=await db.prepare('SELECT * FROM cash_deposits WHERE stay_id=?').bind(stay.id).first();
 const time=new Date(now).toISOString(),day=parisDay(new Date(now));
 const queue=(kind,payload)=>db.prepare('INSERT OR IGNORE INTO mail_outbox(id,stay_id,kind,created_at,payload) SELECT ?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),stay.id,kind,time,JSON.stringify(payload));
 if(data.action==='receive'){
  if(stay.status!=='confirmed'||!stay.contract_accepted_at||(stay.payment_preference==='card'&&!stay.paid_at))throw Error('Le séjour doit être confirmé et son contrat accepté.');
  if(data.received!==true||data.amountCents!==30000)throw Error('Confirmez avoir réellement reçu les 300 € en espèces.');
  if(row)return {ok:true,alreadyRecorded:true};
  if(day<stay.arrival||day>=stay.departure)throw Error('Le dépôt est enregistré pendant le séjour, à compter du jour d’arrivée.');
  await db.batch([db.prepare('INSERT OR IGNORE INTO cash_deposits(stay_id,amount_cents,received_at,received_by) VALUES (?,30000,?,?)').bind(stay.id,time,env.OWNER_EMAIL),queue('cash_deposit_received',{amount:30000,time})]);
  return {ok:true};
 }
 if(data.action==='return'){
  if(!row)throw Error('Aucun dépôt en espèces reçu.');
  if(row.returned_at)return {ok:true,alreadyRecorded:true};
  if(stay.status!=='cancelled'&&day<stay.departure)throw Error('La restitution est enregistrée le jour du départ ou après ; contactez le voyageur en cas de départ anticipé.');
  const amount=data.returnedCents,reason=typeof data.reason==='string'?data.reason.trim():'';
  if(data.returned!==true||data.inspected!==true||!Number.isInteger(amount)||amount<0||amount>30000)throw Error('Confirmez le contrôle du logement et le montant réellement restitué.');
  if((amount<30000&&reason.length<3)||reason.length>2000)throw Error('Précisez les dommages et leurs justificatifs pour toute retenue.');
  await db.batch([db.prepare('UPDATE cash_deposits SET returned_at=?,returned_by=?,returned_cents=?,retained_reason=? WHERE stay_id=? AND returned_at IS NULL').bind(time,env.OWNER_EMAIL,amount,reason,stay.id),queue('cash_deposit_returned',{amount,retained:30000-amount,reason,time})]);
  await db.prepare('UPDATE cancellations SET deposit_done=1 WHERE stay_id=?').bind(stay.id).run();
  return {ok:true};
 }
 throw Error('Action de dépôt invalide.');
}
