const hex=bytes=>Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
export const digest=async value=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
export function stripeConfigured(env) {
 const mode=env.STRIPE_MODE||'test';
 return mode==='test'?/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY||''):
  mode==='live' && env.STRIPE_LIVE_ENABLED==='true' && /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY||'');
}
export const stripeObjectModeMatches=(object,env)=>stripeConfigured(env) && object?.livemode===(env.STRIPE_MODE==='live');
// Receive signed production notifications before enabling outgoing live payments.
export function stripeWebhookModeMatches(event,env) {
 if(env.STRIPE_WEBHOOK_ENABLED===undefined)return stripeObjectModeMatches(event,env);
 const mode=env.STRIPE_MODE||'test';
 return env.STRIPE_WEBHOOK_ENABLED==='true' && ['test','live'].includes(mode)
  && new RegExp('^(sk|rk)_'+mode+'_').test(env.STRIPE_SECRET_KEY||'')
  && event?.livemode===(mode==='live');
}
export async function stripe(env,path,fields,key) {
 if(!stripeConfigured(env))throw new Error('Mode Stripe non configuré ou non activé.');
 const response=await fetch('https://api.stripe.com/v1/'+path,{method:fields?'POST':'GET',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,...(fields?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key}:{})},...(fields?{body:new URLSearchParams(fields)}:{}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();if(!response.ok)throw new Error('Stripe momentanément indisponible.');
 if(Object.hasOwn(result,'livemode') && !stripeObjectModeMatches(result,env))throw new Error('Réponse Stripe hors mode configuré.');
 return result;
}
export function checkoutFields(stay,origin,purpose='stay') {
 const deposit=purpose==='deposit';
 const fields={mode:'payment','payment_method_types[0]':'card',client_reference_id:stay.id,customer_email:stay.customer_email,
  'line_items[0][price_data][currency]':'eur','line_items[0][price_data][unit_amount]':String(deposit?30000:stay.total_cents),
  'line_items[0][price_data][product_data][name]':deposit?'Empreinte bancaire — dépôt de garantie de 300 €':'Séjour L’Étape du Berry',
  'line_items[0][quantity]':'1','metadata[reservation_id]':stay.id,'metadata[purpose]':purpose,
  'payment_intent_data[metadata][reservation_id]':stay.id,'payment_intent_data[metadata][purpose]':purpose,
  success_url:origin+'/paiement.html?etat=retour',cancel_url:origin+'/paiement.html?etat=annule'};
 if(deposit){fields['payment_intent_data[capture_method]']='manual';fields.success_url=origin+'/paiement.html?garantie=1&session_id={CHECKOUT_SESSION_ID}';fields.cancel_url=origin+'/paiement.html?garantie=1&etat=annule';}
 else fields.expires_at=String(Math.floor(Date.parse(stay.payment_due_at)/1000));
 return fields;
}
export async function webhookEvent(payload,signature,secret,now=Date.now()) {
 if(!secret?.startsWith('whsec_'))throw new Error('Webhook non configuré');
 const entries=signature.split(',').map(part=>part.trim().split('='));
 const timestamp=entries.find(([key])=>key==='t')?.[1];
 if(!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now/1000-Number(timestamp))>300)throw new Error('Signature expirée');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=new TextEncoder().encode(timestamp+'.'+payload);
 let valid=false;
 for(const [,value] of entries.filter(([name])=>name==='v1')) {
  if(!/^[a-f0-9]{64}$/.test(value))continue;
  if(await crypto.subtle.verify('HMAC',key,Uint8Array.from(value.match(/../g),pair=>parseInt(pair,16)),bytes))valid=true;
 }
 if(!valid)throw new Error('Signature incorrecte');return JSON.parse(payload);
}
