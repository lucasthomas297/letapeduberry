import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseBusyIcal,mergeRanges,overlaps,readCalendar,parisDay} from './calendar.mjs';
import availability from './availability-worker.mjs';
import requests,{sendQueuedMail} from './request-worker.mjs';
import {quoteStay,validateStay} from './stay.mjs';
import {digest,webhookEvent,checkoutFields,stripeConfigured,stripeObjectModeMatches,stripeWebhookModeMatches,stripe} from './payment.mjs';
import {adminAuthorized} from './admin-auth.mjs';
import {contractReady,renderContract,stayBreakdown,savedDocumentModel,ownerTaxBreakdown} from './contract.mjs';
import {flowFetch} from './booking-flow.mjs';
import {reconcilePayments} from './payment-reconciliation.mjs';
import {calendarExport} from './calendar-export.mjs';
import {depositEvent,depositRequestDueAt} from './deposit.mjs';
import {ownerHealth} from './owner-health.mjs';
const ical=event=>`BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\n${event}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
test('owner diagnostics distinguish stale mail and do not disclose secrets or database errors',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE mail_outbox(created_at TEXT,sent_at TEXT)');
 db.prepare('INSERT INTO mail_outbox VALUES (?,NULL)').run('2026-10-08T00:00:00.000Z');
 db.prepare('INSERT INTO mail_outbox VALUES (?,NULL)').run('2026-10-10T09:00:00.000Z');
 db.prepare('INSERT INTO mail_outbox VALUES (?,?)').run('2026-10-08T00:00:00.000Z','2026-10-08T01:00:00.000Z');
 const secret='sk_live_never_disclose',env={STRIPE_SECRET_KEY:secret,STRIPE_MODE:'live',STRIPE_LIVE_ENABLED:'false',BERRY_DB:{prepare(sql){return {bind:cutoff=>({first:async()=>db.prepare(sql).get(cutoff)})};}}};
 const health=await ownerHealth(env,Date.parse('2026-10-10T10:00:00Z'));
 assert.deepEqual(health.queue,{pending:2,review:1});assert.equal(health.checks.find(c=>c.label==='Paiements activés').ok,false);
 assert.equal(JSON.stringify(health).includes(secret),false);
 const unavailable=await ownerHealth({...env,BERRY_DB:{prepare(){throw new Error('private database token');}}});
 assert.equal(unavailable.queue,null);assert.equal(unavailable.checks[0].ok,false);assert.equal(JSON.stringify(unavailable).includes('private database token'),false);
 db.close();
});
test('live Stripe requires explicit activation and rejects mismatched modes before contacting Stripe',async()=>{
 const testEnv={STRIPE_SECRET_KEY:'sk_test_dummy'},liveEnv={STRIPE_SECRET_KEY:'sk_live_dummy',STRIPE_MODE:'live',STRIPE_LIVE_ENABLED:'true'};
 assert.ok(stripeConfigured(testEnv));assert.ok(stripeConfigured(liveEnv));
 assert.ok(stripeConfigured({...testEnv,STRIPE_SECRET_KEY:'rk_test_dummy'}));
 assert.ok(stripeConfigured({...liveEnv,STRIPE_SECRET_KEY:'rk_live_dummy'}));
 assert.ok(stripeObjectModeMatches({livemode:false},testEnv));assert.ok(stripeObjectModeMatches({livemode:true},liveEnv));
 assert.ok(!stripeObjectModeMatches({livemode:true},testEnv));assert.ok(!stripeObjectModeMatches({livemode:false},liveEnv));
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({livemode:false});};
 try{
  for(const env of [{STRIPE_SECRET_KEY:'sk_live_dummy'},{...liveEnv,STRIPE_LIVE_ENABLED:'false'},{...liveEnv,STRIPE_SECRET_KEY:'sk_test_dummy'},{...testEnv,STRIPE_MODE:'invalid'}]){
   assert.ok(!stripeConfigured(env));await assert.rejects(stripe(env,'balance'));
  }
  assert.equal(calls,0);await assert.rejects(stripe(liveEnv,'balance'),/hors mode/);assert.equal(calls,1);
 }finally{globalThis.fetch=original;}
});
test('incoming live notifications can be enabled while outgoing payments stay disabled',async()=>{
 let reads=0;
 const database={prepare(sql){assert.equal(sql,'SELECT id FROM stripe_events WHERE id=?');return {bind:()=>({first:async()=>{reads++;return null;}})};}};
 const env={STRIPE_MODE:'live',STRIPE_SECRET_KEY:'rk_live_dummy',STRIPE_WEBHOOK_SECRET:'whsec_dummy',STRIPE_WEBHOOK_ENABLED:'true',STRIPE_LIVE_ENABLED:'false',REQUESTS_ENABLED:'false',BERRY_DB:database};
 assert.equal(stripeWebhookModeMatches({livemode:true},env),true);
 assert.equal(stripeWebhookModeMatches({livemode:false},env),false);
 for(const changed of [{STRIPE_WEBHOOK_ENABLED:'false'},{STRIPE_MODE:'invalid'},{STRIPE_SECRET_KEY:'sk_test_dummy'}])assert.equal(stripeWebhookModeMatches({livemode:true},{...env,...changed}),false);
 assert.equal(stripeConfigured(env),false);
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error('Unexpected outgoing request');};
 try{
  await assert.rejects(stripe(env,'checkout/sessions',{}));assert.equal(calls,0);
  async function notification(livemode){
   const payload=JSON.stringify({id:'evt_probe',livemode,type:'checkout.session.completed',data:{object:{metadata:{}}}}),timestamp=Math.floor(Date.now()/1000);
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+payload))).toString('hex');
   return new Request('https://example.test/api/stripe/webhook',{method:'POST',headers:{'Stripe-Signature':`t=${timestamp},v1=${signature}`},body:payload});
  }
  assert.equal((await flowFetch(await notification(true),env)).status,200);assert.equal(reads,1);
  assert.equal((await flowFetch(await notification(false),env)).status,400);assert.equal(reads,1);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
test('iCal departure is free; touching occupied ranges merge',()=>{
 const busy=parseBusyIcal(ical('DTSTART;VALUE=DATE:20261023\r\nDTEND;VALUE=DATE:20261025'));
 assert.deepEqual(busy,[['2026-10-23','2026-10-25']]);
 assert.equal(overlaps('2026-10-25','2026-10-26',busy),false);
 assert.equal(overlaps('2026-10-24','2026-10-26',busy),true);
 assert.deepEqual(mergeRanges([...busy,['2026-10-25','2026-10-27']]),[['2026-10-23','2026-10-27']]);
});
test('contract remains a draft until owner data is complete; personal text escaped',()=>{
 assert.equal(contractReady({CONTRACT_APPROVED:'false'}),false);
 const contract=renderContract({id:'test',customer_name:'<script>bad</script>',total_cents:7000,arrival:'2026-11-16',departure:'2026-11-17',guests:1,rate:'fixed'},{OWNER_NAME:'Propriétaire & test'});
 assert.ok(contract.includes('&lt;script&gt;bad&lt;/script&gt;'));assert.ok(!contract.includes('<script>'));
 assert.ok(contract.includes('Règlement intérieur'));assert.ok(contract.includes('300 €'));
});
test('Stripe separates payment and deposit; webhook signature cannot be forged',async()=>{
 const stay={id:'stay',customer_email:'guest@example.test',total_cents:23000,payment_due_at:new Date(Date.now()+12*3600000).toISOString()};
 assert.equal(checkoutFields(stay,'https://example.test')['line_items[0][price_data][unit_amount]'],'23000');
 assert.equal(checkoutFields(stay,'https://example.test','deposit')['payment_intent_data[capture_method]'],'manual');
 assert.equal(checkoutFields(stay,'https://example.test','deposit')['line_items[0][price_data][unit_amount]'],'30000');
 await assert.rejects(webhookEvent('{}','t=123,v1=bad','whsec_test'));
});
test('private API requires signed Access token with correct audience and owner',async()=>{
 assert.equal(await adminAuthorized(new Request('https://example.test/api/admin/stays'),{}),false);
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='test-key';
 const base=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const issuer='https://test.cloudflareaccess.com',env={ACCESS_ISSUER:issuer,ACCESS_AUD:'private',OWNER_EMAIL:'owner@example.test'};
 async function token(aud='private',email='owner@example.test',claims={}) {const content=base({alg:'RS256',kid:jwk.kid})+'.'+base({iss:issuer,aud:[aud],email,exp:Date.now()/1000+60,...claims});return content+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(content))).toString('base64url');}
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({keys:[jwk]});
 try {
  const request=async(aud,email)=>new Request('https://example.test/api/admin/stays',{headers:{'Cf-Access-Jwt-Assertion':await token(aud,email)}});
  assert.equal(await adminAuthorized(await request(),env),true);
  const previewStay={id:'stay',arrival:'2026-11-13',departure:'2026-11-15',guests:2,rate:'fixed',total_cents:16000,early_arrival:1,late_departure:1,payment_preference:'cash',customer_name:'Voyageur',customer_address:'Adresse',status:'pending'};
  let reads=0;
  const previewEnv={...env,BERRY_DB:{prepare(sql){assert.equal(sql,'SELECT * FROM stays WHERE id=?');return {bind(id){assert.equal(id,'stay');return {first:async()=>{reads++;return previewStay;}}}}}}};
  for(const file of ['contract','description']){
   const response=await flowFetch(new Request('https://example.test/api/admin/'+file+'.pdf?id=stay',{headers:{'Cf-Access-Jwt-Assertion':await token()}}),previewEnv);
   assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/pdf');
   assert.match(response.headers.get('Content-Disposition'),/^inline/);assert.equal(response.headers.get('Cache-Control'),'no-store');
   assert.equal(new TextDecoder().decode((await response.arrayBuffer()).slice(0,4)),'%PDF');
  }
  assert.equal(reads,2);assert.equal(previewStay.status,'pending');assert.equal(previewStay.contract_html,undefined);

  assert.equal(await adminAuthorized(await request('wrong'),env),false);
  assert.equal(await adminAuthorized(await request('private','stranger@example.test'),env),false);
  const signed=async claims=>new Request('https://example.test/api/admin/stays',{headers:{'Cf-Access-Jwt-Assertion':await token('private','owner@example.test',claims)}});
  assert.equal(await adminAuthorized(await signed({exp:Date.now()/1000-1}),env),false);
  assert.equal(await adminAuthorized(await signed({nbf:Date.now()/1000+3600}),env),false);
  assert.equal(await adminAuthorized(await signed({nbf:'invalide'}),env),false);
  assert.equal(await adminAuthorized(await signed({iss:'https://other.cloudflareaccess.com'}),env),false);
  const forged=(await token()).split('.');forged[1]=base({iss:issuer,aud:['private'],email:'owner@example.test',exp:Date.now()/1000+3600});
  assert.equal(await adminAuthorized(new Request('https://example.test/api/admin/stays',{headers:{'Cf-Access-Jwt-Assertion':forged.join('.')}}),env),false);
  globalThis.fetch=async()=>{throw new Error('Certificats indisponibles');};
  assert.equal(await adminAuthorized(await request(),env),false);
 }finally{globalThis.fetch=original;}
});
test('anonymous admin reads and decisions cannot reach the database',async()=>{
 let databaseCalls=0;
 const env={BERRY_DB:{prepare:()=>{databaseCalls++;throw new Error('Database must not be read');}}};
 for(const [path,method] of [['stays','GET'],['health','GET'],['decision','POST'],['deposit','POST'],['contract.pdf?id=stay','GET'],['description.pdf?id=stay','GET']]){
  const response=await flowFetch(new Request('https://example.test/api/admin/'+path,{method,...(method==='POST'?{headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({id:'stay',action:'approve'})}:{})}),env);
  assert.equal(response.status,403);
 }
 assert.equal(databaseCalls,0);
});
test('guest acceptance precedes Checkout; signed payment confirms exactly once',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql'])db.exec(readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8'));
 const token='12345678-1234-1234-1234-123456789012'.repeat(2),html='<h1>Contrat de test</h1>';
 db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,status,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at,contract_html,contract_hash,guest_token_hash,payment_due_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('stay','key','hash','2026-11-06','2026-11-08','awaiting_payment','Test','guest@example.test','0600000000',2,'fixed',0,0,15000,'card','2026-10-03','time','time',html,await digest(html),await digest(token),new Date(Date.now()+12*3600000).toISOString());
 function prepare(sql,args=[]) {return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({success:true,results:db.prepare(sql).all(...args)}),run:async()=>({success:true,meta:db.prepare(sql).run(...args)})};}
 const env={BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const statement of statements)await statement.run();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}},CONTRACT_APPROVED:'true',STRIPE_EXTENDED_AUTHORIZATION_ENABLED:'true',OWNER_NAME:'Test',OWNER_ADDRESS:'Test',OWNER_STATUS:'Test',APARTMENT_AREA:'40',APARTMENT_ROOMS:'2',TOURIST_TAX_DESCRIPTION:'Test',DEPOSIT_RELEASE_TERMS:'Test',APARTMENT_CLASSIFICATION:'Test',GUEST_INSURANCE_TERMS:'Test',INTERMEDIARY_TERMS:'Test',STRIPE_SECRET_KEY:'sk_test_dummy',STRIPE_WEBHOOK_SECRET:'whsec_test',SITE_ORIGIN:'https://example.test'};
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({id:'cs_test',url:'https://checkout.stripe.com/c/pay/test'});};
 const accept=body=>new Request('https://example.test/api/guest/accept',{method:'POST',headers:{Origin:'https://example.test',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  const body={signer:'Test',accepted:true,depositAccepted:true,contractHash:await digest(html)};
  assert.equal((await flowFetch(accept({...body,depositAccepted:false}),env)).status,400);assert.equal(calls,0);
  assert.equal((await flowFetch(accept(body),env)).status,200);assert.equal(calls,1);
  assert.equal((await flowFetch(accept(body),env)).status,200);assert.equal(calls,1);
  const event={id:'evt_test',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_test',metadata:{purpose:'stay',reservation_id:'stay'},payment_status:'paid',amount_total:15000,currency:'eur',payment_intent:'pi_test'}}};
  async function signed(value){const payload=JSON.stringify(value),timestamp=Math.floor(Date.now()/1000);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+payload))).toString('hex');return new Request('https://example.test/api/stripe/webhook',{method:'POST',headers:{'Content-Length':String(new TextEncoder().encode(payload).length),'Stripe-Signature':`t=${timestamp},v1=${sig}`},body:payload});}
  const bad=structuredClone(event);bad.id='evt_wrong';bad.data.object.amount_total=1;
  assert.equal((await flowFetch(await signed(bad),env)).status,409);
  assert.equal(db.prepare('SELECT status FROM stays').get().status,'awaiting_payment');
  assert.equal((await flowFetch(await signed(event),env)).status,200);
  assert.equal((await flowFetch(await signed(event),env)).status,200);
  assert.equal(db.prepare('SELECT status FROM stays').get().status,'confirmed');
  const statusRequest=new Request('https://example.test/api/guest/payment-status',{headers:{Authorization:'Bearer '+token}});
  const statusResponse=await flowFetch(statusRequest,env);assert.equal(statusResponse.status,200);assert.equal((await statusResponse.json()).status,'confirmed');
  assert.equal((await flowFetch(new Request('https://example.test/api/guest/payment-status'),env)).status,403);
  const pdf=await flowFetch(new Request('https://example.test/api/guest/contract.pdf',{headers:{Authorization:'Bearer '+token}}),env);
  assert.equal(pdf.status,200);assert.equal(pdf.headers.get('Content-Type'),'application/pdf');
  assert.ok(pdf.headers.get('Content-Disposition').endsWith('.pdf"'));
  assert.equal(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0,5)),'%PDF-');
  assert.equal((await flowFetch(new Request('https://example.test/api/guest/contract.pdf'),env)).status,403);

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM mail_outbox WHERE kind='confirmation'").get().count,1);
 }finally{globalThis.fetch=original;db.close();}
});
test('private export contains occupied nights, never guest coordinates',async()=>{
 const env={CALENDAR_EXPORT_TOKEN:'a'.repeat(64),BERRY_DB:{prepare:()=>({all:async()=>({success:true,results:[{id:'stay',arrival:'2026-11-06',departure:'2026-11-08',customer_email:'private@example.test'}]})})}};
 assert.equal((await calendarExport(new Request('https://example.test/calendrier/direct/wrong.ics'),env)).status,404);
 const response=await calendarExport(new Request('https://example.test/calendrier/direct/'+env.CALENDAR_EXPORT_TOKEN+'.ics'),env);
 assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes('private@example.test'));assert.deepEqual(parseBusyIcal(body),[['2026-11-06','2026-11-08']]);
});
test('calendar export filters actual stored statuses and does not relay platform blocks',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(readFileSync(new URL('./migrations/0001_stays.sql',import.meta.url),'utf8'));
 const insert=db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,status,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 const statuses=['pending','awaiting_payment','confirmed','declined','cancelled','expired'];
 for(const [index,status] of statuses.entries())insert.run(status,status,'hash',`2027-01-${10+index}`,`2027-01-${11+index}`,status,'Private guest','secret@example.test','0600000000',1,'fixed',0,0,7000,'card','test','test','test');
 const token='b'.repeat(64),request=new Request('https://example.test/calendrier/direct/'+token+'.ics');
 const env={CALENDAR_EXPORT_TOKEN:token,BERRY_DB:{prepare:sql=>({all:async()=>({success:true,results:db.prepare(sql).all()})})}};
 try{
  const body=await (await calendarExport(request,env)).text();
  assert.deepEqual(parseBusyIcal(body),[['2027-01-11','2027-01-13']]);
  assert.equal((body.match(/BEGIN:VEVENT/g)||[]).length,2);
  for(const secret of ['Private guest','secret@example.test','0600000000'])assert.ok(!body.includes(secret));
  assert.equal((await calendarExport(new Request(request.url,{method:'POST'}),env)).status,404);
  db.exec("UPDATE stays SET status='cancelled' WHERE status IN ('awaiting_payment','confirmed')");
  assert.deepEqual(parseBusyIcal(await (await calendarExport(request,env)).text()),[]);
 }finally{db.close();}
});
test('hold expiring before departure requires review rather than guarantee',async()=>{
 let recorded;
 const env={STRIPE_SECRET_KEY:'sk_test_dummy',BERRY_DB:{prepare:sql=>({bind:(...args)=>({first:async()=>sql.includes('FROM deposits')?{stay_id:'stay',status:'requested'}:{departure:new Date(Date.now()+10*86400000).toISOString().slice(0,10)},run:async()=>{recorded=args;}})})}};
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({status:'requires_capture',amount:30000,currency:'eur',latest_charge:{payment_method_details:{card:{capture_before:Math.floor(Date.now()/1000)+86400}}}});
 try{await depositEvent({id:'cs_test',metadata:{reservation_id:'stay'},payment_intent:'pi_test'},env);assert.equal(recorded[2],'review');}finally{globalThis.fetch=original;}
});
test('cancelled events ignored; unsupported or corrupt events fail closed',()=>{
 assert.deepEqual(parseBusyIcal(ical('STATUS:CANCELLED')),[]);
 for(const event of ['DTSTART:20260230','DTSTART:20261023\nRRULE:FREQ=DAILY','SUMMARY:missing date','DTSTART:20261025\nDTEND:20261023'])assert.throws(()=>parseBusyIcal(ical(event)));
 assert.throws(()=>parseBusyIcal('BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261023\nEND:VCALENDAR'));
});
test('UTC timestamps interpreted as occupied days in Paris',()=>{
 assert.deepEqual(parseBusyIcal(ical('DTSTART:20261023T230000Z\nDTEND:20261025T120000Z')),[['2026-10-24','2026-10-25']]);
});
test('provider errors never become an empty available calendar',async()=>{
 await assert.rejects(readCalendar('https://example.test/calendar',async()=>new Response('error',{status:503})));
 await assert.rejects(readCalendar('https://example.test/calendar',async()=>new Response('<html>login</html>')));
 assert.equal((await availability.fetch(new Request('https://example.test/api/availability'),{})).status,503);
});
test('requests disabled until integration complete; cross-origin requests rejected',async()=>{
 const status=await requests.fetch(new Request('https://example.test/api/status'),{});
 assert.deepEqual(await status.json(),{requests_ready:false});
 const request=new Request('https://example.test/api/request',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:'{}'});
 assert.equal((await requests.fetch(request,{})).status,503);
 const foreign=new Request('https://example.test/api/request',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'});
 assert.equal((await requests.fetch(foreign,{})).status,403);
});
const details={arrival:'2026-10-23',departure:'2026-10-26',rate:'fixed',early:true,late:true,guests:2,payment:'card',name:'Voyageur Test',email:'voyageur@example.test',phone:'+33 6 00 00 00 00',rulesAccepted:true,insuranceAccepted:true,depositAccepted:true,comment:'Séjour touristique',address:'Adresse de test'};
test('confirmed rates: Fri/Sat/Sun, options once, cents on server',()=>{
 assert.deepEqual(quoteStay(details,'2026-10-03'),{nights:3,totalCents:23000});
 assert.equal(quoteStay({...details,rate:'flex'},'2026-10-03').totalCents,25600);
 assert.equal(validateStay({...details,totalCents:1},'2026-10-03').totalCents,23000);
 for(const change of [{rulesAccepted:false},{insuranceAccepted:false},{insuranceAccepted:undefined},{guests:3},{early:'true'},{email:'wrong'},{arrival:'2026-02-30'},{departure:'2027-02-01'}])assert.throws(()=>validateStay({...details,...change},'2026-10-03'));
});
test('real SQL schema: consent required, payment session unique, email queue atomic',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('./migrations/0001_stays.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/0002_booking_flow.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/0003_insurance_consent.sql',import.meta.url),'utf8'));
 const insert=db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 const values=['test','key','hash','2026-10-23','2026-10-26','Test','test@example.test','0600000000',2,'fixed',1,1,23000,'card','2026-10-03','2026-10-03T18:00:00Z','2026-10-03T18:00:00Z'];
 insert.run(...values);
 assert.equal(db.prepare('SELECT status FROM stays WHERE id=?').get('test').status,'pending');
 const missingConsent=[...values];missingConsent[0]='bad';missingConsent[1]='other-key';missingConsent[14]=null;
 assert.throws(()=>insert.run(...missingConsent));
 db.prepare('INSERT INTO mail_outbox(id,stay_id,kind,created_at) VALUES (?,?,?,?)').run('mail','test','owner_request',values[16]);
 assert.throws(()=>db.prepare('INSERT INTO mail_outbox(id,stay_id,kind,created_at) VALUES (?,?,?,?)').run('duplicate','test','owner_request',values[16]));
 db.close();
});
test('request persisted once with both notifications even when mail service fails',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 db.exec(readFileSync(new URL('./migrations/0001_stays.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/0002_booking_flow.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/0003_insurance_consent.sql',import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('./migrations/0015_booking_settings.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/0016_dated_minimum_stays.sql',import.meta.url),'utf8'));
 function prepare(sql,args=[]) {
  return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,
   all:async()=>({success:true,results:db.prepare(sql).all(...args)}),
   run:async()=>({success:true,meta:db.prepare(sql).run(...args)})};
 }
 const env={BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const statement of statements)await statement.run();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}},REQUESTS_ENABLED:'true',CONTRACT_APPROVED:'true',STRIPE_EXTENDED_AUTHORIZATION_ENABLED:'true',OWNER_NAME:'Test',OWNER_ADDRESS:'Adresse test',OWNER_STATUS:'Particulier',APARTMENT_AREA:'40',APARTMENT_ROOMS:'2',TOURIST_TAX_DESCRIPTION:'Test',DEPOSIT_RELEASE_TERMS:'Test',APARTMENT_CLASSIFICATION:'Test',GUEST_INSURANCE_TERMS:'Test',INTERMEDIARY_TERMS:'Test',ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUD:'test',OWNER_EMAIL:'owner@example.test',STRIPE_SECRET_KEY:'sk_test_dummy',SITE_ORIGIN:'https://letapeduberry.fr',RESEND_API_KEY:'test-only',CONTACT_FROM:'site@example.test',AIRBNB_ICAL:'https://calendar.example.test/airbnb',BOOKING_ICAL:'https://calendar.example.test/booking',REQUEST_RATE_LIMITER:{limit:async()=>({success:true})}};
 const original=globalThis.fetch;const work=[];
 globalThis.fetch=async url=>new URL(url).hostname==='calendar.example.test'?new Response('BEGIN:VCALENDAR\nEND:VCALENDAR'):new Response('{}',{status:503});
 try {
  const arrival=new Date(Date.now()+7*86400000).toISOString().slice(0,10),departure=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
  const payload={...details,arrival,departure};
  const make=body=>new Request('https://example.test/api/request',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json','Idempotency-Key':'12345678-1234-1234-1234-123456789012'},body:JSON.stringify(body)});
  const first=await requests.fetch(make(payload),env,{waitUntil:p=>work.push(p)});
  assert.equal(first.status,201);const reference=(await first.json()).reference;
  await Promise.all(work);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stays').get().count,1);assert.ok(db.prepare('SELECT insurance_accepted_at FROM stays').get().insurance_accepted_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM mail_outbox WHERE sent_at IS NULL').get().count,2);
  const retry=await requests.fetch(make(payload),env,{waitUntil:p=>work.push(p)});
  assert.equal(retry.status,200);assert.equal((await retry.json()).reference,reference);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stays').get().count,1);assert.ok(db.prepare('SELECT insurance_accepted_at FROM stays').get().insurance_accepted_at);
  assert.equal((await requests.fetch(make({...payload,guests:1}),env,{waitUntil:p=>work.push(p)})).status,409);
  db.prepare('UPDATE booking_settings SET min_nights=4 WHERE id=1').run();
  const blocked=make(payload);blocked.headers.set('Idempotency-Key','22345678-1234-1234-1234-123456789012');
  const short=await requests.fetch(blocked,env,{waitUntil:p=>work.push(p)});assert.equal(short.status,400);assert.match((await short.json()).error,/au moins 4 nuits/);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stays').get().count,1);
  assert.equal((await requests.fetch(make(payload),env,{waitUntil:p=>work.push(p)})).status,200);
 } finally {globalThis.fetch=original;db.close();}
});

test('Paris dates at midnight include summer and winter offset',()=>{
 assert.equal(parisDay(new Date('2026-10-04T22:30:00Z')),'2026-10-05');
 assert.equal(parisDay(new Date('2026-12-01T23:30:00Z')),'2026-12-02');
});
test('oversized Stripe webhook cannot bypass actual body limit with short header',async()=>{
 const request=new Request('https://example.test/api/stripe/webhook',{method:'POST',headers:{'Content-Length':'10'},body:'x'.repeat(1000001)});
 assert.equal((await flowFetch(request,{BERRY_DB:{}})).status,400);
});
test('SQL decision queue belongs only to the winning transition',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE decisions (id TEXT PRIMARY KEY,status TEXT,token TEXT); CREATE TABLE mails (id TEXT PRIMARY KEY,payload TEXT); INSERT INTO decisions VALUES ('stay','pending',NULL)");
 const update=db.prepare("UPDATE decisions SET status='accepted',token=? WHERE id='stay' AND status='pending'");
 const queue=db.prepare("INSERT INTO mails SELECT 'stay',? WHERE changes()=1");
 for(const token of ['winner','loser']){db.exec('BEGIN');update.run(token);queue.run(token);db.exec('COMMIT');}
 assert.equal(db.prepare('SELECT token FROM decisions').get().token,'winner');
 assert.deepEqual(db.prepare('SELECT payload FROM mails').get().payload,'winner');db.close();
});
test('queued acceptance email retains its private contract link and deadline',async()=>{
 const db=new DatabaseSync(':memory:');for(const file of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql'])db.exec(readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8'));
 const time=new Date().toISOString();
 db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('stay','key','hash','2026-11-06','2026-11-08','Test','guest@example.test','0600000000',2,'fixed',0,0,15000,'card','v',time,time);
 const link='https://example.test/sejour.html#private-test-token';
 db.prepare('INSERT INTO mail_outbox(id,stay_id,kind,created_at,payload) VALUES (?,?,?,?,?)').run('mail','stay','payment_link',time,JSON.stringify({url:link,deadline:'2026-11-01T12:00:00Z'}));
 function prepare(sql,args=[]){return {bind:(...values)=>prepare(sql,values),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)};}
 const original=globalThis.fetch;let sent;globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);return Response.json({id:'email-test'});};
 try{await sendQueuedMail({BERRY_DB:{prepare},RESEND_API_KEY:'test',CONTACT_FROM:'site@example.test'});assert.ok(sent.text.includes(link));assert.ok(sent.text.includes('1 novembre 2026 à 13 h 00 (heure de Paris)'));assert.ok(!sent.text.includes('undefined'));assert.ok(db.prepare('SELECT sent_at FROM mail_outbox').get().sent_at);}finally{globalThis.fetch=original;db.close();}
});

test('deposit request is due exactly 48 hours before Paris arrival, including DST',()=>{
 assert.equal(new Date(depositRequestDueAt({arrival:'2026-10-23',early_arrival:0})).toISOString(),'2026-10-21T14:00:00.000Z');
 assert.equal(new Date(depositRequestDueAt({arrival:'2026-12-01',early_arrival:1})).toISOString(),'2026-11-29T13:00:00.000Z');
 assert.equal(new Date(depositRequestDueAt({arrival:'2026-10-25',early_arrival:0})).toISOString(),'2026-10-23T15:00:00.000Z');
 assert.throws(()=>depositRequestDueAt({arrival:'2026-02-30'}));
});

test('Stripe reconciliation releases expired dates and confirms missed payments once',async()=>{
 const db=new DatabaseSync(':memory:');for(const file of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql'])db.exec(readFileSync(new URL('./migrations/'+file,import.meta.url),'utf8'));
 const insert=db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,status,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at,contract_accepted_at,payment_due_at,stripe_checkout_id) VALUES (?,?,?,?,?,'awaiting_payment','Test','guest@example.test','0600000000',2,'fixed',0,0,15000,'card','v','time','time','time',?,?)`);
 for(const [id,arrival,departure] of [['expired','2026-11-01','2026-11-03'],['paid','2026-11-04','2026-11-06'],['unknown','2026-11-07','2026-11-09']])insert.run(id,id,'hash',arrival,departure,new Date(Date.now()-60000).toISOString(),'cs_'+id);
 function prepare(sql,args=[]){return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})};}
 const env={STRIPE_SECRET_KEY:'sk_test_dummy',BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const statement of statements)await statement.run();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}}};
 const original=globalThis.fetch;globalThis.fetch=async url=>{
  const id=new URL(url).pathname.split('/').at(-1).replace('cs_','');
  if(id==='unknown')return new Response('{}',{status:503});
  return Response.json({id:'cs_'+id,livemode:false,status:id==='paid'?'complete':'expired',metadata:{reservation_id:id,purpose:'stay'},payment_status:id==='paid'?'paid':'unpaid',amount_total:15000,currency:'eur',payment_intent:'pi_test'});
 };
 try{
  await reconcilePayments(env);await reconcilePayments(env);
  assert.equal(db.prepare("SELECT status FROM stays WHERE id='expired'").get().status,'expired');
  assert.equal(db.prepare("SELECT status FROM stays WHERE id='paid'").get().status,'confirmed');
  assert.equal(db.prepare("SELECT status FROM stays WHERE id='unknown'").get().status,'awaiting_payment');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE kind='confirmation'").get().n,1);
 }finally{globalThis.fetch=original;db.close();}
});

test('tax-inclusive prices preserve totals and apply exemptions and optional hours',()=>{
 const stay={arrival:'2026-11-13',departure:'2026-11-15',guests:2,rate:'fixed',total_cents:15000};
 const env={TOURIST_TAX_RATE:'0.05',TOURIST_TAX_ADDITIONAL_RATE:'0.10'};
 const {taxDetails,...price}=stayBreakdown(stay,env);
 assert.deepEqual(price,{nights:2,location:14216,options:0,tax:784,total:15000,taxable:2});
 assert.equal(taxDetails.communal+taxDetails.departmental,taxDetails.total);
 const exempt=stayBreakdown({...stay,taxable_guests:0},env);assert.equal(exempt.tax,0);assert.equal(exempt.location,15000);
 const option=stayBreakdown({...stay,total_cents:16000,early_arrival:1,late_departure:1},env);assert.equal(option.options,1000);assert.equal(option.tax,784);
 // Some tax-inclusive cent prices have no exact net/tax split after per-person rounding.
 // They need a manual quote rather than a silently inconsistent invoice.
 assert.throws(()=>stayBreakdown({...stay,taxable_guests:1},env),/Répartition de taxe/);
 assert.throws(()=>stayBreakdown({...stay,total_cents:15001},env));
});
test('January owner-approved tax excludes the departmental addition and preserves the guest total',()=>{
 const stay={arrival:'2027-01-18',departure:'2027-01-22',guests:2,rate:'flex',total_cents:32200,early_arrival:1,late_departure:1};
 const {taxDetails,...price}=stayBreakdown(stay,{TOURIST_TAX_RATE:'0.05',TOURIST_TAX_ADDITIONAL_RATE:'0'});
 assert.deepEqual(price,{nights:4,location:29712,options:1000,tax:1488,total:32200,taxable:2});
 assert.equal(taxDetails.departmental,0);
});
test('owner tax detail preserves the archived rates and reconstructs legacy totals',()=>{
 const stay={id:'tax-detail',arrival:'2027-01-18',departure:'2027-01-22',guests:2,rate:'flex',total_cents:32200,early_arrival:1,late_departure:1};
 const env={TOURIST_TAX_RATE:'0.05',TOURIST_TAX_ADDITIONAL_RATE:'0.10'};
 stay.contract_html=renderContract(stay,env);
 const detail=ownerTaxBreakdown(stay,{...env,TOURIST_TAX_ADDITIONAL_RATE:'0'});
 assert.equal(detail.communal,1480);assert.equal(detail.departmental,152);assert.equal(detail.total,1632);
 assert.equal(detail.daily[0].communalPerPerson,185);assert.equal(detail.daily[0].departmentalPerPerson,19);
 const model=savedDocumentModel(stay.contract_html);delete model.price.taxDetails;
 stay.contract_html=stay.contract_html.replace(/<script id="berry-document-model" type="application\/json">[\s\S]*?<\/script>/,`<script id="berry-document-model" type="application/json">${JSON.stringify(model)}</script>`);
 assert.deepEqual(ownerTaxBreakdown(stay,env),detail);
});
test('contract freezes descriptive annex and never prechecks a missing acceptance',()=>{
 const stay={id:'2026-001',arrival:'2026-11-13',departure:'2026-11-15',guests:2,rate:'fixed',total_cents:15000,customer_name:'</script><script>attack</script>'};
 const html=renderContract(stay,{}),model=savedDocumentModel(html);
 assert.equal(model.guest[0],stay.customer_name);assert.equal(model.accepted,false);assert.equal(model.insuranceAccepted,false);
 assert.equal(model.inventory.length,5);assert.ok(html.includes('Lire la fiche descriptive associée'));assert.ok(!html.includes('</script><script>attack'));
});

test('cash stay: owner approval, guest consent, no Stripe payment, one audited receipt',async()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql','0004_cash_receipts.sql'])db.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 db.exec(readFileSync(new URL('./migrations/0015_booking_settings.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('./migrations/0016_dated_minimum_stays.sql',import.meta.url),'utf8'));
 function prepare(sql,args=[]){return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({success:true,results:db.prepare(sql).all(...args)}),run:async()=>({success:true,meta:db.prepare(sql).run(...args)})};}
 const time=new Date().toISOString();
 db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at,insurance_accepted_at) VALUES ('cash','key','hash','2026-11-13','2026-11-15','Voyageur','guest@example.test','0600000000',2,'flex',1,1,17800,'cash','v',?,?,?)`).run(time,time,time);
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='cash-key';
 const issuer='https://test.cloudflareaccess.com',origin='https://example.test';
 const env={BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const statement of statements)await statement.run();db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}},ACCESS_ISSUER:issuer,ACCESS_AUD:'private',OWNER_EMAIL:'owner@example.test',SITE_ORIGIN:origin,CONTRACT_APPROVED:'true',STRIPE_EXTENDED_AUTHORIZATION_ENABLED:'true',OWNER_NAME:'Loueur',OWNER_ADDRESS:'Adresse',OWNER_STATUS:'EI',APARTMENT_AREA:'47',APARTMENT_ROOMS:'T2',APARTMENT_CLASSIFICATION:'Non classé',TOURIST_TAX_DESCRIPTION:'5 %',TOURIST_TAX_RATE:'.05',TOURIST_TAX_ADDITIONAL_RATE:'.10',DEPOSIT_RELEASE_TERMS:'48 h',GUEST_INSURANCE_TERMS:'Assurance',INTERMEDIARY_TERMS:'Aucun',AIRBNB_ICAL:'https://calendar.test/airbnb',BOOKING_ICAL:'https://calendar.test/booking',CONTACT_FROM:'site@example.test',RESEND_API_KEY:'test'};
 const b=value=>Buffer.from(JSON.stringify(value)).toString('base64url');const content=b({alg:'RS256',kid:jwk.kid})+'.'+b({iss:issuer,aud:['private'],email:env.OWNER_EMAIL,exp:Date.now()/1000+60});
 const jwt=content+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(content))).toString('base64url');
 const mails=[],original=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{const url=String(input);if(url.startsWith(issuer))return Response.json({keys:[jwk]});if(url.startsWith('https://calendar.test'))return new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR');if(url==='https://api.resend.com/emails'){mails.push(JSON.parse(options.body));return Response.json({id:'mail-'+mails.length});}throw Error('No Stripe or unexpected external request allowed');};
 const admin=(path,data,auth=true)=>flowFetch(new Request(origin+'/api/admin/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(auth?{'Cf-Access-Jwt-Assertion':jwt}:{})},body:JSON.stringify(data)}),env);
 try{
  env.STRIPE_EXTENDED_AUTHORIZATION_ENABLED='false';
  assert.equal((await admin('decision',{id:'cash',action:'approve'})).status,200);
  const queued=db.prepare("SELECT payload FROM mail_outbox WHERE kind='payment_link'").get();const token=JSON.parse(queued.payload).url.split('#')[1];
  let stay=db.prepare("SELECT * FROM stays WHERE id='cash'").get();assert.equal(stay.status,'awaiting_payment');
  const model=savedDocumentModel(stay.contract_html);assert.equal(model.payment,'cash');assert.equal(model.price.options,1000);assert.match(model.cancellation[0],/remboursable/);assert.match(model.paymentTerms,/espèces lors du rendez-vous/);
  const guest=data=>flowFetch(new Request(origin+'/api/guest/accept',{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data)}),env);
  const consent={accepted:true,depositAccepted:true,contractHash:stay.contract_hash,signer:'Voyageur'};
  assert.equal((await guest({...consent,depositAccepted:false})).status,400);
  // Cash acceptance remains possible in the last 30 minutes; Stripe's minimum session duration is irrelevant.
  db.prepare("UPDATE stays SET payment_due_at=? WHERE id='cash'").run(new Date(Date.now()+10*60000).toISOString());
  assert.equal((await guest(consent)).status,200);assert.equal((await guest(consent)).status,200);
  stay=db.prepare("SELECT * FROM stays WHERE id='cash'").get();assert.equal(stay.status,'confirmed');assert.equal(stay.flow_stage,'cash_due');assert.equal(stay.paid_at,null);assert.equal(stay.stripe_checkout_id,null);
  assert.equal(db.prepare("SELECT count(*) AS n FROM mail_outbox WHERE kind='confirmation'").get().n,1);
  const confirmedView=await flowFetch(new Request(origin+'/api/guest/stay',{headers:{Authorization:'Bearer '+token}}),env);
  const confirmedData=await confirmedView.json();assert.equal(savedDocumentModel(confirmedData.contractHtml).accepted,true);
  assert.equal(savedDocumentModel(stay.contract_html).accepted,false);assert.equal(confirmedData.contractHash,await digest(stay.contract_html));

  await sendQueuedMail(env);const confirmation=mails.find(m=>m.subject.startsWith('Votre réservation est confirmée'));assert.match(confirmation.text,/reste à régler/);assert.doesNotMatch(confirmation.text,/Votre paiement a été reçu/);assert.equal(confirmation.attachments.length,2);
  assert.equal((await admin('cash-received',{id:'cash',received:true,amountCents:17800},false)).status,403);
  assert.equal((await admin('cash-received',{id:'cash',received:true,amountCents:1})).status,400);
  assert.equal((await admin('cash-received',{id:'cash',received:false,amountCents:17800})).status,400);
  const receive={id:'cash',received:true,amountCents:17800};assert.equal((await admin('cash-received',receive)).status,200);assert.equal((await admin('cash-received',receive)).status,200);
  stay=db.prepare("SELECT * FROM stays WHERE id='cash'").get();assert.ok(stay.paid_at);assert.equal(stay.cash_received_by,'owner@example.test');
  assert.equal(db.prepare("SELECT count(*) AS n FROM mail_outbox WHERE kind='payment_receipt'").get().n,1);
  await sendQueuedMail(env);await sendQueuedMail(env);assert.equal(mails.filter(m=>m.subject.startsWith('Reçu')).length,1);assert.match(mails.find(m=>m.subject.startsWith('Reçu')).text,/178.00 €/);
 }finally{globalThis.fetch=original;db.close();}
});


test('annual contract numbers persist, restart each year and never reuse deleted references',()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql','0004_cash_receipts.sql'])db.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 const insert=db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at) VALUES (?,?,?,?,'2027-12-30','Test','guest@example.test','0600000000',2,'fixed',0,0,15000,'card','v','time',?)`);
 const add=(id,arrival,time=id)=>insert.run(id,id,'hash',arrival,time);
 add('first','2026-11-13','1');add('second','2026-11-20','2');
 db.exec(readFileSync(new URL('./migrations/0005_contract_numbers.sql',import.meta.url),'utf8'));
 const number=id=>db.prepare('SELECT contract_number FROM stays WHERE id=?').get(id).contract_number;
 assert.equal(number('first'),'2026-001');assert.equal(number('second'),'2026-002');
 add('third','2026-12-01');add('next-year','2027-01-01');
 assert.equal(number('third'),'2026-003');assert.equal(number('next-year'),'2027-001');
 db.prepare('DELETE FROM stays WHERE id=?').run('third');add('fourth','2026-12-05');assert.equal(number('fourth'),'2026-004');
 db.prepare('UPDATE stays SET arrival=? WHERE id=?').run('2027-01-02','first');assert.equal(number('first'),'2026-001');
 const html=renderContract({id:'internal',contract_number:'2026-004',arrival:'2026-11-13',departure:'2026-11-15',guests:2,rate:'fixed',total_cents:15000},{});
 assert.equal(savedDocumentModel(html).number,'2026-004');
});

test('deposit lifecycle: retry expired links, ignore old events, reconcile and release once',async()=>{
 const {depositAction,refreshDeposit}=await import('./deposit.mjs');
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql','0004_cash_receipts.sql','0005_contract_numbers.sql','0006_deposit_lifecycle.sql','0007_cancellations.sql','0008_damage_claims.sql'])db.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 const today=parisDay(),tomorrow=parisDay(new Date(Date.now()+86400000));
 db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,status,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at) VALUES ('hold','hold','hash',?,?,'confirmed','Fictif','guest@example.test','0600000000',2,'fixed',0,0,15000,'cash','v','time','time')`).run(today,tomorrow);
 function prepare(sql,args=[]){return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)};}
 const env={STRIPE_EXTENDED_AUTHORIZATION_ENABLED:'false',STRIPE_SECRET_KEY:'sk_test_dummy',SITE_ORIGIN:'https://example.test',BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const statement of statements)await statement.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
 db.exec("UPDATE stays SET contract_accepted_at='time' WHERE id='hold'; INSERT INTO mail_outbox(id,stay_id,kind,created_at,sent_at) VALUES('hold-confirm','hold','confirmation','time','time');");
 const getStay=()=>db.prepare('SELECT * FROM stays WHERE id=?').get('hold'),getDeposit=()=>db.prepare('SELECT * FROM deposits WHERE stay_id=?').get('hold');
 let sessionState='open',intentState='requires_capture',cancels=0,creations=0,fail=false;
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(fail)throw Error('offline');
  if(String(url).endsWith('/checkout/sessions')){creations++;const body=new URLSearchParams(options.body);assert.equal(body.get('payment_method_options[card][request_extended_authorization]'),null);assert.equal(body.get('payment_intent_data[capture_method]'),'manual');assert.equal(body.get('line_items[0][price_data][unit_amount]'),'30000');assert.ok(body.get('success_url').includes('garantie=1'));return Response.json({id:'cs_test_attempt'+creations,url:'https://checkout.stripe.com/test'+creations});}
  if(String(url).includes('/checkout/sessions/'))return Response.json({id:getDeposit().checkout_id,status:sessionState,metadata:{reservation_id:'hold'},payment_intent:'pi_testhold'});
  if(String(url).endsWith('/cancel')){cancels++;intentState='canceled';return Response.json({status:'canceled'});}
  return Response.json({status:intentState,amount:30000,currency:'eur',latest_charge:{payment_method_details:{card:{capture_before:Math.floor(Date.now()/1000)+7*86400}}}});
 };
 try{
  await depositAction(getStay(),{action:'request'},env);assert.equal(creations,1);
  await depositAction(getStay(),{action:'request'},env);assert.equal(creations,1);
  const firstId=getDeposit().checkout_id;
  sessionState='expired';await refreshDeposit(getStay(),env);assert.equal(getDeposit().status,'expired');
  db.prepare("UPDATE mail_outbox SET sent_at='sent',provider_id='old' WHERE kind='deposit_link'").run();
  await depositAction(getStay(),{action:'request'},env);assert.equal(getDeposit().attempt,2);assert.equal(creations,2);
  assert.equal(db.prepare("SELECT sent_at FROM mail_outbox WHERE kind='deposit_link'").get().sent_at,null);
  await depositEvent({id:firstId,status:'expired',metadata:{reservation_id:'hold'}},env);assert.equal(getDeposit().status,'requested');
  sessionState='complete';await refreshDeposit(getStay(),env);assert.equal(getDeposit().status,'authorized');
  fail=true;await assert.rejects(refreshDeposit(getStay(),env));assert.equal(getDeposit().status,'authorized');fail=false;
  await assert.rejects(depositAction(getStay(),{action:'release'},env),/contrôle/);
  await assert.rejects(depositAction(getStay(),{action:'release',inspected:true},env),/après le départ/);assert.equal(cancels,0);
  const yesterday=parisDay(new Date(Date.now()-86400000)),twoDaysAgo=parisDay(new Date(Date.now()-2*86400000));db.prepare('UPDATE stays SET arrival=?,departure=? WHERE id=?').run(twoDaysAgo,yesterday,'hold');
  await depositAction(getStay(),{action:'release',inspected:true},env);assert.equal(getDeposit().status,'released');assert.ok(getDeposit().released_at);
  await depositAction(getStay(),{action:'release',inspected:true},env);assert.equal(cancels,1);
  await depositEvent({id:getDeposit().checkout_id,metadata:{reservation_id:'hold'},payment_intent:'pi_testhold'},env);assert.equal(getDeposit().status,'released');
 }finally{globalThis.fetch=original;db.close();}
});

test('deposit return cannot confirm a stay or reveal customer coordinates',async()=>{
 let touched=false;const env={BERRY_DB:{prepare:()=>{touched=true;throw Error('Should not read');}}};
 assert.equal((await flowFetch(new Request('https://example.test/api/guest/deposit-status?session_id=bad'),env)).status,403);assert.equal(touched,false);
 const fields=checkoutFields({id:'stay',customer_email:'guest@example.test',total_cents:7000},'https://example.test','deposit');
 assert.ok(fields.cancel_url.includes('garantie=1'));assert.ok(fields.success_url.includes('{CHECKOUT_SESSION_ID}'));
});

test('automatic guarantee mail: 48-hour trigger, last-minute confirmation, retries without duplicates',async()=>{
 const {requestDueDeposits,depositRequestDueAt}=await import('./deposit.mjs');
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql','0004_cash_receipts.sql','0005_contract_numbers.sql','0006_deposit_lifecycle.sql','0007_cancellations.sql','0008_damage_claims.sql'])db.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 function prepare(sql,args=[]){return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)};}
 const env={STRIPE_EXTENDED_AUTHORIZATION_ENABLED:'false',STRIPE_SECRET_KEY:'sk_test_dummy',SITE_ORIGIN:'https://letapeduberry.fr',CONTACT_FROM:'L’Étape du Berry <site@messages.letapeduberry.fr>',RESEND_API_KEY:'local',BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const statement of statements)await statement.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const arrival=parisDay(new Date(Date.now()+5*86400000)),departure=parisDay(new Date(Date.now()+6*86400000));
 const insert=db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,status,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at) VALUES (?,?, 'hash',?, ?,?,'Fictif','guest@example.test','0600000000',1,'fixed',1,0,7500,'cash','v','time','time')`);
 insert.run('automatic','automatic',arrival,departure,'confirmed');
 db.exec("UPDATE stays SET contract_accepted_at='time' WHERE id='automatic'; INSERT INTO mail_outbox(id,stay_id,kind,created_at,sent_at) VALUES('auto-confirm','automatic','confirmation','time',NULL);");
 const due=depositRequestDueAt({arrival,early_arrival:1}),OriginalDate=Date,originalNow=Date.now,originalFetch=globalThis.fetch;let creations=0,offline=false;const mails=[];
 globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[Date.now()]));}};
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.resend.com/emails'){mails.push(JSON.parse(options.body));return Response.json({id:'mail'+mails.length});}
  if(offline)throw Error('temporary Stripe outage');
  assert.ok(String(url).endsWith('/checkout/sessions'));creations++;
  return Response.json({id:'cs_test_auto'+creations,url:'https://checkout.stripe.com/auto'+creations});
 };
 try{
  Date.now=()=>due-1;await requestDueDeposits(env);assert.equal(creations,0);
  Date.now=()=>due;await requestDueDeposits(env);assert.equal(creations,0);
  db.exec("UPDATE mail_outbox SET sent_at='sent' WHERE id='auto-confirm'");
  offline=true;await requestDueDeposits(env);assert.equal(db.prepare('SELECT count(*) AS n FROM deposits').get().n,0);assert.equal(db.prepare('SELECT status FROM stays WHERE id=?').get('automatic').status,'confirmed');
  offline=false;await requestDueDeposits(env);await requestDueDeposits(env);assert.equal(creations,1);
  await sendQueuedMail(env);await sendQueuedMail(env);assert.equal(mails.length,1);
  assert.deepEqual(mails[0].to,['guest@example.test']);assert.equal(mails[0].reply_to,'contact@letapeduberry.fr');assert.match(mails[0].text,/300 €/);assert.match(mails[0].text,/sans débit immédiat/);assert.match(mails[0].text,/checkout.stripe.com/);
  // A booking confirmed inside the 48-hour window is eligible immediately.
  // The existing reservation is removed from this fixture to avoid overlap protection.
  db.prepare("UPDATE stays SET status='cancelled' WHERE id='automatic'").run();
  insert.run('lastminute','lastminute',arrival,departure,'confirmed');db.exec("UPDATE stays SET contract_accepted_at='time' WHERE id='lastminute'; INSERT INTO mail_outbox(id,stay_id,kind,created_at,sent_at) VALUES('last-confirm','lastminute','confirmation','time','time');");Date.now=()=>due+3600000;
  await requestDueDeposits(env);await sendQueuedMail(env);assert.equal(creations,2);assert.equal(mails.length,2);
 }finally{globalThis.Date=OriginalDate;Date.now=originalNow;globalThis.fetch=originalFetch;db.close();}
});

test('cancellation policy: exact 24h boundary, options, unused tax, cash and owner exception',async()=>{
 const {cancellationPlan}=await import('./cancellation.mjs');
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-11-19T15:00:00Z');
 const base={id:'cancel-policy',status:'confirmed',arrival:'2026-11-20',departure:'2026-11-22',early_arrival:1,late_departure:1,guests:2,rate:'flex',total_cents:17800,payment_preference:'card',paid_at:'paid',stripe_payment_intent_id:'pi_policy',created_at:'2026-10-06T12:00:00Z'};
 const stay={...base,contract_html:renderContract(base,{TOURIST_TAX_ADDITIONAL_RATE:'.10'})};
 const data={cause:'guest',reason:'Demande du voyageur',notifiedAt:'2026-11-19T13:00:00Z'};
 try{
  const onTime=await cancellationPlan(stay,data);assert.equal(onTime.refundCents,17800);assert.equal(onTime.retainedCents,0);assert.equal(onTime.owedCents,0);
  const late=await cancellationPlan(stay,{...data,notifiedAt:'2026-11-19T13:00:01Z'});assert.equal(late.refundCents,876);assert.equal(late.retainedCents,16924);
  const cash=await cancellationPlan({...stay,payment_preference:'cash',paid_at:null},{...data,notifiedAt:'2026-11-19T13:00:01Z'});assert.equal(cash.refundCents,0);assert.equal(cash.owedCents,16924);
  assert.equal((await cancellationPlan(stay,{...data,cause:'owner',notifiedAt:'2026-11-19T14:00:00Z'})).refundCents,17800);
  assert.equal((await cancellationPlan(stay,{...data,cause:'exception'})).refundCents,17800);
  await assert.rejects(cancellationPlan(stay,{...data,cause:'guarantee_refusal'}),/volontaire/);
  assert.equal((await cancellationPlan(stay,{...data,cause:'guarantee_refusal',refusalConfirmed:true})).refundCents,876);
  const fixed={...base,rate:'fixed',total_cents:16000};fixed.contract_html=renderContract(fixed,{TOURIST_TAX_ADDITIONAL_RATE:'.10'});
  assert.equal((await cancellationPlan(fixed,data)).refundCents,784);
  await assert.rejects(cancellationPlan(stay,{...data,notifiedAt:'2026-11-19T16:00:00Z'}),/Date/);
  await assert.rejects(cancellationPlan({...stay,contract_html:'legacy'},data),/archivé/);
  Date.now=()=>Date.parse('2026-11-20T13:00:00Z');await assert.rejects(cancellationPlan(stay,data),/commencé/);
 }finally{Date.now=originalNow;}
});

test('cancellation transactions: one refund, released calendar, pending reconciliation and honest mail',async()=>{
 const {cancellationPlan,cancelStay,processCancellation,acknowledgeCashRefund}=await import('./cancellation.mjs');
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql','0004_cash_receipts.sql','0005_contract_numbers.sql','0006_deposit_lifecycle.sql','0007_cancellations.sql','0008_damage_claims.sql'])db.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 function prepare(sql,args=[]){return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({success:true,results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)};}
 const env={STRIPE_SECRET_KEY:'sk_test_dummy',OWNER_EMAIL:'owner@example.test',CONTACT_FROM:'site@messages.letapeduberry.fr',RESEND_API_KEY:'local',CALENDAR_EXPORT_TOKEN:'a'.repeat(64),BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const statement of statements)await statement.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const base={id:'cancel-card',arrival:'2026-11-20',departure:'2026-11-22',early_arrival:1,late_departure:1,guests:2,rate:'flex',total_cents:17800};
 const insert=db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,status,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at,paid_at,stripe_payment_intent_id,contract_html) VALUES (?,?,'hash','2026-11-20','2026-11-22','confirmed','Fictif','guest@example.test','0600000000',2,'flex',1,1,17800,?,'v','time','2026-10-06T10:00:00Z','paid',?,?)`);
 insert.run(base.id,base.id,'card','pi_cancelcard',renderContract(base,{TOURIST_TAX_ADDITIONAL_RATE:'.10'}));
 db.prepare("INSERT INTO mail_outbox(id,stay_id,kind,created_at) VALUES ('obsolete',?,'confirmation',?)").run(base.id,new Date().toISOString());
 db.prepare("INSERT INTO deposits(stay_id,checkout_id,checkout_url,status) VALUES (?, 'cs_testcancel', 'https://checkout.stripe.com/cancel', 'requested')").run(base.id);
 const stay=()=>db.prepare('SELECT * FROM stays WHERE id=?').get(base.id),record=()=>db.prepare('SELECT * FROM cancellations WHERE stay_id=?').get(base.id);
 const original=globalThis.fetch;let refundCreates=0,refundState='pending',offline=true,expiredLinks=0,releasedHolds=0;const mails=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.resend.com/emails'){mails.push(JSON.parse(options.body));return Response.json({id:'mail'+mails.length});}
  if(offline)throw Error('network failure');
  if(String(url).includes('/checkout/sessions/')){if(String(url).endsWith('/expire')){expiredLinks++;return Response.json({status:'expired'});}return Response.json({id:'cs_testcancel',status:'open'});}
  if(String(url).includes('/payment_intents/pi_cancelhold')){if(String(url).endsWith('/cancel')){releasedHolds++;return Response.json({status:'canceled'});}return Response.json({status:'requires_capture',amount:30000,currency:'eur',latest_charge:{payment_method_details:{card:{capture_before:Math.floor(Date.now()/1000)+60*86400}}}});}
  if(String(url).endsWith('/refunds')){refundCreates++;assert.equal(new URLSearchParams(options.body).get('amount'),'17800');assert.equal(options.headers['Idempotency-Key'],'cancel-refund-cancel-card');}
  return Response.json({id:'re_cancelcard',amount:17800,currency:'eur',payment_intent:'pi_cancelcard',status:refundState});
 };
 const data={cause:'guest',reason:'Demande du voyageur',notifiedAt:'2026-10-06T11:00:00Z'};
 try{
  const plan=await cancellationPlan(stay(),data);
  await assert.rejects(cancelStay(stay(),{...data,confirmed:false,planHash:plan.hash},env));assert.equal(stay().status,'confirmed');
  await cancelStay(stay(),{...data,confirmed:true,planHash:plan.hash},env);assert.equal(stay().status,'cancelled');assert.equal(record().refund_status,'pending');
  const ical=await calendarExport(new Request('https://example.test/calendrier/direct/'+env.CALENDAR_EXPORT_TOKEN+'.ics'),env);assert.ok(!(await ical.text()).includes('BEGIN:VEVENT'));
  await sendQueuedMail(env);assert.equal(mails.length,1);assert.match(mails[0].subject,/Annulation/);assert.match(mails[0].text,/à rembourser/);
  offline=false;await processCancellation(stay(),env);assert.equal(refundCreates,1);assert.equal(record().refund_status,'pending');assert.equal(record().deposit_done,1);assert.equal(expiredLinks,1);
  refundState='succeeded';await cancelStay(stay(),{},env);assert.equal(refundCreates,1);assert.equal(record().refund_status,'succeeded');
  await sendQueuedMail(env);await processCancellation(stay(),env);await sendQueuedMail(env);assert.equal(mails.length,2);assert.match(mails[1].subject,/remboursement/);
  insert.run('cancel-cash','cancel-cash','cash',null,renderContract({...base,id:'cancel-cash',payment_preference:'cash'},{TOURIST_TAX_ADDITIONAL_RATE:'.10'}));
  db.prepare("INSERT INTO deposits(stay_id,checkout_id,payment_intent_id,status) VALUES ('cancel-cash','cs_testhold','pi_cancelhold','authorized')").run();
  const cash=()=>db.prepare('SELECT * FROM stays WHERE id=?').get('cancel-cash');const cp=await cancellationPlan(cash(),data);
  await cancelStay(cash(),{...data,confirmed:true,planHash:cp.hash},env);assert.equal(db.prepare('SELECT refund_status FROM cancellations WHERE stay_id=?').get('cancel-cash').refund_status,'manual');
  await assert.rejects(acknowledgeCashRefund(cash(),{amountCents:17800,refunded:false},env));
  await acknowledgeCashRefund(cash(),{amountCents:17800,refunded:true},env);await acknowledgeCashRefund(cash(),{amountCents:17800,refunded:true},env);assert.equal(refundCreates,1);assert.equal(releasedHolds,1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM mail_outbox WHERE stay_id='cancel-cash' AND kind='refund_update'").get().n,1);
 }finally{globalThis.fetch=original;db.close();}
});

test('damage retention: justified notice, exact amount, expired hold and uncertain capture without duplicates',async()=>{
 const {damageAction}=await import('./damage.mjs');const {depositAction}=await import('./deposit.mjs');
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_stays.sql','0002_booking_flow.sql','0003_insurance_consent.sql','0004_cash_receipts.sql','0005_contract_numbers.sql','0006_deposit_lifecycle.sql','0007_cancellations.sql','0008_damage_claims.sql'])db.exec(readFileSync(new URL('./migrations/'+name,import.meta.url),'utf8'));
 db.prepare(`INSERT INTO stays(id,request_key,payload_hash,arrival,departure,status,customer_name,customer_email,customer_phone,guests,rate,early_arrival,late_departure,total_cents,payment_preference,rules_version,rules_accepted_at,created_at) VALUES ('damage','damage','hash','2026-01-01','2026-01-03','confirmed','Fictif','guest@example.test','0600000000',2,'fixed',0,0,15000,'card','v','time','time')`).run();
 db.prepare("INSERT INTO deposits(stay_id,checkout_id,payment_intent_id,status,capture_before) VALUES ('damage','cs_damage','pi_damage','authorized',?)").run(new Date(Date.now()+86400000).toISOString());
 function prepare(sql,args=[]) {return {bind:(...values)=>prepare(sql,values),first:async()=>db.prepare(sql).get(...args)??null,all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})};}
 const env={STRIPE_SECRET_KEY:'sk_test_dummy',OWNER_EMAIL:'owner@example.test',RESEND_API_KEY:'local',CONTACT_FROM:'site@messages.letapeduberry.fr',BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
 db.prepare('UPDATE stays SET departure=?').run(parisDay(new Date(Date.now()-86400000)));
 const stay=db.prepare('SELECT * FROM stays').get();let captures=0,received=0,expired=false,loseResponse=true;
 const mails=[];const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.resend.com/emails'){mails.push(JSON.parse(options.body));return Response.json({id:'mail_damage_'+mails.length});}
  if(String(url).endsWith('/capture')){captures++;assert.equal(options.headers['Idempotency-Key'],'damage-pi_damage');assert.equal(new URLSearchParams(options.body).get('amount_to_capture'),'8500');assert.equal(new URLSearchParams(options.body).get('final_capture'),'true');received=8500;if(loseResponse)throw Error('Lost response');}
  return Response.json({id:'pi_damage',currency:'eur',amount:30000,amount_received:received,amount_capturable:received?0:30000,status:received?'succeeded':'requires_capture',latest_charge:{payment_method_details:{card:{capture_before:Math.floor(Date.now()/1000)+(expired?-60:86400)}}}});
 };
 const body={action:'damage-prepare',amountCents:8500,reason:'Table abîmée constatée à la sortie',evidence:'Photos sortie et devis remplacement du plateau',justified:true};
 try{
  for(const invalid of [{amountCents:30001},{amountCents:0},{amountCents:1.5},{justified:false},{evidence:'court'}])await assert.rejects(damageAction(stay,{...body,...invalid},env));
  await assert.rejects(damageAction({...stay,departure:'2099-01-01'},body,env));
  await assert.rejects(damageAction({...stay,departure:'2020-01-01'},body,env));
  expired=true;await assert.rejects(damageAction(stay,body,env));assert.equal(db.prepare('SELECT count(*) n FROM damage_claims').get().n,0);expired=false;
  await damageAction(stay,body,env);assert.equal(captures,0);
  await assert.rejects(depositAction(stay,{action:'release',inspected:true},env));
  const capture={action:'damage-capture',amountCents:8500,confirmed:true,communicated:true};
  await assert.rejects(damageAction(stay,capture,env));assert.equal(captures,0);
  await sendQueuedMail(env);assert.equal(mails.length,1);assert.match(mails[0].text,/retenue envisagée/);assert.equal(mails[0].reply_to,'contact@letapeduberry.fr');
  await assert.rejects(damageAction(stay,{...capture,amountCents:8400},env));
  await assert.rejects(damageAction(stay,{...capture,confirmed:false},env));
  await assert.rejects(damageAction(stay,capture,env));assert.equal(captures,1);assert.equal(db.prepare('SELECT status FROM damage_claims').get().status,'capturing');
  assert.equal((await damageAction(stay,{action:'damage-check'},env)).status,'captured');
  assert.equal((await damageAction(stay,capture,env)).status,'captured');assert.equal(captures,1);
  assert.equal(db.prepare('SELECT status FROM deposits').get().status,'captured');assert.equal(db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind='damage_receipt'").get().n,1);
  await sendQueuedMail(env);assert.equal(mails.length,2);assert.match(mails[1].text,/retenue de 85.00/);
  // Separate fictitious dossier: abandoning it must retain its audit and never capture.
  const copy={...db.prepare('SELECT * FROM stays').get(),id:'abandon',request_key:'abandon',contract_number:null};
  const columns=Object.keys(copy);db.prepare('INSERT INTO stays ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...columns.map(k=>copy[k]));
  db.prepare("INSERT INTO deposits(stay_id,checkout_id,payment_intent_id,status) VALUES ('abandon','cs_abandon','pi_abandon','authorized')").run();
  db.prepare("INSERT INTO damage_claims(stay_id,payment_intent_id,amount_cents,reason,evidence,owner_email,created_at,status) VALUES ('abandon','pi_abandon',5000,'Dommage fictif','Photos fictives','owner@example.test',?,'prepared')").run(new Date().toISOString());
  const abandonedStay=db.prepare("SELECT * FROM stays WHERE id='abandon'").get();
  await assert.rejects(damageAction(abandonedStay,{action:'damage-abandon',confirmed:false},env));
  assert.equal((await damageAction(abandonedStay,{action:'damage-abandon',confirmed:true},env)).status,'abandoned');
  await assert.rejects(damageAction(abandonedStay,{...capture,amountCents:5000},env));assert.equal(captures,1);
  assert.equal(db.prepare("SELECT status FROM damage_claims WHERE stay_id='abandon'").get().status,'abandoned');
  assert.equal(db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind='damage_withdrawal'").get().n,1);
  await sendQueuedMail(env);assert.equal(mails.length,3);assert.match(mails[2].text,/retenue envisagée.*abandonnée/s);

 }finally{globalThis.fetch=original;db.close();}
});

 test('structured customer address requires street, postal code and city and keeps one contract address',()=>{
 const addressParts={street:'9 rue de test',postalCode:'18000',city:'Bourges'};
 assert.equal(validateStay({...details,addressParts},'2026-10-03').address,'9 rue de test, 18000 Bourges');
 for(const field of ['street','postalCode','city'])assert.throws(()=>validateStay({...details,addressParts:{...addressParts,[field]:''}},'2026-10-03'));
 assert.equal(validateStay({...details,addressParts:{street:'12 Test Road',postalCode:'SW1A 1AA',city:'London'}},'2026-10-03').address,'12 Test Road, SW1A 1AA London');
 });
