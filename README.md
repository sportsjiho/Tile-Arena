# Tile Arena (online)

2D top-down deathmatch. Browser client + Cloudflare Worker with one Durable Object per room (server-authoritative).

```
public/index.html   client (canvas, lobby, HUD, touch controls)
public/shared.js    map, weapons, collision, movement (used by client AND server)
server/worker.js    routes /ws?room=CODE to a room
public/sim.js       game simulation + bots (runs in the Durable Object, and in the page for AI mode)
server/room.js      Room Durable Object: WebSocket join/leave around sim.js
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
- AI 대전 (home screen) runs sim.js in the browser with 3/5/7 bots, no server needed.
- If a player leaves mid-match, their character becomes a bot `<name>(AI)` until the match ends. A new player joining a full room replaces one of those bots.
- Modes: 데스매치 (first to 10 kills) or 팀전 (블루 vs 레드, first team to 20, no friendly fire). 3-minute limit either way.
- 1:1 결투: two players (or you vs one AI). Every kill sends both back to their starting corners for the next round, with a 2-second freeze. First to 5 wins.
- AI difficulty 초급/중간/강함 (`DIFF` in public/sim.js): reaction time, aim noise, turn speed, sight range.
- Online: the host picks mode and AI difficulty in the lobby.
- Maps: 창고 70x50, 숲 72x52, 도시 76x56 (대), 기둥 56x40 (중), 작은 기둥 36x26, 결투장 30x22, 미로 36x26 (소), or 랜덤 (built in public/shared.js `BUILD`). The camera caps the visible area, so you never see the whole map; the minimap (bottom-right) shows walls, you, teammates and your view box, never enemies.
- Tuning: weapon numbers and map are in `public/shared.js`.

## Accounts
ID + password signup/login works out of the box (PBKDF2-SHA256 hashes, 5 wrong tries = 1 min lock, 1-year session cookie).

### Google login (optional)
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application.
2. Authorized JavaScript origins: your game URL, e.g. `https://tile-arena.<sub>.workers.dev`.
3. Put the Client ID in `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID` and deploy.

Accounts live in the `Accounts` Durable Object (SQLite): Google `sub`, unique nickname, games/wins/kills/deaths, sessions (HttpOnly cookie, 30 days). Email is not stored. Stats count only online matches that started with 2+ humans.
