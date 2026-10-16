import {WEAPONS,MUZZLE,T,MW,MH,MATCH,GOAL,R,MAX_PLAYERS,SPAWNS,ITEM_DEF,DROP_EVERY,DROP_MAX,DROP_KINDS,tile,hitsSolid,moveStep} from '../public/shared.js';

const TICK=30,RESPAWN=3,RESULT_SECS=6;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// One Room = one Durable Object = one match. State lives in memory while players are connected.
export class Room{
  constructor(state,env){
    this.state=state;
    this.players=new Map();
    this.nextId=1;
    this.phase='LOBBY';
    this.clock=MATCH;
    this.bullets=[];
    this.items=[];
    this.dropT=0;
    this.hostId=0;
    this.code='';
    this.timer=null;
    this.last=0;
    this.resultT=0;
  }

  async fetch(req){
    if(req.headers.get('Upgrade')!=='websocket')return new Response('expected websocket',{status:426});
    const url=new URL(req.url);
    this.code=url.searchParams.get('room')||this.code;
    const create=url.searchParams.get('create')==='1';
    const name=(url.searchParams.get('name')||'player').replace(/[<>&"']/g,'').trim().slice(0,10)||'player';
    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    server.accept();
    let err=null;
    if(this.players.size===0&&!create)err='room_missing';
    else if(this.players.size>=MAX_PLAYERS)err='room_full';
    if(err){server.send(JSON.stringify({t:'err',m:err}));server.close(1000,err);return new Response(null,{status:101,webSocket:client})}
    this.addPlayer(server,name);
    return new Response(null,{status:101,webSocket:client});
  }

  addPlayer(ws,name){
    const p={id:this.nextId++,name,ws,x:0,y:0,ang:0,hp:100,kills:0,deaths:0,dead:0,inv:0,slots:[],cur:0,cd:0,rl:0,
      input:{mx:0,my:0,ang:0,fire:false}};
    this.players.set(p.id,p);
    if(!this.hostId||!this.players.has(this.hostId))this.hostId=p.id;
    this.loadout(p);
    if(this.phase==='PLAYING')this.spawn(p);
    this.send(p,{t:'w',id:p.id,code:this.code});
    ws.addEventListener('message',ev=>this.onMsg(p,ev.data));
    const drop=()=>this.removePlayer(p);
    ws.addEventListener('close',drop);ws.addEventListener('error',drop);
    this.broadcastLobby();
    if(this.phase==='PLAYING'){this.send(p,{t:'ph',ph:'PLAYING',c:this.clock});this.sendItems(p)}
    if(!this.timer){this.last=Date.now();this.timer=setInterval(()=>this.tick(),1000/TICK)}
  }
  removePlayer(p){
    if(!this.players.delete(p.id))return;
    try{p.ws.close()}catch(_){}
    if(this.hostId===p.id)this.hostId=this.players.size?this.players.keys().next().value:0;
    if(this.players.size===0){clearInterval(this.timer);this.timer=null;this.phase='LOBBY';this.bullets=[];return}
    this.broadcastLobby();
  }

  send(p,o){try{p.ws.send(JSON.stringify(o))}catch(_){}}
  all(o){const s=JSON.stringify(o);for(const p of this.players.values()){try{p.ws.send(s)}catch(_){}}}
  broadcastLobby(){
    this.all({t:'lobby',ph:this.phase,host:this.hostId,code:this.code,p:[...this.players.values()].map(p=>[p.id,p.name,p.kills,p.deaths])});
  }
  sendItems(to){
    const o={t:'items',l:this.items.map(i=>[i.type,i.k||'',Math.round(i.x),Math.round(i.y),i.cool>0?0:1,i.drop?1:0,i.uid])};
    if(to)this.send(to,o);else this.all(o);
  }

  onMsg(p,data){
    if(typeof data!=='string'||data.length>300)return;
    let m;try{m=JSON.parse(data)}catch(_){return}
    if(m.t==='in'){
      const i=p.input;
      i.mx=clamp(+m.mx||0,-1,1);i.my=clamp(+m.my||0,-1,1);i.ang=+m.ang||0;i.fire=!!m.f;
    }else if(m.t==='rl')this.reload(p);
    else if(m.t==='sw'){
      const i=m.i|0;
      if(!p.dead&&i>=0&&i<p.slots.length&&i!==p.cur){p.cur=i;p.rl=0}
    }else if(m.t==='go'){
      if(p.id===this.hostId&&this.phase==='LOBBY')this.startMatch();
    }else if(m.t==='ping')this.send(p,{t:'pong',n:m.n});
  }

  loadout(p){p.slots=[{k:'pistol',mag:12,res:36}];p.cur=0;p.rl=0;p.cd=0}
  spawn(p){
    let best=null,bd=-1;
    for(const[sx,sy]of SPAWNS){
      const x=sx*T+T/2,y=sy*T+T/2;let d=1e9;
      for(const o of this.players.values())if(o!==p&&!o.dead)d=Math.min(d,Math.hypot(o.x-x,o.y-y));
      d+=Math.random()*120;if(d>bd){bd=d;best=[x,y]}
    }
    p.x=best[0];p.y=best[1];p.hp=100;p.dead=0;p.inv=2;this.loadout(p);
  }

  startMatch(){
    this.phase='PLAYING';this.clock=MATCH;this.bullets=[];this.dropT=3;this.uid=1;
    this.items=ITEM_DEF.map(([type,x,y])=>({type,x:x*T+T/2,y:y*T+T/2,cool:0,uid:this.uid++}));
    for(const p of this.players.values()){p.kills=0;p.deaths=0;p.input.fire=false}
    for(const p of this.players.values())this.spawn(p);
    this.all({t:'ph',ph:'PLAYING',c:this.clock});
    this.sendItems();
    this.broadcastLobby();
  }
  endMatch(reason){
    if(this.phase!=='PLAYING')return;
    this.phase='RESULT';this.resultT=RESULT_SECS;this.bullets=[];
    const rank=[...this.players.values()].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths);
    this.all({t:'result',why:reason,r:rank.map(p=>[p.id,p.name,p.kills,p.deaths])});
  }

  reload(p){
    const s=p.slots[p.cur],w=WEAPONS[s.k];
    if(p.dead||p.rl>0||s.res<=0||s.mag>=w.mag)return;
    p.rl=w.reload;
  }
  shoot(p){
    const s=p.slots[p.cur],w=WEAPONS[s.k];
    if(p.dead||p.rl>0||p.cd>0)return;
    if(s.mag<=0){this.reload(p);return}
    s.mag--;p.cd=w.rate;p.inv=0;
    const out=[];
    for(let i=0;i<w.pellets;i++){
      const a=p.ang+(Math.random()-.5)*2*w.spread,sp=w.speed*(w.pellets>1?.9+Math.random()*.2:1);
      const b={x:p.x+Math.cos(a)*MUZZLE[s.k],y:p.y+Math.sin(a)*MUZZLE[s.k],vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
        dmg:w.dmg,owner:p.id,life:w.range/w.speed,pierce:!!w.pierce,hit:new Set()};
      this.bullets.push(b);
      out.push([Math.round(b.x),Math.round(b.y),Math.round(b.vx),Math.round(b.vy),+b.life.toFixed(2),b.pierce?1:0]);
    }
    this.all({t:'sh',id:p.id,k:s.k,b:out});
  }
  damage(v,dmg,srcId){
    if(v.dead||v.inv>0)return;
    v.hp-=dmg;
    this.all({t:'hit',id:v.id,by:srcId});
    if(v.hp<=0){
      v.hp=0;v.dead=RESPAWN;v.deaths++;
      const src=this.players.get(srcId);if(src)src.kills++;
      this.all({t:'kill',by:srcId,id:v.id,bn:src?src.name:'?',vn:v.name});
      this.broadcastLobby();
      if(src&&src.kills>=GOAL)this.endMatch('goal');
    }
  }
  updBullets(dt){
    for(const b of this.bullets){
      const steps=Math.ceil(Math.hypot(b.vx,b.vy)*dt/8);
      for(let i=0;i<steps&&b.life>0;i++){
        b.x+=b.vx*dt/steps;b.y+=b.vy*dt/steps;
        const tv=tile(Math.floor(b.x/T),Math.floor(b.y/T));
        if(tv===1){b.life=0;break}
        if(tv===2&&!b.pierce&&!b.crate){b.crate=1;if(Math.random()<.6){b.life=0;break}}
        for(const e of this.players.values()){
          if(e.id===b.owner||e.dead||b.hit.has(e.id))continue;
          if((e.x-b.x)**2+(e.y-b.y)**2<R*R){b.hit.add(e.id);this.damage(e,b.dmg,b.owner);if(!b.pierce){b.life=0;break}}
        }
      }
      b.life-=dt;
    }
    this.bullets=this.bullets.filter(b=>b.life>0);
  }
  pickups(p){
    let changed=false;
    for(const it of this.items){
      if(it.cool>0||Math.hypot(it.x-p.x,it.y-p.y)>24)continue;
      if(it.type==='hp'){if(p.hp>=100)continue;p.hp=Math.min(100,p.hp+40)}
      else if(it.type==='ammo'){for(const s of p.slots)s.res=WEAPONS[s.k].mag*3}
      else{
        const w=WEAPONS[it.k],have=p.slots.findIndex(s=>s.k===it.k);
        if(have>=0)p.slots[have].res=w.mag*3;
        else if(p.slots.length<3){p.slots.push({k:it.k,mag:w.mag,res:w.mag*3});p.cur=p.slots.length-1}
        else p.slots[p.cur]={k:it.k,mag:w.mag,res:w.mag*3};
        p.rl=0;
      }
      this.send(p,{t:'pk',k:it.k||it.type});
      if(it.drop)it.gone=true;else it.cool=15;
      changed=true;
    }
    if(changed){this.items=this.items.filter(i=>!i.gone);this.sendItems()}
  }
  dropWeapon(){
    if(this.items.filter(i=>i.drop).length>=DROP_MAX)return;
    let x,y,tries=0;
    do{
      const tx=1+Math.floor(Math.random()*(MW-2)),ty=1+Math.floor(Math.random()*(MH-2));
      if(tile(tx,ty)!==0)continue;
      x=tx*T+T/2;y=ty*T+T/2;tries++;
      if(![...this.players.values()].some(e=>!e.dead&&Math.hypot(e.x-x,e.y-y)<160))break;
    }while(tries<30);
    if(x===undefined)return;
    const k=DROP_KINDS[Math.floor(Math.random()*DROP_KINDS.length)];
    this.items.push({type:'w',k,x,y,cool:0,drop:true,uid:this.uid++});
    this.sendItems();
    this.all({t:'drop',k});
  }

  tick(){
    const now=Date.now(),dt=Math.min(.1,(now-this.last)/1000);this.last=now;
    if(this.phase==='RESULT'){
      this.resultT-=dt;
      if(this.resultT<=0){this.phase='LOBBY';this.all({t:'ph',ph:'LOBBY'});this.broadcastLobby()}
      return;
    }
    if(this.phase!=='PLAYING')return;
    this.clock-=dt;
    if(this.clock<=0){this.clock=0;this.endMatch('time');return}
    for(const p of this.players.values()){
      p.cd=Math.max(0,p.cd-dt);p.inv=Math.max(0,p.inv-dt);
      if(p.rl>0){p.rl-=dt;if(p.rl<=0){const s=p.slots[p.cur],take=Math.min(WEAPONS[s.k].mag-s.mag,s.res);s.mag+=take;s.res-=take;p.rl=0}}
      if(p.dead){p.dead-=dt;if(p.dead<=0)this.spawn(p);continue}
      p.ang=p.input.ang;
      moveStep(p,p.input.mx,p.input.my,dt,p.slots[p.cur].k);
      if(p.input.fire)this.shoot(p);
      this.pickups(p);
    }
    this.updBullets(dt);
    for(const it of this.items)if(it.cool>0){it.cool-=dt;if(it.cool<=0)this.sendItems()}
    this.dropT-=dt;if(this.dropT<=0){this.dropWeapon();this.dropT=DROP_EVERY}
    // snapshot
    const ps=[...this.players.values()].map(p=>[p.id,Math.round(p.x*10)/10,Math.round(p.y*10)/10,+p.ang.toFixed(3),Math.ceil(p.hp),+p.dead.toFixed(1),p.inv>0?1:0,p.slots[p.cur].k,p.rl>0?+(p.rl/WEAPONS[p.slots[p.cur].k].reload).toFixed(2):0]);
    for(const p of this.players.values()){
      const s=p.slots[p.cur];
      this.send(p,{t:'s',c:+this.clock.toFixed(1),p:ps,m:{mag:s.mag,res:s.res,cur:p.cur,sl:p.slots.map(x=>x.k)}});
    }
  }
}
