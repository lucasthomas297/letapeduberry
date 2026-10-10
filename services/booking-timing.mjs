export function parisArrivalAt(stay){
 const utc=Date.parse(stay.arrival+'T00:00:00Z')+(stay.early_arrival?14:16)*3600000;
 const offset=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'}).formatToParts(new Date(utc)).find(p=>p.type==='timeZoneName').value.match(/^GMT\+(1|2)$/);
 if(!Number.isFinite(utc)||!offset)throw Error('Date d’arrivée invalide');
 return utc-Number(offset[1])*3600000;
}
export function boundedDeadline(start,stay){return new Date(Math.min(start+12*3600000,parisArrivalAt(stay))).toISOString();}
