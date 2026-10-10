import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {depositDeadline,depositOverdue,alertOverdueDeposits} from './deposit-deadline.mjs';
import {arrivalMessage} from './stay-messages.mjs';
test('deadline begins with accepted email and requires exactly twelve hours',()=>{
 const sent='2026-10-20T10:00:00.000Z';
 assert.equal(depositDeadline(sent),'2026-10-20T22:00:00.000Z');
 assert.equal(depositOverdue('requested',sent,Date.parse('2026-10-20T21:59:59Z')),false);
 assert.equal(depositOverdue('requested',sent,Date.parse('2026-10-20T22:00:00Z')),true);
 assert.equal(depositOverdue('authorized',sent,Date.parse('2026-10-21T22:00:00Z')),false);
 assert.equal(depositOverdue('requested',null),false);
});
test('overdue alert queues once, does not cancel, and excludes authorized/cancelled stays',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE stays(id TEXT,status TEXT,arrival TEXT,early_arrival INTEGER);CREATE TABLE deposits(stay_id TEXT,status TEXT);CREATE TABLE mail_outbox(id TEXT,stay_id TEXT,kind TEXT,created_at TEXT,payload TEXT,sent_at TEXT,UNIQUE(stay_id,kind));");
 const sent='2026-10-20T10:00:00Z';
 for(const [id,status,deposit] of [['late','confirmed','requested'],['done','confirmed','authorized'],['cancel','cancelled','requested']]){
  db.prepare('INSERT INTO stays VALUES(?,?,?,?)').run(id,status,'2026-10-22',0);db.prepare('INSERT INTO deposits VALUES(?,?)').run(id,deposit);
  db.prepare('INSERT INTO mail_outbox VALUES(?,?,?,?,?,?)').run(id,id,'deposit_link',sent,'{}',sent);
 }
 const prepare=(sql,args=[])=>({bind:(...a)=>prepare(sql,a),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)});
 const env={BERRY_DB:{prepare}};const now=Date.parse('2026-10-20T22:00:00Z');
 await alertOverdueDeposits(env,now);await alertOverdueDeposits(env,now);
 assert.equal(db.prepare("SELECT count(*) n FROM mail_outbox WHERE kind='deposit_overdue'").get().n,1);
 assert.equal(db.prepare("SELECT status FROM stays WHERE id='late'").get().status,'confirmed');db.close();
});
test('no arrival code with failed, missing, expired or insufficient guarantee',()=>{
 const stay={status:'confirmed',paid_at:'paid',payment_preference:'card'};
 for(const deposit of [null,{status:'requested'},{status:'failed'},{status:'expired'},{status:'review'}])assert.throws(()=>arrivalMessage(stay,{ACCESS_KEYBOX_CODE:'PRIVATE_TEST'},deposit));
});
import {sendQueuedMail} from './request-worker.mjs';
test('overdue mail goes to owner and a resolved guarantee suppresses it',async()=>{
 const queue={mail_id:'timeout',id:'stay',kind:'deposit_overdue',status:'confirmed',customer_name:'Camille',customer_email:'camille@example.test',arrival:'2026-10-20',departure:'2026-10-23',guests:1,total_cents:21000,payload:'{}'};
 let deposit='requested',sent=[],updates=[];
 const env={SITE_ORIGIN:'https://letapeduberry.fr',CONTACT_FROM:'site@messages.letapeduberry.fr',RESEND_API_KEY:'test',BERRY_DB:{prepare:sql=>({bind(){return this;},all:async()=>({results:[queue]}),first:async()=>({status:deposit}),run:async()=>{updates.push(sql);}})}};
 const previous=globalThis.fetch;globalThis.fetch=async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({id:'fake'});};
 try{
  await sendQueuedMail(env);assert.deepEqual(sent[0].to,['contact@letapeduberry.fr']);assert.match(sent[0].text,/Aucune annulation automatique/);assert.doesNotMatch(sent[0].text,/Code :/);
  deposit='authorized';sent=[];await sendQueuedMail(env);assert.equal(sent.length,0);assert.ok(updates.some(sql=>sql.includes('suppressed-resolved')));
 }finally{globalThis.fetch=previous;}
});
import {boundedDeadline,parisArrivalAt} from './booking-timing.mjs';
test('last-minute deadlines cannot exceed arrival, including the early arrival option',()=>{
 const stay={arrival:'2026-10-20',early_arrival:0};
 assert.equal(boundedDeadline(Date.parse('2026-10-19T10:00:00Z'),stay),'2026-10-19T22:00:00.000Z');
 assert.equal(boundedDeadline(Date.parse('2026-10-20T08:00:00Z'),stay),'2026-10-20T14:00:00.000Z');
 assert.equal(parisArrivalAt({...stay,early_arrival:1}),Date.parse('2026-10-20T12:00:00Z'));
 assert.equal(depositDeadline('2026-10-20T08:00:00Z',{...stay,early_arrival:1}),'2026-10-20T12:00:00.000Z');
});
