const book=document.querySelector('.guide-book');
if(book){
 const pages=[...book.querySelectorAll('.guide-page')];
 const chapters=[...document.querySelectorAll('[data-guide-page]')];
 const previous=document.querySelector('#guide-prev'),next=document.querySelector('#guide-next');
 const count=document.querySelector('#guide-count'),progress=document.querySelector('#guide-progress-fill');
 let current=0,startX=null;
 book.classList.add('guide-ready');
 function showPage(index){
  current=Math.max(0,Math.min(pages.length-1,index));
  pages.forEach((page,i)=>{page.hidden=i!==current;page.classList.toggle('is-active',i===current)});
  chapters.forEach((button,i)=>{button.classList.toggle('is-current',i===current);if(i===current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
  previous.disabled=current===0;next.disabled=current===pages.length-1;
  count.textContent=String(current+1).padStart(2,'0')+' / '+String(pages.length).padStart(2,'0');
  progress.style.width=((current+1)/pages.length*100)+'%';
 }
 chapters.forEach(button=>button.addEventListener('click',()=>showPage(Number(button.dataset.guidePage))));
 previous.addEventListener('click',()=>showPage(current-1));
 next.addEventListener('click',()=>showPage(current+1));
 document.querySelector('#carnet').addEventListener('keydown',event=>{
  if(event.key==='ArrowRight'){event.preventDefault();showPage(current+1)}
  if(event.key==='ArrowLeft'){event.preventDefault();showPage(current-1)}
 });
 book.addEventListener('touchstart',event=>{startX=event.touches[0].clientX},{passive:true});
 book.addEventListener('touchend',event=>{if(startX===null)return;const distance=event.changedTouches[0].clientX-startX;if(Math.abs(distance)>65)showPage(current+(distance<0?1:-1));startX=null},{passive:true});
 showPage(0);
}

