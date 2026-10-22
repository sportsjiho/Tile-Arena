export {Room} from './room.js';
export {Accounts} from './accounts.js';

// /ws?room=CODE -> one Room Durable Object per room. /api/* -> Google login, nickname, ranking.
// Everything else is served from ./public (see wrangler.jsonc).
const json=(o,s=200,h={})=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json',...h}});
const acc=env=>env.ACCOUNTS.get(env.ACCOUNTS.idFromName('main'));
const ask=async(env,path,body)=>(await acc(env).fetch('https://acc'+path,body?{method:'POST',body:JSON.stringify(body)}:undefined)).json();
const getCookie=(req,name)=>{const m=(req.headers.get('cookie')||'').match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)'));return m?m[1]:''};
const sessionCookie=(v,age)=>`ta_s=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

async function currentUser(req,env){
  const t=getCookie(req,'ta_s');if(!t)return null;
  return (await ask(env,'/session?t='+encodeURIComponent(t))).user;
}
// Check a Google ID token with Google's tokeninfo endpoint.
async function verifyGoogle(credential,clientId){
  const r=await fetch('https://oauth2.googleapis.com/tokeninfo?id_token='+encodeURIComponent(credential));
  if(!r.ok)return null;
  const t=await r.json();
  if(t.aud!==clientId)return null;
  if(t.iss!=='accounts.google.com'&&t.iss!=='https://accounts.google.com')return null;
  if(+t.exp*1000<Date.now())return null;
  return{sub:t.sub,name:t.given_name||t.name||''};
}

async function api(req,env,path){
  const clientId=env.GOOGLE_CLIENT_ID||'';
  if(path==='/api/config')return json({clientId:clientId||null});
  if(path==='/api/me')return json({user:await currentUser(req,env)});
  if(path==='/api/rank')return json(await ask(env,'/rank'));
  if(req.method!=='POST')return json({error:'method'},405);
  const body=await req.json().catch(()=>({}));
  if(path==='/api/login'){
    if(!clientId)return json({error:'Google 로그인이 아직 설정되지 않았어요.'},503);
    const g=await verifyGoogle(String(body.credential||''),clientId);
    if(!g)return json({error:'Google 로그인 확인에 실패했어요.'},401);
    const r=await ask(env,'/login',g);
    return json({user:r.user},200,{'set-cookie':sessionCookie(r.token,365*86400)});
  }
  if(path==='/api/signup'||path==='/api/pwlogin'){
    const r=await acc(env).fetch('https://acc'+(path==='/api/signup'?'/signup':'/pwlogin'),{method:'POST',body:JSON.stringify({id:body.id,pw:body.pw,nick:body.nick})});
    const d=await r.json();
    if(!r.ok)return json({error:d.error},r.status);
    return json({user:d.user},200,{'set-cookie':sessionCookie(d.token,365*86400)});
  }
  if(path==='/api/logout'){
    await ask(env,'/logout',{token:getCookie(req,'ta_s')});
    return json({ok:true},200,{'set-cookie':sessionCookie('',0)});
  }
  if(path==='/api/nick'){
    const u=await currentUser(req,env);if(!u)return json({error:'로그인이 필요해요.'},401);
    const r=await acc(env).fetch('https://acc/nick',{method:'POST',body:JSON.stringify({sub:u.sub,nick:body.nick})});
    return new Response(r.body,{status:r.status,headers:{'content-type':'application/json'}});
  }
  return json({error:'not found'},404);
}

export default{
  async fetch(req,env){
    const url=new URL(req.url);
    if(url.pathname.startsWith('/api/'))return api(req,env,url.pathname);
    if(url.pathname==='/ws'){
      const code=(url.searchParams.get('room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
      if(!code)return new Response('room required',{status:400});
      // identity comes only from the session cookie, never from the client's query string
      url.searchParams.delete('uid');
      const u=await currentUser(req,env);
      if(u){url.searchParams.set('uid',u.sub);url.searchParams.set('name',u.nick)}
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request(url,req));
    }
    return new Response('not found',{status:404});
  }
};
