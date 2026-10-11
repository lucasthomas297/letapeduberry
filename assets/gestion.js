import {isArchivedStay} from './gestion-categories.js';
const list=document.querySelector('#stays'),status=document.querySelector('#admin-status');
const currentTab=document.querySelector('#tab-current'),archiveTab=document.querySelector('#tab-archives');
let selectedCategory='current',initialCategory=true;
for(const [tab,category] of [[currentTab,'current'],[archiveTab,'archives']]){
 tab.onclick=()=>{selectedCategory=category;load();};
 tab.onkeydown=event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();const next=event.key==='Home'?currentTab:event.key==='End'?archiveTab:tab===currentTab?archiveTab:currentTab;next.focus();next.click();
 };
}
const preview=new URL(location.href).searchParams.has('apercu');
const examples=[{id:'exemple',arrival:'2026-11-06',departure:'2026-11-08',status:'pending',customer_name:'Voyageur de démonstration',customer_email:'voyageur@example.test',customer_phone:'Coordonnées de démonstration',comment:'Nous venons découvrir Bourges pendant un week-end.',guests:2,rate:'fixed',total_cents:15000,payment_preference:'card'}];
if(preview)examples.push({id:'exemple-garantie',arrival:'2026-09-20',departure:'2026-09-22',status:'confirmed',customer_name:'Séjour fictif — garantie',customer_email:'voyageur@example.test',customer_phone:'06 00 00 00 00',guests:2,rate:'flex',total_cents:16800,payment_preference:'card',paid_at:'2026-09-19',deposit_status:'authorized'});
const labels={pending:'À étudier',awaiting_payment:'En attente du contrat / paiement',confirmed:'Confirmée',declined:'Refusée',expired:'Délai expiré',cancelled:'Annulée'};
function text(parent,tag,value){const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;}
async function loadHealth(){
 let panel=document.querySelector('#owner-health');
 if(!panel){panel=document.createElement('details');panel.id='owner-health';panel.className='notice';status.before(panel);text(panel,'summary','Vérifier le service de réservation');}
 const content=document.createElement('div');panel.append(content);
 const refresh=text(content,'button','Actualiser les contrôles');refresh.className='secondary';refresh.type='button';
 const output=text(content,'div','');
 async function check(){
  refresh.disabled=true;output.replaceChildren();text(output,'p','Vérification en cours…');
  try{
   const response=await fetch('/api/admin/health',{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error();const data=await response.json();if(!Array.isArray(data.checks))throw new Error();
   output.replaceChildren();
   const items=text(output,'ul','');for(const item of data.checks){const activation=item.label.endsWith('activés')||item.label.endsWith('activées');text(items,'li',`${activation?(item.ok?'✓ Activé':'Désactivé'):(item.ok?'✓ Vérifié':'À vérifier')} · ${item.label}`);}
   if(data.queue){text(output,'p',`${data.queue.pending} e-mail(s) en attente d’envoi.`);if(data.queue.review)text(output,'p',`${data.queue.review} e-mail(s) nécessitent une vérification dans Resend avant tout nouvel envoi. Ne renvoyez pas un lien de paiement pour résoudre un retard de messagerie.`);}
   text(output,'p',data.explanation);
  }catch{text(output,'p','Les contrôles ne sont pas accessibles. Actualisez la page ou reconnectez-vous. Cela ne signifie pas qu’une réservation a été perdue.');}
  finally{refresh.disabled=false;}
 }
 refresh.onclick=check;panel.addEventListener('toggle',()=>{if(panel.open&&!output.childNodes.length)check();});
}
async function load(){
 try {
  const stays=preview?examples:(await (await fetch('/api/admin/stays')).json()).stays;
  if(!Array.isArray(stays))throw new Error('Connectez-vous à l’espace privé pour consulter les demandes.');
  const groups={current:stays.filter(stay=>!isArchivedStay(stay)),archives:stays.filter(stay=>isArchivedStay(stay))};
  if(initialCategory){const linked=stays.find(stay=>'#'+stay.id===location.hash);if(linked)selectedCategory=isArchivedStay(linked)?'archives':'current';initialCategory=false;}
  currentTab.textContent=`En cours et à venir (${groups.current.length})`;archiveTab.textContent=`Archives (${groups.archives.length})`;
  for(const [tab,category] of [[currentTab,'current'],[archiveTab,'archives']]){tab.setAttribute('aria-selected',String(selectedCategory===category));tab.tabIndex=selectedCategory===category?0:-1;}
  list.setAttribute('aria-labelledby',selectedCategory==='current'?'tab-current':'tab-archives');
  status.textContent=preview?'Aperçu local : données fictives, aucune décision ni aucun paiement réel.':selectedCategory==='current'?'Demandes à étudier et réservations en cours ou à venir.':'Séjours terminés et demandes refusées, annulées ou expirées. Les dossiers restent consultables.';
  if(!preview&&!document.querySelector('#owner-health'))loadHealth();
  list.replaceChildren();
  if(!groups[selectedCategory].length)text(list,'p',selectedCategory==='current'?'Aucune demande ni réservation en cours ou à venir.':'Aucun dossier archivé pour le moment.').className='empty-stays';
  for(const stay of groups[selectedCategory]){
   const card=document.createElement('article');list.append(card);card.id=stay.id;
   text(card,'span',stay.status==='confirmed'&&isArchivedStay(stay)?'Séjour terminé':stay.status==='awaiting_payment'&&stay.payment_preference==='cash'?'En attente de l’acceptation du contrat':labels[stay.status]||stay.status).className='badge';text(card,'h2',stay.customer_name);
   text(card,'p',`${stay.arrival} → ${stay.departure} · ${stay.guests} personne(s) · ${(stay.total_cents/100).toFixed(2)} €`);
   text(card,'p',stay.rate==='fixed'?'Tarif non remboursable':'Tarif remboursable');
   text(card,'p',stay.payment_preference==='cash'?'Paiement en espèces à l’arrivée':'Paiement par carte bancaire en ligne');
   const options=[stay.early_arrival?'Arrivée dès 14 h (+ 5 €)':null,stay.late_departure?'Départ jusqu’à midi (+ 5 €)':null].filter(Boolean);
   text(card,'p',options.length?options.join(' · '):'Aucune option d’horaires');
   if(stay.tax_details){
    const tax=stay.tax_details,panel=text(card,'details','');panel.className='notice';
    text(panel,'summary','Détail de la taxe de séjour pour votre déclaration');
    text(panel,'p',`Part communale (${tax.rate*100} %) : ${money(tax.communal)} · Part départementale (${tax.additionalRate*100} % de la taxe communale) : ${money(tax.departmental)} · Total : ${money(tax.total)}`);
    for(const day of tax.daily)text(panel,'p',`${new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(day.date+'T12:00:00Z'))} · ${day.taxable} adulte(s) imposable(s) · par personne : ${money(day.communalPerPerson)} + ${money(day.departmentalPerPerson)} · total de la nuit : ${money(day.total)}`);
    text(panel,'p',stay.status==='cancelled'?'Séjour annulé : les taxes des nuitées non réalisées ne sont pas dues.':'Montants prévisionnels du contrat. Déclarez uniquement les nuitées effectivement réalisées et les voyageurs imposables ; adaptez en cas de départ anticipé ou d’exonération.');
   }
   if(stay.customer_address)text(card,'p',stay.customer_address);
   const documents=document.createElement('div');card.append(documents);
   for(const [file,label] of [['contract','Voir le contrat PDF'],['description','Voir la fiche descriptive PDF']]){
    if(file==='description'&&stay.description_available===0)continue;
    const link=text(documents,'a',label);link.className='button secondary';link.target='_blank';link.rel='noopener';
    link.href=preview?'output/pdf/'+(file==='contract'?'contrat-apercu':'fiche-descriptive-apercu')+'.pdf':'/api/admin/'+file+'.pdf?id='+encodeURIComponent(stay.id);
   }
   if(stay.status==='pending')text(card,'p','Consultez les documents avant d’accepter. Leur ouverture n’envoie aucun message au voyageur.').className='muted';

   text(card,'p',`${stay.customer_email} · ${stay.customer_phone}`);text(card,'pre',stay.comment||'Aucun commentaire.');
   if(stay.unsent_notifications)text(card,'p',`${stay.unsent_notifications} notification(s) en attente d’envoi : vérifiez la messagerie avant de contacter le voyageur.`).className='notice';
   const deposits={requested:'Lien envoyé, autorisation attendue',authorized:'Empreinte autorisée',review:'Empreinte à vérifier : montant ou durée insuffisante',released:'Empreinte libérée',expired:'Lien ou empreinte expirés',captured:'Retenue effectuée',failed:'Autorisation échouée'};
   if(stay.status==='confirmed') {
    if(stay.payment_preference==='cash'){
     text(card,'p',stay.paid_at?'Espèces encaissées le '+new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'medium',timeStyle:'short'}).format(new Date(stay.paid_at)):'Séjour confirmé · règlement en espèces attendu à l’arrivée').className='notice';
     if(!stay.paid_at){const received=text(card,'button','Enregistrer le règlement en espèces');received.onclick=()=>cashReceived(stay);}
    }

    const cancelStayButton=text(card,'button','Annuler le séjour');cancelStayButton.className='secondary';cancelStayButton.onclick=()=>cancellation(stay);
    if(stay.deposit_method!=='cash'){
    text(card,'p','Garantie bancaire : '+(deposits[stay.deposit_status]||'À demander près de l’arrivée'));
    if(stay.capture_before)text(card,'p','Expiration bancaire : '+new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'medium',timeStyle:'short'}).format(new Date(stay.capture_before)));
    const deadline=stay.deposit_deadline?new Date(stay.deposit_deadline):null;
    if(deadline&&['requested','failed','expired','review'].includes(stay.deposit_status)){
     text(card,'p','Garantie à valider avant le '+new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris'}).format(deadline)+'. Le code d’accès reste bloqué.');
     if(Date.now()>=deadline.getTime())text(card,'p','Échéance de la garantie dépassée : contactez le voyageur, puis choisissez si vous maintenez ou annulez la réservation.').className='notice';
    }
    if(!stay.deposit_status||['requested','expired','failed'].includes(stay.deposit_status)){
     const send=text(card,'button',stay.deposit_status==='requested'?'Vérifier l’autorisation':stay.deposit_status?'Envoyer un nouveau lien de garantie':'Envoyer le lien de garantie');
     send.onclick=()=>manageDeposit(stay,stay.deposit_status==='requested'?'check':'request');
    }else if(['authorized','review'].includes(stay.deposit_status)){
     const check=text(card,'button','Vérifier la validité bancaire');check.className='secondary';check.onclick=()=>manageDeposit(stay,'check');
    }
    if(stay.deposit_status==='review')text(card,'p','Cette empreinte ne garantit pas encore le séjour : vérifiez sa durée et son montant avant l’arrivée.').className='notice';
    if(stay.damage_status&&stay.damage_status!=='abandoned'){
     text(card,'p','Dossier de retenue : '+money(stay.damage_amount)+' · '+({prepared:'À confirmer',capturing:'Résultat bancaire à vérifier',captured:'Prélèvement confirmé'}[stay.damage_status]||stay.damage_status));
     const damage=text(card,'button','Consulter la retenue');damage.onclick=()=>damageClaim(stay);
    }else if(['authorized','review'].includes(stay.deposit_status)) {
     if(stay.damage_status!=='abandoned'){const damage=text(card,'button','Préparer une retenue pour dommage');damage.className='secondary';damage.onclick=()=>damageClaim(stay);}else text(card,'p','Dossier de retenue abandonné.');
     const release=text(card,'button','Libérer l’empreinte bancaire');release.className='secondary';release.onclick=()=>releaseDeposit(stay);
    }
    }
   }

   if(stay.deposit_method==='cash'&&(stay.status==='confirmed'||stay.cash_deposit_received_at)){
    text(card,'p','Dépôt de garantie : 300 € en espèces · rendez-vous le jour de l’arrivée à partir de 17 h 30 ; restitution en main propre au départ.').className='notice';
    if(!stay.cash_deposit_received_at){const receive=text(card,'button','Enregistrer les 300 € de dépôt reçus');receive.onclick=()=>cashDeposit(stay,'receive');}
    else if(!stay.cash_deposit_returned_at){text(card,'p','Dépôt reçu · restitution à enregistrer au départ.');const returned=text(card,'button','Enregistrer la restitution du dépôt');returned.onclick=()=>cashDeposit(stay,'return');}
    else {text(card,'p','Dépôt restitué : '+money(stay.cash_deposit_returned_cents));if(stay.cash_deposit_retained_reason)text(card,'p','Retenue justifiée : '+stay.cash_deposit_retained_reason);}
   }
   if(stay.status==='cancelled'&&stay.refund_status){
    const refundLabels={none:'Aucun remboursement à effectuer',manual:'Remboursement en espèces à effectuer',pending:'Remboursement par carte en cours',succeeded:'Remboursement traité',failed:'Remboursement à vérifier dans Stripe'};
    text(card,'p',refundLabels[stay.refund_status]+(stay.refund_cents?' · '+money(stay.refund_cents):'')).className='notice';
    if(stay.retained_cents)text(card,'p','Montant conservé : '+money(stay.retained_cents));
    if(stay.owed_cents)text(card,'p','Montant restant dû selon le contrat : '+money(stay.owed_cents)+' · Aucun prélèvement automatique.');
    if(stay.deposit_done===0&&stay.deposit_method!=='cash')text(card,'p','Libération de la garantie bancaire à vérifier.').className='notice';
    if(stay.refund_status==='manual'&&stay.payment_preference==='cash'){const ack=text(card,'button','Enregistrer le remboursement en espèces');ack.onclick=()=>cashRefunded(stay);}
    if(stay.refund_status==='pending'||stay.deposit_done===0){const verify=text(card,'button','Vérifier le traitement de l’annulation');verify.onclick=async()=>{verify.disabled=true;try{await adminPost('cancellation-check',{id:stay.id});await load();}catch(error){status.textContent=error.message;verify.disabled=false;}};}
   }
   if(stay.status==='pending')for(const [action,label] of [['approve','Accepter la demande'],['decline','Refuser la demande']]) {
    const button=text(card,'button',label);button.type='button';if(action==='decline')button.className='secondary';
    button.addEventListener('click',()=>decision(stay,action));
   }
  }
 }catch(error){status.textContent=error.message;}
}
function decision(stay,action){
 const dialog=document.createElement('dialog');document.body.append(dialog);
 text(dialog,'h2',action==='approve'?'Confirmer votre acceptation':'Confirmer votre refus');
 text(dialog,'p',action==='approve'&&stay.payment_preference==='cash'?'Les disponibilités seront revérifiées et les dates bloquées. Le voyageur disposera de 12 heures pour accepter son contrat. Sa réservation sera alors confirmée, avec règlement en espèces à l’arrivée et garantie bancaire obligatoire de 300 €.':action==='approve'?'Les disponibilités seront revérifiées. Les dates seront bloquées sur notre site et le voyageur recevra son contrat et un accès au paiement valable 12 heures. Vérifiez également vos plateformes avant de confirmer.':'Le voyageur sera informé de votre refus, sans aucun débit.');
 const label=text(dialog,'label','Message au voyageur (facultatif)'),message=document.createElement('textarea');message.maxLength=2000;label.append(message);
 const info=text(dialog,'p','');info.setAttribute('role','status');
 const confirm=text(dialog,'button','Confirmer'),cancel=text(dialog,'button','Revenir');cancel.className='secondary';
 cancel.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
 confirm.onclick=async()=>{if(preview){info.textContent='Ceci est un aperçu : aucune demande n’est envoyée.';return;}confirm.disabled=true;try{const response=await fetch('/api/admin/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:stay.id,action,message:message.value})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Décision indisponible');dialog.close();await load();}catch(error){info.textContent=error.message;confirm.disabled=false;}};
 dialog.showModal();
}
load();

function releaseDeposit(stay){
 const dialog=document.createElement('dialog');document.body.append(dialog);
 text(dialog,'h2','Libérer la garantie de 300 €');
 text(dialog,'p','Confirmez que le contrôle du logement est terminé et qu’aucune retenue n’est nécessaire. La libération sera demandée à Stripe ; son affichage dépend ensuite de la banque du voyageur.');
 const label=text(dialog,'label',''),inspected=document.createElement('input');inspected.type='checkbox';label.append(inspected,document.createTextNode('Le contrôle est terminé et aucun dommage ne nécessite de retenue.'));
 const info=text(dialog,'p','');info.setAttribute('role','status');
 const confirm=text(dialog,'button','Confirmer la libération'),cancel=text(dialog,'button','Revenir');cancel.className='secondary';cancel.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
 confirm.disabled=true;inspected.onchange=()=>{confirm.disabled=!inspected.checked;};
 confirm.onclick=async()=>{if(preview){info.textContent='Aperçu : aucune opération bancaire effectuée.';return;}confirm.disabled=true;try{const response=await fetch('/api/admin/deposit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:stay.id,action:'release',inspected:inspected.checked})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Libération indisponible');dialog.close();await load();}catch(error){info.textContent=error.message;confirm.disabled=false;}};
 dialog.showModal();
}

function cashReceived(stay){
 const dialog=document.createElement('dialog');document.body.append(dialog);
 text(dialog,'h2','Enregistrer l’encaissement');
 text(dialog,'p',`Montant intégral : ${(stay.total_cents/100).toFixed(2)} €. Cette action enregistre un paiement réellement reçu et envoie un reçu au voyageur.`);
 const label=text(dialog,'label',''),check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode('Je confirme avoir reçu la totalité de cette somme en espèces.'));
 const info=text(dialog,'p','');info.setAttribute('role','status');
 const confirm=text(dialog,'button','Confirmer l’encaissement'),cancel=text(dialog,'button','Revenir');confirm.disabled=true;cancel.className='secondary';
 check.onchange=()=>confirm.disabled=!check.checked;cancel.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
 confirm.onclick=async()=>{if(preview){info.textContent='Aperçu : aucun encaissement enregistré.';return;}confirm.disabled=true;try{
  const response=await fetch('/api/admin/cash-received',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:stay.id,received:check.checked,amountCents:stay.total_cents})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Encaissement indisponible');dialog.close();await load();
 }catch(error){info.textContent=error.message;confirm.disabled=!check.checked;}};
 dialog.showModal();
}

function manageDeposit(stay,action){
 const dialog=document.createElement('dialog');document.body.append(dialog);
 text(dialog,'h2',action==='check'?'Vérifier la garantie bancaire':'Envoyer le lien de garantie de 300 €');
 text(dialog,'p',action==='check'?'La validité sera vérifiée directement auprès de Stripe.':'Le voyageur recevra un lien pour autoriser 300 €, sans débit immédiat. L’envoi est possible à partir de 48 heures avant l’arrivée.');
 const info=text(dialog,'p','');info.setAttribute('role','status');
 const confirm=text(dialog,'button',action==='check'?'Vérifier':'Envoyer le lien'),cancel=text(dialog,'button','Revenir');cancel.className='secondary';cancel.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
 confirm.onclick=async()=>{if(preview){info.textContent='Aperçu : aucune opération bancaire effectuée.';return;}confirm.disabled=true;try{const response=await fetch('/api/admin/deposit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:stay.id,action})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Garantie indisponible');dialog.close();await load();}catch(error){info.textContent=error.message;confirm.disabled=false;}};
 dialog.showModal();
}

const money=cents=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(cents/100);
async function adminPost(path,data){const response=await fetch('/api/admin/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(result.error||'Action indisponible');return result;}
function cancellation(stay){
 const dialog=document.createElement('dialog');document.body.append(dialog);text(dialog,'h2','Annuler le séjour');
 text(dialog,'p','Le calcul reprend le tarif du contrat et la date de réception de la demande. Les dates seront libérées après votre confirmation.');
 const causeLabel=text(dialog,'label','Origine de l’annulation'),cause=document.createElement('select');causeLabel.append(cause);
 for(const [value,label] of [['guest','À la demande du voyageur'],['owner','À notre initiative'],['exception','Remboursement intégral exceptionnel'],['guarantee_refusal','Refus volontaire de la garantie bancaire']]){const option=document.createElement('option');option.value=value;option.textContent=label;cause.append(option);}
 const refusalLabel=text(dialog,'label',''),refusal=document.createElement('input');refusal.type='checkbox';refusalLabel.append(refusal,document.createTextNode('Le voyageur a volontairement refusé la garantie ; il ne s’agit pas d’un échec technique bancaire.'));refusalLabel.hidden=true;cause.addEventListener('change',()=>{refusalLabel.hidden=cause.value!=='guarantee_refusal';});
 const dateLabel=text(dialog,'label','Date et heure de réception de la demande'),date=document.createElement('input');date.type='datetime-local';date.value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);dateLabel.append(date);
 const reasonLabel=text(dialog,'label','Motif (repris dans l’e-mail au voyageur)'),reason=document.createElement('textarea');reason.maxLength=2000;reasonLabel.append(reason);
 if(stay.deposit_deadline&&Date.now()>=Date.parse(stay.deposit_deadline)&&['requested','failed','expired','review'].includes(stay.deposit_status)){
  cause.value='owner';reason.value='L’empreinte bancaire de 300 € prévue au contrat pour le dépôt de garantie n’a pas été validée avant l’échéance indiquée dans notre e-mail.';
 }
 const summary=text(dialog,'div','');summary.className='notice';summary.hidden=true;
 const acceptLabel=text(dialog,'label',''),accepted=document.createElement('input');accepted.type='checkbox';acceptLabel.append(accepted,document.createTextNode('Je confirme cette annulation et les montants indiqués.'));
 const info=text(dialog,'p','');info.setAttribute('role','status');
 const calculate=text(dialog,'button','Calculer les montants'),confirm=text(dialog,'button','Confirmer l’annulation'),back=text(dialog,'button','Revenir');back.className='secondary';confirm.disabled=true;
 let plan=null;
 function reset(){plan=null;accepted.checked=false;confirm.disabled=true;summary.hidden=true;}
 for(const input of [cause,date,reason,refusal])input.addEventListener('input',reset);
 accepted.onchange=()=>{confirm.disabled=!accepted.checked||!plan;};back.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
 calculate.onclick=async()=>{if(preview){info.textContent='Aperçu : aucun séjour réel à annuler.';return;}reset();calculate.disabled=true;try{const data={id:stay.id,cause:cause.value,refusalConfirmed:refusal.checked,reason:reason.value,notifiedAt:new Date(date.value).toISOString()};plan=(await adminPost('cancellation-preview',data)).plan;summary.replaceChildren();text(summary,'p',plan.full?'Remboursement intégral prévu.':'Le prix de la location et des options reste dû selon le contrat.');text(summary,'p','À rembourser : '+money(plan.refundCents));text(summary,'p','Montant conservé : '+money(plan.retainedCents));if(plan.owedCents)text(summary,'p','Montant restant dû : '+money(plan.owedCents)+' · Aucun prélèvement automatique.');text(summary,'p',stay.rate==='flex'?'Limite d’annulation sans frais : '+new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(plan.deadline)):'Tarif non remboursable.');summary.hidden=false;info.textContent='La garantie bancaire sera traitée séparément. Aucun montant n’a encore été remboursé.';}catch(error){info.textContent=error.message;}finally{calculate.disabled=false;}};
 confirm.onclick=async()=>{if(!plan||!accepted.checked)return;confirm.disabled=true;try{await adminPost('cancel',{id:stay.id,cause:plan.cause,refusalConfirmed:plan.refusalConfirmed,reason:plan.reason,notifiedAt:plan.notifiedAt,planHash:plan.hash,confirmed:true});dialog.close();await load();}catch(error){info.textContent=error.message;confirm.disabled=false;}};
 dialog.showModal();
}
function cashRefunded(stay){
 const dialog=document.createElement('dialog');document.body.append(dialog);text(dialog,'h2','Enregistrer le remboursement en espèces');text(dialog,'p','Montant à restituer : '+money(stay.refund_cents)+'. Aucun virement ni paiement n’est effectué par ce bouton.');
 const label=text(dialog,'label',''),check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode('Je confirme avoir réellement restitué cette somme au voyageur.'));
 const info=text(dialog,'p','');info.setAttribute('role','status');const confirm=text(dialog,'button','Enregistrer'),back=text(dialog,'button','Revenir');confirm.disabled=true;check.onchange=()=>{confirm.disabled=!check.checked;};back.className='secondary';back.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());
 confirm.onclick=async()=>{confirm.disabled=true;try{await adminPost('cash-refunded',{id:stay.id,refunded:check.checked,amountCents:stay.refund_cents});dialog.close();await load();}catch(error){info.textContent=error.message;confirm.disabled=false;}};dialog.showModal();
}

async function damageClaim(stay){
 const dialog=document.createElement('dialog');dialog.className='damage-panel';document.body.append(dialog);
 text(dialog,'h2','Retenue sur le dépôt de garantie');
 text(dialog,'p','Après le départ : uniquement des frais justifiés pour un dommage, hors usure normale. Montant maximal : 300 €. Aucune retenue automatique.');
 const info=text(dialog,'p','');info.setAttribute('role','status');
 const close=text(dialog,'button','Revenir');close.className='secondary';close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
 try{
  let claim=stay.damage_status?(await adminPost('deposit',{id:stay.id,action:'damage-read'})).claim:null;
  if(claim){
   text(dialog,'p','Montant : '+money(claim.amount_cents));text(dialog,'p','Motif : '+claim.reason);text(dialog,'p','Justificatifs : '+claim.evidence);
   if(claim.status==='prepared'){const abandon=text(dialog,'button','Abandonner la retenue');abandon.className='secondary';abandon.onclick=()=>{abandon.disabled=true;const ack=text(dialog,'label',''),yes=document.createElement('input');yes.type='checkbox';ack.append(yes,document.createTextNode('Je renonce à cette retenue, sans prélèvement.'));const done=text(dialog,'button','Confirmer l’abandon');done.disabled=true;yes.onchange=()=>done.disabled=!yes.checked;done.onclick=async()=>{done.disabled=true;try{await adminPost('deposit',{id:stay.id,action:'damage-abandon',confirmed:yes.checked});dialog.close();await load();}catch(error){info.textContent=error.message;done.disabled=false;}};};}
   if(claim.status==='captured'){text(dialog,'p','Prélèvement confirmé. Le solde de la garantie est libéré.');return;}
   const label=text(dialog,'label',''),check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode('Je confirme ce montant et avoir communiqué les justificatifs au voyageur.'));
   const confirm=text(dialog,'button','Prélever '+money(claim.amount_cents));confirm.disabled=true;check.onchange=()=>confirm.disabled=!check.checked;
   confirm.onclick=async()=>{confirm.disabled=true;try{await adminPost('deposit',{id:stay.id,action:'damage-capture',amountCents:claim.amount_cents,confirmed:true,communicated:check.checked});dialog.close();await load();}catch(error){info.textContent=error.message;confirm.disabled=false;}};
   if(claim.status==='capturing'){text(dialog,'p','Résultat bancaire incertain : vérifiez avant de réessayer.');const verify=text(dialog,'button','Vérifier le résultat bancaire');verify.onclick=async()=>{verify.disabled=true;try{const result=await adminPost('deposit',{id:stay.id,action:'damage-check'});info.textContent=result.status==='captured'?'Prélèvement confirmé.':'Traitement encore à vérifier dans Stripe.';await load();}catch(error){info.textContent=error.message;}verify.disabled=false;};}
  }else{
   const amountLabel=text(dialog,'label','Montant à retenir (€)'),amount=document.createElement('input');amount.type='number';amount.min='.01';amount.max='300';amount.step='.01';amountLabel.append(amount);
   const reasonLabel=text(dialog,'label','Dommage constaté'),reason=document.createElement('textarea');reason.maxLength=2000;reasonLabel.append(reason);
   const evidenceLabel=text(dialog,'label','Références des justificatifs (photos, devis ou facture)'),evidence=document.createElement('textarea');evidence.maxLength=2000;evidenceLabel.append(evidence);
   text(dialog,'p','Conservez les pièces et communiquez-les au voyageur. Ce champ enregistre leurs références, sans joindre de fichiers.').className='muted';
   const label=text(dialog,'label',''),check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode('Les frais sont justifiés et ne relèvent pas de l’usure normale.'));
   const send=text(dialog,'button','Enregistrer et informer le voyageur');send.disabled=true;
   const valid=()=>{const cents=Math.round(Number(amount.value)*100);send.disabled=!(check.checked&&cents>0&&cents<=30000&&reason.value.trim().length>=10&&evidence.value.trim().length>=10);};
   for(const field of [amount,reason,evidence,check])field.addEventListener('input',valid);
   send.onclick=async()=>{if(preview){info.textContent='Aperçu : aucun dossier enregistré.';return;}send.disabled=true;try{await adminPost('deposit',{id:stay.id,action:'damage-prepare',amountCents:Math.round(Number(amount.value)*100),reason:reason.value,evidence:evidence.value,justified:check.checked});dialog.close();await load();}catch(error){info.textContent=error.message;valid();}};
  }
 }catch(error){info.textContent=error.message;}
 dialog.append(close);
}

async function cashDeposit(stay,action){
 const dialog=document.createElement('dialog');dialog.className='owner-dialog';
 text(dialog,'h2',action==='receive'?'Réception du dépôt de garantie':'Restitution du dépôt de garantie');
 text(dialog,'p',action==='receive'?'Confirmez uniquement une remise réelle des 300 € en espèces, distincte du règlement du séjour. Un reçu sera envoyé au voyageur.':'Enregistrez uniquement la restitution réelle en main propre après contrôle du logement. Un reçu sera envoyé au voyageur.');
 const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode(action==='receive'?' J’ai reçu les 300 € en espèces.':' J’ai contrôlé le logement et restitué le montant indiqué en main propre.'));dialog.append(label);
 let amount,reason;
 if(action==='return'){
  const amountLabel=text(dialog,'label','Montant restitué en euros');amount=document.createElement('input');amount.type='number';amount.min='0';amount.max='300';amount.step='0.01';amount.value='300';amountLabel.append(amount);
  const reasonLabel=text(dialog,'label','Motif et justificatifs de toute retenue');reason=document.createElement('textarea');reason.maxLength=2000;reasonLabel.append(reason);
 }
 const message=text(dialog,'p',''),save=text(dialog,'button','Enregistrer'),cancel=text(dialog,'button','Fermer');save.disabled=true;check.onchange=()=>save.disabled=!check.checked;cancel.onclick=()=>dialog.close();
 save.onclick=async()=>{save.disabled=true;try{await adminPost('cash-deposit',{id:stay.id,action,received:action==='receive'&&check.checked,amountCents:30000,returned:action==='return'&&check.checked,inspected:action==='return'&&check.checked,returnedCents:amount?Math.round(Number(amount.value)*100):undefined,reason:reason?.value});dialog.close();await load();}catch(error){message.textContent=error.message;save.disabled=!check.checked;}};
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
