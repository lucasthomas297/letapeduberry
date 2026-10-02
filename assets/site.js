const form=document.querySelector('.booking');
if(form){
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
 const minDate=field=>{if(field!=='depart'||!arrival.value)return today;const next=fromISO(arrival.value);next.setDate(next.getDate()+1);return iso(next)};
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
   button.type='button';button.textContent=day;button.disabled=value<min;
   button.setAttribute('aria-label',dateLabel(value));
   if(value===selected){button.classList.add('is-selected');button.setAttribute('aria-pressed','true')}
   if(value===today)button.classList.add('is-today');
   button.addEventListener('click',event=>{
    event.stopPropagation();
    form.elements[activeDate].value=value;
    dateValues[activeDate].textContent=dateLabel(value);
    dateValues[activeDate].classList.remove('booking-placeholder');
    estimate.hidden=true;requestPanel.hidden=true;error.hidden=true;
    const chosen=activeDate;
    closeCalendar();
    if(chosen==='arrivee'){
     if(departure.value<=value){departure.value='';dateValues.depart.textContent='Choisir une date';dateValues.depart.classList.add('booking-placeholder')}
     if(!departure.value)openCalendar('depart');
    }
   });
   calendarDays.append(button);
  }
  calendarHint.textContent=activeDate==='arrivee'?'Sélectionnez votre jour d’arrivée':'Sélectionnez votre jour de départ';
  placeCalendar();
 };
 function openCalendar(field){
  closeGuests();closeCalendar();activeDate=field;
  const value=form.elements[field].value||minDate(field);
  const date=fromISO(value);viewMonth=new Date(date.getFullYear(),date.getMonth(),1);
  calendar.hidden=false;dateTriggers[field].setAttribute('aria-expanded','true');
  calendar.setAttribute('aria-label',field==='arrivee'?'Choisir la date d’arrivée':'Choisir la date de départ');
  renderCalendar();
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
 form.addEventListener('submit',e=>{e.preventDefault();if(!arrival.value||!departure.value||departure.value<=arrival.value){error.textContent=!arrival.value?'Choisissez votre date d’arrivée.':!departure.value?'Choisissez votre date de départ.':'Le départ doit être après l’arrivée.';error.hidden=false;estimate.hidden=true;requestPanel.hidden=true;openCalendar(!arrival.value?'arrivee':'depart');return}error.hidden=true;const start=fromISO(arrival.value),end=fromISO(departure.value);let fixed=0,flex=0,nights=0;for(let d=new Date(start);d<end;d.setDate(d.getDate()+1)){const weekend=[5,6].includes(d.getDay());fixed+=weekend?75:70;flex+=weekend?84:78;nights++}const extras=(earlyArrival.checked?5:0)+(lateDeparture.checked?5:0);fixed+=extras;flex+=extras;const selected=[earlyArrival.checked?'arrivée dès 14 h (+ 5 €)':null,lateDeparture.checked?'départ jusqu’à 12 h (+ 5 €)':null].filter(Boolean);const euro=n=>n.toLocaleString('fr-FR')+' €';estimate.innerHTML=`<strong>Votre séjour · ${nights} nuit${nights>1?'s':''} · ${guestInput.value}</strong><p>Non remboursable : <strong>${euro(fixed)}</strong> · Remboursable : <strong>${euro(flex)}</strong></p>${selected.length?`<p>Options incluses : ${selected.join(' · ')}.</p>`:''}<p>Ménage et taxe de séjour compris. Annulation du tarif remboursable jusqu’à 24 h avant l’arrivée.</p><p>Estimation du tarif uniquement. Disponibilité et horaires à confirmer auprès de Lucas.</p>`;estimate.hidden=false;requestPanel.hidden=!requestServiceReady;estimate.scrollIntoView({behavior:'smooth',block:'nearest'});
 });
 const requestPanel=document.querySelector('#request-panel'),requestMessage=document.querySelector('#request-message');
 let requestServiceReady=false;
 fetch('/api/status').then(response=>response.ok?response.json():null).then(data=>{requestServiceReady=Boolean(data?.requests_ready);if(requestServiceReady&&!estimate.hidden)requestPanel.hidden=false}).catch(()=>{});
 document.querySelector('#request-send').addEventListener('click',async()=>{
  const name=document.querySelector('#request-name'),email=document.querySelector('#request-email'),phone=document.querySelector('#request-phone');
  if(!name.reportValidity()||!email.reportValidity()||!phone.reportValidity())return;
  const button=document.querySelector('#request-send');button.disabled=true;requestMessage.textContent='Envoi en cours…';
  const payload={arrival:arrival.value,departure:departure.value,guests:guestInput.value.startsWith('1')?1:2,
   early:earlyArrival.checked,late:lateDeparture.checked,rate:document.querySelector('#request-rate').value,
   name:name.value.trim(),email:email.value.trim(),phone:phone.value.trim(),
   payment:document.querySelector('input[name="payment_preference"]:checked').value};
  try{
   const response=await fetch('/api/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Le service de demande est momentanément indisponible.');}
   const data=await response.json();requestMessage.textContent=`Demande envoyée (référence ${data.reference}). Lucas vous répondra par e-mail. Aucun paiement n’a été effectué.`;
   button.hidden=true;
  }catch(error){requestMessage.textContent=error.message;button.disabled=false;}
 });

}
const dialog=document.querySelector('#lightbox');
if(dialog){
 const large=document.querySelector('#lightbox-image'),caption=document.querySelector('#lightbox-caption');
 const photos=Array.from(document.querySelectorAll('.photo-open'));
 let opener,currentIndex=0;
 const showPhoto=index=>{currentIndex=(index+photos.length)%photos.length;const img=photos[currentIndex].querySelector('img');large.src=img.src;large.alt=img.alt;caption.textContent=img.alt};
 photos.forEach((button,index)=>button.addEventListener('click',()=>{opener=button;showPhoto(index);dialog.showModal();document.body.style.overflow='hidden'}));
 dialog.querySelector('#lightbox-prev').addEventListener('click',()=>showPhoto(currentIndex-1));
 dialog.querySelector('#lightbox-next').addEventListener('click',()=>showPhoto(currentIndex+1));
 dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();showPhoto(currentIndex+(event.key==='ArrowRight'?1:-1))}});
 dialog.querySelector('.close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
 dialog.addEventListener('close',()=>{document.body.style.overflow='';opener?.focus()});
}

if(document.querySelector('#location-map') && window.L){
 const map=L.map('location-map',{scrollWheelZoom:false}).setView([47.0935619,2.3951321],15);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
 const icon=L.divIcon({className:'stay-pin',iconSize:[32,32],iconAnchor:[16,32],popupAnchor:[0,-30]});
 L.marker([47.0935619,2.3951321],{icon,title:'L’Étape du Berry',alt:'16 Place du Général Leclerc, Bourges'}).addTo(map).bindPopup('<strong>L’Étape du Berry</strong><br>16 Place du Général Leclerc<br>18000 Bourges');
 document.querySelector('#location-map .leaflet-control-zoom-in').setAttribute('aria-label','Agrandir la carte');document.querySelector('#location-map .leaflet-control-zoom-out').setAttribute('aria-label','Réduire la carte');
}
