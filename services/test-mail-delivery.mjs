import test from 'node:test';
import assert from 'node:assert/strict';
import {sendDeliveryTest,deliveryTestPage} from './mail-delivery-test.mjs';
import {sendQueuedMail} from './request-worker.mjs';
import {flowFetch} from './booking-flow.mjs';
import {mailDate} from './mail-format.mjs';
test('email dates use Paris daylight saving and winter time without technical timestamps',()=>{
 assert.equal(mailDate('2026-10-10T16:03:49.003Z',{time:true}),'10 octobre 2026 à 18 h 03 (heure de Paris)');
 assert.equal(mailDate('2026-12-10T16:03:49.003Z',{time:true}),'10 décembre 2026 à 17 h 03 (heure de Paris)');
});
test('delivery test uses normal PDFs without accessing production database or allowing arbitrary recipients',async()=>{
 const original=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent=JSON.parse(options.body);assert.match(options.headers['Idempotency-Key'],/^berry-delivery-check-4-nights-\d{4}-\d{2}-\d{2}$/);return Response.json({id:'test-provider-id'});};
 try{
  const result=await sendDeliveryTest({CONTACT_FROM:'site@messages.example.test',RESEND_API_KEY:'test-only',BERRY_DB:{prepare(){throw new Error('Production database must not be used');}}},sendQueuedMail);
  assert.equal(result.accepted,true);assert.deepEqual(sent.to,['contact@letapeduberry.fr']);assert.match(sent.subject,/^TEST/);assert.match(sent.text,/aucune réservation ni aucun paiement réel/);
  assert.doesNotMatch(sent.text,/La durée bancaire effective|\d{4}-\d{2}-\d{2}T\d{2}:/);
  assert.match(sent.text,/300 € en espèces/);assert.doesNotMatch(sent.text,/Empreinte bancaire standard/);assert.match(sent.text,/20 novembre 2026/);assert.equal(sent.attachments.length,2);
  for(const file of sent.attachments)assert.equal(Buffer.from(file.content,'base64').subarray(0,5).toString(),'%PDF-');
 }finally{globalThis.fetch=original;}
});
test('test page is private, uses same-origin form, and distinguishes accepted mail from delivery',async()=>{
 assert.equal((await flowFetch(new Request('https://example.test/api/admin/mail-test'),{})).status,403);
 const page=deliveryTestPage();assert.match(page.headers.get('Content-Security-Policy'),/form-action 'self'/);assert.match(await page.text(),/form method="post"/);
 assert.match(await deliveryTestPage(true).text(),/Vérifiez la boîte/);
});
