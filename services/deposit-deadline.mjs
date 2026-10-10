import {boundedDeadline} from './booking-timing.mjs';
export const depositTimeoutReason='L’empreinte bancaire de 300 € prévue au contrat pour le dépôt de garantie n’a pas été validée avant l’échéance indiquée dans notre e-mail.';
export function depositDeadline(sentAt,stay){const time=Date.parse(sentAt);return Number.isFinite(time)?(stay?boundedDeadline(time,stay):new Date(time+12*3600000).toISOString()):null;}
export function depositOverdue(status,sentAt,now=Date.now(),stay){const deadline=depositDeadline(sentAt,stay);return Boolean(deadline&&now>=Date.parse(deadline)&&['requested','failed','expired','review'].includes(status));}
export async function alertOverdueDeposits(env,now=Date.now()){
 const rows=await env.BERRY_DB.prepare("SELECT s.id,s.arrival,s.early_arrival,d.status,o.sent_at FROM stays s JOIN deposits d ON d.stay_id=s.id JOIN mail_outbox o ON o.stay_id=s.id AND o.kind='deposit_link' WHERE s.status='confirmed' AND o.sent_at IS NOT NULL AND d.status IN ('requested','failed','expired','review')").all();
 for(const row of rows.results){
  if(!depositOverdue(row.status,row.sent_at,now,row))continue;
  await env.BERRY_DB.prepare("INSERT OR IGNORE INTO mail_outbox(id,stay_id,kind,created_at,payload) VALUES (?,?,'deposit_overdue',?,?)").bind(crypto.randomUUID(),row.id,new Date(now).toISOString(),JSON.stringify({deadline:depositDeadline(row.sent_at,row)})).run();
 }
}
