import {bookingSettings} from './booking-settings.mjs';
import {readCalendar,mergeRanges} from './calendar.mjs';
const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {
 async fetch(request,env) {
  const path=new URL(request.url).pathname;
  if(path!=='/api/availability')return json(404,{error:'Introuvable'});
  if(request.method!=='GET')return json(405,{error:'Méthode interdite'});
  // Both providers and direct bookings must be checked; never silently omit one.
  if(!env.BERRY_DB || !env.AIRBNB_ICAL || !env.BOOKING_ICAL)return json(503,{error:'Calendrier non configuré'});
  try {
   const [airbnb,booking,direct,settings]=await Promise.all([
    readCalendar(env.AIRBNB_ICAL),readCalendar(env.BOOKING_ICAL),
    env.BERRY_DB.prepare("SELECT arrival,departure FROM stays WHERE status IN ('awaiting_payment','confirmed')").all(),bookingSettings(env)
   ]);
   if(!direct.success)throw new Error('Base indisponible');
   return json(200,{...settings,busy:mergeRanges([...airbnb,...booking,...direct.results.map(row=>[row.arrival,row.departure])])});
  } catch {return json(503,{error:'Disponibilités momentanément indisponibles. Veuillez nous contacter.'});}
 }
};
