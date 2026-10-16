export {Room} from './room.js';

// Routes /ws?room=CODE to one Durable Object per room. Everything else is served from ./public (see wrangler.jsonc).
export default{
  async fetch(req,env){
    const url=new URL(req.url);
    if(url.pathname==='/ws'){
      const code=(url.searchParams.get('room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
      if(!code)return new Response('room required',{status:400});
      const id=env.ROOM.idFromName(code);
      return env.ROOM.get(id).fetch(req);
    }
    return new Response('not found',{status:404});
  }
};
