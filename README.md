# Tile Arena (online)

2D top-down deathmatch. Browser client + Cloudflare Worker with one Durable Object per room (server-authoritative).

```
public/index.html   client (canvas, lobby, HUD, touch controls)
public/shared.js    map, weapons, collision, movement (used by client AND server)
server/worker.js    routes /ws?room=CODE to a room
server/room.js      Room Durable Object: 30Hz sim, bullets, damage, pickups, drops, match flow
wrangler.jsonc      assets + Durable Object binding
```

## Run locally
```
npm install
npm run dev        # http://localhost:8787  (open two tabs, 방 만들기 → 코드로 참가)
```

## Deploy
```
npx wrangler login
npm run deploy     # prints https://tile-arena.<your-subdomain>.workers.dev
```
Durable Objects work on the Workers free plan (SQLite-backed class, already set in wrangler.jsonc).

## How it works
- Client sends input (`mx,my,ang,fire`) 30x/s. Server moves players, fires, resolves hits, and broadcasts snapshots 30x/s.
- Your own character is predicted locally (same `moveStep` as the server) and only corrected on large error. Others are interpolated 100 ms behind.
- Rooms: 방 만들기 makes a 4-letter code, 코드로 참가 joins an existing room, 빠른 참가 fills rooms Q1..Q6. Max 8 players. First player is host and starts the match.
- Tuning: weapon numbers and map are in `public/shared.js`.
