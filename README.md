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
| `1` `2` `3` / wheel | primary / sidearm / close-in weapon (wheel also cycles throwables) |
| `4` `5` | take a throwable in hand: hold `LMB` to aim, release to throw |
| `G` | quick throw |
| `Space` `F` `M` | jump / flashlight / mute |

**The campaign:** four chapters (*The Long Lullaby*, briefed in `docs/campaign.md`), each a
30–60 minute run. A quest guides the squad: the objective at the top of the screen, a yellow
waypoint marker, and radio chatter. Steps are *reach* a place, *gather* everyone somewhere,
*use* a machine (often followed by a holdout), *collect* scattered items, or *hold out*.
Mid-chapter safe rooms are checkpoints: wipe after one and the squad restarts there. Every
chapter builds to a **Big Hold On**: a holdout with far bigger hordes, and a mounted support gun
at the stand (the *Popcorn Gatling* minigun, the *Thump Cannon* or the *Fizzbang Pod* rockets).
Press **E** at one to man it (E or Space lets go). You turn within its arc, and it overheats or
reloads instead of running dry. Finish a chapter and the room moves on to the next. Pick the
starting chapter in the lobby.

**Weapons:** everyone starts with the *Pea Shooter* (endless ammo). Primaries are found at
weapon stops: the *Buzz Blaster* (SMG), *Boomstick* (pump shotgun) and *Long Bonker* (rifle),
then rarer finds later on: the *Rumble Drum* (auto shotgun), the *Bloop Tube* (grenade launcher;
lobbed shells, a big blast that only nicks the squad near its centre, half-armed closer than 3 m),
and two sidearms that replace the Pea Shooter and are still endless: the *Thunder Pea* (magnum)
and the *Desert Eagle* (slower and heavier: one round drops a common and goes through three). Each gun has a reach: full
damage out to a distance, then falling off to a floor (shotguns hit hard up close and barely
tickle at 20 m; rifle and magnum hold up far longer) and nothing past its maximum range. Heavy
guns slow you a little. Accuracy is per gun too: holding the trigger widens the spray (the SMG
settles fast; the rifle stays tight in bursts but drifts on long full-auto), and running or
jumping throws shots wide. **V** (or right mouse) shoves with any weapon. Guns are
single-use: the first survivor to grab one takes it, so share them out. Each ammo pile refills
every survivor once. Medkits (one carried, healing most of your missing health) are rolled each
attempt and scale with the squad's size. Loot comes back on a checkpoint restart.

**Close-in weapons** go on your belt (key `3`) beside your guns: the *Bonk Bat* (wide swing,
one-hits commons) and the *Snip-Snap* (fast). They
never run out and they are silent, so a swing wakes nobody. **Throwables** (up to three carried in any mix; `4` / `5` take one in hand, hold left mouse to aim along the
shown arc and release to throw; `G` throws one straight away): the
*Hot Sauce* firebomb leaves a burning patch for 9 s (it burns you too) and the *Rattle Bomb* draws
every common nearby for 5 s, then explodes. A **Pillow Vest** gives 50 armour that soaks up half of
each bite or hit until it is used up (goo and fire go straight through).

**The horde:** walkers, plus specials that the campaign introduces one at a time (chapter 1 opens
with walkers only): the *Leaper* (pounces from range), the *Puffer* (explodes into goo that calls
more walkers), the *Drooler* (spits goo pools), the *Charger* (bull-rushes and pins), the *Alarm
Clock* (rings for a mini-horde), the *Snatcher* (lassoes a survivor and reels them in: shoot it or
shove the victim free), the *Piggyback* (rides a survivor away from the team: shove it off) and the
*Weeper* (sits sobbing; linger near her or hurt her and she flattens whoever woke her). Two uncommon
commons join the hordes later: the *Tinpot* (bullets do a quarter damage to its front until it is shoved) and the
*Raincoat* (fireproof). The *Brute* (one or two per run) hits like a truck. At 0 HP you go down and bleed out unless a teammate helps you up (solo, you can get
yourself up once per attempt). While down, every hit does a tenth of its damage, buying the team time to reach you, and you can still shoot: your sidearm comes out (and whatever you held goes back in hand once you are up). Going down again before a medkit or a safe room counts: the
third down (second on Nightmare) knocks you out. Knocked-out players are rescued next to a
teammate after 15/30/45 s (Easy/Normal/Hard; on Nightmare only at the next safe room), and every
safe room rescues them. Shoving tires you: spam it and it slows down. If nobody is left standing
the squad restarts at the last checkpoint.

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
  (a scheduled fire-rate clock, range, pellet count; piercing rounds must lie in a lane along
  the shot and in sight; grenade impacts must pair with a shell actually fired and be in range
  and sight of where it was fired). Fine for co-op with friends; not cheat-proof.
- **AI:** the horde picks one survivor at a time (the one with the most commons on them; kept
  until they go down) and follows a breadth-first flow field toward them, swiping at anyone else
  who gets in the way. A zombie runs straight at its target whenever the straight line there is
  clear for its body. Specials keep their own targeting (nearest, or a lone wolf). The director spawns out of sight, a walk away, and
  paces itself like Left 4 Dead's: each survivor's intensity (hurt, downed, pinned, close kills)
  drives a BUILD_UP → SUSTAIN → FADE → RELAX cycle (a build-up that never peaks still ends after
  60-90 s, scaled by difficulty, so a careful team gets its breathers too); mobs come faster while the team pushes on,
  and a team that camps gets a horde from behind. Specials fill a few slots (per-type respawn
  cooldowns), lurk out of sight until the slots are full or ~20 s pass, then attack together; a
  survivor who strays far from the team draws them. Besides the scripted Brute, each attempt may
  roll a roaming one at a random point 30-70% along the chapter's route (clear of safe rooms,
  holdouts and the scripted one); it comes from ahead when the team passes that point, and timed
  mobs pause while a Brute is up. Holdouts are staged like L4D2 crescendos: waves with
  breathers between, a coordinated special push, sometimes a Brute, then a final rush from two
  sides (a default curve from the hold length; a step's `holdScript` can author its own). Sleeping wanderers are placed once per area per attempt
  (`shared/regions.ts`; `b.density(...)` in a chapter scales or zeroes an area), so a cleared
  street stays cleared. Run the server with `DIRECTOR_DEBUG=1` to log phase changes, ambush
  releases, lone-wolf picks, the rolled Brute point and wanderer placement.
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

**Guide:** with `npm run dev`, open <http://localhost:3000/tools/guide.html>. Three tabs, in English or
Traditional Chinese (picker in the header; the same saved choice as the game):
- *Infected* and *Weapons & gear*: the model (drag to turn, pose buttons), stats read straight from
  `shared/constants.ts`, when each infected type first appears in the campaign, how to beat it and
  shots-to-kill tables.
- *Maps* (`guide.html#maps`; the old `tools/maps.html` redirects there): it shows each
chapter top-down (floors, props, loot, doors, lamps, quest areas and the routed critical path),
the validator report and estimated play time, per-step radio lines and lore notes. Click a step
to focus it (doors shown as at that step); "play from this step" opens the game jumped there.
The `regions` layer shows the wanderer regions (tinted, bordered, labelled with id and expected
sleepers at higher zoom) and any `b.density` overrides; hover a tile for its region.
Dev servers accept the step jump (`?room=X&ch=N&step=K`); production does not unless `ALLOW_DEBUG=1`.

`?debug` on the URL allows input without pointer lock and exposes `window.__game`.
