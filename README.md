# Chibi Outbreak

A browser co-op zombie survival shooter for up to 4 players. Chibi characters, cel-shaded
toon rendering with ink outlines, and a server-driven horde. TypeScript end to end, rendered
with [PlayCanvas](https://playcanvas.com).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000 — server + Vite middleware, reloads on change
```

Production:

```bash
npm run build      # bundles the client into dist/
npm start          # serves dist/ and the game WebSocket on $PORT (default 3000)
```

Or with Docker: `docker build -t chibi-outbreak . && docker run -p 3000:3000 chibi-outbreak`.

Everything (pages, assets, `/ws`) is on one port, so any host that supports WebSockets works.

## Playing together

Enter a name and press **PLAY**. Leave the room code blank for quick play (joins any room
with a free seat) or type a code to create/join a private room. In game, the top-right
button copies an invite link — the room code is the URL hash.

| Key | Action |
| --- | --- |
| `WASD` / mouse | move / aim |
| `LMB` | shoot |
| `RMB` | shove (staggers zombies around you) |
| `R` | reload |
| `E` | pick up / use, hold to help up a downed teammate |
| `Q` (hold) | use medkit |
| `1` `2` / wheel | primary / sidearm |
| `Space` `F` `M` | jump / flashlight / mute |

**The run:** gear up in the safe room, fight down the street, through the alley and park,
into the warehouse. Starting the generator there triggers a holdout; when the gate opens,
get every standing survivor into the safe house.

**The horde:** walkers, plus three specials — the *Leaper* (pounces from range), the
*Puffer* (explodes into goo that calls more walkers) and the *Brute* (one per run, hits
like a truck). At 0 HP you go down and bleed out unless a teammate helps you up; knocked-out
players are rescued next to a teammate after 25 s. If nobody is left standing the run restarts.

## Layout

```
shared/   constants, the level grid, collision/raycast helpers, wire protocol types
server/   index.ts (HTTP + WebSocket host), room.ts (authoritative simulation + director)
client/   index.html, style.css, src/ (PlayCanvas rendering, input, HUD, synthesised audio)
scripts/  smoke.ts — headless end-to-end test
```

- **Authority:** the server owns zombies, health, pickups and win/lose. Clients own their
  movement and do their own hitscan, sending hit claims the server sanity-checks
  (fire rate, range, pellet count). Fine for co-op with friends; not cheat-proof.
- **AI:** zombies follow a breadth-first flow field towards the nearest survivor and
  beeline when close with line of sight. The director spawns out of sight, a walk away.
- **Look:** PlayCanvas has no built-in toon material, so `client/src/gfx.ts` holds a few small
  custom GLSL shaders: 4-step banded lighting, a stepped flashlight cone, fog, and inverted-hull
  ink outlines. Architecture ink lines are thin beam geometry. `client/src/geo.ts` is a small
  primitive/merge kit; all models are built from it in code and all sound is synthesised, so
  there are no asset files. The shaders are GLSL only, so rendering uses WebGL2 (not WebGPU).

## Checks

```bash
npm run typecheck
npm test           # boots a server, joins two bots, plays join → combat → revive → finale
```

`?debug` on the URL allows input without pointer lock and exposes `window.__game`.
