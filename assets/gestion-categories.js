export function isArchivedStay(stay,now=new Date()){
 if(['declined','cancelled','expired'].includes(stay.status))return true;
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const value=type=>parts.find(p=>p.type===type).value;
 const today=`${value('year')}-${value('month')}-${value('day')}`;
 return stay.departure<today||(stay.departure===today&&Number(value('hour'))>=(stay.late_departure?12:11));
}
