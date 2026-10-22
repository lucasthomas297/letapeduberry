const form=document.querySelector('.booking');
if(form){
 const pricingReady=import('./nightly-prices.mjs?v=20261022');
 // Keep a rejected loading promise handled until the customer requests a quote.
 pricingReady.catch(()=>{});
 const arrival=form.elements.arrivee,departure=form.elements.depart,estimate=document.querySelector('#estimate');
 const earlyArrival=form.elements.arrivee_anticipee,lateDeparture=form.elements.depart_tardif;
 const guestInput=form.elements.voyageurs;
 const dateTriggers={arrivee:document.querySelector('#arrival-trigger'),depart:document.querySelector('#departure-trigger')};
 const dateValues={arrivee:document.querySelector('#arrival-value'),depart:document.querySelector('#departure-value')};
 const guestTrigger=document.querySelector('#guest-trigger'),guestMenu=document.querySelector('#guest-menu');
 const calendar=document.querySelector('#calendar-popover'),calendarDays=document.querySelector('#calendar-days');
 const calendarMonth=document.querySelector('#calendar-month'),calendarHint=document.querySelector('#calendar-hint');
 const error=document.querySelector('#booking-error');
 const iso=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
 const fromISO=value=>new Date(value+'T12:00:00');
 const dateLabel=value=>new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric'}).format(fromISO(value));
 const today=iso(new Date());
 let activeDate=null,viewMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
 let minimumNights=1,datedMinimums={};
 const minimumForDate=value=>datedMinimums[value]??minimumNights;
 let busyPeriods=[],availabilityState='loading',availabilityCheckedAt=0,availabilityTask=null;
 const overlapsBusy=(start,end)=>busyPeriods.some(([a,b])=>start<b&&end>a);
 const unavailableDate=(value,field)=>field==='depart'&&arrival.value?overlapsBusy(arrival.value,value):busyPeriods.some(([a,b])=>value>=a&&value<b);
 async function loadAvailability(){
  if(availabilityTask)return availabilityTask;
  if(availabilityState==='ready'&&Date.now()-availabilityCheckedAt<60000)return;
  availabilityState='loading';
  availabilityTask=(async()=>{
   try{
    const response=await fetch('/api/availability',{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Disponibilités indisponibles');
    const data=await response.json();
    if(!Array.isArray(data.busy)||!data.busy.every(period=>Array.isArray(period)&&period.length===2&&period.every(value=>/^\d{4}-\d{2}-\d{2}$/.test(value))&&period[0]<period[1]))throw Error('Disponibilités invalides');
    minimumNights=Number.isInteger(data.min_nights)?data.min_nights:1;datedMinimums=data.min_nights_by_date||{};busyPeriods=data.busy;availabilityState='ready';availabilityCheckedAt=Date.now();
   }catch{availabilityState='error';}
   finally{availabilityTask=null;if(activeDate)renderCalendar();}
  })();
  return availabilityTask;
 }
 const minDate=field=>{if(field!=='depart'||!arrival.value)return today;const next=fromISO(arrival.value);next.setDate(next.getDate()+minimumForDate(arrival.value));return iso(next)};
 const closeCalendar=()=>{calendar.hidden=true;if(activeDate)dateTriggers[activeDate].setAttribute('aria-expanded','false');activeDate=null};
 const closeGuests=()=>{guestMenu.hidden=true;guestTrigger.setAttribute('aria-expanded','false')};
 const placeCalendar=()=>{const rect=dateTriggers[activeDate].getBoundingClientRect();const left=Math.max(12,Math.min(rect.left,window.innerWidth-calendar.offsetWidth-12));const below=rect.bottom+8;const top=below+calendar.offsetHeight<=window.innerHeight-12?below:Math.max(12,rect.top-calendar.offsetHeight-8);calendar.style.left=left+'px';calendar.style.top=top+'px'};
 const renderCalendar=()=>{
  const min=minDate(activeDate),selected=form.elements[activeDate].value;
  const year=viewMonth.getFullYear(),month=viewMonth.getMonth();
  calendarMonth.textContent=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric'}).format(viewMonth);
  document.querySelector('#calendar-prev').disabled=iso(new Date(year,month,0))<min;
  calendarDays.replaceChildren();
  const offset=(new Date(year,month,1).getDay()+6)%7;
  for(let i=0;i<offset;i++)calendarDays.append(document.createElement('span'));
  for(let day=1;day<=new Date(year,month+1,0).getDate();day++){
   const value=iso(new Date(year,month,day)),button=document.createElement('button');
   button.type='button';button.textContent=day;button.disabled=value<min||availabilityState!=='ready'||unavailableDate(value,activeDate);
   button.setAttribute('aria-label',dateLabel(value));
   if(value===selected){button.classList.add('is-selected');button.setAttribute('aria-pressed','true')}
   if(value===today)button.classList.add('is-today');
   button.addEventListener('click',event=>{
    event.stopPropagation();
    form.elements[activeDate].value=value;updateGuarantee();
    dateValues[activeDate].textContent=dateLabel(value);
    dateValues[activeDate].classList.remove('booking-placeholder');
    estimate.hidden=true;requestPanel.hidden=true;error.hidden=true;
    const chosen=activeDate;
    closeCalendar();
    if(chosen==='arrivee'){
     if(departure.value<minDate('depart')||overlapsBusy(value,departure.value)){departure.value='';dateValues.depart.textContent='Choisir une date';dateValues.depart.classList.add('booking-placeholder')}
     if(!departure.value)openCalendar('depart');
    }
   });
   calendarDays.append(button);
  }
  calendarHint.textContent=availabilityState==='loading'?'Vérification des disponibilités…':availabilityState==='error'?'Disponibilités momentanément indisponibles. Fermez puis rouvrez le calendrier pour réessayer.':activeDate==='arrivee'?'Sélectionnez votre jour d’arrivée':`Sélectionnez votre jour de départ. Minimum : ${minimumForDate(arrival.value)} nuit${minimumForDate(arrival.value)>1?'s':''}.`;
  placeCalendar();
 };
 function openCalendar(field){
  closeGuests();closeCalendar();activeDate=field;
  const value=form.elements[field].value||minDate(field);
  const date=fromISO(value);viewMonth=new Date(date.getFullYear(),date.getMonth(),1);
  calendar.hidden=false;dateTriggers[field].setAttribute('aria-expanded','true');
  calendar.setAttribute('aria-label',field==='arrivee'?'Choisir la date d’arrivée':'Choisir la date de départ');
  renderCalendar();
  void loadAvailability();
 }
 Object.entries(dateTriggers).forEach(([field,trigger])=>trigger.addEventListener('click',()=>activeDate===field?closeCalendar():openCalendar(field)));
 document.querySelector('#calendar-prev').addEventListener('click',()=>{viewMonth.setMonth(viewMonth.getMonth()-1);renderCalendar()});
 document.querySelector('#calendar-next').addEventListener('click',()=>{viewMonth.setMonth(viewMonth.getMonth()+1);renderCalendar()});
 guestTrigger.addEventListener('click',()=>{const opening=guestMenu.hidden;closeCalendar();guestMenu.hidden=!opening;guestTrigger.setAttribute('aria-expanded',String(opening))});
 guestMenu.querySelectorAll('[data-guests]').forEach(option=>option.addEventListener('click',()=>{
  guestInput.value=option.dataset.guests;document.querySelector('#guest-value').textContent=guestInput.value;
  guestMenu.querySelectorAll('[data-guests]').forEach(item=>{const selected=item===option;item.setAttribute('aria-checked',String(selected));item.lastElementChild.textContent=selected?'✓':'○'});
  estimate.hidden=true;requestPanel.hidden=true;closeGuests();guestTrigger.focus();
 }));
 document.addEventListener('click',event=>{if(!calendar.hidden&&!calendar.contains(event.target)&&!Object.values(dateTriggers).some(trigger=>trigger.contains(event.target)))closeCalendar();if(!guestMenu.hidden&&!guestTrigger.parentElement.contains(event.target))closeGuests()});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(activeDate){const trigger=dateTriggers[activeDate];closeCalendar();trigger.focus()}else if(!guestMenu.hidden){closeGuests();guestTrigger.focus()}}});
 window.addEventListener('resize',()=>{if(activeDate)placeCalendar()});
 window.addEventListener('scroll',()=>{if(activeDate)placeCalendar()},{passive:true});
 [earlyArrival,lateDeparture].forEach(option=>option.addEventListener('change',()=>{estimate.hidden=true}));
 form.addEventListener('submit',async e=>{e.preventDefault();let nightlyPrice;try{({nightlyPrice}=await pricingReady);}catch{error.textContent='Impossible de charger les tarifs. Veuillez actualiser la page et réessayer.';error.hidden=false;estimate.hidden=true;requestPanel.hidden=true;return;}await loadAvailability();if(availabilityState!=='ready'||(arrival.value&&departure.value&&overlapsBusy(arrival.value,departure.value))){error.textContent=availabilityState!=='ready'?'Impossible de vérifier les disponibilités pour le moment. Veuillez réessayer.':'Ces dates ne sont plus disponibles. Choisissez une autre période.';error.hidden=false;estimate.hidden=true;requestPanel.hidden=true;return}if(!arrival.value||!departure.value||departure.value<=arrival.value){error.textContent=!arrival.value?'Choisissez votre date d’arrivée.':!departure.value?'Choisissez votre date de départ.':'Le départ doit être après l’arrivée.';error.hidden=false;estimate.hidden=true;requestPanel.hidden=true;openCalendar(!arrival.value?'arrivee':'depart');return}if((Date.parse(departure.value)-Date.parse(arrival.value))/86400000<minimumForDate(arrival.value)){error.textContent=`Le séjour doit comprendre au moins ${minimumForDate(arrival.value)} nuit${minimumForDate(arrival.value)>1?'s':''}.`;error.hidden=false;estimate.hidden=true;requestPanel.hidden=true;openCalendar('depart');return}error.hidden=true;updateGuarantee();const start=fromISO(arrival.value),end=fromISO(departure.value);let fixed=0,flex=0,nights=0;for(let d=new Date(start);d<end;d.setDate(d.getDate()+1)){const night=iso(d);fixed+=nightlyPrice(night,'fixed')/100;flex+=nightlyPrice(night,'flex')/100;nights++}const extras=(earlyArrival.checked?10:0)+(lateDeparture.checked?5:0);fixed+=extras;flex+=extras;const selected=[earlyArrival.checked?'arrivée dès 14 h (+ 10 €)':null,lateDeparture.checked?'départ jusqu’à 12 h (+ 5 €)':null].filter(Boolean);const euro=n=>n.toLocaleString('fr-FR')+' €';estimate.innerHTML=`<strong>Votre séjour · ${nights} nuit${nights>1?'s':''} · ${guestInput.value}</strong><p>Non remboursable : <strong>${euro(fixed)}</strong> · Remboursable : <strong>${euro(flex)}</strong></p>${selected.length?`<p>Options incluses : ${selected.join(' · ')}.</p>`:''}<p>Ménage et taxe de séjour compris. Annulation du tarif remboursable jusqu’à 24 h avant l’arrivée.</p><p>Estimation du tarif uniquement. Disponibilité et horaires à confirmer auprès de nous.</p>`;estimate.hidden=false;requestPanel.hidden=!(requestServiceReady||localRequestPreview);estimate.scrollIntoView({behavior:'smooth',block:'nearest'});
 });
 const requestPanel=document.querySelector('#request-panel'),requestMessage=document.querySelector('#request-message');
 const requestConfirmation=document.querySelector('#request-confirmation');
 document.querySelector('#request-confirmation-close').addEventListener('click',()=>requestConfirmation.close());
 requestConfirmation.addEventListener('close',()=>{requestMessage.tabIndex=-1;requestMessage.focus({preventScroll:true});});
 const localRequestPreview=['127.0.0.1','localhost'].includes(location.hostname)&&new URL(location.href).searchParams.get('apercu')==='reservation';
 let requestServiceReady=false;
 const requestSend=document.querySelector('#request-send');
 const requestConsents=['request-rules','request-deposit','request-insurance'].map(id=>document.getElementById(id));
 let requestSending=false;
 let guaranteePolicy='';
 function updateGuarantee(){
  const nights=(Date.parse(departure.value)-Date.parse(arrival.value))/86400000;
  const method=Number.isInteger(nights)&&nights>0?(nights>3?'cash':'bank'):'';
  const label=document.querySelector('#request-deposit-text');
  if(!label)return;
  if(method!==guaranteePolicy){document.querySelector('#request-deposit').checked=false;guaranteePolicy=method;}
  label.textContent=method==='cash'?'J’accepte le dépôt de garantie de 300 € en espèces, distinct du prix du séjour, remis en main propre lors d’un rendez-vous le jour de l’arrivée à partir de 17 h 30, contre reçu, puis restitué en main propre le jour du départ après contrôle du logement et sous déduction des frais justifiés pour dommages. L’arrivée autonome et l’option d’arrivée anticipée dès 14 h restent possibles.':'J’accepte l’empreinte bancaire standard de 300 € pour le dépôt de garantie, demandée 48 heures avant l’arrivée ou dès la confirmation si celle-ci intervient dans ce délai, distincte du prix du séjour. Le contrat précisera ses modalités et les conséquences d’un refus avant tout paiement.';
  updateRequestButton();
 }
 ['arrivee','depart'].forEach(name=>form.elements[name].addEventListener('change',updateGuarantee));
 const updateRequestButton=()=>{requestSend.disabled=requestSending||!requestConsents.every(input=>input.checked);};
 requestConsents.forEach(input=>input.addEventListener('change',updateRequestButton));
 window.addEventListener('pageshow',updateRequestButton);
 updateRequestButton();
 if(localRequestPreview){requestPanel.hidden=false;requestMessage.textContent='Aperçu local du formulaire : aucune demande ni aucun paiement ne sera envoyé.';}
 let lastRequestBody='',lastRequestKey='';
 fetch('/api/status').then(response=>response.ok?response.json():null).then(data=>{requestServiceReady=Boolean(data?.requests_ready);if(requestServiceReady&&!estimate.hidden)requestPanel.hidden=false}).catch(()=>{});
 document.querySelector('#request-send').addEventListener('click',async()=>{
  if(localRequestPreview||requestSending||requestSend.disabled)return;
  const name=document.querySelector('#request-name'),email=document.querySelector('#request-email'),phone=document.querySelector('#request-phone');
  const insurance=document.querySelector('#request-insurance'),rules=document.querySelector('#request-rules'),deposit=document.querySelector('#request-deposit'),address=document.querySelector('#request-address'),postalCode=document.querySelector('#request-postal-code'),city=document.querySelector('#request-city'),comment=document.querySelector('#request-comment');
  if(!name.reportValidity()||!email.reportValidity()||!phone.reportValidity()||!rules.reportValidity()||!deposit.reportValidity()||!address.reportValidity()||!postalCode.reportValidity()||!city.reportValidity()||!comment.reportValidity()||!insurance.reportValidity())return;
  const button=requestSend;requestSending=true;updateRequestButton();requestMessage.textContent='Envoi en cours…';
  const payload={arrival:arrival.value,departure:departure.value,guests:guestInput.value.startsWith('1')?1:2,
   early:earlyArrival.checked,late:lateDeparture.checked,rate:document.querySelector('#request-rate').value,
   name:name.value.trim(),email:email.value.trim(),phone:phone.value.trim(),
   payment:document.querySelector('input[name="payment_preference"]:checked').value,rulesAccepted:rules.checked,insuranceAccepted:insurance.checked,depositAccepted:deposit.checked,address:[address.value.trim(),postalCode.value.trim()+' '+city.value.trim()].join(', '),addressParts:{street:address.value.trim(),postalCode:postalCode.value.trim(),city:city.value.trim()},comment:comment.value.trim()};
  try{
   const body=JSON.stringify(payload);
   if(body!==lastRequestBody){lastRequestBody=body;lastRequestKey=crypto.randomUUID();}
   const response=await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':lastRequestKey},body});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Le service de demande est momentanément indisponible.');}
   const data=await response.json();requestMessage.textContent=`Demande envoyée (référence ${data.reference}). Nous vous répondrons par e-mail. Aucun paiement n’a été effectué.`;
   button.hidden=true;
   document.querySelector('#request-confirmation-reference').textContent='Référence : '+data.reference;
   requestConfirmation.showModal();
  }catch(error){requestMessage.textContent=error.message;}finally{requestSending=false;updateRequestButton();}
 });

}
const dialog=document.querySelector('#lightbox');
if(dialog){
 const large=document.querySelector('#lightbox-image'),caption=document.querySelector('#lightbox-caption'),stage=dialog.querySelector('#lightbox-stage');
 const photos=Array.from(document.querySelectorAll('.photo-open')),pointers=new Set(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const viewport=document.createElement('div');viewport.className='lightbox-viewport';
 const slides=[-1,0,1].map(offset=>{const frame=document.createElement('div');frame.className='lightbox-slide';const image=offset===0?large:document.createElement('img');image.draggable=false;if(offset!==0){frame.setAttribute('aria-hidden','true');image.alt='';}frame.append(image);viewport.append(frame);return {frame,image,offset};});
 stage.insertBefore(viewport,stage.querySelector('#lightbox-next'));
 let opener,currentIndex=0,gesture=null,animating=false,finishTimer;
 const indexOf=index=>(index+photos.length)%photos.length;
 const width=()=>viewport.getBoundingClientRect().width;
 function position(displacement,duration=0){const size=width();for(const slide of slides){slide.frame.style.transition=duration?`transform ${duration}ms cubic-bezier(.2,.75,.25,1)`:'none';slide.frame.style.transform=`translate3d(${slide.offset*size+displacement}px,0,0)`;}}
 function placeCaption(){if(dialog.open)caption.style.top=(large.getBoundingClientRect().bottom-dialog.getBoundingClientRect().top+12)+'px';}
 large.addEventListener('load',placeCaption);
 function resetDismiss(){viewport.style.transition='none';viewport.style.transform='';dialog.style.removeProperty('--lightbox-shade');dialog.classList.remove('lightbox-dragging');}
 function dragPhoto(dx,dy,duration=0){
  const distance=Math.hypot(dx,dy),progress=Math.min(1,distance/Math.max(180,viewport.clientHeight*.5));
  viewport.style.transition=duration?`transform ${duration}ms cubic-bezier(.2,.75,.25,1)`:'none';
  viewport.style.transform=`translate3d(${dx}px,${dy}px,0) scale(${1-progress*.12})`;
  dialog.style.setProperty('--lightbox-shade',String(.96-progress*.7));
 }
 function showPhoto(index){resetDismiss();clearTimeout(finishTimer);animating=false;gesture=null;currentIndex=indexOf(index);for(const slide of slides){const image=photos[indexOf(currentIndex+slide.offset)].querySelector('img');slide.image.src=image.src;if(slide.offset===0)slide.image.alt=image.alt;}caption.textContent=large.alt;position(0);requestAnimationFrame(placeCaption);}
 function settle(step=0){
  gesture=null;animating=true;const duration=reduced.matches?0:260;
  const finish=()=>{if(step)showPhoto(currentIndex+step);else{animating=false;position(0);}};
  position(-step*width(),duration);
  if(duration)finishTimer=setTimeout(finish,duration+20);else finish();
 }
 function navigate(step){if(animating)return;settle(step);}
 photos.forEach((button,index)=>button.addEventListener('click',()=>{opener=button;dialog.showModal();showPhoto(index);document.body.style.overflow='hidden';}));
 dialog.querySelector('#lightbox-prev').addEventListener('click',()=>navigate(-1));
 dialog.querySelector('#lightbox-next').addEventListener('click',()=>navigate(1));
 dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();navigate(event.key==='ArrowRight'?1:-1);}});
 stage.addEventListener('pointerdown',event=>{
  if(event.target.closest('button')||(event.pointerType==='mouse'&&event.button!==0)||animating)return;
  pointers.add(event.pointerId);if(pointers.size!==1){gesture=null;resetDismiss();position(0);return;}
  gesture={id:event.pointerId,x:event.clientX,y:event.clientY,start:performance.now(),mode:null};stage.setPointerCapture(event.pointerId);
 });
 stage.addEventListener('pointermove',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(!gesture.mode&&Math.hypot(dx,dy)>8)gesture.mode=Math.abs(dx)>Math.abs(dy)*1.2?'horizontal':'dismiss';
  if(gesture.mode==='horizontal')position(Math.max(-width(),Math.min(width(),dx)));
  if(gesture.mode==='dismiss'){dialog.classList.add('lightbox-dragging');dragPhoto(dx,dy);}
 });
 function finishDrag(event,cancelled=false){
  const started=gesture;pointers.delete(event.pointerId);if(!started||started.id!==event.pointerId)return;
  gesture=null;
  const dx=event.clientX-started.x,dy=event.clientY-started.y,distance=Math.hypot(dx,dy),velocity=distance/Math.max(1,performance.now()-started.start);
  if(started.mode==='horizontal'){
   const enough=Math.abs(dx)>=Math.max(50,width()*.18)||(Math.abs(dx)>25&&Math.abs(dx)/Math.max(1,performance.now()-started.start)>.5);
   settle(!cancelled&&enough?(dx<0?1:-1):0);return;
  }
  const dismiss=!cancelled&&started.mode==='dismiss'&&(distance>=90||(distance>35&&velocity>.5));
  animating=true;const duration=reduced.matches?0:220;
  if(dismiss){
   const travel=Math.max(innerWidth,innerHeight)*1.25,ratio=travel/Math.max(1,distance);
   dragPhoto(dx*ratio,dy*ratio,duration);dialog.style.setProperty('--lightbox-shade','0');
  }else dragPhoto(0,0,duration);
  const finish=()=>{resetDismiss();animating=false;if(dismiss)dialog.close();};
  if(duration)finishTimer=setTimeout(finish,duration+20);else finish();
 }
 stage.addEventListener('pointerup',event=>finishDrag(event));
 stage.addEventListener('pointercancel',event=>finishDrag(event,true));
 stage.addEventListener('lostpointercapture',event=>{if(gesture?.id===event.pointerId)finishDrag(event,true);});
 viewport.addEventListener('dragstart',event=>event.preventDefault());
 window.addEventListener('resize',()=>{if(dialog.open){pointers.clear();showPhoto(currentIndex);}});
 dialog.querySelector('.close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
 dialog.addEventListener('close',()=>{resetDismiss();clearTimeout(finishTimer);animating=false;gesture=null;pointers.clear();document.body.style.overflow='';opener?.focus();});
}


const reviewsTrack=document.querySelector('#reviews-track');
if(reviewsTrack){
 const cards=[...reviewsTrack.querySelectorAll('.review')],prev=document.querySelector('#reviews-prev'),next=document.querySelector('#reviews-next'),position=document.querySelector('#reviews-position');
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const current=()=>cards.reduce((best,card,index)=>Math.abs(card.offsetLeft-cards[0].offsetLeft-reviewsTrack.scrollLeft)<Math.abs(cards[best].offsetLeft-cards[0].offsetLeft-reviewsTrack.scrollLeft)?index:best,0);
 const update=()=>{prev.disabled=reviewsTrack.scrollLeft<3;next.disabled=reviewsTrack.scrollLeft+reviewsTrack.clientWidth>=reviewsTrack.scrollWidth-3;position.textContent=`${current()+1} / ${cards.length}`;};
 const move=direction=>{const index=Math.max(0,Math.min(cards.length-1,current()+direction));reviewsTrack.scrollTo({left:cards[index].offsetLeft-cards[0].offsetLeft,behavior:reduced.matches?'auto':'smooth'});};
 prev.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));
 reviewsTrack.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowRight'?1:-1);}});
 reviewsTrack.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);update();
}

const googleMapFrame=document.querySelector('iframe#location-map');
if(googleMapFrame){
 // Anticiper la carte pendant le défilement, sans bloquer l’accueil.
 if('IntersectionObserver' in window){
  const mapLoader=new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting)){
    googleMapFrame.loading='eager';
    mapLoader.disconnect();
   }
  },{rootMargin:'2000px 0px'});
  mapLoader.observe(googleMapFrame);
 }
 let mapZoom=16;
 const zoomIn=document.querySelector('#map-zoom-in'),zoomOut=document.querySelector('#map-zoom-out');
 const setMapZoom=delta=>{mapZoom=Math.max(3,Math.min(20,mapZoom+delta));const url=new URL(googleMapFrame.src);url.searchParams.set('z',String(mapZoom));googleMapFrame.src=url.href;zoomIn.disabled=mapZoom===20;zoomOut.disabled=mapZoom===3;};
 zoomIn?.addEventListener('click',()=>setMapZoom(1));zoomOut?.addEventListener('click',()=>setMapZoom(-1));
}
