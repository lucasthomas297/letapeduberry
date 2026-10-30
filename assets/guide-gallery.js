const gallery=document.querySelector('.address-gallery');
if(gallery){
 const cards=[...gallery.querySelectorAll('.address-card')];
 const filters=[...gallery.querySelectorAll('[data-filter]')];
 filters.forEach(button=>button.addEventListener('click',()=>{
  const selected=button.dataset.filter;
  gallery.querySelector('.gallery-grid').classList.toggle('is-filtered',selected!=='all');
  filters.forEach(filter=>filter.setAttribute('aria-pressed',String(filter===button)));
  cards.forEach(card=>{card.hidden=selected!=='all'&&card.dataset.category!==selected});
 }));
}
