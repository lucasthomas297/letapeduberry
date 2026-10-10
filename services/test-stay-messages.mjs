import test from 'node:test';
import assert from 'node:assert/strict';
import {arrivalMessage,departureReminderMessage,thankYouMessage} from './stay-messages.mjs';
const stay={status:'confirmed',customer_name:'Voyageur fictif',arrival:'2026-11-20',departure:'2026-11-22',payment_preference:'card',paid_at:'time',early_arrival:1,late_departure:1};
const env={ACCESS_KEYBOX_CODE:'TEST_CODE',CASH_WELCOME_FROM:'contract'};
test('departure reminder personalizes the departure date and late option without access secrets',()=>{
 const message=departureReminderMessage({...stay,customer_first_name:'Camille'}).text;
 assert.match(message,/Bonjour Camille,/);assert.match(message,/22 novembre 2026, au plus tard à 12 h/);
 assert.match(departureReminderMessage({...stay,late_departure:0}).text,/au plus tard à 11 h/);
 assert.doesNotMatch(message,/TEST_CODE|Code :|code abrégé/);
 assert.throws(()=>departureReminderMessage({...stay,status:'cancelled'}));
});
test('thank-you message allows a reply and excludes cancelled stays and payment details',()=>{
 const message=thankYouMessage(stay).text;
 assert.match(message,/répondre à cet e-mail/);assert.doesNotMatch(message,/TEST_CODE|300 €|code abrégé/);
 assert.throws(()=>thankYouMessage({...stay,status:'cancelled'}));
});
test('arrival instructions require confirmed paid stay and authorized deposit for self check-in',()=>{
 for(const [s,d] of [[{...stay,status:'pending'},{status:'authorized'}],[{...stay,paid_at:null},{status:'authorized'}],[stay,{status:'review'}],[stay,{status:'requested'}]])assert.throws(()=>arrivalMessage(s,env,d));
 const message=arrivalMessage(stay,env,{status:'authorized'}).text;
 assert.match(message,/20 novembre 2026, à partir de 14 h/);assert.match(message,/22 novembre 2026, au plus tard à 12 h/);assert.match(message,/Code : TEST_CODE/);assert.doesNotMatch(message,/début du code abrégé/);
});
test('cash autonomous arrival requires the guarantee and schedules cash collection after 17:30',()=>{
 const cash={...stay,payment_preference:'cash',paid_at:null};
 assert.throws(()=>arrivalMessage(cash,env,null));
 const message=arrivalMessage(cash,env,{status:'authorized'}).text;
 assert.match(message,/à partir de 14 h/);assert.match(message,/rendez-vous à partir de 17 h 30/);
 assert.match(message,/espèces, contre reçu/);assert.match(message,/Code : TEST_CODE/);
});

import {guestMessageWindows,queueGuestMessages} from './guest-message-schedule.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
test('schedule follows Paris time, options and daylight saving changes',()=>{
 const windows=guestMessageWindows({...stay,arrival:'2026-10-25',departure:'2026-10-26',early_arrival:0});
 assert.equal(new Date(windows[0].due).toISOString(),'2026-10-24T15:00:00.000Z');
 assert.equal(new Date(windows[1].due).toISOString(),'2026-10-25T19:00:00.000Z');
 assert.equal(new Date(windows[2].due).toISOString(),'2026-10-26T17:00:00.000Z');
 assert.equal(new Date(guestMessageWindows({...stay,arrival:'2026-07-20',departure:'2026-07-21'})[0].due).toISOString(),'2026-07-19T12:00:00.000Z');
});
test('scheduler queues once, respects disabled mode, blocks access without guarantee and ignores cancelled stays',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE stays(id TEXT,status TEXT,arrival TEXT,departure TEXT,early_arrival INTEGER,late_departure INTEGER,payment_preference TEXT,paid_at TEXT,customer_name TEXT); CREATE TABLE deposits(stay_id TEXT,status TEXT); CREATE TABLE mail_outbox(id TEXT,stay_id TEXT,kind TEXT,created_at TEXT,sent_at TEXT,UNIQUE(stay_id,kind));");
 db.prepare('INSERT INTO stays VALUES(?,?,?,?,?,?,?,?,?)').run('test','confirmed','2026-11-20','2026-11-22',0,0,'card','paid','Camille');
 const prepare=(sql,args=[])=>({bind:(...a)=>prepare(sql,a),all:async()=>({results:db.prepare(sql).all(...args)}),first:async()=>db.prepare(sql).get(...args),run:async()=>db.prepare(sql).run(...args)});
 db.exec("INSERT INTO mail_outbox VALUES('confirmed','test','confirmation','time','sent')");
 const config={...env,BERRY_DB:{prepare},GUEST_MESSAGES_ENABLED:'false'};
 const now=Date.parse('2026-11-19T15:00:00Z');
 await queueGuestMessages(config,now);assert.equal(db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind!='confirmation'").get().n,0);
 config.GUEST_MESSAGES_ENABLED='true';await queueGuestMessages(config,now);assert.equal(db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind!='confirmation'").get().n,0);
 db.exec("INSERT INTO deposits VALUES('test','authorized')");
 await queueGuestMessages(config,now);await queueGuestMessages(config,now);
 assert.equal(db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind!='confirmation'").get().n,1);
 db.exec("DELETE FROM mail_outbox; UPDATE stays SET status='cancelled'");
 await queueGuestMessages(config,now);assert.equal(db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind!='confirmation'").get().n,0);
 db.close();
});
test('new mail migration preserves existing queued messages and accepts scheduled kinds',()=>{
 const db=new DatabaseSync(':memory:');
 for(const name of ['0001_stays','0002_booking_flow','0003_insurance_consent','0004_cash_receipts','0005_contract_numbers','0006_deposit_lifecycle','0007_cancellations','0008_damage_claims'])db.exec(readFileSync(new URL('./migrations/'+name+'.sql',import.meta.url),'utf8'));
 db.exec('PRAGMA foreign_keys=OFF');
 db.exec("INSERT INTO mail_outbox(id,stay_id,kind,created_at) VALUES('old','stay','confirmation','time')");
 db.exec(readFileSync(new URL('./migrations/0009_guest_messages.sql',import.meta.url),'utf8'));
 assert.equal(db.prepare("SELECT kind FROM mail_outbox WHERE id='old'").get().kind,'confirmation');
 db.exec("INSERT INTO mail_outbox(id,stay_id,kind,created_at) VALUES('new','stay','arrival_instructions','time')");
 assert.equal(db.prepare('SELECT count(*) n FROM mail_outbox').get().n,2);db.close();
});
test('booking within 48h preserves stage order and delayed guarantee unlocks overdue arrival mail',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE stays(id TEXT,status TEXT,arrival TEXT,departure TEXT,early_arrival INTEGER,late_departure INTEGER,payment_preference TEXT,paid_at TEXT,customer_name TEXT);CREATE TABLE deposits(stay_id TEXT,status TEXT);CREATE TABLE mail_outbox(id TEXT,stay_id TEXT,kind TEXT,created_at TEXT,sent_at TEXT,UNIQUE(stay_id,kind));");
 db.prepare('INSERT INTO stays VALUES(?,?,?,?,?,?,?,?,?)').run('last','awaiting_payment','2026-10-20','2026-10-23',0,0,'card',null,'Camille');
 db.exec("INSERT INTO deposits VALUES('last','requested');INSERT INTO mail_outbox VALUES('confirm','last','confirmation','time',NULL)");
 const prepare=(sql,args=[])=>({bind:(...a)=>prepare(sql,a),all:async()=>({results:db.prepare(sql).all(...args)}),first:async()=>db.prepare(sql).get(...args),run:async()=>db.prepare(sql).run(...args)});
 const config={...env,GUEST_MESSAGES_ENABLED:'true',BERRY_DB:{prepare}};
 const count=()=>db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind='arrival_instructions'").get().n;
 const fortyEight=Date.parse('2026-10-18T14:00:00Z'),late=Date.parse('2026-10-19T18:00:00Z');
 await queueGuestMessages(config,late);assert.equal(count(),0);
 db.exec("UPDATE stays SET status='confirmed',paid_at='paid'");await queueGuestMessages(config,late);assert.equal(count(),0);
 db.exec("UPDATE mail_outbox SET sent_at='sent'");await queueGuestMessages(config,late);assert.equal(count(),0);
 db.exec("UPDATE deposits SET status='authorized'");await queueGuestMessages(config,fortyEight);assert.equal(count(),0);
 await queueGuestMessages(config,late);await queueGuestMessages(config,late);assert.equal(count(),1);db.close();
});
