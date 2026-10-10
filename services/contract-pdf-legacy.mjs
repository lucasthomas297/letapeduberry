import PDFLib from './vendor/pdf-lib.cjs';
const {PDFDocument,StandardFonts,rgb}=PDFLib;
const decode=text=>text.replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[entity]));
// Read the saved contract, so the PDF contains the text presented to the guest.
export function contractBlocks(html) {
 const clean=String(html).replace(/<(style|script|title)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 return [...clean.matchAll(/<(h1|h2|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(([,tag,body])=>({tag,text:decode(body.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'')).replace(/[\u00a0\u202f\u2009]/g,' ').replace(/[\u2011\u2013\u2014]/g,'-').trim()}));
}
export async function contractPdf(html) {
 const doc=await PDFDocument.create();
 doc.setTitle('Contrat de location - L’Étape du Berry');doc.setAuthor('L’Étape du Berry');
 const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),serif=await doc.embedFont(StandardFonts.TimesRoman);
 const ink=rgb(.16,.22,.20),gold=rgb(.66,.52,.32),muted=rgb(.41,.45,.43),paper=rgb(.98,.97,.94),white=rgb(1,1,1);
 const width=595.28,height=841.89,margin=48,bottom=64,lineWidth=width-margin*2;
 const originalBlocks=contractBlocks(html),draft=originalBlocks.some(block=>block.text.includes('projet à valider'));
 // Organise the same saved clauses into three readable chapters, without rewriting them.
 const preamble=[],groups=[];
 for(const block of originalBlocks){
  if(block.tag==='h2')groups.push([block]);
  else if(groups.length)groups.at(-1).push(block);
  else preamble.push(block);
 }
 const expected=['Les parties','Description','Prix','Annulation','Règlement','Acceptation'];
 const recognised=groups.length===6&&groups.every((group,index)=>group[0].text.startsWith(expected[index]));
 const blocks=recognised?[...preamble,...groups[0],...groups[2],{tag:'page'},...groups[1],...groups[4],{tag:'page'},...groups[3],...groups[5]]:originalBlocks;
 let page,y,section=0;
 function addPage(first=false){
  page=doc.addPage([width,height]);
  if(first){
   page.drawRectangle({x:0,y:height-156,width,height:156,color:ink});
   page.drawText('L’ÉTAPE DU BERRY',{x:margin,y:height-41,size:12,font:bold,color:gold});
   page.drawText('BOURGES  /  LOCATION SAISONNIÈRE',{x:margin,y:height-60,size:8,font:regular,color:white});
   page.drawText('Contrat de location',{x:margin,y:height-104,size:29,font:serif,color:white});
   page.drawText('Votre séjour, ses prestations et ses conditions',{x:margin,y:height-125,size:10,font:regular,color:white});
   y=height-183;
  }else{
   page.drawText('L’ÉTAPE DU BERRY',{x:margin,y:height-39,size:10,font:bold,color:gold});
   page.drawText('CONTRAT DE LOCATION SAISONNIÈRE',{x:margin,y:height-56,size:8,font:regular,color:muted});
   page.drawLine({start:{x:margin,y:height-68},end:{x:width-margin,y:height-68},thickness:.6,color:gold});
   y=height-93;
  }
 }
 function wrap(text,font,size,maxWidth=lineWidth){
  const lines=[];
  for(const paragraph of text.split('\n')){
   let line='';
   for(const word of paragraph.split(/\s+/).filter(Boolean)){
    if(font.widthOfTextAtSize(word,size)>maxWidth){
     if(line){lines.push(line);line='';}
     let part='';for(const letter of word){if(font.widthOfTextAtSize(part+letter,size)>maxWidth){lines.push(part);part='';}part+=letter;}line=part;
    }else if(line&&font.widthOfTextAtSize(line+' '+word,size)>maxWidth){lines.push(line);line=word;}
    else line+=(line?' ':'')+word;
   }
   lines.push(line);
  }
  return lines;
 }
 addPage(true);
 function panel(text,x,top,panelWidth,label){
  const lines=wrap(text,regular,9.5,panelWidth-24),panelHeight=lines.length*14+44;
  page.drawRectangle({x,y:top-panelHeight,width:panelWidth,height:panelHeight,color:paper});
  page.drawText(label,{x:x+12,y:top-18,size:8,font:bold,color:gold});
  lines.forEach((line,index)=>page.drawText(line,{x:x+12,y:top-38-index*14,size:9.5,font:regular,color:ink}));
  return panelHeight;
 }
 let skipGuest=false;
 for(const block of blocks){
  if(block.tag==='page'){addPage();continue;}
  if(block.tag==='h1')continue; // The title is reproduced in the cover header.
  if(block.tag==='h2'){
   section++;
   const lines=wrap(block.text,serif,17,lineWidth-26),needed=lines.length*22+12+3*15.5;
   if(y-needed<bottom)addPage();
   y-=12;
   page.drawText(String(section).padStart(2,'0'),{x:margin,y,size:9,font:bold,color:gold});
   for(const line of lines){page.drawText(line,{x:margin+26,y,size:17,font:serif,color:ink});y-=22;}
   y-=4;
  }else if(block.text.startsWith('Référence ')){
   page.drawRectangle({x:margin,y:y-10,width:lineWidth,height:32,color:paper});
   page.drawText(block.text,{x:margin+12,y,size:9,font:bold,color:ink});
   if(draft)page.drawText('PROJET POUR VALIDATION',{x:width-margin-149,y,size:8,font:bold,color:gold});
   y-=39;
  }else{
   if(recognised&&block.text.startsWith('Loueur :')){
    const guest=blocks.find(item=>item.tag==='p'&&item.text.startsWith('Voyageur :'));
    const panelWidth=(lineWidth-12)/2;
    const needed=Math.max(wrap(block.text,regular,9.5,panelWidth-24).length,wrap(guest.text,regular,9.5,panelWidth-24).length)*14+44;
    if(y-needed<bottom)addPage();
    const left=panel(block.text,margin,y,panelWidth,'LE LOUEUR');
    const right=panel(guest.text,margin+panelWidth+12,y,panelWidth,'LE VOYAGEUR');
    y-=Math.max(left,right)+16;skipGuest=true;continue;
   }
   if(skipGuest&&block.text.startsWith('Voyageur :')){skipGuest=false;continue;}
   if(block.text.startsWith('Du ')&&recognised){
    const lines=wrap(block.text,regular,10.4,lineWidth-24),boxHeight=lines.length*15.5+28;
    if(y-boxHeight<bottom)addPage();
    page.drawRectangle({x:margin,y:y-boxHeight+7,width:lineWidth,height:boxHeight,color:paper});
    page.drawRectangle({x:margin,y:y-boxHeight+7,width:3,height:boxHeight,color:gold});
    lines.forEach((line,index)=>page.drawText(line,{x:margin+12,y:y-12-index*15.5,size:10.4,font:regular,color:ink}));
    y-=boxHeight+12;continue;
   }
   if(block.text.startsWith('Prix total du séjour :')){
    const amount=block.text.match(/Prix total du séjour : ([\d.]+) €/);
    if(amount){
     if(y-88<bottom)addPage();
     page.drawRectangle({x:margin,y:y-63,width:lineWidth,height:65,color:ink});
     page.drawText('MONTANT TOTAL DU SÉJOUR',{x:margin+14,y:y-18,size:8,font:bold,color:gold});
     page.drawText('Dépôt de garantie distinct : 300 €',{x:margin+14,y:y-42,size:9,font:regular,color:white});
     const value=amount[1].replace('.',',')+' €';
     page.drawText(value,{x:width-margin-16-serif.widthOfTextAtSize(value,26),y:y-40,size:26,font:serif,color:white});
     y-=85;
    }
   }
   const size=10.4,leading=15.5,lines=wrap(block.text,regular,size);
   if(y-leading*2<bottom)addPage();
   for(let index=0;index<lines.length;index++){
    // Avoid leaving a single last paragraph line at the top of the next page.
    if(y-leading<bottom||(lines.length-index===2&&y-leading*2<bottom))addPage();
    if(lines[index])page.drawText(lines[index],{x:margin,y,size,font:regular,color:ink});
    y-=leading;
   }
   y-=11;
  }
 }
 const pages=doc.getPages();
 pages.forEach((item,index)=>{
  item.drawLine({start:{x:margin,y:45},end:{x:width-margin,y:45},thickness:.5,color:gold});
  item.drawText(draft?'Projet de contrat - à valider avant mise en service':'Contrat et règlement intérieur',{x:margin,y:29,size:8,font:regular,color:muted});
  const number=`${index+1} / ${pages.length}`;
  item.drawText(number,{x:width-margin-regular.widthOfTextAtSize(number,8),y:29,size:8,font:regular,color:muted});
 });
 return doc.save();
}
