const book=document.querySelector('.guide-book');
if(book){
 const pages=[...book.querySelectorAll('.guide-page')];
 const chapters=[...document.querySelectorAll('[data-guide-page]')];
 const previous=document.querySelector('#guide-prev'),next=document.querySelector('#guide-next');
 const count=document.querySelector('#guide-count'),progress=document.querySelector('#guide-progress-fill');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let current=0,gesture=null,animating=false,timer,suppressClick=false;
 const pointers=new Set();
 book.classList.add('guide-ready','guide-slider');
 pages.forEach(page=>{page.hidden=false;page.querySelectorAll('img').forEach(img=>{img.draggable=false;img.addEventListener('load',resize)})});
 function position(distance=0,duration=0){
  const width=book.clientWidth;
  pages.forEach((page,i)=>{
   page.style.transition=duration?`transform ${duration}ms cubic-bezier(.2,.75,.25,1)`:'none';
   page.style.transform=`translate3d(${(i-current)*width+distance}px,0,0)`;
  });
 }
 function resize(){if(!animating&&!gesture)book.style.height=pages[current].offsetHeight+'px'}
 function showPage(index){
  clearTimeout(timer);animating=false;gesture=null;
  current=Math.max(0,Math.min(pages.length-1,index));
  pages.forEach((page,i)=>{page.classList.toggle('is-active',i===current);page.inert=i!==current;page.setAttribute('aria-hidden',String(i!==current))});
  chapters.forEach((button,i)=>{button.classList.toggle('is-current',i===current);if(i===current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
  previous.disabled=current===0;next.disabled=current===pages.length-1;
  count.textContent=String(current+1).padStart(2,'0')+' / '+String(pages.length).padStart(2,'0');
  progress.style.width=((current+1)/pages.length*100)+'%';
  position();resize();
 }
 function settle(index=current){
  gesture=null;animating=true;
  const target=Math.max(0,Math.min(pages.length-1,index)),duration=reduced.matches?0:280;
  book.style.height=Math.max(pages[current].offsetHeight,pages[target].offsetHeight)+'px';
  position((current-target)*book.clientWidth,duration);
  if(duration)timer=setTimeout(()=>showPage(target),duration+20);else showPage(target);
 }
 function navigate(index){if(!animating)settle(index)}
 chapters.forEach(button=>button.addEventListener('click',()=>navigate(Number(button.dataset.guidePage))));
 previous.addEventListener('click',()=>navigate(current-1));
 next.addEventListener('click',()=>navigate(current+1));
 document.querySelector('#carnet').addEventListener('keydown',event=>{
  if(event.key==='ArrowRight'){event.preventDefault();navigate(current+1)}
  if(event.key==='ArrowLeft'){event.preventDefault();navigate(current-1)}
 });
 book.addEventListener('pointerdown',event=>{
  if(animating||(event.pointerType==='mouse'&&event.button!==0))return;
  pointers.add(event.pointerId);
  if(pointers.size>1){gesture=null;position();resize();return}
  gesture={id:event.pointerId,x:event.clientX,y:event.clientY,time:performance.now(),mode:'pending'};
 });
 book.addEventListener('pointermove',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(gesture.mode==='pending'&&Math.max(Math.abs(dx),Math.abs(dy))>8){
   gesture.mode=Math.abs(dx)>Math.abs(dy)*1.2?'horizontal':'vertical';
   if(gesture.mode==='horizontal')book.setPointerCapture(event.pointerId);
  }
  if(gesture.mode!=='horizontal')return;
  const target=current+(dx<0?1:-1);
  book.style.height=Math.max(pages[current].offsetHeight,pages[Math.max(0,Math.min(pages.length-1,target))].offsetHeight)+'px';
  const edge=(current===0&&dx>0)||(current===pages.length-1&&dx<0);
  position(Math.max(-book.clientWidth,Math.min(book.clientWidth,dx*(edge?.25:1))));
 });
 book.addEventListener('pointerup',event=>{
  pointers.delete(event.pointerId);
  if(!gesture||gesture.id!==event.pointerId)return;
  const dx=event.clientX-gesture.x,velocity=Math.abs(dx)/Math.max(1,performance.now()-gesture.time);
  const horizontal=gesture.mode==='horizontal';
  suppressClick=horizontal;
  const enough=Math.abs(dx)>=Math.max(50,book.clientWidth*.18)||(Math.abs(dx)>25&&velocity>.5);
  settle(horizontal&&enough?current+(dx<0?1:-1):current);
  setTimeout(()=>{suppressClick=false},0);
 });
 book.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);if(gesture?.id===event.pointerId)settle()});
 book.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopPropagation()}},true);
 book.addEventListener('dragstart',event=>event.preventDefault());
 window.addEventListener('resize',()=>{pointers.clear();showPage(current)});
 new ResizeObserver(resize).observe(pages[current]);
 showPage(0);
}
