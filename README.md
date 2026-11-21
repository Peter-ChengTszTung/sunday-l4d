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

Enter a name. The lobby lists open rooms (chapter, current objective, who's in): click **JOIN**,
or **QUICK PLAY** to drop into any room with a free seat. **New room** picks the chapter and
where to start: the chapter start or any of its checkpoint safe rooms. Tick *Private* to keep
the room off the list. In game, the top-right button copies an invite link (the room code is
the URL hash), and opening it shows a one-click join.

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

**The campaign:** four chapters (*The Long Lullaby*, briefed in `docs/campaign.md`), each a
30–60 minute run. A quest guides the squad: the objective at the top of the screen, a yellow
waypoint marker, and radio chatter. Steps are *reach* a place, *gather* everyone somewhere,
*use* a machine (often followed by a holdout), *collect* scattered items, or *hold out*.
Mid-chapter safe rooms are checkpoints: wipe after one and the squad restarts there. Finish a
chapter and the room moves on to the next. Pick the starting chapter in the lobby.

**The horde:** walkers, plus three specials — the *Leaper* (pounces from range), the
*Puffer* (explodes into goo that calls more walkers) and the *Brute* (one per run, hits
like a truck). At 0 HP you go down and bleed out unless a teammate helps you up; knocked-out
players are rescued next to a teammate after 25 s. If nobody is left standing the squad restarts at the last checkpoint.

## Layout

```
shared/   constants, wire protocol types, level.ts (chapter builder kit + collision/LOS/BFS),
          chapters/ (one file per chapter), validate.ts (static quest/reachability checks)
server/   index.ts (HTTP + WebSocket host), room.ts (authoritative simulation + director)
client/   index.html, style.css, src/ (PlayCanvas rendering, input, HUD, synthesised audio)
scripts/  smoke.ts — headless end-to-end test; check-chapters.ts — chapter validator
docs/     campaign.md — story bible and per-chapter quest briefs
```

- **Authority:** the server owns zombies, health, pickups and win/lose. Clients own their
  movement and do their own hitscan, sending hit claims the server sanity-checks
  (fire rate, range, pellet count). Fine for co-op with friends; not cheat-proof.
- **AI:** zombies follow a breadth-first flow field towards the nearest survivor and
  beeline when close with line of sight. The director spawns out of sight, a walk away.
- **Look:** PlayCanvas has no built-in toon material, so `client/src/gfx.ts` holds a few small
  custom GLSL shaders: 4-step banded lighting, a stepped flashlight cone, fog, and inverted-hull
  ink outlines. Architecture ink lines are thin beam geometry. Lamps light the scene through a
  baked top-down light map (`atmo.ts`: sky exposure, warm street lamps, cool ceiling fixtures) that
  the toon shader samples by world position and bands. `arch.ts` builds walls, shopfronts, door
  frames and ceilings, `ground.ts` the painted ground, curbs and water, per 32x32-tile chunk. `client/src/geo.ts` is a small
  primitive/merge kit; all models are built from it in code and all sound is synthesised, so
  there are no asset files. The shaders are GLSL only, so rendering uses WebGL2 (not WebGPU).

## Checks

```bash
npm run typecheck
npm test           # boots a server, joins two bots, plays join → combat → revive → chapter 1's whole quest
npm run check:maps # validates every chapter (reachability per door state, pacing estimate)
```

**Map viewer:** with `npm run dev`, open <http://localhost:3000/tools/maps.html>. It shows each
chapter top-down (floors, props, loot, doors, lamps, quest areas and the routed critical path),
the validator report and estimated play time, per-step radio lines and lore notes. Click a step
to focus it (doors shown as at that step); "play from this step" opens the game jumped there.
Dev servers accept the step jump (`?room=X&ch=N&step=K`); production does not unless `ALLOW_DEBUG=1`.

`?debug` on the URL allows input without pointer lock and exposes `window.__game`.
