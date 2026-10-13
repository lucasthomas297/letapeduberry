import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {paymentEnvironment,ownerTestConfigured,digest} from './payment.mjs';
import {flowFetch} from './booking-flow.mjs';
import {reconcilePayments} from './payment-reconciliation.mjs';
import {sendQueuedMail} from './request-worker.mjs';
import {renderContract} from './contract.mjs';
import {cancellationPlan,cancelStay} from './cancellation.mjs';
import {calendarExport} from './calendar-export.mjs';
const live={STRIPE_MODE:'live',STRIPE_LIVE_ENABLED:'true',STRIPE_WEBHOOK_ENABLED:'true',STRIPE_SECRET_KEY:'sk_live_dummy',STRIPE_WEBHOOK_SECRET:'whsec_live',OWNER_EMAIL:'owner@example.test',OWNER_PAYMENT_TEST_ENABLED:'true',STRIPE_TEST_SECRET_KEY:'sk_test_dummy',STRIPE_TEST_WEBHOOK_SECRET:'whsec_test'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const file of readdirSync(new URL('./migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())db.exec(readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8'));
 function prepare(sql,args=[]){return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({success:true,results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})};}
 const env={...live,BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}},CONTRACT_APPROVED:'true',OWNER_NAME:'Owner',OWNER_ADDRESS:'Address',OWNER_STATUS:'LMNP',APARTMENT_AREA:'47',APARTMENT_ROOMS:'2',TOURIST_TAX_DESCRIPTION:'Tax',DEPOSIT_RELEASE_TERMS:'48 heures',APARTMENT_CLASSIFICATION:'Sans classement',GUEST_INSURANCE_TERMS:'Assurance',INTERMEDIARY_TERMS:'Aucun',SITE_ORIGIN:'https://example.test',RESEND_API_KEY:'mail_dummy',CONTACT_FROM:'site@messages.example.test',CALENDAR_EXPORT_TOKEN:'a'.repeat(48)};
 function add(id,email=env.OWNER_EMAIL){db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at,insurance_accepted_at) VALUES (?,?,?,'2027-01-18','2027-01-19','Owner',?,'0600000000',1,'flex',0,0,7800,'card','v',?,?,?)`).run(id,id,'hash',email,new Date().toISOString(),new Date().toISOString(),new Date().toISOString());return db.prepare('SELECT * FROM stays WHERE id=?').get(id);}
 return {db,env,add};
}
async function signedEvent(path,secret,event){const payload=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+payload))).toString('hex');return new Request('https://example.test'+path,{method:'POST',headers:{'Stripe-Signature':`t=${timestamp},v1=${sig}`},body:payload});}
test('owner test never falls back to live credentials and rejects foreign addresses',()=>{
 const stay={payment_test:1,customer_email:live.OWNER_EMAIL};assert.ok(ownerTestConfigured(live));assert.equal(paymentEnvironment(stay,live).STRIPE_SECRET_KEY,'sk_test_dummy');assert.equal(paymentEnvironment({payment_test:0},live),live);
 for(const patch of [{OWNER_PAYMENT_TEST_ENABLED:'false'},{STRIPE_TEST_SECRET_KEY:''},{STRIPE_TEST_SECRET_KEY:'sk_live_wrong'},{STRIPE_TEST_WEBHOOK_SECRET:''}])assert.throws(()=>paymentEnvironment(stay,{...live,...patch}));
 assert.throws(()=>paymentEnvironment({...stay,customer_email:'guest@example.test'},live));
 assert.throws(()=>paymentEnvironment({payment_test:0},{...live,STRIPE_OWNER_TEST_CONTEXT:true}));
});
test('private opt-in only allows a pending owner card request and freezes its mode',async()=>{
 const {db,env,add}=fixture();add('owner');add('guest','guest@example.test');
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='owner-test';
 env.ACCESS_ISSUER='https://test.cloudflareaccess.com';env.ACCESS_AUD='owner';
 const base=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),content=base({alg:'RS256',kid:jwk.kid})+'.'+base({iss:env.ACCESS_ISSUER,aud:['owner'],email:env.OWNER_EMAIL,exp:Date.now()/1000+60}),token=content+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(content))).toString('base64url');
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({keys:[jwk]});
 const request=(id,headers={})=>new Request('https://example.test/api/admin/payment-test',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',...headers},body:JSON.stringify({id,confirmed:true})});
 try{
  assert.equal((await flowFetch(request('owner'),env)).status,403);
  const auth={'Cf-Access-Jwt-Assertion':token};const setting=value=>new Request('https://example.test/api/admin/settings',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json',...auth},body:JSON.stringify({min_nights:value})});assert.equal((await flowFetch(setting(2.5),env)).status,400);assert.equal((await flowFetch(setting(61),env)).status,400);assert.equal((await flowFetch(setting(3),env)).status,200);assert.equal(db.prepare('SELECT min_nights FROM booking_settings').get().min_nights,3);assert.throws(()=>add('too-short'),/minimum de nuits/);assert.equal((await flowFetch(setting(1),env)).status,200);assert.equal((await flowFetch(request('guest',auth),env)).status,409);
  assert.equal((await flowFetch(request('owner',{...auth,Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await flowFetch(request('owner',auth),{...env,STRIPE_TEST_SECRET_KEY:''})).status,503);
  assert.equal((await flowFetch(request('owner',auth),env)).status,200);
  db.prepare("UPDATE stays SET status='declined' WHERE id='owner'").run();
  assert.equal((await flowFetch(request('owner',auth),env)).status,409);
  assert.throws(()=>db.prepare("UPDATE stays SET payment_test=0 WHERE id='owner'").run(),/fixé/);
  assert.equal(db.prepare("SELECT payment_test FROM stays WHERE id='guest'").get().payment_test,0);
 }finally{globalThis.fetch=original;db.close();}
});
test('same booking flow creates test Checkout, rejects cross-mode webhooks, sends real marked mail and simulates refund',async()=>{
 const {db,env,add}=fixture();const stay=add('test');db.prepare("UPDATE stays SET payment_test=1 WHERE id='test'").run();
 const token='12345678-1234-1234-1234-123456789012'.repeat(2),html=renderContract(stay,env),hash=await digest(html),deadline=new Date(Date.now()+12*3600000).toISOString();
 db.prepare("UPDATE stays SET status='awaiting_payment',contract_html=?,contract_hash=?,guest_token_hash=?,payment_due_at=? WHERE id='test'").run(html,hash,await digest(token),deadline);
 const calls=[],mails=[],original=globalThis.fetch;globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://api.resend.com/')){mails.push(JSON.parse(options.body));return Response.json({id:'mail_'+mails.length});}
  calls.push({url:String(url),key:options.headers.Authorization});assert.equal(options.headers.Authorization,'Bearer sk_test_dummy');
  if(String(url).endsWith('/refunds'))return Response.json({id:'re_test',livemode:false,payment_intent:'pi_test',amount:7800,currency:'eur',status:'succeeded'});
  return Response.json({id:'cs_test',livemode:false,url:'https://checkout.stripe.com/c/pay/cs_test'});
 };
 const accept=()=>new Request('https://example.test/api/guest/accept',{method:'POST',headers:{Origin:'https://example.test',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({signer:'Owner',accepted:true,depositAccepted:true,contractHash:hash})});
 try{
  assert.equal((await flowFetch(accept(),env)).status,200);assert.equal(calls.length,1);
  assert.equal((await flowFetch(accept(),env)).status,200);assert.equal(calls.length,1);
  const event={id:'evt_test',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_test',livemode:false,metadata:{purpose:'stay',reservation_id:'test'},payment_status:'paid',amount_total:7800,currency:'eur',payment_intent:'pi_test'}}};
  assert.equal((await flowFetch(await signedEvent('/api/stripe/webhook','whsec_live',event),env)).status,400);
  const falseLive=structuredClone(event);falseLive.id='evt_live';falseLive.livemode=true;falseLive.data.object.livemode=true;
  assert.equal((await flowFetch(await signedEvent('/api/stripe/webhook','whsec_live',falseLive),env)).status,409);
  assert.equal(db.prepare('SELECT status FROM stays').get().status,'awaiting_payment');
  assert.equal((await flowFetch(await signedEvent('/api/stripe/webhook-test','whsec_live',event),env)).status,400);
  assert.equal((await flowFetch(await signedEvent('/api/stripe/webhook-test','whsec_test',event),env)).status,200);
  assert.equal((await flowFetch(await signedEvent('/api/stripe/webhook-test','whsec_test',event),env)).status,200);
  assert.equal(db.prepare('SELECT status FROM stays').get().status,'confirmed');
  await sendQueuedMail(env);assert.equal(mails.length,2);assert.equal(mails[0].to[0],env.OWNER_EMAIL);assert.match(mails[0].subject,/^TEST/);assert.equal(mails[0].attachments.length,2);const ownerMail=mails.find(m=>m.to[0]==='contact@letapeduberry.fr');assert.match(ownerMail.subject,/Paiement reçu/);assert.match(ownerMail.text,/Owner/);assert.match(ownerMail.text,/78.00/);await sendQueuedMail(env);assert.equal(mails.length,2);
  const exportUrl='https://example.test/calendrier/direct/'+env.CALENDAR_EXPORT_TOKEN+'.ics';
  assert.match(await (await calendarExport(new Request(exportUrl),env)).text(),/20270118/);
  const confirmed=db.prepare('SELECT * FROM stays').get(),data={cause:'exception',reason:'Fin du test Stripe'};const plan=await cancellationPlan(confirmed,data);
  await cancelStay(confirmed,{...data,notifiedAt:plan.notifiedAt,confirmed:true,planHash:plan.hash},env);
  assert.equal(db.prepare('SELECT status FROM stays').get().status,'cancelled');assert.equal(db.prepare('SELECT refund_status FROM cancellations').get().refund_status,'succeeded');
  assert.doesNotMatch(await (await calendarExport(new Request(exportUrl),env)).text(),/20270118/);
  await sendQueuedMail(env);assert.equal(mails.length,4);assert.ok(mails.every(m=>m.subject.startsWith('TEST')));
 }finally{globalThis.fetch=original;db.close();}
});
test('owner confirmation retries independently of guest mail and never describes cash as already paid',async()=>{
 const {db,env,add}=fixture();add('notice','guest@example.test');const now=new Date().toISOString();
 db.prepare("UPDATE stays SET status='confirmed',contract_accepted_at=?,paid_at=? WHERE id='notice'").run(now,now);
 db.prepare("INSERT INTO mail_outbox(id,stay_id,kind,created_at,payload) VALUES ('guest-confirmation','notice','confirmation',?,'{}')").run(now);
 const calls=[],original=globalThis.fetch;let guestFails=true;
 globalThis.fetch=async(url,options)=>{assert.equal(String(url),'https://api.resend.com/emails');const mail=JSON.parse(options.body);calls.push({mail,key:options.headers['Idempotency-Key']});if(mail.to[0]==='guest@example.test'&&guestFails)return Response.json({error:'temporary'}, {status:503});return Response.json({id:'accepted-'+calls.length});};
 try{
  await sendQueuedMail(env);assert.equal(calls.length,2);assert.deepEqual(calls[1].mail.to,['contact@letapeduberry.fr']);assert.match(calls[1].mail.text,/paiement intégral.*confirmé/);assert.doesNotMatch(calls[1].mail.text,/En attente de votre validation/);
  assert.ok(db.prepare("SELECT sent_at FROM mail_outbox WHERE kind='owner_confirmation'").get().sent_at);
  guestFails=false;await sendQueuedMail(env);assert.equal(calls.length,3);assert.equal(calls[0].key,calls[2].key);assert.deepEqual(calls[2].mail.to,['guest@example.test']);
  add('cash','cash@example.test');db.prepare("UPDATE stays SET arrival='2027-02-18',departure='2027-02-19',payment_preference='cash',status='confirmed',contract_accepted_at=? WHERE id='cash'").run(now);
  db.prepare("INSERT INTO mail_outbox(id,stay_id,kind,created_at,payload) VALUES ('cash-confirmation','cash','confirmation',?,'{}')").run(now);
  await sendQueuedMail(env);const cashOwner=calls.find(c=>c.mail.to[0]==='contact@letapeduberry.fr'&&c.mail.subject.includes('espèces'));assert.ok(cashOwner);assert.match(cashOwner.mail.text,/reste à régler en espèces/);assert.doesNotMatch(cashOwner.mail.text,/paiement intégral.*confirmé|Paiement confirmé le/);
 }finally{globalThis.fetch=original;db.close();}
});
