import {arrivalMessage,departureReminderMessage,thankYouMessage} from './stay-messages.mjs';
import {parisDay} from './calendar.mjs';
function parisHour(day,hour){
 const utc=Date.parse(day+'T00:00:00Z')+hour*3600000;
 const zone=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'}).formatToParts(new Date(utc)).find(p=>p.type==='timeZoneName').value;
 const offset=zone.match(/^GMT\+(1|2)$/);if(!offset)throw Error('Fuseau horaire invalide');
 return utc-Number(offset[1])*3600000;
}
export function guestMessageWindows(stay){
 const arrival=parisHour(stay.arrival,stay.early_arrival?14:16);
 const previous=new Date(Date.parse(stay.departure+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 return [
  {kind:'arrival_instructions',due:arrival-86400000,until:parisHour(stay.arrival,23)},
  {kind:'departure_reminder',due:parisHour(previous,20),until:parisHour(stay.departure,stay.late_departure?12:11)},
  {kind:'stay_thanks',due:parisHour(stay.departure,18),until:parisHour(stay.departure,18)+86400000}
 ];
}
export function scheduledGuestMessage(stay,kind,env,deposit){
 if(kind==='arrival_instructions')return arrivalMessage(stay,env,deposit);
 if(kind==='departure_reminder')return departureReminderMessage(stay);
 if(kind==='stay_thanks')return thankYouMessage(stay);
 throw Error('Message inconnu');
}
export const guestMessageKinds=['arrival_instructions','departure_reminder','stay_thanks'];
export async function queueGuestMessages(env,now=Date.now()){
 if(env.GUEST_MESSAGES_ENABLED!=='true')return;
 const rows=await env.BERRY_DB.prepare("SELECT * FROM stays WHERE status='confirmed' AND departure>=? ORDER BY arrival").bind(parisDay(new Date(now-86400000))).all();
 for(const stay of rows.results){
  const confirmation=await env.BERRY_DB.prepare("SELECT sent_at FROM mail_outbox WHERE stay_id=? AND kind='confirmation'").bind(stay.id).first();
  if(!confirmation?.sent_at)continue;
  const deposit=await env.BERRY_DB.prepare('SELECT * FROM deposits WHERE stay_id=?').bind(stay.id).first();
  for(const window of guestMessageWindows(stay)){
   if(now<window.due||now>=window.until)continue;
   try{scheduledGuestMessage(stay,window.kind,env,deposit);}catch{continue;}
   await env.BERRY_DB.prepare('INSERT OR IGNORE INTO mail_outbox(id,stay_id,kind,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(),stay.id,window.kind,new Date(now).toISOString()).run();
  }
 }
}
