import {Game} from '../public/sim.js';

// One Room = one Durable Object = one match. The simulation itself lives in public/sim.js.
export class Room extends Game{
  constructor(state,env){super();this.state=state}
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
    if(this.humans().length===0&&!create)err='room_missing';
    else if(!this.canJoin())err='room_full';
    if(err){server.send(JSON.stringify({t:'err',m:err}));server.close(1000,err);return new Response(null,{status:101,webSocket:client})}
    this.addPlayer(server,name);
    return new Response(null,{status:101,webSocket:client});
  }
}
