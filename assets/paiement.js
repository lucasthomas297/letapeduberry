const title=document.querySelector('#payment-title'),message=document.querySelector('#payment-message');
const reference=document.querySelector('#payment-reference'),resume=document.querySelector('#resume-payment');
let token='';try{token=sessionStorage.getItem('berry-payment-token')||'';}catch{}
if(!/^[a-f0-9-]{72}$/.test(token))token='';
const guarantee=new URL(location.href).searchParams.has('garantie');
const depositSession=new URL(location.href).searchParams.get('session_id');
const interrupted=new URL(location.href).searchParams.get('etat')==='annule';
function showInterrupted(){title.textContent='Votre paiement a été interrompu';message.textContent='Vous pouvez reprendre votre réservation depuis le lien reçu par e-mail.';if(token){resume.href='sejour.html#'+token;resume.hidden=false;}}
if(interrupted&&!guarantee)showInterrupted();
if(guarantee){title.textContent=interrupted?'Votre autorisation a été interrompue':'Nous vérifions votre garantie bancaire';message.textContent=interrupted?'Vous pouvez réessayer depuis le lien reçu par e-mail. En cas de difficulté, contactez-nous.':'Il s’agit de l’empreinte bancaire de 300 € pour le dépôt de garantie, distincte du paiement du séjour.';}
async function checkPayment(attempt=0){
 if(!token)return;
 try{
  const response=await fetch('/api/guest/payment-status',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
  if(!response.ok)return;
  const result=await response.json();
  if(result.status==='confirmed'){
   title.textContent='Votre réservation est confirmée !';message.textContent='Merci pour votre confiance. Votre confirmation et les informations de votre séjour vous seront envoyées par e-mail.';
   reference.textContent='Référence de votre séjour : '+result.reference;reference.hidden=false;resume.hidden=true;return;
  }
  if(['expired','cancelled','declined'].includes(result.status)){title.textContent='Contactez-nous pour poursuivre';message.textContent='Votre lien de réservation n’est plus disponible. Nous sommes à votre disposition pour organiser votre séjour.';resume.hidden=true;return;}
  if(!interrupted&&attempt<9)setTimeout(()=>checkPayment(attempt+1),3000);
 }catch{ /* Keep a short, neutral message; never infer payment from a URL. */ }
}
if(!guarantee)checkPayment();
async function checkGuarantee(attempt=0){
 if(!depositSession||interrupted)return;
 try{const response=await fetch('/api/guest/deposit-status?session_id='+encodeURIComponent(depositSession),{cache:'no-store'});if(!response.ok)throw Error();const result=await response.json();
  const messages={authorized:['Votre garantie bancaire est autorisée','L’empreinte de 300 € est enregistrée, sans débit immédiat. Nous vous souhaitons un agréable séjour.'],review:['Votre garantie nécessite une vérification','Nous devons vérifier la validité de l’empreinte bancaire. Contactez-nous pour faire le point avant votre arrivée.'],expired:['Votre garantie bancaire a expiré','Contactez-nous pour obtenir un nouveau lien.'],failed:['Votre autorisation n’a pas abouti','Contactez-nous pour réessayer ou utiliser une autre carte.'],released:['Votre garantie bancaire est libérée','Le délai d’affichage dépend de votre banque.']};
  if(messages[result.status]){[title.textContent,message.textContent]=messages[result.status];return;}
 }catch{}
 if(attempt<9)setTimeout(()=>checkGuarantee(attempt+1),3000);else message.textContent='La vérification bancaire est en cours. Si elle ne se termine pas, contactez-nous. Aucun paiement du séjour n’est demandé sur cette page.';
}
if(guarantee)checkGuarantee();
