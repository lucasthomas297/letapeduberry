export async function initializeBookingSettings({preview=false,adminPost}){
 const panel=document.querySelector('#booking-settings'),general=panel.querySelector('#general-minimum-form'),input=general.elements.min_nights,message=panel.querySelector('#settings-status');
 const days=panel.querySelector('#minimum-days'),heading=panel.querySelector('#minimum-month'),selection=panel.querySelector('#minimum-selection'),dated=panel.querySelector('#dated-minimum-form'),minimum=dated.elements.min_nights,apply=dated.querySelector('[type=submit]'),reset=panel.querySelector('#minimum-reset'),clear=panel.querySelector('#minimum-clear');
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const today=['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-'),last=new Date(Date.parse(today+'T12:00:00Z')+365*86400000).toISOString().slice(0,10);
 let month=new Date(today+'T12:00:00Z');month.setUTCDate(1);let settings,loading=false;const selected=new Set();
 const label=date=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 const iso=date=>date.toISOString().slice(0,10),effective=date=>settings.min_nights_by_date?.[date]??settings.min_nights;
 function controls(){
  apply.disabled=loading||!selected.size;reset.disabled=loading||!selected.size;clear.disabled=loading||!selected.size;
  general.querySelector('button').disabled=loading;
  selection.textContent=!selected.size?'Sélectionnez un jour dans le calendrier.':selected.size===1?`Arrivée le ${label([...selected][0])}`:`${selected.size} dates d’arrivée sélectionnées.`;
 }
 function render(){
  heading.textContent=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(month);
  panel.querySelector('#minimum-prev').disabled=iso(month).slice(0,7)<=today.slice(0,7)||loading;
  panel.querySelector('#minimum-next').disabled=iso(month).slice(0,7)>=last.slice(0,7)||loading;
  days.replaceChildren();const offset=(month.getUTCDay()+6)%7;
  for(let i=0;i<offset;i++)days.append(document.createElement('span'));
  const count=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,0)).getUTCDate();
  for(let day=1;day<=count;day++){
   const date=iso(new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),day,12))),value=effective(date),button=document.createElement('button');button.type='button';button.className='minimum-day';button.disabled=date<today||date>last||loading;button.setAttribute('aria-label',`${label(date)} : ${value} nuit${value>1?'s':''} minimum`);button.setAttribute('aria-pressed',String(selected.has(date)));
   if(settings.min_nights_by_date?.[date]!==undefined)button.classList.add('has-rule');
   const number=document.createElement('span');number.textContent=day;const rule=document.createElement('small');rule.textContent=value+' n';button.append(number,rule);
   button.onclick=()=>{if(selected.has(date))selected.delete(date);else selected.add(date);const values=[...new Set([...selected].map(effective))];minimum.value=values.length===1?values[0]:'';render();};days.append(button);
  }
  controls();
 }
 try{settings=preview?{min_nights:1,min_nights_by_date:{}}:await (await fetch('/api/admin/settings',{cache:'no-store'})).json();if(!Number.isInteger(settings.min_nights))throw Error();input.value=settings.min_nights;render();}catch{message.textContent='Réglages indisponibles. Reconnectez-vous ou actualisez la page.';return;}
 panel.querySelector('#minimum-prev').onclick=()=>{month.setUTCMonth(month.getUTCMonth()-1);render();};panel.querySelector('#minimum-next').onclick=()=>{month.setUTCMonth(month.getUTCMonth()+1);render();};
 clear.onclick=()=>{selected.clear();minimum.value='';render();};
 async function save(data,confirmation){
  loading=true;render();message.textContent='Enregistrement…';
  try{
   if(preview){if(data.dates){for(const date of data.dates){if(data.min_nights===null)delete settings.min_nights_by_date[date];else settings.min_nights_by_date[date]=data.min_nights;}}else settings.min_nights=data.min_nights;message.textContent='Aperçu : '+confirmation+' Aucun réglage réel modifié.';}
   else{settings=await adminPost('settings',data);message.textContent=confirmation;}
   input.value=settings.min_nights;const values=[...new Set([...selected].map(effective))];minimum.value=values.length===1?values[0]:'';
  }catch(error){message.textContent=error.message;}finally{loading=false;render();}
 }
 general.onsubmit=event=>{event.preventDefault();if(!general.reportValidity())return;save({min_nights:Number(input.value)},'Minimum général enregistré. Les règles particulières sont conservées.');};
 dated.onsubmit=event=>{event.preventDefault();if(!selected.size||!dated.reportValidity())return;save({dates:[...selected],min_nights:Number(minimum.value)},`Minimum enregistré pour ${selected.size} date${selected.size>1?'s':''} d’arrivée.`);};
 reset.onclick=()=>{if(selected.size)save({dates:[...selected],min_nights:null},'Les dates sélectionnées utilisent à nouveau le minimum général.');};
}
