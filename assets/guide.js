const book=document.querySelector('.guide-book');
if(book){
 const pages=[...book.querySelectorAll('.guide-page')];
 const chapters=[...document.querySelectorAll('[data-guide-page]')];
 const previous=document.querySelector('#guide-prev'),next=document.querySelector('#guide-next');
 const count=document.querySelector('#guide-count'),progress=document.querySelector('#guide-progress-fill');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let current=0,gesture=null,animating=false,timer,suppressClick=false;
 const pointers=new Set();
 let turnLayer=null,turnAnimation=null;
 book.classList.add('guide-ready','guide-slider');
 book.tabIndex=0;book.setAttribute('role','group');book.setAttribute('aria-label','Carnet d’adresses : utiliser les flèches gauche et droite pour feuilleter');
 pages.forEach(page=>{page.hidden=false;page.querySelectorAll('img').forEach(img=>{img.draggable=false;img.addEventListener('load',resize)})});
 function position(distance=0,duration=0){
  const width=book.clientWidth;
  pages.forEach((page,i)=>{
   page.style.transition=duration?`transform ${duration}ms cubic-bezier(.2,.75,.25,1)`:'none';
   page.style.transform=`translate3d(${(i-current)*width+distance}px,0,0)`;
  });
 }
 function resize(){
  if(animating||gesture)return;
  book.style.removeProperty('--guide-spread-height');
  const height=innerWidth>760?Math.max(460,Math.min(680,innerHeight-300)):Math.ceil(Math.max(...pages.map(page=>page.getBoundingClientRect().height)));
  book.style.setProperty('--guide-spread-height',height+'px');
  book.style.height=height+'px';
 }
 function showPage(index){
  clearTimeout(timer);turnAnimation?.cancel();turnAnimation=null;turnLayer?.remove();turnLayer=null;animating=false;gesture=null;
  current=Math.max(0,Math.min(pages.length-1,index));
  pages.forEach((page,i)=>{page.style.zIndex='';page.classList.toggle('is-active',i===current);page.inert=i!==current;page.setAttribute('aria-hidden',String(i!==current))});
  chapters.forEach(button=>{const first=Number(button.dataset.guidePage),last=Number(button.dataset.guideEnd??first),active=current>=first&&current<=last;button.classList.toggle('is-current',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')});
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
 function turnPage(index){
  const target=Math.max(0,Math.min(pages.length-1,index));
  if(target===current)return;
  if(reduced.matches){showPage(target);return}
  // Sur téléphone, garder le glissement tactile existant.
  if(book.clientWidth<720){settle(target);return}
  gesture=null;animating=true;
  const forward=target>current;
  const height=Math.max(pages[current].offsetHeight,pages[target].offsetHeight);
  book.style.height=height+'px';
  function half(page,index){
   const copy=page.children[index].cloneNode(true);
   copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
   copy.removeAttribute('id');return copy;
  }
  function surface(className,content){const node=document.createElement('div');node.className=className;node.append(content);return node}
  turnLayer=document.createElement('div');turnLayer.className='guide-turn-layer';turnLayer.setAttribute('aria-hidden','true');turnLayer.inert=true;
  const left=half(forward?pages[current]:pages[target],0);
  const right=half(forward?pages[target]:pages[current],1);
  turnLayer.append(surface('guide-turn-static guide-turn-static-left',left),surface('guide-turn-static guide-turn-static-right',right));
  const sheet=document.createElement('div');sheet.className='guide-turn-sheet '+(forward?'guide-turn-sheet-forward':'guide-turn-sheet-backward');
  sheet.append(surface('guide-turn-face guide-turn-front',half(pages[current],forward?1:0)),surface('guide-turn-face guide-turn-back',half(pages[target],forward?0:1)));
  turnLayer.append(sheet);pages[target].style.transform='translate3d(0,0,0)';pages[target].style.zIndex='1';book.append(turnLayer);
  const frontShade=sheet.querySelector('.guide-turn-front'),backShade=sheet.querySelector('.guide-turn-back');
  frontShade.animate([{filter:'brightness(1)',boxShadow:'-2px 0 6px #392d2208'},{filter:'brightness(.97)',boxShadow:'-14px 4px 26px #392d2220',offset:.48},{filter:'brightness(1)',boxShadow:'-2px 0 6px #392d2208'}],{duration:850,easing:'ease-in-out'});
  backShade.animate([{filter:'brightness(1)'},{filter:'brightness(.96)',offset:.52},{filter:'brightness(1)'}],{duration:850,easing:'ease-in-out'});
  let finished=false;
  const finish=()=>{
   if(finished)return;finished=true;
   // Garder le dernier feuillet rendu pendant la mise en place du vrai contenu.
   const cover=turnLayer;turnLayer=null;turnAnimation=null;
   showPage(target);
   requestAnimationFrame(()=>requestAnimationFrame(()=>cover?.remove()));
  };
  turnAnimation=sheet.animate([{transform:'rotateY(0deg)'},{transform:`rotateY(${forward?-180:180}deg)`}],{duration:850,easing:'cubic-bezier(.35,.05,.2,1)',fill:'forwards'});
  turnAnimation.onfinish=finish;
  timer=setTimeout(finish,1050);
 }
 function navigate(index){if(!animating)turnPage(index)}
 chapters.forEach(button=>button.addEventListener('click',()=>navigate(Number(button.dataset.guidePage))));
 previous.addEventListener('click',()=>navigate(current-1));
 next.addEventListener('click',()=>navigate(current+1));
 document.querySelector('#carnet').addEventListener('keydown',event=>{
  if(event.key==='ArrowRight'){event.preventDefault();navigate(current+1)}
  if(event.key==='ArrowLeft'){event.preventDefault();navigate(current-1)}
 });
 book.addEventListener('pointerdown',event=>{
  if(animating||(event.pointerType==='mouse'&&event.button!==0))return;
  if(!event.target.closest('a,button,input,select,textarea'))book.focus({preventScroll:true});
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
 const sizes=new ResizeObserver(resize);pages.forEach(page=>sizes.observe(page));
 document.fonts?.ready.then(resize);
 showPage(0);
}
