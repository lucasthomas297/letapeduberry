export async function adminAuthorized(request,env) {
 try {
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER||'') || !env.ACCESS_AUD || !env.OWNER_EMAIL)return false;
  const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token || token.length>20000)return false;
  const parts=token.split('.');if(parts.length!==3)return false;
  const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  const now=Date.now()/1000;
  if(header.alg!=='RS256' || typeof header.kid!=='string' || !header.kid || claims.iss!==env.ACCESS_ISSUER || claims.exp<=now || !Number.isFinite(claims.exp) || (claims.nbf!==undefined && (!Number.isFinite(claims.nbf) || claims.nbf>now)) || ![].concat(claims.aud||[]).includes(env.ACCESS_AUD) || claims.email?.toLowerCase()!==env.OWNER_EMAIL.toLowerCase())return false;
  const response=await fetch(env.ACCESS_ISSUER+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)return false;const jwk=(await response.json()).keys?.find(key=>key.kid===header.kid && key.kty==='RSA');if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return false;}
}
