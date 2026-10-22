// One global Durable Object holding accounts, sessions and stats in SQLite.
const NICK_RE=/^[0-9A-Za-z가-힣_\-]{2,10}$/;
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json'}});
const DAY=86400000,SESSION_DAYS=365;
const ID_RE=/^[a-z0-9_]{3,12}$/;
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
// PBKDF2-SHA256, 100k iterations (the Workers maximum)
async function hashPw(pw,saltHex){
  const salt=saltHex?Uint8Array.from(saltHex.match(/../g),h=>parseInt(h,16)):crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256);
  return{salt:hex(salt),hash:hex(bits)};
}

export class Accounts{
  constructor(state,env){
    this.sql=state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(sub TEXT PRIMARY KEY,nick TEXT UNIQUE,games INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,kills INTEGER DEFAULT 0,deaths INTEGER DEFAULT 0,created INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,sub TEXT,exp INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS logins(id TEXT PRIMARY KEY,salt TEXT,hash TEXT,fails INTEGER DEFAULT 0,lock INTEGER DEFAULT 0)`);
  }
  user(sub){return this.sql.exec('SELECT sub,nick,games,wins,kills,deaths FROM users WHERE sub=?',sub).toArray()[0]||null}
  freeNick(base){
    base=(base||'').replace(/[^0-9A-Za-z가-힣_\-]/g,'').slice(0,8)||'player';
    if(base.length<2)base+='00';
    let n=base;
    for(let i=0;this.sql.exec('SELECT 1 FROM users WHERE nick=?',n).toArray().length;i++)n=base.slice(0,7)+(Math.floor(Math.random()*900)+100);
    return n;
  }
  async fetch(req){
    const url=new URL(req.url),path=url.pathname,body=req.method==='POST'?await req.json().catch(()=>({})):{};
    const now=Date.now();
    const session=sub=>{
      const token=hex(crypto.getRandomValues(new Uint8Array(24)));
      this.sql.exec('INSERT INTO sessions VALUES(?,?,?)',token,sub,now+SESSION_DAYS*DAY);
      this.sql.exec('DELETE FROM sessions WHERE exp<?',now);
      return json({token,user:this.user(sub)});
    };
    if(path==='/login'){
      if(!this.user(body.sub))this.sql.exec('INSERT INTO users(sub,nick,created) VALUES(?,?,?)',body.sub,this.freeNick(body.name),now);
      return session(body.sub);
    }
    if(path==='/signup'){
      const id=String(body.id||'').toLowerCase().trim(),pw=String(body.pw||'');
      if(!ID_RE.test(id))return json({error:'아이디는 영문 소문자·숫자·_ 3~12자예요.'},400);
      if(pw.length<4||pw.length>64)return json({error:'비밀번호는 4자 이상이에요.'},400);
      if(this.sql.exec('SELECT 1 FROM logins WHERE id=?',id).toArray().length)return json({error:'이미 있는 아이디예요.'},409);
      const{salt,hash}=await hashPw(pw);
      const sub='pw:'+id;
      this.sql.exec('INSERT INTO logins(id,salt,hash) VALUES(?,?,?)',id,salt,hash);
      this.sql.exec('INSERT INTO users(sub,nick,created) VALUES(?,?,?)',sub,this.freeNick(body.nick||id),now);
      return session(sub);
    }
    if(path==='/pwlogin'){
      const id=String(body.id||'').toLowerCase().trim(),pw=String(body.pw||'');
      const row=this.sql.exec('SELECT salt,hash,fails,lock FROM logins WHERE id=?',id).toArray()[0];
      if(!row)return json({error:'아이디 또는 비밀번호가 맞지 않아요.'},401);
      if(row.lock>now)return json({error:'비밀번호를 여러 번 틀렸어요. 1분 뒤에 다시 해 주세요.'},429);
      const{hash}=await hashPw(pw,row.salt);
      if(hash!==row.hash){
        const f=row.fails+1;
        this.sql.exec('UPDATE logins SET fails=?,lock=? WHERE id=?',f>=5?0:f,f>=5?now+60000:0,id);
        return json({error:'아이디 또는 비밀번호가 맞지 않아요.'},401);
      }
      this.sql.exec('UPDATE logins SET fails=0,lock=0 WHERE id=?',id);
      return session('pw:'+id);
    }
    if(path==='/session'){
      const s=this.sql.exec('SELECT sub,exp FROM sessions WHERE token=?',url.searchParams.get('t')||'').toArray()[0];
      if(!s||s.exp<now)return json({user:null});
      return json({user:this.user(s.sub)});
    }
    if(path==='/logout'){this.sql.exec('DELETE FROM sessions WHERE token=?',body.token||'');return json({ok:true})}
    if(path==='/nick'){
      const nick=String(body.nick||'').trim();
      if(!NICK_RE.test(nick))return json({error:'2~10자, 한글/영문/숫자/_/- 만 쓸 수 있어요.'},400);
      const taken=this.sql.exec('SELECT sub FROM users WHERE nick=?',nick).toArray()[0];
      if(taken&&taken.sub!==body.sub)return json({error:'이미 쓰는 닉네임이에요.'},409);
      this.sql.exec('UPDATE users SET nick=? WHERE sub=?',nick,body.sub);
      return json({user:this.user(body.sub)});
    }
    if(path==='/record'){
      for(const r of body.results||[])
        this.sql.exec('UPDATE users SET games=games+1,wins=wins+?,kills=kills+?,deaths=deaths+? WHERE sub=?',r.win?1:0,r.kills|0,r.deaths|0,r.uid);
      return json({ok:true});
    }
    if(path==='/rank'){
      const top=this.sql.exec('SELECT nick,games,wins,kills,deaths FROM users WHERE games>0 ORDER BY wins DESC,kills DESC LIMIT 10').toArray();
      return json({top});
    }
    return json({error:'not found'},404);
  }
}
