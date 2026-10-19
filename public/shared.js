// Shared by the browser client and the Cloudflare Worker (server-authoritative sim).
export const WEAPONS={
  pistol:{name:'권총',dmg:20,rate:.28,mag:12,reload:1.0,speed:900,spread:.03,pellets:1,range:700,move:1},
  rifle:{name:'소총',dmg:14,rate:.1,mag:30,reload:1.8,speed:1000,spread:.07,pellets:1,range:800,move:.95},
  shotgun:{name:'샷건',dmg:8,rate:.8,mag:6,reload:2.0,speed:750,spread:.22,pellets:6,range:380,move:.95},
  sniper:{name:'저격총',dmg:80,rate:1.3,mag:5,reload:2.4,speed:1500,spread:0,pellets:1,range:1400,pierce:true,move:.85}
};
export const WKEYS=['pistol','rifle','shotgun','sniper'];
export const MUZZLE={pistol:23,rifle:31,shotgun:28,sniper:47};
export const T=32,MATCH=180,GOAL=10,TEAM_GOAL=20,DUEL_GOAL=5,R=13,MAX_PLAYERS=8;
export const DROP_EVERY=7,DROP_MAX=6,DROP_KINDS=['rifle','shotgun','sniper'];

// ---------- maps ----------  tiles: 0 floor, 1 wall, 2 crate, 3 bush
// [id, name, size label]
export const MAP_LIST=[['warehouse','창고','대'],['forest','숲','대'],['city','도시','대'],['pillars','기둥','중'],['pillars_s','작은 기둥','소'],['arena','결투장','소'],['maze','미로','소']];
const rng=seed=>()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
function blank(w,h){
  const g=[];for(let y=0;y<h;y++)g.push(new Array(w).fill(0));
  for(let x=0;x<w;x++){g[0][x]=1;g[h-1][x]=1}
  for(let y=0;y<h;y++){g[y][0]=1;g[y][w-1]=1}
  return g;
}
function rect(g,x,y,w,h,t){for(let j=0;j<h;j++)for(let i=0;i<w;i++){const yy=y+j,xx=x+i;if(yy>0&&xx>0&&yy<g.length-1&&xx<g[0].length-1)g[yy][xx]=t}}
function nearestOpen(g,x,y){
  for(let r=0;r<20;r++)for(let j=-r;j<=r;j++)for(let i=-r;i<=r;i++){
    const xx=x+i,yy=y+j;if(g[yy]&&g[yy][xx]===0)return[xx,yy];
  }
  return[x,y];
}
const BUILD={
  warehouse(){
    const w=70,h=50,g=blank(w,h),r=rng(7);
    // central room with a door on every side
    rect(g,29,19,12,1,1);rect(g,29,30,12,1,1);rect(g,29,19,1,12,1);rect(g,40,19,1,12,1);
    rect(g,33,19,4,1,0);rect(g,33,30,4,1,0);rect(g,29,23,1,4,0);rect(g,40,23,1,4,0);
    rect(g,34,24,2,2,2);
    // mirrored L-walls in each quarter
    for(const[mx,my]of[[0,0],[1,0],[0,1],[1,1]]){
      const fx=x=>mx?w-1-x:x,fy=y=>my?h-1-y:y;
      for(let i=0;i<9;i++){g[fy(8)][fx(8+i)]=1}
      for(let i=0;i<7;i++){g[fy(8+i)][fx(8)]=1}
      for(let i=0;i<6;i++){g[fy(16)][fx(18+i)]=1}
    }
    // long dividing walls with gaps
    rect(g,14,25,10,1,1);rect(g,46,24,10,1,1);rect(g,34,5,1,8,1);rect(g,35,37,1,8,1);
    for(let i=0;i<22;i++){const x=3+Math.floor(r()*(w-6)),y=3+Math.floor(r()*(h-6));if(Math.abs(x-35)<8&&Math.abs(y-25)<8)continue;rect(g,x,y,2,2,2)}
    for(let i=0;i<7;i++){const x=3+Math.floor(r()*(w-8)),y=3+Math.floor(r()*(h-8));rect(g,x,y,3,3,3)}
    return{w,h,g};
  },
  forest(){
    const w=72,h=52,g=blank(w,h),r=rng(21);
    for(let i=0;i<34;i++){const x=2+Math.floor(r()*(w-6)),y=2+Math.floor(r()*(h-6)),s=2+Math.floor(r()*3);rect(g,x,y,s,s-1+Math.floor(r()*2),3)}
    for(let i=0;i<80;i++){const x=2+Math.floor(r()*(w-4)),y=2+Math.floor(r()*(h-4));g[y][x]=2}
    for(let i=0;i<12;i++){const x=3+Math.floor(r()*(w-8)),y=3+Math.floor(r()*(h-8));rect(g,x,y,2+Math.floor(r()*2),2,1)}
    // a creek-like stone line with crossings
    for(let x=6;x<w-6;x++){const y=25+Math.round(Math.sin(x/6)*3);if(x%11>2)g[y][x]=1}
    return{w,h,g};
  },
  pillars(){return pillars(56,40)},
  pillars_s(){return pillars(36,26)},
  arena(){
    const w=30,h=22,g=blank(w,h);
    rect(g,13,10,4,2,1);
    for(const[x,y]of[[7,5],[21,5],[7,15],[21,15]])rect(g,x,y,2,2,2);
    rect(g,4,8,1,6,1);rect(g,25,8,1,6,1);rect(g,12,4,6,1,1);rect(g,12,17,6,1,1);
    rect(g,1,10,2,2,3);rect(g,27,10,2,2,3);rect(g,14,1,2,2,3);rect(g,14,19,2,2,3);
    return{w,h,g};
  },
  maze(){
    const w=36,h=26,g=blank(w,h),r=rng(5);
    for(let y=4;y<h-3;y+=6)for(let x=4;x<w-3;x+=7){
      if(r()<.5)rect(g,x,y,5,2,1);else rect(g,x,y-1,2,5,1);
    }
    for(let i=0;i<8;i++){const x=2+Math.floor(r()*(w-4)),y=2+Math.floor(r()*(h-4));if(g[y][x]===0)g[y][x]=2}
    return{w,h,g};
  },
  city(){
    const w=76,h=56,g=blank(w,h),r=rng(42);
    // building blocks separated by 4-tile streets
    for(let by=4;by<h-6;by+=12)for(let bx=4;bx<w-6;bx+=12){
      const kind=r();
      if(kind<.18){rect(g,bx,by,8,8,3);continue}            // park
      if(kind<.45){                                          // hollow building with two doors
        rect(g,bx,by,8,1,1);rect(g,bx,by+7,8,1,1);rect(g,bx,by,1,8,1);rect(g,bx+7,by,1,8,1);
        rect(g,bx+3,by,2,1,0);rect(g,bx+3,by+7,2,1,0);rect(g,bx+3,by+3,2,2,2);continue;
      }
      rect(g,bx,by,8,8,1);
    }
    for(let i=0;i<30;i++){                                   // parked cars
      const x=2+Math.floor(r()*(w-4)),y=2+Math.floor(r()*(h-4));
      if(g[y][x]===0&&g[y][x+1]===0)rect(g,x,y,2,1,2);
    }
    return{w,h,g};
  }
};
// Pillar layout (like the reference screenshot): 2-thick bars, L-walls and blocks, rotationally symmetric.
function pillars(w,h){
  const g=blank(w,h),fx=w/56,fy=h/40,X=v=>Math.round(v*fx),Y=v=>Math.round(v*fy),L=v=>Math.max(2,Math.round(v));
  const P=[[9,4,2,9],[9,11,8,2],[17,3,2,2],[25,6,2,12],[32,11,4,4],[17,17,2,2],[4,18,4,2],[13,24,2,8],[20,26,6,2],[40,3,2,2],[46,8,2,7],[3,30,2,2]];
  for(const[x,y,pw,ph]of P){
    const xx=X(x),yy=Y(y),ww=pw===2?2:L(pw*fx),hh=ph===2?2:L(ph*fy);
    rect(g,xx,yy,ww,hh,1);rect(g,w-xx-ww,h-yy-hh,ww,hh,1);
  }
  rect(g,Math.floor(w/2)-1,Math.floor(h/2)-1,2,2,2);
  rect(g,X(20),Y(14),2,1,2);rect(g,w-X(20)-2,h-Y(14)-1,2,1,2);
  return{w,h,g};
}
const SP=[[.05,.07],[.95,.07],[.05,.93],[.95,.93],[.5,.06],[.5,.94],[.04,.5],[.96,.5],[.28,.3],[.72,.7],[.72,.3],[.28,.7]];
const IT=[['hp',.5,.42],['hp',.5,.58],['hp',.15,.5],['hp',.85,.5],['ammo',.22,.22],['ammo',.78,.78],['ammo',.22,.78],['ammo',.78,.22],['ammo',.5,.15],['ammo',.5,.85]];
const cache={};
export function getMap(id){
  if(!BUILD[id])id='warehouse';
  if(cache[id])return cache[id];
  const{w,h,g}=BUILD[id]();
  const spawns=SP.map(([fx,fy])=>{const p=nearestOpen(g,Math.round(fx*w),Math.round(fy*h));rect(g,p[0]-1,p[1]-1,3,3,0);return p});
  const items=IT.map(([type,fx,fy])=>{const p=nearestOpen(g,Math.round(fx*w),Math.round(fy*h));return[type,p[0],p[1]]});
  return cache[id]={id,name:(MAP_LIST.find(m=>m[0]===id)||[0,id])[1],w,h,grid:g,spawns,items};
}
export function pickMap(sel){return sel==='random'||!BUILD[sel]?MAP_LIST[Math.floor(Math.random()*MAP_LIST.length)][0]:sel}

export const tile=(m,tx,ty)=>(tx<0||ty<0||tx>=m.w||ty>=m.h)?1:m.grid[ty][tx];
export const solid=(m,tx,ty)=>{const v=tile(m,tx,ty);return v===1||v===2};
export function hitsSolid(m,x,y,r){
  for(let ty=Math.floor((y-r)/T);ty<=Math.floor((y+r)/T);ty++)
  for(let tx=Math.floor((x-r)/T);tx<=Math.floor((x+r)/T);tx++){
    if(!solid(m,tx,ty))continue;
    const cx=Math.max(tx*T,Math.min(x,tx*T+T)),cy=Math.max(ty*T,Math.min(y,ty*T+T));
    if((x-cx)**2+(y-cy)**2<r*r)return true;
  }
  return false;
}
export const inBush=(m,e)=>tile(m,Math.floor(e.x/T),Math.floor(e.y/T))===3;
export function moveStep(m,e,mx,my,dt,weaponKey){
  const len=Math.hypot(mx,my);if(len<.01)return;
  const sp=200*WEAPONS[weaponKey].move*Math.min(1,len),ux=mx/len*sp*dt,uy=my/len*sp*dt;
  if(!hitsSolid(m,e.x+ux,e.y,R))e.x+=ux;
  if(!hitsSolid(m,e.x,e.y+uy,R))e.y+=uy;
}
export function los(m,ax,ay,bx,by){
  const d=Math.hypot(bx-ax,by-ay),n=Math.ceil(d/10);
  for(let i=1;i<n;i++){const x=ax+(bx-ax)*i/n,y=ay+(by-ay)*i/n;if(solid(m,Math.floor(x/T),Math.floor(y/T)))return false}
  return true;
}
export function randOpen(m){for(;;){const tx=1+Math.floor(Math.random()*(m.w-2)),ty=1+Math.floor(Math.random()*(m.h-2));if(tile(m,tx,ty)===0)return[tx*T+T/2,ty*T+T/2]}}
