import {dateNumber} from './calendar.mjs';
export const RULES_VERSION='2026-10-10-standard-deposit';
const DAY=86400000;
export function quoteStay(data,today) {
 const arrival=dateNumber(data.arrival),departure=dateNumber(data.departure),now=dateNumber(today);
 const nights=(departure-arrival)/DAY;
 if(arrival<now || arrival>now+365*DAY || nights<1 || nights>60)throw new Error('Dates de séjour invalides.');
 if(!['fixed','flex'].includes(data.rate) || typeof data.early!=='boolean' || typeof data.late!=='boolean')throw new Error('Tarif ou options invalides.');
 let total=0;
 for(let day=arrival;day<departure;day+=DAY) {
  const weekend=[5,6].includes(new Date(day).getUTCDay());
  total+=data.rate==='fixed'?(weekend?7500:7000):(weekend?8400:7800);
 }
 return {nights,totalCents:total+(data.early?500:0)+(data.late?500:0)};
}
export function validateStay(data,today) {
 if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('Demande invalide.');
 if(data.rulesAccepted!==true)throw new Error('Veuillez accepter le règlement intérieur.');
 if(data.insuranceAccepted!==true)throw new Error('Veuillez confirmer disposer d’une assurance couvrant votre séjour.');
 if(data.depositAccepted!==true)throw new Error('Veuillez accepter le dépôt de garantie de 300 € selon la durée du séjour.');
 if(![1,2].includes(data.guests) || !['card','cash'].includes(data.payment))throw new Error('Voyageurs ou paiement invalide.');
 const result={};
 for(const [field,max] of Object.entries({name:100,email:254,phone:40})) {
  if(typeof data[field]!=='string' || !data[field].trim() || data[field].length>max || /[\r\n]/.test(data[field]))throw new Error('Coordonnées invalides.');
 result[field]=data[field].trim();
 }
 for(const [field,max] of Object.entries({comment:2000,address:500})) {
  if(typeof data[field]!=='string' || data[field].length>max || !data[field].trim())throw new Error('Veuillez indiquer votre adresse et présenter votre séjour.');
  result[field]=data[field].trim();
 }
 if(result.name.length<2 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email) || !/^[+()\d .-]{6,40}$/.test(result.phone))throw new Error('Coordonnées invalides.');
 if(data.addressParts!==undefined){
  const parts=data.addressParts;
  if(!parts||typeof parts!=='object'||Array.isArray(parts))throw new Error('Adresse postale invalide.');
  for(const [field,max] of Object.entries({street:400,postalCode:20,city:80})){
   if(typeof parts[field]!=='string'||parts[field].trim().length<2||parts[field].length>max||/[\r\n]/.test(parts[field]))throw new Error('Veuillez compléter la rue, le code postal et la ville.');
  }
  result.address=`${parts.street.trim()}, ${parts.postalCode.trim()} ${parts.city.trim()}`;
 }
 const quote=quoteStay(data,today);
 for(const key of ['arrival','departure','rate','early','late','guests','payment'])result[key]=data[key];
 return {...result,...quote,rulesVersion:RULES_VERSION};
}
