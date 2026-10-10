const token=location.hash.slice(1),status=document.querySelector('#stay-status');
// Keep the private token out of request URLs and referrers.
const headers={Authorization:'Bearer '+token};let stay;
async function load(){try{
 const response=await fetch('/api/guest/stay',{headers});stay=await response.json();if(!response.ok)throw new Error(stay.error);
 const cash=stay.payment==='cash';
 document.querySelector('#accept-deposit-text').textContent='J’accepte les modalités du dépôt de garantie prévues au contrat. '+stay.depositSummary;
 document.querySelector('h1').textContent=cash?'Votre contrat et votre séjour':'Votre contrat et votre paiement';
 document.querySelector('#stay-summary').textContent=`Du ${stay.arrival} au ${stay.departure} · ${(stay.totalCents/100).toFixed(2)} € · Référence ${stay.reference}`;
 document.querySelector('#stay-deadline').textContent=(cash?'Contrat à accepter avant le ':'Paiement à effectuer avant le ')+new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'long',timeStyle:'short'}).format(new Date(stay.deadline))+' (heure de Paris).';
 document.querySelector('#contract').srcdoc=stay.contractHtml;document.querySelector('#save-description').hidden=!stay.descriptionAvailable;document.querySelector('#stay-panel').hidden=false;
 paymentButton.textContent=cash?'Accepter et confirmer mon séjour':'Accepter et payer mon séjour';
 if(stay.status==='confirmed'){
  document.querySelector('#accept-deposit-text').textContent='J’accepte les modalités du dépôt de garantie prévues au contrat. '+stay.depositSummary;
  status.textContent=cash&&!stay.paid?'Votre réservation est confirmée. Le séjour sera réglé en espèces à l’arrivée. Le dépôt de garantie de 300 € est distinct du règlement.':'Votre réservation est confirmée et votre règlement a été enregistré. Vous pouvez télécharger votre contrat PDF.';
  document.querySelector('#contract-form').hidden=true;document.querySelector('#stay-deadline').hidden=true;
 }else status.textContent=cash?'Votre demande est acceptée. Acceptez le contrat pour confirmer la réservation ; vous réglerez en espèces à l’arrivée. '+(stay.depositMethod==='cash'?'Le dépôt de garantie sera remis en espèces lors du rendez-vous le jour de l’arrivée.':'Une carte bancaire reste nécessaire pour la garantie de 300 €.'):'Votre demande a été acceptée. La réservation sera confirmée après paiement.';
}catch(error){status.textContent=error.message||'Votre séjour n’a pas pu être chargé.';}}

for(const [id,path,label] of [['save-contract','contract','contrat-location'],['save-description','description','fiche-descriptive']]){
 document.querySelector('#'+id).onclick=async()=>{
  const button=document.querySelector('#'+id),message=document.querySelector('#payment-status');button.disabled=true;message.textContent='Préparation du PDF…';
  try{const response=await fetch('/api/guest/'+path+'.pdf',{headers,cache:'no-store'});if(!response.ok)throw new Error('Le document ne peut pas être téléchargé pour le moment.');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=label+'-'+stay.reference+'.pdf';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);message.textContent='';}
  catch(error){message.textContent=error.message;}finally{button.disabled=false;}
 };
}
const paymentButton=document.querySelector('#contract-form button[type=submit]'),paymentConsents=[document.querySelector('#accept-contract'),document.querySelector('#accept-deposit')];let paymentSending=false;
function updatePaymentButton(){paymentButton.disabled=paymentSending||!paymentConsents.every(input=>input.checked);}
for(const input of paymentConsents)input.addEventListener('change',updatePaymentButton);
addEventListener('pageshow',updatePaymentButton);updatePaymentButton();
document.querySelector('#contract-form').onsubmit=async event=>{event.preventDefault();if(paymentSending||!paymentConsents.every(input=>input.checked))return;paymentSending=true;const button=event.target.querySelector('button'),message=document.querySelector('#payment-status');button.disabled=true;message.textContent=stay.payment==='cash'?'Confirmation de votre séjour…':'Préparation du paiement sécurisé…';try{const response=await fetch('/api/guest/accept',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({signer:document.querySelector('#signer').value.trim(),accepted:document.querySelector('#accept-contract').checked,depositAccepted:document.querySelector('#accept-deposit').checked,contractHash:stay.contractHash})});const result=await response.json();if(!response.ok)throw new Error(result.error);if(result.confirmed===true&&stay.payment==='cash'){await load();message.textContent='Votre confirmation avec les documents vous sera envoyée par e-mail.';paymentSending=false;updatePaymentButton();return;}if(!result.url?.startsWith('https://checkout.stripe.com/'))throw new Error('Lien de paiement invalide.');try{sessionStorage.setItem('berry-payment-token',token);}catch{}location.assign(result.url);}catch(error){message.textContent=error.message;paymentSending=false;updatePaymentButton();}};
load();
