// One global Durable Object holding accounts, sessions and stats in SQLite.
const NICK_RE=/^[0-9A-Za-z가-힣_\-]{2,10}$/;
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json'}});
const DAY=86400000,SESSION_DAYS=30;

export class Accounts{
  constructor(state,env){
    this.sql=state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(sub TEXT PRIMARY KEY,nick TEXT UNIQUE,games INTEGER DEFAULT 0,wins INTEGER DEFAULT 0,kills INTEGER DEFAULT 0,deaths INTEGER DEFAULT 0,created INTEGER)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,sub TEXT,exp INTEGER)`);
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
    if(path==='/login'){
      if(!this.user(body.sub))this.sql.exec('INSERT INTO users(sub,nick,created) VALUES(?,?,?)',body.sub,this.freeNick(body.name),now);
      const token=[...crypto.getRandomValues(new Uint8Array(24))].map(b=>b.toString(16).padStart(2,'0')).join('');
      this.sql.exec('INSERT INTO sessions VALUES(?,?,?)',token,body.sub,now+SESSION_DAYS*DAY);
      this.sql.exec('DELETE FROM sessions WHERE exp<?',now);
      return json({token,user:this.user(body.sub)});
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
