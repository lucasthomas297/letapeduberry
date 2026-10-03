const contactForm=document.querySelector('#contact-form');
if(contactForm){
 const status=document.querySelector('#contact-status');
 contactForm.addEventListener('submit',async event=>{
  event.preventDefault();if(!contactForm.reportValidity())return;
  const button=contactForm.querySelector('button[type="submit"]');
  const original=button.innerHTML;button.disabled=true;button.textContent='Envoi en cours…';
  status.hidden=false;status.textContent='Votre message est en cours d’envoi.';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
  try{
   const payload=Object.fromEntries(new FormData(contactForm));
   const response=await fetch('/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
   const result=await response.json().catch(()=>null);
   if(!response.ok||result?.sent!==true)throw new Error(response.status===429?'Trop de tentatives. Merci de réessayer dans quelques minutes.':'Votre message n’a pas pu être envoyé. Vous pouvez nous écrire directement à contact@letapeduberry.fr.');
   contactForm.reset();status.textContent='Votre message a été envoyé. Nous vous répondrons à l’adresse e-mail indiquée. À bientôt !';
  }catch(error){status.textContent=error.name==='AbortError'?'Le service met trop de temps à répondre. L’envoi n’est pas confirmé : contactez-nous à contact@letapeduberry.fr.':error.message;}
  finally{clearTimeout(timeout);button.disabled=false;button.innerHTML=original;}
 });
}
