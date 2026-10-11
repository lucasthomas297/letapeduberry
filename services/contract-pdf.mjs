import PDFLib from './vendor/pdf-lib.cjs';
import {savedDocumentModel,euros,arrivalTerms,priceRows} from './contract.mjs';
import {contractPdf as legacyPdf,contractBlocks} from './contract-pdf-legacy.mjs';
import photo64 from './pdf-photo.mjs';
export {contractBlocks};
const {PDFDocument,StandardFonts,rgb}=PDFLib;
const ink=rgb(.16,.22,.20),gold=rgb(.66,.52,.32),muted=rgb(.40,.44,.42),cream=rgb(.97,.96,.93),white=rgb(1,1,1);
const clean=t=>String(t??'').replace(/[\u00a0\u202f\u2009]/g,' ').replace(/[\u2011\u2013\u2014]/g,'-');
async function createDocument(m,type){
 const doc=await PDFDocument.create();doc.setTitle((type==='contract'?'Contrat de location':'Fiche descriptive')+' - L’Étape du Berry');doc.setAuthor('L’Étape du Berry');
 const font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),serif=await doc.embedFont(StandardFonts.TimesRoman);
 const W=595.28,H=841.89,M=42,C=W-2*M,B=62;
 let page,y,contentTop;
 const draw=(t,x,yy,size=10,f=font,color=ink)=>page.drawText(clean(t),{x,y:yy,size,font:f,color});
 function round(x,top,w,h,color=cream,r=8){
  const yy=top-h;
  page.drawRectangle({x:x+r,y:yy,width:w-2*r,height:h,color});page.drawRectangle({x,y:yy+r,width:w,height:h-2*r,color});
  for(const cx of [x+r,x+w-r])for(const cy of [yy+r,yy+h-r])page.drawEllipse({x:cx,y:cy,xScale:r,yScale:r,color});
 }
 function lines(t,size=10,w=C,f=font){
  const out=[];for(const para of clean(t).split('\n')){let l='';for(const word of para.split(/\s+/).filter(Boolean)){
   if(f.widthOfTextAtSize(word,size)>w){if(l){out.push(l);l='';}for(const char of word){if(f.widthOfTextAtSize(l+char,size)>w){out.push(l);l='';}l+=char;}}
   else if(l&&f.widthOfTextAtSize(l+' '+word,size)>w){out.push(l);l=word;}else l+=(l?' ':'')+word;
  }out.push(l);}return out;
 }
 function add(){const first=doc.getPageCount()===0;page=doc.addPage([W,H]);
  round(M,H-30,C,first?76:57,ink,10);draw('L’ÉTAPE DU BERRY',M+16,H-49,first?10:8,bold,gold);
  const title=(type==='contract'?'Contrat de location n° ':'Fiche descriptive n° ')+m.number;const titleSize=Math.min(first?22:18,(C-32)/serif.widthOfTextAtSize(clean(title),1));draw(title,M+16,H-(first?83:72),titleSize,serif,white);y=H-(first?127:105);contentTop=y;
 }
 function ensure(h){if(y-h<B)add();}
 function heading(t){ensure(54);if(y<contentTop)y-=8;draw(t,M,y,15,serif);y-=16;}
 function paragraph(t,size=10,lead=14){lead+=.8;const ls=lines(t,size);ensure(Math.min(ls.length,3)*lead);for(let i=0;i<ls.length;i++){ensure(i===ls.length-2?2*lead:lead);draw(ls[i],M,y,size);y-=lead;}y-=type==='contract'?6:8;}
 function box(title,content,x,top,w,h){round(x,top,w,h);draw(title,x+12,top-19,9,bold,gold);const ls=lines(content,9.3,w-24);ls.forEach((l,i)=>draw(l,x+12,top-39-i*13,9.3));}
 function checkbox(t,checked,x=M,yy=y,w=C){const ls=lines(t,9.5,w-21),h=ls.length*13;
  page.drawRectangle({x,y:yy-1,width:9,height:9,borderColor:gold,borderWidth:.8});
  if(checked){page.drawLine({start:{x:x+1.5,y:yy+3},end:{x:x+4,y:yy+.5},thickness:1.1,color:ink});page.drawLine({start:{x:x+4,y:yy+.5},end:{x:x+8,y:yy+6.5},thickness:1.1,color:ink});}
  ls.forEach((l,i)=>draw(l,x+19,yy-i*13,9.5));return h+9;
 }
 function totalsHeight(w){return Math.max(146,47+priceRows(m).reduce((height,[label])=>height+Math.max(19,lines(label,9.0,w-94).length*12+7),0));}
 function totals(x,top,w){const h=totalsHeight(w);round(x,top,w,h);
  round(x,top,w,31,ink,7);draw('Montant de votre séjour',x+12,top-20,11,bold,white);
  const rows=priceRows(m);let yy=top-52;
  rows.forEach(([t,n],i)=>{const last=i===rows.length-1,f=last?bold:font,ls=lines(t,9.0,w-94,f);
   if(last)page.drawLine({start:{x:x+12,y:yy+13},end:{x:x+w-12,y:yy+13},thickness:.5,color:gold});
   ls.forEach((line,j)=>draw(line,x+12,yy-j*12,9.0,f));const v=clean(euros(n));draw(v,x+w-12-f.widthOfTextAtSize(v,10),yy,10,f);yy-=Math.max(19,ls.length*12+7);
  });return h;
 }
 function payments(x,top,w,h=146){round(x,top,w,h);round(x,top,w,31,ink,7);draw('Mode de paiement',x+12,top-20,11,bold,white);
  checkbox('Espèces',m.payment==='cash',x+12,top-53,w-24);checkbox('Par carte bancaire : paiement en ligne',m.payment==='card',x+12,top-83,w-24);
  draw('Ménage et charges compris.',x+12,top-h+24,8.7,font,muted);return h;
 }
 function bullet(t){const lead=13.8,ls=lines(t,9.5,C-16);ensure(ls.length*lead);draw('-',M,y,10,bold,gold);ls.forEach((l,i)=>draw(l,M+15,y-i*lead,9.5));y-=ls.length*lead;}
 add();
 if(type==='contract'){
  const half=(C-14)/2;
  const ownerH=lines(m.owner.join('\n'),9.3,half-24).length*13+48,guestH=lines(m.guest.join('\n'),9.3,half-24).length*13+48;
  const h=Math.max(ownerH,guestH);box('Le loueur',m.owner.join('\n'),M,y,half,h);box('Le voyageur',m.guest.join('\n'),M+half+14,y,half,h);y-=h+18;
  heading('Votre séjour');paragraph(m.address+'\n'+m.area+' m² · '+m.rooms+' · '+m.classification);
  if(m.registration)paragraph('Numéro d’enregistrement : '+m.registration);
  const stay=`Du ${m.arrival} à ${m.arrivalTime} au ${m.departure} à ${m.departureTime}\n${m.nights} nuits · ${m.guests} voyageurs · Capacité maximale : 2 personnes\n${[m.early?'Arrivée anticipée : + 5 €':null,m.late?'Départ tardif : + 5 €':null].filter(Boolean).join(' · ')||'Aucune option d’horaires souscrite.'}\n${arrivalTerms(m)} Le réservant doit être majeur.`;
  const sh=lines(stay,9.3,C-24).length*13+48;box('Dates et horaires',stay,M,y,C,sh);y-=sh+16;
  const priceH=totalsHeight(half);ensure(priceH+18);totals(M,y,half);payments(M+half+14,y,half,priceH);y-=priceH+18;
  paragraph(m.paymentTerms,9.5,13);paragraph(m.intermediary,9.5,13);
  paragraph('Fiche descriptive n° '+m.number+' annexée au contrat : logement, mobilier, équipements et services.',9.5,13);
  if(m.acceptedAt)paragraph('Acceptation enregistrée : '+m.signer+' - '+new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(m.acceptedAt)),8,11);
  if(m.payment==='card')paragraph(m.acceptanceTerms,9,12);
  add();heading('Annulation');m.cancellation.forEach(t=>paragraph(t,9.3,13.5));
  heading('Dépôt de garantie : 300 €');m.deposit.forEach(t=>paragraph(t,9.3,13.5));
  heading('Règlement intérieur');
  const ruleLeading=14.3; // Same as the adjacent paragraphs: 13.5 + 0.8 pt.
  for(const rule of m.rules){
   const wrapped=lines(rule,9.3,C-15);ensure(wrapped.length*ruleLeading);
   draw('-',M,y,10,bold,gold);
   wrapped.forEach((line,index)=>draw(line,M+15,y-index*ruleLeading,9.3));
   y-=wrapped.length*ruleLeading;
  }

  ensure(115);heading('Déclarations et acceptation');
  // Printed declarations are prefilled; online consent and its timestamp remain recorded separately.
  y-=checkbox(m.insurance,true);y-=checkbox(m.agreement,true);
  paragraph(m.copy,9,12);
  if(m.payment!=='card')paragraph(m.acceptanceTerms||'L’acceptation expresse du voyageur et l’accord du loueur sont conservés avec le contrat.',9,12);
 }else{
  const photo=await doc.embedJpg(Uint8Array.from(atob(photo64),c=>c.charCodeAt(0)));
  const iw=224,ih=iw*photo.height/photo.width;page.drawImage(photo,{x:M,y:y-ih,width:iw,height:ih});
  box('L’appartement',`${m.area} m²\n${m.rooms}\n1 chambre · Lit double\n2 voyageurs maximum\n${m.classification}\nRez-de-chaussée sans escalier`,M+iw+16,y,C-iw-16,ih);y-=ih+20;
  heading('Adresse et situation');paragraph(m.address);paragraph(m.description);paragraph(m.location);
  heading('Le loueur');paragraph(m.owner.join('\n'),9.5,13);if(m.registration)paragraph('Numéro d’enregistrement : '+m.registration);
  paragraph('Arrivée anticipée dès 14 h : 5 €. Départ tardif jusqu’à 12 h : 5 €. Sur demande et sous réserve de disponibilité.',9.3,13);
  paragraph(m.depositSummary||'Dépôt de garantie : 300 €, par empreinte bancaire demandée 48 heures avant l’arrivée ; libération sous 48 heures après le départ sans dommage. Modalités détaillées au contrat.',9.3,13);
  paragraph('Fiche descriptive associée au contrat de location n° '+m.number+'.',9,12);
  add();heading('Mobilier et équipements');
  for(const [room,content] of m.inventory){const h=lines(content,9.5,C-153).length*14+25;ensure(h+8);round(M,y,C,h);draw(room,M+12,y-21,9.5,bold);lines(content,9.5,C-153).forEach((l,i)=>draw(l,M+140,y-21-i*14,9.5));y-=h+8;}
  y-=10;heading('Services et stationnement');m.services.forEach(bullet);paragraph(m.parking,9.5,13);
  heading('Prix du séjour et paiement');const half=(C-14)/2,priceH=totalsHeight(half);ensure(priceH+16);totals(M,y,half);payments(M+half+14,y,half,priceH);y-=priceH+16;
  paragraph(m.paymentTerms,9.3,13);
 }
 const pages=doc.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:M,y:44},end:{x:W-M,y:44},thickness:.5,color:gold});p.drawText('L’Étape du Berry · '+(type==='contract'?'Contrat':'Fiche descriptive')+' n° '+m.number,{x:M,y:28,size:8,font,color:muted});const n=`${i+1} / ${pages.length}`;p.drawText(n,{x:W-M-font.widthOfTextAtSize(n,8),y:28,size:8,font,color:muted});});return doc.save();
}
export async function contractPdf(html,acceptance={}){const m=savedDocumentModel(html);if(!m)return legacyPdf(html);return createDocument({...m,...acceptance},'contract');}
export async function descriptionPdf(html){const m=savedDocumentModel(html);if(!m)throw new Error('Fiche descriptive absente de ce contrat archivé');return createDocument(m,'description');}
