import {alertOverdueDeposits} from './deposit-deadline.mjs';
import {queueGuestMessages,guestMessageWindows,scheduledGuestMessage} from './guest-message-schedule.mjs';
import {reconcileDamageClaims} from './damage.mjs';
// Deliberately separate from the deployed Worker. Loopback-only, isolated SQLite,
// intercepted mail and calendars, real Stripe TEST Checkout when configured.
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,existsSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import worker,{sendQueuedMail} from './request-worker.mjs';
import {processStaySession} from './booking-flow.mjs';
import {stripe} from './payment.mjs';
import {requestDueDeposits,reconcileDeposits} from './deposit.mjs';
import {reconcileCancellations} from './cancellation.mjs';
import {escapeHtml as e,savedDocumentModel,renderContractModel} from './contract.mjs';
import {digest} from './payment.mjs';
import {readCalendar} from './calendar.mjs';

const root=resolve(new URL('..',import.meta.url).pathname),port=Number(process.env.BERRY_PREVIEW_PORT||8773);
const namespace=process.env.BERRY_PREVIEW_NAME||'';
if(![8773,8774].includes(port)||!/^([a-z0-9-]{1,40})?$/.test(namespace))throw new Error('Configuration locale invalide.');
const suffix=namespace?`-${namespace}`:'';
const local=`http://127.0.0.1:${port}`,virtual='https://letapeduberry.fr';
const privateDir=resolve(root,'work/private');mkdirSync(privateDir,{recursive:true,mode:0o700});
const file=resolve(privateDir,`local-booking-preview${suffix}.sqlite`);
const fresh=!existsSync(file),db=new DatabaseSync(file);chmodSync(file,0o600);db.exec('PRAGMA foreign_keys=ON');
if(fresh)for(const name of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql'])db.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
if(!db.prepare('PRAGMA table_info(stays)').all().some(column=>column.name==='cash_received_by'))db.exec(readFileSync(new URL('./migrations/0004_cash_receipts.sql',import.meta.url),'utf8'));
if(!db.prepare('PRAGMA table_info(stays)').all().some(column=>column.name==='contract_number')){
 db.exec(readFileSync(new URL('./migrations/0005_contract_numbers.sql',import.meta.url),'utf8'));
 // These are fictitious local stays only; update their snapshots together with the hash.
 for(const stay of db.prepare('SELECT id,contract_number,contract_html FROM stays WHERE contract_html IS NOT NULL').all()){
  const model=savedDocumentModel(stay.contract_html);if(!model)continue;
  const html=renderContractModel({...model,number:stay.contract_number});
  db.prepare('UPDATE stays SET contract_html=?,contract_hash=? WHERE id=?').run(html,await digest(html),stay.id);
 }
}
if(!db.prepare('PRAGMA table_info(deposits)').all().some(column=>column.name==='attempt'))db.exec(readFileSync(new URL('./migrations/0006_deposit_lifecycle.sql',import.meta.url),'utf8'));
if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cancellations'").get())db.exec(readFileSync(new URL('./migrations/0007_cancellations.sql',import.meta.url),'utf8'));
// Refresh the unpublished local test schema when the new cancellation choices evolve.
if(!db.prepare("SELECT sql FROM sqlite_master WHERE name='cancellations'").get().sql.includes('guarantee_refusal')){
 db.exec('ALTER TABLE cancellations RENAME TO cancellations_local_previous');
 db.exec(readFileSync(new URL('./migrations/0007_cancellations.sql',import.meta.url),'utf8').split('ALTER TABLE mail_outbox')[0]);
 db.exec('INSERT INTO cancellations SELECT * FROM cancellations_local_previous');
 db.exec('DROP TABLE cancellations_local_previous');
}
if(!db.prepare("SELECT name FROM sqlite_master WHERE name='damage_claims'").get())db.exec(readFileSync(new URL('./migrations/0008_damage_claims.sql',import.meta.url),'utf8'));
if(!db.prepare("SELECT sql FROM sqlite_master WHERE name='mail_outbox'").get().sql.includes('arrival_instructions'))db.exec(readFileSync(new URL('./migrations/0009_guest_messages.sql',import.meta.url),'utf8'));
if(!db.prepare("SELECT sql FROM sqlite_master WHERE name='mail_outbox'").get().sql.includes('deposit_overdue'))db.exec(readFileSync(new URL('./migrations/0010_deposit_deadline.sql',import.meta.url),'utf8'));
db.exec('CREATE TABLE IF NOT EXISTS local_mail(id TEXT PRIMARY KEY,body TEXT NOT NULL,created_at TEXT NOT NULL)');
function prepare(sql,args=[]) {return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({success:true,results:db.prepare(sql).all(...args)}),run:async()=>({success:true,meta:db.prepare(sql).run(...args)})};}
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='local-preview';
const issuer='https://local-preview.cloudflareaccess.com';
const owner=JSON.parse(readFileSync(resolve(privateDir,'reservation-owner.json'),'utf8'));
const secret=readFileSync(resolve(privateDir,'stripe-test-key.txt'),'utf8').trim();
if(!secret.startsWith('sk_test_'))throw new Error('Une clé Stripe de test est requise.');
if(!db.prepare("SELECT name FROM sqlite_master WHERE name='cash_deposits'").get())db.exec(readFileSync(new URL('./migrations/0011_cash_deposits.sql',import.meta.url),'utf8'));
if(!db.prepare("SELECT name FROM sqlite_master WHERE name='queue_owner_confirmation'").get())db.exec(readFileSync(new URL('./migrations/0014_owner_confirmation.sql',import.meta.url),'utf8'));
if(!db.prepare("SELECT name FROM sqlite_master WHERE name='booking_settings'").get())db.exec(readFileSync(new URL('./migrations/0015_booking_settings.sql',import.meta.url),'utf8'));
const env={...owner,CONTRACT_APPROVED:'true',INTERMEDIARY_TERMS:'Réservation directe sans intermédiaire — simulation locale',REQUESTS_ENABLED:'true',
 GUEST_MESSAGES_ENABLED:'true',ACCESS_KEYBOX_CODE:'CODE D’EXEMPLE',SITE_ORIGIN:virtual,CONTACT_FROM:'L’Étape du Berry <site@messages.letapeduberry.fr>',RESEND_API_KEY:'local-mail-only',
 STRIPE_SECRET_KEY:secret,ACCESS_ISSUER:issuer,ACCESS_AUD:'local-preview',OWNER_EMAIL:'owner@example.test',
 AIRBNB_ICAL:'https://local-calendar.invalid/airbnb',BOOKING_ICAL:'https://local-calendar.invalid/booking',
 REQUEST_RATE_LIMITER:{limit:async()=>({success:true})},
 BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}}};
const realCalendars=process.env.BERRY_REAL_CALENDARS==='true';
const exportTokenFile=resolve(privateDir,`local-calendar-export-token${suffix}.txt`);
if(!existsSync(exportTokenFile))writeFileSync(exportTokenFile,crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),{mode:0o600});
env.CALENDAR_EXPORT_TOKEN=readFileSync(exportTokenFile,'utf8').trim();
const calendarSources=realCalendars?JSON.parse(readFileSync(resolve(privateDir,'calendar-sources.json'),'utf8')):null;
if(realCalendars){env.AIRBNB_ICAL=calendarSources.AIRBNB_ICAL;env.BOOKING_ICAL=calendarSources.BOOKING_ICAL;}
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.origin===issuer)return Response.json({keys:[jwk]});
 if(realCalendars&&Object.values(calendarSources).includes(url.href))return nativeFetch(input,options);
 if(url.hostname==='local-calendar.invalid')return new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR');
 if(url.origin==='https://api.resend.com') {
  const id=options.headers['Idempotency-Key'];
  db.prepare('INSERT OR IGNORE INTO local_mail VALUES(?,?,?)').run(id,options.body,new Date().toISOString());
  return Response.json({id:'local-'+id});
 }
 if(url.origin!=='https://api.stripe.com')throw new Error('Destination externe interdite dans cet essai.');
 if(!String(options.headers?.Authorization).startsWith('Bearer sk_test_'))throw new Error('Mode test uniquement.');
 if(url.pathname==='/v1/checkout/sessions' && options.method==='POST') {
  const fields=new URLSearchParams(options.body);
  for(const key of ['success_url','cancel_url'])fields.set(key,fields.get(key).replace(virtual,local));
  fields.set('line_items[0][price_data][product_data][name]','ESSAI LOCAL — '+fields.get('line_items[0][price_data][product_data][name]'));
  options={...options,body:fields};
 }
 return nativeFetch(input,options);
};
async function adminToken(){const b=value=>Buffer.from(JSON.stringify(value)).toString('base64url');const content=b({alg:'RS256',kid:jwk.kid})+'.'+b({iss:issuer,aud:['local-preview'],email:env.OWNER_EMAIL,exp:Math.floor(Date.now()/1000)+60});return content+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(content))).toString('base64url');}
const banner=`<aside style="background:#eae1cd;color:#27362f;padding:12px 24px;font:14px system-ui;position:relative;z-index:10000">ESSAI LOCAL · Paiements fictifs · Contrat en projet · ${realCalendars?'Calendriers Airbnb et Booking réels (lecture seule)':'Calendriers simulés'} · <a href="/essai-calendriers.html">Disponibilités</a> · <a href="/essai.html">Messages de l’essai</a> · <a href="/gestion.html">Espace propriétaire</a></aside>`;
function page(content){return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Essai local — L’Étape du Berry</title><link rel="stylesheet" href="/assets/reservation.css?v=local"><body>${banner}<main>${content}</main></body></html>`;}
function inbox(){const rows=db.prepare("SELECT m.*,s.customer_name FROM local_mail m LEFT JOIN mail_outbox o ON m.id='berry-'||o.id LEFT JOIN stays s ON s.id=o.stay_id ORDER BY m.created_at DESC").all();return page(`<h1>Messages de votre essai</h1><p><a class="button secondary" href="/essai-messages.html">Voir les trois messages automatiques</a></p><p>Ils sont conservés ici : aucun e-mail n’est envoyé. Utilisez des coordonnées fictives. ${realCalendars?'Les disponibilités Airbnb et Booking sont lues sur les plateformes.':'Les dates Airbnb et Booking sont simulées libres.'} Les séjours de cet essai bloquent aussi leurs dates, uniquement ici.</p><p><a class="button" href="/index.html#demande">Commencer comme un voyageur</a><a class="button secondary" href="/gestion.html">Accepter ou refuser la demande</a></p><p>Après acceptation, ouvrez ci-dessous le message contenant le contrat et le paiement. Carte de test : <strong>4242 4242 4242 4242</strong>, date future, trois chiffres pour le code.</p>${rows.map(row=>{const mail=JSON.parse(row.body);return `<article><div class="mail-metadata"><strong>${e(row.customer_name||'Voyageur')}</strong><time datetime="${e(row.created_at)}"><span>${e(new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'Europe/Paris'}).format(new Date(row.created_at)))}</span><span>${e(new Intl.DateTimeFormat('fr-FR',{timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(row.created_at)))}</span></time></div><h2>${e(mail.subject)}</h2><a class="button secondary" href="/essai-mail/${encodeURIComponent(row.id)}">Lire ce message</a></article>`;}).join('')||'<p>Aucun message pour le moment.</p>'}`);}
function previewStayMessages(url){
 const cash=url.searchParams.get('payment')==='cash',early=url.searchParams.get('early')==='1',late=url.searchParams.get('late')==='1';
 const long=url.searchParams.get('long')==='1';
 const sample={status:'confirmed',customer_name:'Camille Martin',customer_first_name:'Camille',arrival:'2026-10-20',departure:url.searchParams.get('long')==='1'?'2026-10-24':'2026-10-23',contract_accepted_at:'simulation',payment_preference:cash?'cash':'card',paid_at:cash?null:'simulation',early_arrival:Number(early),late_departure:Number(late)};
 const windows=guestMessageWindows(sample),config={ACCESS_KEYBOX_CODE:'CODE D’EXEMPLE',OWNER_PHONE:'06 95 37 10 67'};
 const date=time=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'full',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(time));
 return page(`<h1>Les messages automatiques du séjour</h1><p>Exemple pour Camille, du 20 octobre au ${long?'24 octobre':'23 octobre'} 2026. Aucun message n’est envoyé et le code d’accès ci-dessous est fictif.</p><form method="get"><label>Mode de paiement <select name="payment"><option value="card" ${cash?'':'selected'}>Carte bancaire</option><option value="cash" ${cash?'selected':''}>Espèces</option></select></label><label><input type="checkbox" name="early" value="1" ${early?'checked':''}> Arrivée anticipée à 14 h</label><label><input type="checkbox" name="late" value="1" ${late?'checked':''}> Départ tardif à midi</label><label><input type="checkbox" name="long" value="1" ${long?'checked':''}> Séjour de 4 nuits · dépôt en espèces</label><button class="button">Actualiser l’exemple</button></form><p>${long?'Le dépôt en espèces sera remis lors du rendez-vous le jour de l’arrivée. L’accès autonome reste possible après confirmation du séjour.':'Les consignes d’arrivée sont envoyées après validation de la garantie bancaire et du paiement par carte, le cas échéant.'}</p>${windows.map((window,index)=>{const mail=scheduledGuestMessage(sample,window.kind,config,{status:'authorized'});return `<article><p>${index+1} · Envoi prévu le ${e(date(window.due))}, heure de Paris</p><h2>${e(mail.subject)}</h2><pre>${e(mail.text)}</pre></article>`;}).join('')}<p><a class="button secondary" href="/essai.html">Revenir aux messages de l’essai</a></p>`);
}
let ticking=false;
async function syncPayment(){if(ticking)return;ticking=true;try{
 for(const stay of db.prepare("SELECT * FROM stays WHERE status='awaiting_payment' AND stripe_checkout_id IS NOT NULL").all()) {
  try{const session=await stripe(env,'checkout/sessions/'+encodeURIComponent(stay.stripe_checkout_id));
   if(session.id===stay.stripe_checkout_id && session.livemode===false && session.status==='complete' && session.payment_status==='paid')await processStaySession(session,'checkout.session.completed','local-reconcile-'+session.id,env);
  }catch{/* Retry on the next local visit; never infer payment from the URL. */}
 }
 await sendQueuedMail(env);
 await requestDueDeposits(env);
 await sendQueuedMail(env);
 await reconcileDeposits(env);
 await reconcileDamageClaims(env);
 await reconcileCancellations(env);
 await alertOverdueDeposits(env);
 await queueGuestMessages(env);
 await sendQueuedMail(env);
}finally{ticking=false;}}
// Local equivalent of the future five-minute scheduled job. No real e-mails are sent.
setInterval(()=>syncPayment().catch(()=>{}),5*60000).unref();
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};
http.createServer(async(req,res)=>{
 const finish=(status,body,type='text/html; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(body);};
 try {
  if(req.headers.host!==`127.0.0.1:${port}`)return finish(403,'Accès local uniquement.');
  if(req.headers.origin && req.headers.origin!==local)return finish(403,'Origine interdite.');
  const url=new URL(req.url,local),path=decodeURIComponent(url.pathname);
  if(path.startsWith('/api/') || path.startsWith('/calendrier/direct/')) {
   if(path==='/api/guest/payment-status')await syncPayment();
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)return finish(413,'Trop volumineux.');chunks.push(chunk);}
   const headers=new Headers(req.headers);if(headers.has('Origin'))headers.set('Origin',virtual);
   if(path.startsWith('/api/admin/'))headers.set('Cf-Access-Jwt-Assertion',await adminToken());
   const request=new Request(virtual+url.pathname+url.search,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const tasks=[];const response=await worker.fetch(request,env,{waitUntil:task=>tasks.push(task)});await Promise.allSettled(tasks);
   return finish(response.status,Buffer.from(await response.arrayBuffer()),response.headers.get('Content-Type')||'application/json');
  }
  if(req.method!=='GET')return finish(405,'Méthode interdite.');
  if(path==='/essai-calendriers.html'){
   const [airbnb,booking]=await Promise.all([readCalendar(env.AIRBNB_ICAL),readCalendar(env.BOOKING_ICAL)]);
   const tests=db.prepare("SELECT id,arrival,departure FROM stays WHERE status IN ('awaiting_payment','confirmed') ORDER BY arrival").all();
   const date=value=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
   const periods=ranges=>ranges.map(([from,to])=>`<p>Du ${e(date(from))} au ${e(date(to))}</p>`).join('')||'<p>Aucune période indisponible.</p>';
   return finish(200,page(`<h1>Disponibilités du logement</h1><p>${realCalendars?'Calendriers Airbnb et Booking réels, consultés à l’instant.':'Calendriers externes simulés.'} Une période indisponible peut correspondre à une réservation ou à une fermeture du calendrier.</p><article><h2>Airbnb</h2>${periods(airbnb)}</article><article><h2>Booking</h2>${periods(booking)}<p>Booking transmet ces périodes comme indisponibles. Son export ne permet pas de distinguer une réservation d’un blocage manuel. Pour libérer une période, vérifiez le calendrier dans Booking.</p></article><article><h2>Réservations fictives de l’essai local</h2><p>Ces séjours ont été créés pendant nos tests. Ils ne correspondent pas à des réservations Airbnb ou Booking et bloquent les dates uniquement dans cet essai.</p>${tests.map(stay=>`<p>Du ${e(date(stay.arrival))} au ${e(date(stay.departure))} · <a href="/gestion.html#${e(stay.id)}">Voir le séjour de test</a></p>`).join('')||'<p>Aucun séjour de test actif.</p>'}</article><p>Pour toutes les périodes, le jour du départ reste réservable. Aucune réservation de test n’est envoyée aux plateformes.</p><p><a class="button" href="/index.html#demande">Tester le choix des dates</a></p><article><h2>Calendrier des réservations du site</h2><p>Ce calendrier contient uniquement les séjours acceptés sur le site, en attente de paiement ou confirmés. Les annulations et les demandes non acceptées en sont exclues. Aucun nom, e-mail ou numéro de téléphone n’est transmis.</p><p><a class="button secondary" href="/calendrier/direct/${env.CALENDAR_EXPORT_TOKEN}.ics">Télécharger le calendrier de l’essai</a></p><p>Ce lien local sert à vérifier le fichier. Le lien définitif à importer dans Airbnb et Booking sera disponible après le déploiement ; les plateformes ne peuvent pas accéder à votre serveur local.</p></article>`));
  }
  if(path==='/essai-messages.html')return finish(200,previewStayMessages(url));
  if(path==='/essai.html'){await syncPayment();return finish(200,inbox());}
  if(path.startsWith('/essai-mail/')) {
   const row=db.prepare('SELECT * FROM local_mail WHERE id=?').get(path.slice('/essai-mail/'.length));if(!row)return finish(404,'Message introuvable.');
   const mail=JSON.parse(row.body),text=mail.text.replaceAll(virtual,local);
   const links=[...text.matchAll(/(?:http:\/\/127\.0\.0\.1:\d+\/|https:\/\/checkout\.stripe\.com\/)[^\s]+/g)].map(match=>match[0]).filter(link=>link.startsWith(local+'/')||link.startsWith('https://checkout.stripe.com/'));
   return finish(200,page(`<h1>${e(mail.subject)}</h1><p>À : ${e(mail.to.join(', '))}</p><article><pre>${e(text)}</pre>${links.map(link=>`<p><a class="button" href="${e(link)}">${link.startsWith('https://checkout.stripe.com/')?'Autoriser l’empreinte bancaire de test':link.includes('sejour.html')?(/contrat à confirmer/.test(mail.subject)?'Lire et accepter le contrat':'Lire le contrat et payer'):'Ouvrir l’espace propriétaire'}</a></p>`).join('')}${(mail.attachments||[]).map((item,index)=>`<p><a href="/essai-piece/${encodeURIComponent(row.id)}/${index}">${e(item.filename)}</a></p>`).join('')}</article>`));
  }
  if(path.startsWith('/essai-piece/')){const parts=path.split('/');const row=db.prepare('SELECT * FROM local_mail WHERE id=?').get(parts[2]);const attachment=row&&JSON.parse(row.body).attachments?.[Number(parts[3])];return attachment?finish(200,Buffer.from(attachment.content,'base64'),attachment.filename.endsWith('.pdf')?'application/pdf':'text/html; charset=utf-8'):finish(404,'Pièce introuvable.');}
  const relative=path==='/'?'index.html':path.slice(1),target=resolve(root,relative);
  if(!target.startsWith(root+'/') || !(relative.startsWith('assets/') || /^[a-z-]+\.html$/.test(relative)))return finish(404,'Introuvable.');
  let body=readFileSync(target);if(extname(target)==='.html')body=body.toString().replace(/(<body[^>]*>)/i,'$1'+banner);
  return finish(200,body,types[extname(target)]||'application/octet-stream');
 }catch{return finish(503,'L’essai est momentanément indisponible.');}
}).listen(port,'127.0.0.1',()=>console.log('Essai local prêt : '+local+'/essai.html'));
