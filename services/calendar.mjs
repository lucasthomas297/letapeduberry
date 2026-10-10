// Occupied nights use [arrival, departure): a departure day may be booked again.
const DAY = 86400000;
export function parisDay(instant=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
 return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
}
export function dateNumber(value) {
 if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Date invalide');
 const number = Date.parse(value+'T00:00:00Z');
 if(!Number.isFinite(number) || new Date(number).toISOString().slice(0,10)!==value) throw new Error('Date invalide');
 return number;
}
const iso = number => new Date(number).toISOString().slice(0,10);
export function mergeRanges(ranges) {
 const result=[];
 for(const [start,end] of [...ranges].sort((a,b)=>a[0].localeCompare(b[0]))) {
  if(dateNumber(end)<=dateNumber(start)) throw new Error('Période invalide');
  const last=result.at(-1);
  if(last && start<=last[1]) last[1]=end>last[1]?end:last[1];
  else result.push([start,end]);
 }
 return result;
}
export const overlaps = (arrival,departure,busy) => busy.some(([start,end])=>arrival<end && start<departure);
function eventDate(key,value) {
 if(/^\d{8}$/.test(value)) {
  const result=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  dateNumber(result); return result;
 }
 // Reject unsupported timezone semantics rather than advertise false availability.
 if(!/^\d{8}T\d{6}Z?$/.test(value)) throw new Error('Date iCal invalide');
 const tzid=key.match(/;TZID=([^;:]+)/)?.[1];
 if(tzid && tzid!=='Europe/Paris') throw new Error('Fuseau iCal non pris en charge');
 const day=`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
 dateNumber(day);
 const hour=Number(value.slice(9,11)), minute=Number(value.slice(11,13)), second=Number(value.slice(13,15));
 if(hour>23 || minute>59 || second>59) throw new Error('Heure iCal invalide');
 if(!value.endsWith('Z')) return day;
 const instant=new Date(`${day}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}Z`);
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
 const get=type=>parts.find(part=>part.type===type).value;
 return `${get('year')}-${get('month')}-${get('day')}`;
}
export function parseBusyIcal(content) {
 if(typeof content!=='string' || !content.includes('BEGIN:VCALENDAR') || !content.includes('END:VCALENDAR')) throw new Error('Calendrier invalide');
 const lines=content.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\n[ \t]/g,'').split('\n');
 const ranges=[];let current=null;
 for(const line of lines) {
  if(line==='BEGIN:VEVENT') {if(current) throw new Error('Événement invalide');current={};}
  else if(line==='END:VEVENT') {
   if(!current) throw new Error('Événement invalide');
   if(current.STATUS?.[1]!=='CANCELLED' && current.TRANSP?.[1]!=='TRANSPARENT') {
    if(current.RRULE || current.RDATE || current.EXDATE || current['RECURRENCE-ID']) throw new Error('Récurrence à vérifier');
    if(!current.DTSTART || current.DURATION) throw new Error('Événement non pris en charge');
    const start=eventDate(...current.DTSTART);
    const end=current.DTEND?eventDate(...current.DTEND):iso(dateNumber(start)+DAY);
    if(end<=start) throw new Error('Période iCal invalide');
    ranges.push([start,end]);
   }
   current=null;
  } else if(current && line.includes(':')) {
   const separator=line.indexOf(':'),key=line.slice(0,separator),name=key.split(';')[0].toUpperCase();
   if(current[name] && ['DTSTART','DTEND'].includes(name)) throw new Error('Date iCal dupliquée');
   current[name]=[key,line.slice(separator+1)];
  }
 }
 if(current) throw new Error('Calendrier incomplet');
 return mergeRanges(ranges);
}
export async function readCalendar(url,fetcher=fetch) {
 if(!url || new URL(url).protocol!=='https:') throw new Error('Calendrier non configuré');
 const response=await fetcher(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'text/calendar'}});
 if(!response.ok) throw new Error('Calendrier indisponible');
 const reader=response.body.getReader();let size=0;const chunks=[];
 while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;
  if(size>2000000){await reader.cancel();throw new Error('Calendrier trop volumineux');}chunks.push(value);
 }
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return parseBusyIcal(new TextDecoder().decode(bytes));
}
