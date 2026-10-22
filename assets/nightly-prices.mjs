// Shared by the browser estimate and the reservation service. Amounts are cents,
// include cleaning and tourist tax, and concern the night starting on each date.
export const PRICE_VERSION='2026-10-22-seasonal';
export const SEASONAL_PRICES=[
 {start:'2026-12-23',end:'2026-12-31',fixed:7600,flex:8500,label:'Fêtes de fin d’année'},
 {start:'2026-12-31',end:'2027-01-01',fixed:9200,flex:10300,label:'Réveillon du Nouvel An'},
 {start:'2027-01-01',end:'2027-01-03',fixed:7600,flex:8500,label:'Fêtes de fin d’année'},
 {start:'2027-04-20',end:'2027-04-26',fixed:12100,flex:13500,label:'Printemps de Bourges'}
];
export function nightlyPrice(date,rate,version=PRICE_VERSION){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!['fixed','flex'].includes(rate))throw Error('Date ou tarif invalide.');
 if(version===PRICE_VERSION){const period=SEASONAL_PRICES.find(p=>date>=p.start&&date<p.end);if(period)return period[rate];}
 const weekend=[5,6].includes(new Date(date+'T12:00:00Z').getUTCDay());
 return rate==='fixed'?(weekend?7500:7000):(weekend?8400:7800);
}
