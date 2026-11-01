(() => {
 const mobile=matchMedia('(max-width:760px)');
 const filters=document.querySelector('.gallery-filters');
 const placeholder=filters?document.createComment('Position des filtres du guide'):null;
 if(filters){
  filters.before(placeholder);
  const place=()=>{
   if(mobile.matches){filters.classList.add('mobile-guide-filters');document.body.append(filters)}
   else{filters.classList.remove('mobile-guide-filters');placeholder.after(filters)}
  };
  place();mobile.addEventListener('change',place);
 }
 [document.querySelector('.navlinks'),filters].filter(Boolean).forEach(dock=>{
  const items=[...dock.querySelectorAll(':scope > a,:scope > button')];
  const bubble=document.createElement('i');bubble.className='glass-selection';bubble.setAttribute('aria-hidden','true');dock.prepend(bubble);dock.classList.add('glass-draggable');
  let gesture=null,suppressUntil=0;
  const selected=()=>items.find(item=>item.matches('.dock-current,[aria-pressed="true"]'));
  const paint=(x,width,visible=true)=>{bubble.style.width=width+'px';bubble.style.transform=`translate3d(${x}px,0,0)`;bubble.style.opacity=visible?'1':'0'};
  const settle=()=>{
   if(gesture||!mobile.matches)return;
   const item=selected();if(!item){bubble.style.opacity='0';return}
   const box=dock.getBoundingClientRect(),r=item.getBoundingClientRect();paint(r.left-box.left,r.width);
  };
  const nearest=x=>items.reduce((best,item)=>Math.abs(item.getBoundingClientRect().left+item.getBoundingClientRect().width/2-x)<Math.abs(best.getBoundingClientRect().left+best.getBoundingClientRect().width/2-x)?item:best,items[0]);
  dock.addEventListener('pointerdown',event=>{
   if(!mobile.matches||event.button!==0||!event.target.closest('a,button'))return;
   const item=nearest(event.clientX);gesture={id:event.pointerId,start:event.clientX,item,dragged:false};
  });
  dock.addEventListener('pointermove',event=>{
   if(!gesture||gesture.id!==event.pointerId)return;
   if(Math.abs(event.clientX-gesture.start)>7)gesture.dragged=true;
   if(!gesture.dragged)return;
   event.preventDefault();if(!dock.hasPointerCapture(event.pointerId))dock.setPointerCapture(event.pointerId);
   dock.classList.add('glass-dragging');
   const box=dock.getBoundingClientRect(),item=nearest(event.clientX),r=item.getBoundingClientRect();gesture.item=item;
   const x=Math.max(5,Math.min(box.width-r.width-5,event.clientX-box.left-r.width/2));paint(x,r.width);
  },{passive:false});
  const finish=(event,cancel=false)=>{
   if(!gesture||event.pointerId!==gesture.id)return;
   const state=gesture;gesture=null;dock.classList.remove('glass-dragging');
   if(dock.hasPointerCapture(event.pointerId))dock.releasePointerCapture(event.pointerId);
   if(state.dragged){suppressUntil=performance.now()+600;if(!cancel)state.item.click()}
   requestAnimationFrame(settle);
  };
  dock.addEventListener('pointerup',event=>finish(event));
  dock.addEventListener('pointercancel',event=>finish(event,true));
  dock.addEventListener('click',event=>{if(event.isTrusted&&performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation()}else requestAnimationFrame(settle)},true);
  new MutationObserver(settle).observe(dock,{subtree:true,attributes:true,attributeFilter:['class','aria-pressed']});
  new ResizeObserver(settle).observe(dock);window.addEventListener('pageshow',settle);mobile.addEventListener('change',settle);requestAnimationFrame(settle);
 });
})();
