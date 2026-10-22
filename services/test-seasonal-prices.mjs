import test from 'node:test';
import assert from 'node:assert/strict';
import {nightlyPrice,PRICE_VERSION} from '../assets/nightly-prices.mjs';
import {quoteStay,validateStay,RULES_VERSION} from './stay.mjs';
import {stayBreakdown,renderContract,savedDocumentModel} from './contract.mjs';
const tax={TOURIST_TAX_RATE:'0.05',TOURIST_TAX_ADDITIONAL_RATE:'0.10'};
const next=date=>new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);
const nights=[];
for(let d='2026-12-23';d<'2027-01-03';d=next(d))nights.push([d,d==='2026-12-31'?9200:7600,d==='2026-12-31'?10300:8500]);
for(let d='2027-04-20';d<'2027-04-26';d=next(d))nights.push([d,12100,13500]);
test('all 17 seasonal nights have identical prices in quotes and contract tax breakdowns',()=>{
 assert.equal(RULES_VERSION,PRICE_VERSION);
 for(const [date,fixed,flex] of nights)for(const rate of ['fixed','flex'])for(const guests of [1,2]){
  const amount=rate==='fixed'?fixed:flex;
  const data={arrival:date,departure:next(date),rate,early:false,late:false};
  assert.equal(nightlyPrice(date,rate),amount);
  assert.equal(quoteStay(data,'2026-10-22').totalCents,amount);
  const stay={...data,id:'seasonal',guests,total_cents:amount,rules_version:PRICE_VERSION};
  const b=stayBreakdown(stay,tax);
  assert.equal(b.total,amount);assert.equal(b.location+b.options+b.tax,amount);
  assert.equal(b.taxDetails.daily[0].date,date);
  assert.equal(savedDocumentModel(renderContract(stay,tax)).price.total,amount);
 }
});
test('boundaries remain ordinary; departing on an event date does not charge that night',()=>{
 for(const d of ['2026-12-22','2027-01-03','2027-04-19','2027-04-26'])for(const r of ['fixed','flex'])assert.equal(nightlyPrice(d,r),nightlyPrice(d,r,'legacy'));
 assert.equal(quoteStay({arrival:'2026-12-22',departure:'2026-12-24',rate:'fixed',early:true,late:true},'2026-10-22').totalCents,7000+7600+1500);
 assert.equal(quoteStay({arrival:'2027-04-19',departure:'2027-04-20',rate:'fixed',early:false,late:false},'2026-10-22').totalCents,7000);
});
test('old requests during seasonal dates retain their original quoted tariff and early-arrival price',()=>{
 for(const rules_version of ['2026-10-10-standard-deposit',undefined]){
  const stay={arrival:'2027-04-23',departure:'2027-04-25',guests:2,rate:'fixed',total_cents:16000,early_arrival:1,late_departure:1,rules_version};
  const b=stayBreakdown(stay,tax);assert.equal(b.total,16000);assert.equal(b.options,1000);
 }
});
