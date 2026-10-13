import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {bookingSettings,saveBookingSettings,minimumForArrival} from './booking-settings.mjs';
import {parisDay,dateNumber} from './calendar.mjs';
function fixture(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE stays(id TEXT PRIMARY KEY,arrival TEXT,departure TEXT,status TEXT)');for(const n of ['0015_booking_settings','0016_dated_minimum_stays'])db.exec(readFileSync(new URL('./migrations/'+n+'.sql',import.meta.url),'utf8'));function prepare(sql,args=[]){return {bind:(...a)=>prepare(sql,a),first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>db.prepare(sql).run(...args)};}return {db,env:{OWNER_EMAIL:'owner@example.test',BERRY_DB:{prepare,batch:async statements=>{db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}}};}
const date=offset=>new Date(dateNumber(parisDay())+offset*86400000).toISOString().slice(0,10);
test('date minimum is specific to arrival, overrides the general rule and can be removed without changing received stays',async()=>{
 const {db,env}=fixture(),chosen=date(7),following=date(8);
 try{
  db.prepare('INSERT INTO stays VALUES(?,?,?,?)').run('existing',chosen,following,'confirmed');
  const settings=await saveBookingSettings(env,{dates:[chosen],min_nights:3});assert.equal(minimumForArrival(settings,chosen),3);assert.equal(minimumForArrival(settings,date(14)),1);
  assert.throws(()=>db.prepare('INSERT INTO stays VALUES(?,?,?,?)').run('short',chosen,following,'pending'),/minimum de nuits/);
  db.prepare('INSERT INTO stays VALUES(?,?,?,?)').run('valid',chosen,date(10),'pending');
  db.prepare('INSERT INTO stays VALUES(?,?,?,?)').run('earlier',date(6),following,'pending');
  assert.equal(db.prepare("SELECT departure FROM stays WHERE id='existing'").get().departure,following);
  await saveBookingSettings(env,{min_nights:4});await saveBookingSettings(env,{dates:[chosen],min_nights:1});assert.equal(minimumForArrival(await bookingSettings(env),chosen),1);
  db.prepare('INSERT INTO stays VALUES(?,?,?,?)').run('exception',chosen,following,'pending');
  await saveBookingSettings(env,{dates:[chosen],min_nights:null});assert.equal(minimumForArrival(await bookingSettings(env),chosen),4);assert.throws(()=>db.prepare('INSERT INTO stays VALUES(?,?,?,?)').run('restored',chosen,following,'pending'),/minimum de nuits/);
 }finally{db.close();}
});
test('bulk date rules are validated before any write and reset only the selected dates',async()=>{
 const {db,env}=fixture();try{
  await saveBookingSettings(env,{dates:[date(1),date(2),date(1)],min_nights:2});assert.equal(db.prepare('SELECT COUNT(*) n FROM minimum_stay_dates').get().n,2);
  for(const data of [{dates:[],min_nights:2},{dates:[date(3),'2027-02-30'],min_nights:2},{dates:[date(-1)],min_nights:2},{dates:[date(366)],min_nights:2},{dates:[date(3)],min_nights:0},{dates:[date(3)],min_nights:2.5}])await assert.rejects(saveBookingSettings(env,data));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM minimum_stay_dates').get().n,2);
  await saveBookingSettings(env,{dates:[date(1)],min_nights:null});const settings=await bookingSettings(env);assert.equal(minimumForArrival(settings,date(1)),1);assert.equal(minimumForArrival(settings,date(2)),2);
  assert.equal(db.prepare('SELECT updated_by FROM minimum_stay_dates').get().updated_by,env.OWNER_EMAIL);
 }finally{db.close();}
});
