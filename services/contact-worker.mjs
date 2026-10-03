const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/api/contact')return json(404,{error:'Introuvable'});
  if(request.method!=='POST')return json(405,{error:'Méthode interdite'});
  if(request.headers.get('Origin')!==url.origin)return json(403,{error:'Origine interdite'});
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json(415,{error:'Format invalide'});
  if(!env.RESEND_API_KEY||!env.CONTACT_FROM||!env.CONTACT_RATE_LIMITER)return json(503,{error:'Service non configuré'});
  try{
   const {success}=await env.CONTACT_RATE_LIMITER.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});
   if(!success)return json(429,{error:'Trop de tentatives'});
   const reader=request.body?.getReader();if(!reader)return json(400,{error:'Message manquant'});
   let size=0,chunks=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>20000){await reader.cancel();return json(413,{error:'Message trop volumineux'});}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{return json(400,{error:'Format invalide'});}
   if(!data||typeof data!=='object'||Array.isArray(data))return json(400,{error:'Format invalide'});
   if(data.website)return json(400,{error:'Demande invalide'});
   const limits={firstName:80,lastName:80,email:254,phone:40,message:4000};
   for(const [field,max] of Object.entries(limits)){
    if(typeof data[field]!=='string'||!data[field].trim()||data[field].length>max)return json(400,{error:'Champs invalides'});
    data[field]=data[field].trim();
   }
   if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.email)||/[\r\n]/.test(data.firstName+data.lastName+data.phone)||data.message.length<10)return json(400,{error:'Champs invalides'});
   const response=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{'Authorization':`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({from:env.CONTACT_FROM,to:['contact@letapeduberry.fr'],reply_to:data.email,
     subject:'Nouveau message — L’Étape du Berry',text:`Prénom : ${data.firstName}\nNom : ${data.lastName}\nE-mail : ${data.email}\nTéléphone : ${data.phone}\n\n${data.message}`}),signal:AbortSignal.timeout(12000)
   });
   const result=await response.json().catch(()=>null);
   if(!response.ok||!result?.id)return json(502,{error:'Envoi indisponible'});
   return json(200,{sent:true});
  }catch{return json(503,{error:'Envoi momentanément indisponible'});}
 }
};
