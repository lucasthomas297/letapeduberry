import {renderContract} from './contract.mjs';

// Uses the normal PDF/mail renderer, with an isolated in-memory queue only.
// No production stay, calendar entry, payment or database write is created.
export async function sendDeliveryTest(env,sendQueuedMail) {
 const now=new Date().toISOString();
 const stay={id:'TEST-LIVRAISON',contract_number:'TEST-LIVRAISON',arrival:'2026-11-16',departure:'2026-11-20',guests:2,rate:'fixed',total_cents:28000,payment_preference:'card',customer_name:'Voyageur de démonstration',customer_address:'Adresse fictive pour cet essai',customer_email:'contact@letapeduberry.fr',customer_phone:'',status:'confirmed',insurance_accepted_at:now,contract_accepted_at:now,contract_signer:'Voyageur de démonstration',kind:'confirmation',mail_id:'delivery-check-4-nights-'+now.slice(0,10),payload:'{}'};
 stay.contract_html=renderContract(stay,env);
 let providerId=null;
 const isolatedDB={prepare(sql){
  if(sql.startsWith('SELECT o.id'))return {bind:()=>({all:async()=>({results:[stay]})})};
  if(sql.startsWith('UPDATE mail_outbox SET sent_at=?,provider_id=?'))return {bind:(_time,id)=>({run:async()=>{providerId=id;}})};
  throw new Error('Unexpected test database operation');
 }};
 await sendQueuedMail({...env,BERRY_DB:isolatedDB},{testOnly:true});
 return {accepted:Boolean(providerId),recipient:'contact@letapeduberry.fr'};
}

export function deliveryTestPage(sent=false) {
 return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Essai de réception — L’Étape du Berry</title><body style="max-width:650px;margin:60px auto;padding:24px;font:18px/1.6 Arial;color:#293a33"><h1>Essai de réception — séjour de 4 nuits</h1>${sent?'<p>Le service d’envoi a accepté le message TEST à destination de contact@letapeduberry.fr. Vérifiez la boîte de réception et les indésirables : contrat et fiche descriptive PDF sont joints.</p>':'<p>Envoyer un exemple de confirmation pour 4 nuits (du 16 au 20 novembre 2026, 280 €), avec caution de 300 € en espèces, et ses deux PDF à contact@letapeduberry.fr. Aucune réservation ni aucun paiement réel ne sera créé. Un seul exemplaire est envoyé par jour, même en cas de clic répété.</p><form method="post"><button style="padding:16px;background:#293a33;color:white;border:0;border-radius:8px;font:inherit">Envoyer l’e-mail TEST avec les deux PDF</button></form>'}<p><a href="/gestion">Retour à la gestion</a></p></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
}
