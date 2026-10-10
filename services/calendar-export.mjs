import {digest} from './payment.mjs';
export async function calendarExport(request,env) {
 const path=new URL(request.url).pathname;
 if(request.method!=='GET' || !env.CALENDAR_EXPORT_TOKEN || env.CALENDAR_EXPORT_TOKEN.length<48)return new Response('Introuvable',{status:404});
 const provided=path.match(/^\/calendrier\/direct\/([a-f0-9-]+)\.ics$/)?.[1]||'';
 if(await digest(provided)!==await digest(env.CALENDAR_EXPORT_TOKEN))return new Response('Introuvable',{status:404});
 const rows=await env.BERRY_DB.prepare("SELECT id,arrival,departure FROM stays WHERE status IN ('awaiting_payment','confirmed')").all();
 if(!rows.success)throw new Error('Calendrier indisponible');
 const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//LEtapeDuBerry//Reservations//FR','CALSCALE:GREGORIAN'];
 for(const stay of rows.results)lines.push('BEGIN:VEVENT',`UID:${stay.id}@letapeduberry.fr`,`DTSTAMP:${stamp}`,`DTSTART;VALUE=DATE:${stay.arrival.replace(/-/g,'')}`,`DTEND;VALUE=DATE:${stay.departure.replace(/-/g,'')}`,'SUMMARY:Indisponible','END:VEVENT');
 lines.push('END:VCALENDAR');return new Response(lines.join('\r\n')+'\r\n',{headers:{'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'}});
}
