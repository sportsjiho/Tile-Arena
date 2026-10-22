// Game simulation. Runs in the Durable Object for online rooms, and in the browser for AI practice.
import {WEAPONS,MUZZLE,T,MATCH,GOAL,TEAM_GOAL,DUEL_GOAL,R,MAX_PLAYERS,DROP_EVERY,DROP_MAX,DROP_KINDS,tile,moveStep,los,inBush,randOpen,getMap,pickMap,MAP_LIST} from './shared.js';

const TICK=30,RESPAWN=3,RESULT_SECS=6;
const BOT_NAMES=['Fox','Rook','Vega','Moss','Juno','Kite','Ash'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Bot skill: reaction delay, aim noise, turn speed, sight range, fire cone, item hunting
export const DIFF={
  easy:{react:.8,noise:.6,turn:3,view:500,cone:.4,greed:.3},
  normal:{react:.35,noise:.25,turn:7,view:750,cone:.25,greed:.7},
  hard:{react:.12,noise:.07,turn:14,view:950,cone:.15,greed:.9}
};
const newAi=()=>({tx:0,ty:0,t:0,strafe:1,st:0,react:0,px:0,py:0});

export class Game{
  constructor(){
    this.players=new Map();this.nextId=1;this.phase='LOBBY';this.clock=MATCH;
    this.bullets=[];this.items=[];this.dropT=0;this.hostId=0;this.code='';
    this.timer=null;this.last=0;this.resultT=0;this.fill=0;this.uid=1;
    this.mode='ffa';this.diff='normal';this.mapSel='random';this.freeze=0;this.round=0;this.map=getMap('warehouse');
  }
  isTeam(){return this.mode==='team'}
  foe(a,b){return a!==b&&(!this.isTeam()||a.team!==b.team)}
  smallerTeam(){let n=[0,0];for(const p of this.players.values())n[p.team]++;return n[0]<=n[1]?0:1}
  balance(){
    // humans alternate first, then bots fill the smaller side
    const all=[...this.players.values()].sort((a,b)=>(a.bot-b.bot)||(a.id-b.id));
    const n=[0,0];for(const p of all){const t=n[0]<=n[1]?0:1;p.team=t;n[t]++}
  }
  teamKills(){const k=[0,0];for(const p of this.players.values())k[p.team]+=p.kills;return k}
  humans(){return[...this.players.values()].filter(p=>!p.bot)}
  isDuel(){return this.mode==='duel'}
  freeDuel(){const u=new Set([...this.players.values()].map(p=>p.duelIdx));return u.has(0)?1:0}
  canJoin(){
    if(this.isDuel()){
      if(this.humans().length>=2)return false;
      if(this.players.size>=2){
        const ab=[...this.players.values()].find(p=>p.bot&&p.auto);
        if(!ab)return false;
        this.players.delete(ab.id);
      }
      return true;
    }
    if(this.players.size<MAX_PLAYERS)return true;
    const ab=[...this.players.values()].find(p=>p.bot&&p.auto);
    if(!ab)return false;
    this.players.delete(ab.id);return true;
  }
  newPlayer(name,ws){
    return{id:this.nextId++,name,ws,bot:false,auto:false,x:0,y:0,ang:0,hp:100,kills:0,deaths:0,dead:0,inv:0,slots:[],cur:0,cd:0,rl:0,
      input:{mx:0,my:0,ang:0,fire:false},ai:newAi(),team:0,duelIdx:this.freeDuel()};
  }
  addPlayer(ws,name,uid=null){
    const p=this.newPlayer(name,ws);p.uid=uid;
    p.team=this.smallerTeam();
    this.players.set(p.id,p);
    const host=this.players.get(this.hostId);
    if(!host||host.bot)this.hostId=p.id;
    this.loadout(p);
    if(this.phase==='PLAYING')this.spawn(p);
    this.send(p,{t:'w',id:p.id,code:this.code});
    ws.addEventListener('message',ev=>this.onMsg(p,ev.data));
    const drop=()=>this.removePlayer(p);
    ws.addEventListener('close',drop);ws.addEventListener('error',drop);
    this.broadcastLobby();
    if(this.phase==='PLAYING'){this.send(p,{t:'ph',ph:'PLAYING',c:this.clock,mode:this.mode,map:this.map.id});this.sendItems(p)}
    if(!this.timer){this.last=Date.now();this.timer=setInterval(()=>this.tick(),1000/TICK)}
    return p;
  }
  addBot(name,auto){
    const p=this.newPlayer(name,null);p.bot=true;p.auto=auto;p.team=this.smallerTeam();
    this.players.set(p.id,p);this.loadout(p);
    if(this.phase==='PLAYING')this.spawn(p);
    return p;
  }
  // A human leaving mid-match hands their character to the AI.
  removePlayer(p){
    if(!this.players.has(p.id)||p.bot)return;
    try{p.ws.close()}catch(_){}
    const rest=this.humans().filter(h=>h.id!==p.id);
    if(!rest.length){this.shutdown();return}
    if(this.phase==='PLAYING'){
      p.bot=true;p.auto=true;p.ws=null;p.uid=null;p.name=p.name+'(AI)';p.ai=newAi();
      p.input={mx:0,my:0,ang:p.ang,fire:false};
      this.all({t:'left',n:p.name});
    }else this.players.delete(p.id);
    if(this.hostId===p.id)this.hostId=rest[0].id;
    this.broadcastLobby();
  }
  shutdown(){
    clearInterval(this.timer);this.timer=null;this.players.clear();
    this.hostId=0;this.phase='LOBBY';this.bullets=[];this.items=[];
  }

  send(p,o){if(!p.ws)return;try{p.ws.send(JSON.stringify(o))}catch(_){}}
  all(o){const s=JSON.stringify(o);for(const p of this.players.values()){if(!p.ws)continue;try{p.ws.send(s)}catch(_){}}}
  broadcastLobby(){
    this.all({t:'lobby',ph:this.phase,host:this.hostId,code:this.code,mode:this.mode,diff:this.diff,map:this.mapSel,tk:this.teamKills(),
      p:[...this.players.values()].map(p=>[p.id,p.name,p.kills,p.deaths,p.bot?1:0,p.team])});
  }
  sendItems(to){
    const o={t:'items',l:this.items.map(i=>[i.type,i.k||'',Math.round(i.x),Math.round(i.y),i.cool>0?0:1,i.drop?1:0,i.uid])};
    if(to)this.send(to,o);else this.all(o);
  }

  onMsg(p,data){
    if(p.bot||typeof data!=='string'||data.length>300)return;
    let m;try{m=JSON.parse(data)}catch(_){return}
    if(m.t==='in'){
      const i=p.input;
      i.mx=clamp(+m.mx||0,-1,1);i.my=clamp(+m.my||0,-1,1);i.ang=+m.ang||0;i.fire=!!m.f;
    }else if(m.t==='rl')this.reload(p);
    else if(m.t==='sw'){
      const i=m.i|0;
      if(!p.dead&&i>=0&&i<p.slots.length&&i!==p.cur){p.cur=i;p.rl=0}
    }else if(m.t==='go'){
      if(p.id===this.hostId&&this.phase!=='PLAYING')this.startMatch();
    }else if(m.t==='cfg'){
      if(p.id!==this.hostId||this.phase==='PLAYING')return;
      if(m.mode==='ffa'||m.mode==='team'||(m.mode==='duel'&&this.humans().length<=2))this.mode=m.mode;
      if(DIFF[m.diff])this.diff=m.diff;
      if(m.map==='random'||MAP_LIST.some(x=>x[0]===m.map))this.mapSel=m.map;
      this.balance();this.broadcastLobby();
    }else if(m.t==='ping')this.send(p,{t:'pong',n:m.n});
  }

  loadout(p){p.slots=[{k:'pistol',mag:12,res:36}];p.cur=0;p.rl=0;p.cd=0}
  spawn(p){
    if(this.isDuel()){
      const[sx,sy]=this.map.spawns[p.duelIdx?3:0];
      p.x=sx*T+T/2;p.y=sy*T+T/2;p.ang=p.duelIdx?Math.PI:0;p.input.ang=p.ang;
      p.hp=100;p.dead=0;p.inv=0;this.loadout(p);p.ai.t=0;return;
    }
    let best=null,bd=-1;
    for(const[sx,sy]of this.map.spawns){
      const x=sx*T+T/2,y=sy*T+T/2;let d=1e9;
      for(const o of this.players.values())if(this.foe(o,p)&&!o.dead)d=Math.min(d,Math.hypot(o.x-x,o.y-y));
      d+=Math.random()*120;if(d>bd){bd=d;best=[x,y]}
    }
    p.x=best[0];p.y=best[1];p.hp=100;p.dead=0;p.inv=2;this.loadout(p);p.ai.t=0;
  }

  startMatch(){
    for(const p of[...this.players.values()])if(p.bot&&(p.auto||this.fill>0))this.players.delete(p.id);
    this.map=getMap(pickMap(this.mapSel));
    this.phase='PLAYING';this.clock=MATCH;this.bullets=[];this.dropT=3;this.uid=1;
    for(let i=0;i<this.fill&&this.players.size<MAX_PLAYERS;i++)this.addBot(BOT_NAMES[i%BOT_NAMES.length],false);
    if(this.isDuel()){
      while(this.players.size<2)this.addBot(BOT_NAMES[0],true);
      [...this.players.values()].forEach((p,i)=>p.duelIdx=i);
      this.round=1;this.freeze=2;
    }else this.freeze=0;
    this.items=this.map.items.map(([type,x,y])=>({type,x:x*T+T/2,y:y*T+T/2,cool:0,uid:this.uid++}));
    this.balance();this.humansAtStart=this.humans().length;
    for(const p of this.players.values()){p.kills=0;p.deaths=0;p.input.fire=false;p.dead=0}
    for(const p of this.players.values())this.spawn(p);
    this.all({t:'ph',ph:'PLAYING',c:this.clock,mode:this.mode,map:this.map.id});
    this.sendItems();
    this.broadcastLobby();
  }
  endMatch(reason){
    if(this.phase!=='PLAYING')return;
    this.phase='RESULT';this.resultT=RESULT_SECS;this.bullets=[];
    const rank=[...this.players.values()].sort((a,b)=>b.kills-a.kills||a.deaths-b.deaths);
    const tk=this.teamKills(),win=this.isTeam()?(tk[0]===tk[1]?-1:tk[0]>tk[1]?0:1):null;
    this.all({t:'result',why:reason,mode:this.mode,tk,win,r:rank.map(p=>[p.id,p.name,p.kills,p.deaths,p.team])});
    const top=rank[0];
    this.onResult?.(rank.filter(p=>!p.bot).map(p=>({uid:p.uid,kills:p.kills,deaths:p.deaths,
      win:this.isTeam()?win===p.team:(p===top&&p.kills>0&&(!rank[1]||rank[1].kills<p.kills))})));
  }

  // 1:1 duel: after every kill both players go back to their starting spots.
  roundReset(){
    this.round++;this.freeze=2;this.bullets=[];
    for(const p of this.players.values())this.spawn(p);
    this.items=this.items.filter(i=>!i.drop);for(const i of this.items)i.cool=0;
    this.dropT=4;this.sendItems();
    this.all({t:'round',n:this.round});
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
      if(this.isDuel()){if(src&&src.kills>=DUEL_GOAL)this.endMatch('goal');else this.roundReset()}
      else if(this.isTeam()){if(src&&this.teamKills()[src.team]>=TEAM_GOAL)this.endMatch('goal')}
      else if(src&&src.kills>=GOAL)this.endMatch('goal');
    }
  }
  updBullets(dt){
    for(const b of this.bullets){
      const steps=Math.ceil(Math.hypot(b.vx,b.vy)*dt/8);
      for(let i=0;i<steps&&b.life>0;i++){
        b.x+=b.vx*dt/steps;b.y+=b.vy*dt/steps;
        const tv=tile(this.map,Math.floor(b.x/T),Math.floor(b.y/T));
        if(tv===1){b.life=0;break}
        if(tv===2&&!b.pierce&&!b.crate){b.crate=1;if(Math.random()<.6){b.life=0;break}}
        for(const e of this.players.values()){
          if(e.id===b.owner||e.dead||b.hit.has(e.id))continue;
          if(this.isTeam()){const o=this.players.get(b.owner);if(o&&o.team===e.team)continue}
          if((e.x-b.x)**2+(e.y-b.y)**2<R*R){b.hit.add(e.id);const rd=this.round;this.damage(e,b.dmg,b.owner);if(this.phase!=='PLAYING'||this.round!==rd)return;if(!b.pierce){b.life=0;break}}
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
    let x,y;
    for(let tries=0;tries<30;tries++){
      [x,y]=randOpen(this.map);
      if(![...this.players.values()].some(e=>!e.dead&&Math.hypot(e.x-x,e.y-y)<160))break;
    }
    const k=DROP_KINDS[Math.floor(Math.random()*DROP_KINDS.length)];
    this.items.push({type:'w',k,x,y,cool:0,drop:true,uid:this.uid++});
    this.sendItems();
    this.all({t:'drop',k});
  }

  // Bots drive the same input fields a human client sends.
  botThink(p,dt){
    const a=p.ai,s=p.slots[p.cur],w=WEAPONS[s.k],inp=p.input,D=DIFF[this.diff]||DIFF.normal;
    let tgt=null,td=1e9;
    for(const o of this.players.values()){
      if(!this.foe(o,p)||o.dead)continue;
      const d=Math.hypot(o.x-p.x,o.y-p.y);
      if(d>D.view||d>=td)continue;
      if(inBush(this.map,o)&&d>90)continue;
      if(los(this.map,p.x,p.y,o.x,o.y)){tgt=o;td=d}
    }
    inp.fire=false;
    if(s.mag===0)this.reload(p);
    if(tgt){
      a.react+=dt;
      const want=Math.atan2(tgt.y-p.y,tgt.x-p.x)+(Math.random()-.5)*D.noise;
      const diff=((want-p.ang+Math.PI*3)%(Math.PI*2))-Math.PI;
      inp.ang=p.ang+diff*Math.min(1,dt*D.turn);
      a.st-=dt;if(a.st<=0){a.strafe*=-1;a.st=.6+Math.random()*1.2}
      const nx=(tgt.x-p.x)/td,ny=(tgt.y-p.y)/td,pref=w.range*.45;
      let mx=-ny*a.strafe,my=nx*a.strafe;
      if(td>pref){mx+=nx;my+=ny}else if(td<pref*.5){mx-=nx;my-=ny}
      inp.mx=mx;inp.my=my;
      inp.fire=a.react>D.react&&Math.abs(diff)<D.cone&&td<w.range;
    }else{
      a.react=0;a.t-=dt;
      const stuck=Math.abs(p.x-a.px)+Math.abs(p.y-a.py)<.3;
      if(a.t<=0||stuck||Math.hypot(a.tx-p.x,a.ty-p.y)<20){
        const items=this.items.filter(i=>i.cool<=0&&((i.drop&&!p.slots.some(x=>x.k===i.k))||(i.type==='hp'&&p.hp<60)))
          .sort((q,r)=>Math.hypot(q.x-p.x,q.y-p.y)-Math.hypot(r.x-p.x,r.y-p.y));
        const opp=this.isDuel()&&[...this.players.values()].find(o=>o!==p&&!o.dead);
        if(items[0]&&Math.random()<D.greed*(opp?.4:1)){a.tx=items[0].x;a.ty=items[0].y}
        else if(opp){a.tx=opp.x;a.ty=opp.y;a.t=1.5}
        else[a.tx,a.ty]=randOpen(this.map);
        if(a.t<=0)a.t=5;
      }
      inp.mx=a.tx-p.x;inp.my=a.ty-p.y;
      inp.ang=Math.atan2(inp.my,inp.mx);
      if(s.mag<w.mag)this.reload(p);
    }
    a.px=p.x;a.py=p.y;
  }

  tick(){
    const now=Date.now(),dt=Math.min(.1,(now-this.last)/1000);this.last=now;
    if(this.phase==='RESULT'){
      this.resultT-=dt;
      if(this.resultT<=0){
        for(const p of[...this.players.values()])if(p.bot&&p.auto)this.players.delete(p.id);
        this.phase='LOBBY';this.all({t:'ph',ph:'LOBBY'});this.broadcastLobby();
      }
      return;
    }
    if(this.phase!=='PLAYING')return;
    this.clock-=dt;
    if(this.clock<=0){this.clock=0;this.endMatch('time');return}
    if(this.freeze>0)this.freeze=Math.max(0,this.freeze-dt);
    const frozen=this.freeze>0;
    for(const p of this.players.values()){
      p.cd=Math.max(0,p.cd-dt);p.inv=Math.max(0,p.inv-dt);
      if(frozen)continue;
      if(p.rl>0){p.rl-=dt;if(p.rl<=0){const s=p.slots[p.cur],take=Math.min(WEAPONS[s.k].mag-s.mag,s.res);s.mag+=take;s.res-=take;p.rl=0}}
      if(p.dead){p.dead-=dt;if(p.dead<=0)this.spawn(p);continue}
      if(p.bot)this.botThink(p,dt);
      p.ang=p.input.ang;
      moveStep(this.map,p,p.input.mx,p.input.my,dt,p.slots[p.cur].k);
      if(p.input.fire)this.shoot(p);
      this.pickups(p);
    }
    this.updBullets(dt);
    if(this.phase!=='PLAYING')return;

    for(const it of this.items)if(it.cool>0){it.cool-=dt;if(it.cool<=0)this.sendItems()}
    if(!frozen)this.dropT-=dt;if(this.dropT<=0){this.dropWeapon();this.dropT=DROP_EVERY}
    const ps=[...this.players.values()].map(p=>[p.id,Math.round(p.x*10)/10,Math.round(p.y*10)/10,+p.ang.toFixed(3),Math.ceil(p.hp),+p.dead.toFixed(1),p.inv>0?1:0,p.slots[p.cur].k,p.rl>0?+(p.rl/WEAPONS[p.slots[p.cur].k].reload).toFixed(2):0,p.team]);
    for(const p of this.players.values()){
      if(!p.ws)continue;
      const s=p.slots[p.cur];
      this.send(p,{t:'s',c:+this.clock.toFixed(1),fz:+this.freeze.toFixed(1),rd:this.round,p:ps,m:{mag:s.mag,res:s.res,cur:p.cur,sl:p.slots.map(x=>x.k)}});
    }
  }
}
