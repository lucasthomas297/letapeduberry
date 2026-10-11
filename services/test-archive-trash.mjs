import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {archiveTrash} from './archive-trash.mjs';
import {flowFetch} from './booking-flow.mjs';
test('archive removal is reversible, idempotent and preserves the booking and its documents',async()=>{
 const db=new DatabaseSync(':memory:');db.exec("PRAGMA foreign_keys=ON; CREATE TABLE stays(id TEXT PRIMARY KEY,contract_html TEXT,status TEXT); INSERT INTO stays VALUES ('test','archived contract','declined');");
 db.exec(readFileSync(new URL('./migrations/0012_archive_trash.sql',import.meta.url),'utf8'));
 function prepare(sql,args=[]){return {bind:(...values)=>prepare(sql,values),run:async()=>db.prepare(sql).run(...args)};}
 const env={BERRY_DB:{prepare},OWNER_EMAIL:'owner@example.test'},stay={id:'test',status:'declined',departure:'2027-01-22'};
 try{
  await archiveTrash(stay,'trash',env);await archiveTrash(stay,'trash',env);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM archive_trash').get().n,1);
  assert.equal(db.prepare('SELECT deleted_by FROM archive_trash').get().deleted_by,env.OWNER_EMAIL);
  assert.equal(db.prepare('SELECT contract_html FROM stays').get().contract_html,'archived contract');
  await archiveTrash(stay,'restore',env);await archiveTrash(stay,'restore',env);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM archive_trash').get().n,0);
  await assert.rejects(archiveTrash({...stay,status:'confirmed'},'trash',env,new Date('2026-10-11T10:00:00Z')),/archivés/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM stays').get().n,1);
 }finally{db.close();}
});
test('archive deletion endpoint requires owner authentication before accessing storage',async()=>{
 const response=await flowFetch(new Request('https://example.test/api/admin/archive-trash',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify({id:'test',action:'trash'})}),{BERRY_DB:{prepare(){throw Error('Unauthorized storage access');}}});
 assert.equal(response.status,403);
});
