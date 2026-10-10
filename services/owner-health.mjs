import {contractReady} from './contract.mjs';
import {stripeConfigured} from './payment.mjs';

// Only call after the owner has authenticated. Never return secret values.
export async function ownerHealth(env,now=Date.now()) {
 const checks=[
  {label:'Informations du contrat',ok:contractReady({...env,CONTRACT_APPROVED:'true'})},
  {label:'Accès propriétaire',ok:Boolean(env.ACCESS_ISSUER&&env.ACCESS_AUD&&env.OWNER_EMAIL)},
  {label:'Connexion d’envoi des e-mails',ok:Boolean(env.RESEND_API_KEY&&env.CONTACT_FROM)},
  {label:'Liens des calendriers Airbnb et Booking',ok:Boolean(env.AIRBNB_ICAL&&env.BOOKING_ICAL)},
  {label:'Code d’arrivée',ok:Boolean(env.ACCESS_KEYBOX_CODE?.trim())},
  {label:'Lien privé du calendrier du site',ok:Boolean(env.CALENDAR_EXPORT_TOKEN?.length>=48)},
  {label:'Connexion Stripe pour les empreintes standards',ok:Boolean(env.STRIPE_SECRET_KEY)},
  {label:'Paiements activés',ok:Boolean(stripeConfigured(env))},
  {label:'Demandes de réservation activées',ok:env.REQUESTS_ENABLED==='true'}
 ];
 let queue=null,database=false;
 if(env.BERRY_DB)try{
  const cutoff=new Date(now-23*3600000).toISOString();
  const row=await env.BERRY_DB.prepare(`SELECT COUNT(*) AS pending, COALESCE(SUM(CASE WHEN created_at<? THEN 1 ELSE 0 END),0) AS review FROM mail_outbox WHERE sent_at IS NULL`).bind(cutoff).first();
  if(row&&Number.isSafeInteger(row.pending)&&Number.isSafeInteger(row.review)){
   database=true;queue={pending:row.pending,review:row.review};
  }
 }catch{/* Show an unavailable check, never expose database error details. */}
 checks.unshift({label:'Base des réservations accessible',ok:database});
 return {checked_at:new Date(now).toISOString(),checks,queue,
  explanation:'Ces contrôles vérifient les réglages et les messages en attente. Ils ne prouvent pas la remise d’un e-mail ni la réussite d’un paiement.'};
}
