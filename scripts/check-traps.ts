// Dev check for booby traps (docs/booby-traps.html; server/traps.ts), in process, no network: in every
// chapter that has traps, for the first alarm car and the first nightlight,
//   - a pistol shot that stops on the car sets it off (a 'trap' RING by the shooter, a lure, a horde on Normal),
//     and it is spent when the ring ends;
//   - a blast beside a car sets it off;
//   - walking into a nightlight's cone chirps (WARN), then plays (RING) after TRAP.light.warn s;
//   - stepping back out during the chirp re-arms it;
//   - a shot at a nightlight breaks it silently (SPENT, no horde);
//   - traps are dark during a holdout: shooting the car does nothing.
// Exit code 1 on failure. Usage: npx tsx scripts/check-traps.ts
import { CHAPTERS, getLevel } from '../shared/chapters';
import { TICK_HZ, TILE, TRAP, TRAP_ST } from '../shared/constants';
import { cellOf, type Trap } from '../shared/level';
import type { GameEvent, ServerMsg } from '../shared/protocol';
import { Room } from '../server/room';
import { EYE } from '../server/tuning';
import type { Player } from '../server/types';

let failed = 0;
const fail = (msg: string) => { console.error('FAIL:', msg); failed++; };
const DT = 1 / TICK_HZ;

/** A room on chapter `ch` with one survivor, ticked by hand. Returns the room, the survivor and every event it has seen. */
function setup(ch: number) {
  const events: GameEvent[] = [];
  const ws = { readyState: 1, send(raw: string) { const m = JSON.parse(raw) as ServerMsg; if (m.t === 's') events.push(...m.ev); } };
  const room = new Room(`T${ch}`, ch, true);
  room.destroy();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = room.addPlayer(ws as any, 'Tester')!;
  room.onMessage(p, { t: 'dbgf', calm: 1, god: 1 });
  const tick = (secs: number) => { for (let i = 0; i < Math.round(secs / DT); i++) room.tick(DT); };
  tick(0.2);
  events.length = 0;
  return { room, p, events, tick };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R = (room: Room) => room as any;
/** Put survivor `p` at (x, z) on floor height y, facing (fx, fz). */
function put(room: Room, p: Player, x: number, y: number, z: number, fx = 0, fz = -1): void {
  p.x = x; p.z = z; p.y = y; p.gy = y; p.ry = Math.atan2(-fx, -fz); p.freeAt = 0;
  R(room).place(p);
}

/** An open spot 4–10 m from car `tr` with a clear line from eye height to its body. */
function carSpot(room: Room, tr: Trap): { x: number; z: number } | null {
  const L = room.L, lv = L.storeyOf(tr.y);
  for (let r = 2; r <= 5; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const cx = cellOf(tr.x) + dx, cz = cellOf(tr.z) + dz;
    if (!L.inBounds(cx, cz) || L.solidAt(cx, cz, room.doors, lv)) continue;
    const x = (cx + 0.5) * TILE, z = (cz + 0.5) * TILE, oy = tr.y + EYE, ey = tr.y + 0.8;
    const ddx = tr.x - x, ddy = ey - oy, ddz = tr.z - z, d = Math.hypot(ddx, ddy, ddz);
    const hit = L.ray(x, oy, z, ddx / d, ddy / d, ddz / d, d, room.doors);
    if (hit < d - 0.2) {
      // Where the ray meets the car (or whatever it meets first).
      const ex = x + (ddx / d) * hit, ez = z + (ddz / d) * hit;
      const inCar = ex >= tr.tx * TILE - 0.3 && ex <= (tr.tx + tr.w) * TILE + 0.3 && ez >= tr.tz * TILE - 0.3 && ez <= (tr.tz + tr.d) * TILE + 0.3;
      if (inCar) return { x, z };
    }
  }
  return null;
}
/** An open spot 3–12 m from nightlight `tr`, outside its cone, with a clear line from eye height to it. */
function lightSpot(room: Room, tr: Trap): { x: number; z: number } | null {
  const L = room.L, lv = L.storeyOf(tr.y), cosHalf = Math.cos(TRAP.light.half + 0.15);
  const ex = tr.x + tr.fx * 0.05, ey = tr.y + TRAP.light.height, ez = tr.z + tr.fz * 0.05;
  for (let r = 2; r <= 6; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const cx = cellOf(tr.x) + dx, cz = cellOf(tr.z) + dz;
    if (!L.inBounds(cx, cz) || L.solidAt(cx, cz, room.doors, lv)) continue;
    const x = (cx + 0.5) * TILE, z = (cz + 0.5) * TILE, vx = x - tr.x, vz = z - tr.z, dd = Math.hypot(vx, vz);
    if (dd < 3 || dd > 12 || (dd <= TRAP.light.range + 1 && (vx * tr.fx + vz * tr.fz) / dd > cosHalf)) continue;
    const oy = tr.y + EYE, ddx = ex - x, ddy = ey - oy, ddz = ez - z, d = Math.hypot(ddx, ddy, ddz);
    if (L.ray(x, oy, z, ddx / d, ddy / d, ddz / d, d + 0.5, room.doors) >= d - 0.3) return { x, z };
  }
  return null;
}
const trapEv = (ev: GameEvent[], id: number, st: number) => ev.find((e) => e[0] === 'trap' && e[1] === id && e[2] === st);

let tested = 0;
for (let ch = 0; ch < CHAPTERS.length; ch++) {
  const traps = getLevel(ch).def.traps;
  const name = `ch${ch + 1}`;
  const car = traps.find((t) => t.kind === 'car'), light = traps.find((t) => t.kind === 'light');
  if (!traps.length) { console.log(`${name}: no traps`); continue; }
  {
    // Every nightlight must be shootable from outside its light (its counterplay).
    const { room } = setup(ch);
    for (const l of traps) if (l.kind === 'light' && !lightSpot(room, l)) fail(`${name}: nightlight ${l.id} can't be shot from anywhere outside its light within 12 m`);
  }

  if (car) {
    // Shot.
    let { room, p, events, tick } = setup(ch);
    const at = carSpot(room, car);
    if (!at) fail(`${name}: car ${car.id} has no open spot with a clear shot within 10 m`);
    else {
      put(room, p, at.x, car.y, at.z);
      // Aim from the eye at the car's middle; the bullet stops where the ray first meets something (the car).
      const oy = car.y + EYE, dx = car.x - at.x, dy = car.y + 0.8 - oy, dz = car.z - at.z, d = Math.hypot(dx, dy, dz);
      const hit = room.L.ray(at.x, oy, at.z, dx / d, dy / d, dz / d, d, room.doors);
      room.onMessage(p, { t: 'f', w: 0, h: [], e: [at.x + (dx / d) * hit, oy + (dy / d) * hit, at.z + (dz / d) * hit] });
      tick(0.2);
      if (!trapEv(events, car.id, TRAP_ST.RING)) fail(`${name}: shooting car ${car.id} did not set it off`);
      else {
        if (!events.some((e) => e[0] === 'horde')) fail(`${name}: car alarm brought no horde`);
        if (!R(room).lures.some((l: { w: number }) => l.w === -1)) fail(`${name}: car alarm has no lure`);
        if (!events.some((e) => e[0] === 'msg' && String(e[1]).includes('car alarm'))) fail(`${name}: no kill-feed line`);
        tick(TRAP.car.ring + 0.3);
        if (!trapEv(events, car.id, TRAP_ST.SPENT)) fail(`${name}: car ${car.id} still ringing after ${TRAP.car.ring} s`);
        else console.log(`ok: ${name} car ${car.id}: shot sets it off, lure + horde, spent after the ring`);
      }
    }
    // Blast.
    ({ room, p, events, tick } = setup(ch));
    room.traps.blast(car.x, car.y + 0.4, car.z + (car.d * TILE) / 2 + 1.5, 4, p);
    tick(0.1);
    if (!trapEv(events, car.id, TRAP_ST.RING)) fail(`${name}: a blast beside car ${car.id} did not set it off`);
    else console.log(`ok: ${name} car ${car.id}: a blast sets it off`);
    // Dark in a holdout.
    ({ room, p, events, tick } = setup(ch));
    R(room).holdout = 30;
    tick(0.1);
    if (!events.some((e) => e[0] === 'traps' && e[1] === 0)) fail(`${name}: traps not dark during a holdout`);
    room.traps.blast(car.x, car.y + 0.4, car.z, 4, p);
    tick(0.1);
    if (trapEv(events, car.id, TRAP_ST.RING)) fail(`${name}: a dark car went off`);
    else console.log(`ok: ${name}: traps go dark in a holdout and can't go off`);
    tested++;
  }

  if (light) {
    const inFront = (m: number) => ({ x: light.x + light.fx * m, z: light.z + light.fz * m });
    // Walk in, stay.
    let { room, p, events, tick } = setup(ch);
    let s = inFront(3);
    put(room, p, s.x, light.y, s.z, -light.fx, -light.fz);
    tick(0.15);
    if (!trapEv(events, light.id, TRAP_ST.WARN)) fail(`${name}: nightlight ${light.id} did not chirp with a survivor 3 m in front`);
    tick(TRAP.light.warn + 0.1);
    if (!trapEv(events, light.id, TRAP_ST.RING)) fail(`${name}: nightlight ${light.id} did not play after the chirp`);
    else console.log(`ok: ${name} nightlight ${light.id}: chirp, then plays`);
    // Walk in, step out.
    ({ room, p, events, tick } = setup(ch));
    put(room, p, s.x, light.y, s.z);
    tick(0.15);
    s = inFront(TRAP.light.range + 3);
    put(room, p, s.x, light.y, s.z);
    tick(0.1);
    if (!trapEv(events, light.id, TRAP_ST.ARMED)) fail(`${name}: nightlight ${light.id} did not re-arm when the survivor stepped out`);
    tick(TRAP.light.warn + 0.2);
    if (trapEv(events, light.id, TRAP_ST.RING)) fail(`${name}: nightlight ${light.id} played after the survivor stepped out`);
    else console.log(`ok: ${name} nightlight ${light.id}: stepping out in time re-arms it`);
    // Shoot it out, from somewhere outside its light (the counterplay has to exist).
    ({ room, p, events, tick } = setup(ch));
    const spot = lightSpot(room, light);
    if (!spot) { fail(`${name}: nightlight ${light.id} can't be shot from anywhere outside its light within 12 m`); continue; }
    put(room, p, spot.x, light.y, spot.z);
    room.onMessage(p, { t: 'f', w: 0, h: [], e: [light.x + light.fx * 0.05, light.y + TRAP.light.height, light.z + light.fz * 0.05] });
    tick(0.1);
    if (!trapEv(events, light.id, TRAP_ST.SPENT)) fail(`${name}: shooting nightlight ${light.id} from (${spot.x}, ${spot.z}) did not break it`);
    else if (events.some((e) => e[0] === 'horde')) fail(`${name}: breaking a nightlight brought a horde`);
    else console.log(`ok: ${name} nightlight ${light.id}: one shot breaks it quietly`);
    tested++;
  }
}
if (!tested) fail('no chapter has traps');
if (failed) { console.error(`${failed} trap check(s) failed`); process.exit(1); }
console.log('TRAP CHECK PASSED');
process.exit(0);
