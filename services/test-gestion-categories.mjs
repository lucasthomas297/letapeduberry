import test from 'node:test';
import assert from 'node:assert/strict';
import {isArchivedStay} from '../assets/gestion-categories.js';
test('future requests and confirmed stays remain current; closed requests are archived',()=>{
 const now=new Date('2026-10-11T10:00:00Z');
 for(const status of ['pending','awaiting_payment','confirmed'])assert.equal(isArchivedStay({status,departure:'2027-01-22'},now),false);
 for(const status of ['declined','expired','cancelled'])assert.equal(isArchivedStay({status,departure:'2027-01-22'},now),true);
 assert.equal(isArchivedStay({status:'confirmed',departure:'2026-10-10'},now),true);
});
test('checkout archives at 11h or noon in Paris, including winter and summer',()=>{
 for(const [date,offset] of [['2027-01-22','+01:00'],['2027-07-22','+02:00']]){
  const stay={status:'confirmed',departure:date};
  assert.equal(isArchivedStay(stay,new Date(date+'T10:59:00'+offset)),false);
  assert.equal(isArchivedStay(stay,new Date(date+'T11:00:00'+offset)),true);
  assert.equal(isArchivedStay({...stay,late_departure:1},new Date(date+'T11:59:00'+offset)),false);
  assert.equal(isArchivedStay({...stay,late_departure:1},new Date(date+'T12:00:00'+offset)),true);
 }
});
