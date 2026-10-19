// Shared by the browser client and the Cloudflare Worker (server-authoritative sim).
export const WEAPONS={
  pistol:{name:'권총',dmg:20,rate:.28,mag:12,reload:1.0,speed:900,spread:.03,pellets:1,range:700,move:1},
  rifle:{name:'소총',dmg:14,rate:.1,mag:30,reload:1.8,speed:1000,spread:.07,pellets:1,range:800,move:.95},
  shotgun:{name:'샷건',dmg:8,rate:.8,mag:6,reload:2.0,speed:750,spread:.22,pellets:6,range:380,move:.95},
  sniper:{name:'저격총',dmg:80,rate:1.3,mag:5,reload:2.4,speed:1500,spread:0,pellets:1,range:1400,pierce:true,move:.85}
};
export const WKEYS=['pistol','rifle','shotgun','sniper'];
export const MUZZLE={pistol:23,rifle:31,shotgun:28,sniper:47};
export const T=32,MW=40,MH=30,MATCH=180,GOAL=10,R=13,MAX_PLAYERS=8;
// 1 wall, 2 crate, 3 bush
const RECTS=[[6,5,6,1,1],[6,5,1,5,1],[28,5,6,1,1],[33,5,1,5,1],[6,24,6,1,1],[6,20,1,5,1],[28,24,6,1,1],[33,20,1,5,1],
[18,10,4,1,1],[18,19,4,1,1],[14,13,1,4,1],[25,13,1,4,1],[19,14,2,2,2],[10,14,2,2,2],[28,14,2,2,2],[16,4,2,2,2],
[22,24,2,2,2],[3,14,2,1,2],[35,15,2,1,2],[9,9,3,3,3],[28,18,3,3,3],[17,25,3,2,3],[20,3,3,2,3]];
export const SPAWNS=[[3,3],[36,3],[3,26],[36,26],[20,7],[20,22],[8,15],[31,15]];
export const ITEM_DEF=[['hp',20,12],['hp',20,17],['ammo',4,8],['ammo',35,21],['ammo',8,20]];
export const DROP_EVERY=7,DROP_MAX=5,DROP_KINDS=['rifle','shotgun','sniper'];

export const grid=[];
for(let y=0;y<MH;y++)grid.push(new Array(MW).fill(0));
for(let x=0;x<MW;x++){grid[0][x]=1;grid[MH-1][x]=1}
for(let y=0;y<MH;y++){grid[y][0]=1;grid[y][MW-1]=1}
for(const[x,y,w,h,t]of RECTS)for(let j=0;j<h;j++)for(let i=0;i<w;i++)grid[y+j][x+i]=t;
export const tile=(tx,ty)=>(tx<0||ty<0||tx>=MW||ty>=MH)?1:grid[ty][tx];
export const solid=(tx,ty)=>{const v=tile(tx,ty);return v===1||v===2};
export function hitsSolid(x,y,r){
  for(let ty=Math.floor((y-r)/T);ty<=Math.floor((y+r)/T);ty++)
  for(let tx=Math.floor((x-r)/T);tx<=Math.floor((x+r)/T);tx++){
    if(!solid(tx,ty))continue;
    const cx=Math.max(tx*T,Math.min(x,tx*T+T)),cy=Math.max(ty*T,Math.min(y,ty*T+T));
    if((x-cx)**2+(y-cy)**2<r*r)return true;
  }
  return false;
}
export const inBush=e=>tile(Math.floor(e.x/T),Math.floor(e.y/T))===3;
// One movement step. (mx,my) is the raw input vector (length <= 1 scales speed).
export function moveStep(e,mx,my,dt,weaponKey){
  const len=Math.hypot(mx,my);if(len<.01)return;
  const sp=200*WEAPONS[weaponKey].move*Math.min(1,len),ux=mx/len*sp*dt,uy=my/len*sp*dt;
  if(!hitsSolid(e.x+ux,e.y,R))e.x+=ux;
  if(!hitsSolid(e.x,e.y+uy,R))e.y+=uy;
}
export function los(ax,ay,bx,by){
  const d=Math.hypot(bx-ax,by-ay),n=Math.ceil(d/10);
  for(let i=1;i<n;i++){const x=ax+(bx-ax)*i/n,y=ay+(by-ay)*i/n;if(solid(Math.floor(x/T),Math.floor(y/T)))return false}
  return true;
}
export function randOpen(){for(;;){const tx=1+Math.floor(Math.random()*(MW-2)),ty=1+Math.floor(Math.random()*(MH-2));if(tile(tx,ty)===0)return[tx*T+T/2,ty*T+T/2]}}
