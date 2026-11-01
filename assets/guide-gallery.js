const gallery=document.querySelector('.address-gallery');
if(gallery){
 const cards=[...gallery.querySelectorAll('.address-card')];
 const filters=[...gallery.querySelectorAll('[data-filter]')];
 const compactLabels={all:'Tout',bourges:'Bourges',restaurant:'Restaurants',saveurs:'MONIN',sancerre:'Sancerre'};
 filters.forEach(button=>{
  const full=document.createElement('span');full.className='filter-full-label';full.textContent=button.textContent.replace(/\s+\d+\s*$/,'').trim();
  const compact=document.createElement('span');compact.className='filter-short-label';compact.textContent=compactLabels[button.dataset.filter];compact.setAttribute('aria-hidden','true');
  button.replaceChildren(full,compact);
 });
 filters.forEach(button=>button.addEventListener('click',()=>{
  const selected=button.dataset.filter;
  gallery.querySelector('.gallery-grid').classList.toggle('is-filtered',selected!=='all');
  filters.forEach(filter=>filter.setAttribute('aria-pressed',String(filter===button)));
  cards.forEach(card=>{card.hidden=selected!=='all'&&card.dataset.category!==selected});
 }));
}
