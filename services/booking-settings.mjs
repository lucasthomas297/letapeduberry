import {dateNumber,parisDay} from './calendar.mjs';
const validMinimum=n=>Number.isInteger(n)&&n>=1&&n<=60;
export function minimumForArrival(settings,arrival){return settings.min_nights_by_date?.[arrival]??settings.min_nights;}
export async function bookingSettings(env){
 const [row,rules]=await Promise.all([
  env.BERRY_DB.prepare('SELECT min_nights FROM booking_settings WHERE id=1').first(),
  env.BERRY_DB.prepare('SELECT arrival_date,min_nights FROM minimum_stay_dates ORDER BY arrival_date').all()
 ]);
 if(!validMinimum(row?.min_nights)||!Array.isArray(rules.results))throw Error('Réglage de séjour invalide');
 const dates={};for(const rule of rules.results){dateNumber(rule.arrival_date);if(!validMinimum(rule.min_nights))throw Error('Réglage de séjour invalide');dates[rule.arrival_date]=rule.min_nights;}
 return {min_nights:row.min_nights,min_nights_by_date:dates};
}
export async function saveBookingSettings(env,data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Réglage invalide.');
 if(data.dates!==undefined){
  if(!Array.isArray(data.dates)||!data.dates.length||data.dates.length>366)throw Error('Sélectionnez au moins une date, dans la limite de 366 dates.');
  if(data.min_nights!==null&&!validMinimum(data.min_nights))throw Error('Choisissez un nombre entier entre 1 et 60 nuits.');
  const today=dateNumber(parisDay()),dates=[...new Set(data.dates)];
  for(const date of dates){const value=dateNumber(date);if(value<today||value>today+365*86400000)throw Error('Choisissez des dates dans les douze prochains mois.');}
  const time=new Date().toISOString();
  await env.BERRY_DB.batch(dates.map(date=>data.min_nights===null?
   env.BERRY_DB.prepare('DELETE FROM minimum_stay_dates WHERE arrival_date=?').bind(date):
   env.BERRY_DB.prepare('INSERT INTO minimum_stay_dates(arrival_date,min_nights,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(arrival_date) DO UPDATE SET min_nights=excluded.min_nights,updated_at=excluded.updated_at,updated_by=excluded.updated_by').bind(date,data.min_nights,time,env.OWNER_EMAIL)));
 }else{
  if(!validMinimum(data.min_nights))throw Error('Choisissez un nombre entier entre 1 et 60 nuits.');
  await env.BERRY_DB.prepare('UPDATE booking_settings SET min_nights=?,updated_at=?,updated_by=? WHERE id=1').bind(data.min_nights,new Date().toISOString(),env.OWNER_EMAIL).run();
 }
 return bookingSettings(env);
}
