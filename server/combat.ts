// Client claim validation: shots, swings, grenade landings and shoves. Survivors report what they
// hit; these checks keep the claims honest (weapon owned, shot clock, range, sight, cone) before
// the room applies damage. Free functions over the narrow CombatHost the Room implements.
import { PLAYER, WEAPONS, shotDamage, blastPower, blastRadius, blastDamage, ZTYPES, ZT, ZSTATE, PSTATE, CHARGER, isCommon, armoredFront, TINPOT_FRONT, zedHitSpheres, meleeDamage, shoveFatigue, shoveCooldown, type BlastDef, type WeaponDef } from '../shared/constants';
import type { Level } from '../shared/level';
import type { ClientMsg, GameEvent } from '../shared/protocol';
import { r2, EYE, REACH_DY, BLAST_FF, GRABBER } from './tuning';
import type { Player, Zombie } from './types';

/** What claim validation needs from the room (Room implements it). */
export interface CombatHost {
  readonly time: number;
  readonly state: 'play' | 'won' | 'lost';
  readonly L: Level;
  /** Open-door bitmask (for sight through doorways). */
  readonly doors: number;
  readonly zombies: Map<number, Zombie>;
  readonly players: Map<number, Player>;
  readonly events: GameEvent[];
  /** Dev server: weapons may be fired without having been picked up (debug gives). */
  readonly allowDebug: boolean;
  /** Eye-to-eye sight between things standing at floor heights ay and by. */
  sight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  damageZombie(z: Zombie, dmg: number, by: Player | null, head: boolean): void;
  damagePlayer(p: Player, dmg: number, sx: number, sz: number, quiet?: boolean, scaled?: boolean): void;
  alertNear(x: number, y: number, z: number, radius: number): void;
  addFire(x: number, y: number, z: number, by: Player): void;
  addLure(x: number, y: number, z: number, by: Player, w: number): void;
  unpin(p: Player): void;
}

export function onFire(room: CombatHost, p: Player, m: Extract<ClientMsg, { t: 'f' }>): void {
  const wi = m.w | 0, wp = WEAPONS[wi];
  // Pinned (a Charger, a lasso, a rider): no shooting. Down: the sidearm only.
  const downShot = p.st === PSTATE.DOWN && wi === p.sidearm;
  if (!wp || (p.st !== PSTATE.ALIVE && !downShot) || p.pinned || room.state !== 'play') return;
  // Only the pistol and weapons this player actually picked up (dev servers allow debug gives).
  if (wi !== 0 && wi !== p.primary && wi !== p.sidearm && wi !== p.melee && !(p.thr[wi] > 0) && !room.allowDebug) return;
  const e = Array.isArray(m.e) && m.e.length === 3 && m.e.every(Number.isFinite) ? m.e : null;
  /** Remember a thrown or launched grenade until its landing claim ('g'): where, when and with what it left. */
  const pushNade = () => {
    p.nades.push({ x: p.x, y: p.gy, z: p.z, t: room.time, w: wi, seq: (m.n ?? 0) | 0, ex: e ? e[0] : p.x, ez: e ? e[2] : p.z });
    if (p.nades.length > 6) p.nades.shift();
  };
  if (wp.slot === 'throw') {
    // A throw is its own action (no shot clock): one of that kind is spent; what it does waits for the landing claim ('g').
    if (p.thr[wi] > 0) p.thr[wi]--;
    if (e) room.events.push(['shot', p.id, wi, r2(e[0]), r2(e[1]), r2(e[2])]);
    pushNade();
    return;
  }
  // Shot clock: scheduled from the previous accepted shot rather than reset to "now", so ordinary
  // jitter (bursts within about 0.35 s) doesn't drop real shots; a longer lag spike can still lose
  // some. Sustained rate is capped at 1.25x the weapon's own; an idle gap banks at most 0.25 s;
  // a weapon swap needs 0.25 s (the client spends 0.3 s) and each weapon keeps its own clock, so
  // alternating weapons can't beat either weapon's rate.
  const gap = wi === p.fireW ? wp.rate * 0.8 : 0.25;
  const clock = Math.max(p.lastFire + gap, (p.shotAt[wi] ?? -1e9) + wp.rate * 0.8, room.time - 0.25);
  if (clock > room.time + 0.1) return;
  p.lastFire = clock; p.fireW = wi; p.shotAt[wi] = clock;
  if (e) room.events.push(['shot', p.id, wi, r2(e[0]), r2(e[1]), r2(e[2])]);
  // A swing is quiet: it wakes nobody.
  if (wp.melee) { if (Array.isArray(m.h)) meleeHits(room, p, wp, m.h); return; }
  room.alertNear(p.x, p.gy, p.z, 22);
  if (wp.blast) {
    // Damage waits for the impact claim ('g'); remember where it was fired from.
    pushNade();
    return;
  }
  if (!Array.isArray(m.h)) return;
  if (wp.pierce > 1) { pierceHits(room, p, wi, m.h, e); return; }
  let budget = wp.pellets;
  for (const h of m.h.slice(0, wp.pellets)) {
    if (!Array.isArray(h)) continue;
    const z = room.zombies.get(h[0] | 0);
    if (!z) continue;
    const nb = Math.max(0, Math.min(budget, h[1] | 0)); budget -= nb;
    const nh = Math.max(0, Math.min(budget, h[2] | 0)); budget -= nh;
    if (nb + nh === 0) continue;
    const d = Math.hypot(z.x - p.x, z.z - p.z, z.y - p.gy);
    if (d > wp.range + 4) continue;
    // Across storeys, the floor between must not be in the way (on one floor, claims stay trusted as before, so lag never eats hits).
    if (Math.abs(z.y - p.gy) > REACH_DY && !room.sight(p.x, p.gy, p.z, z.x, z.y - EYE + 0.6, z.z) && !room.sight(p.x, p.gy, p.z, z.x, z.y - EYE + zedHitSpheres(z.type, z.st).headY, z.z)) continue;
    // A Tinpot's front takes only a share of the bullet.
    const front = armoredFront(z.type, z.st, z.ry, z.x, z.z, p.x, p.z);
    if (front) room.events.push(['clang', z.id]);
    // Falloff from the server's view of the distance; the slack above stays at the range floor.
    room.damageZombie(z, shotDamage(wp, z.type, nb, nh, Math.min(d, wp.range)) * (front ? TINPOT_FRONT : 1), p, nh > 0 && !front);
  }
}

/**
 * A piercing bullet: up to `pierce` distinct zombies, one hit each. Checked nearest first:
 * every one in range; the ones after the first in line of sight and inside a lane around the
 * shooter -> end-point line. The bullet stops at a Brute.
 */
function pierceHits(room: CombatHost, p: Player, wi: number, claims: unknown[], e: [number, number, number] | null): void {
  const wp = WEAPONS[wi];
  const seen = new Set<number>();
  const hits: { z: Zombie; head: boolean; d: number }[] = [];
  for (const h of claims.slice(0, wp.pierce)) {
    if (!Array.isArray(h)) continue;
    const z = room.zombies.get(h[0] | 0);
    const nb = Math.max(0, h[1] | 0), nh = Math.max(0, h[2] | 0);
    if (!z || seen.has(z.id) || nb + nh === 0) continue;
    seen.add(z.id);
    hits.push({ z, head: nh > 0, d: Math.hypot(z.x - p.x, z.z - p.z, z.y - p.gy) });
  }
  hits.sort((a, b) => a.d - b.d);
  if (!hits.length) return;
  // The lane: from the shooter through where the bullet stopped (or the nearest hit).
  let lx = (e ? e[0] : hits[0].z.x) - p.x, lz = (e ? e[2] : hits[0].z.z) - p.z;
  let ll = Math.hypot(lx, lz);
  if (ll < 0.5) { lx = hits[0].z.x - p.x; lz = hits[0].z.z - p.z; ll = Math.hypot(lx, lz) || 1; }
  lx /= ll; lz /= ll;
  for (let i = 0; i < hits.length; i++) {
    const { z, head, d } = hits[i];
    if (d > wp.range + 4) break;
    if (i > 0) {
      const ox = z.x - p.x, oz = z.z - p.z, side = Math.abs(ox * lz - oz * lx);
      if (side > 1.4 + ZTYPES[z.type].radius || ox * lx + oz * lz < -1) continue;
      if (!room.sight(p.x, p.gy, p.z, z.x, z.y, z.z)) break;
    }
    // A Tinpot's front takes a share of even a piercing round and stops it dead.
    if (armoredFront(z.type, z.st, z.ry, z.x, z.z, p.x, p.z)) {
      room.events.push(['clang', z.id]);
      room.damageZombie(z, shotDamage(wp, z.type, head ? 0 : 1, head ? 1 : 0, Math.min(d, wp.range)) * TINPOT_FRONT, p, false);
      break;
    }
    room.damageZombie(z, shotDamage(wp, z.type, head ? 0 : 1, head ? 1 : 0, Math.min(d, wp.range)), p, head);
    if (z.type === ZT.BRUTE) break;
  }
}

/**
 * A close-in swing: up to `cleave` distinct zombies, each within reach (plus slack for lag) and
 * inside the swing's cone from where the server has the survivor facing, in line of sight. Survivors
 * of the hit are staggered and shoved back (not the Brute, a Charger or a woken Weeper).
 */
function meleeHits(room: CombatHost, p: Player, wp: WeaponDef, claims: unknown[]): void {
  const M = wp.melee!, fx = -Math.sin(p.ry), fz = -Math.cos(p.ry), seen = new Set<number>();
  for (const h of claims.slice(0, M.cleave)) {
    if (!Array.isArray(h)) continue;
    const z = room.zombies.get(h[0] | 0);
    if (!z || seen.has(z.id)) continue;
    seen.add(z.id);
    const T = ZTYPES[z.type], dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, dz);
    if (d > M.reach + T.radius + 1 || Math.abs(z.y - p.gy) > REACH_DY || (d > 0.6 && (dx * fx + dz * fz) / d < M.arc - 0.35)) continue;
    if (!room.sight(p.x, p.gy, p.z, z.x, z.y, z.z)) continue;
    room.damageZombie(z, meleeDamage(wp, z.type), p, false);
    if (z.hp <= 0 || z.type === ZT.BRUTE || z.type === ZT.CHARGER || z.type === ZT.WEEPER) continue;
    const k = d || 1;
    z.stun = isCommon(z.type) ? M.stun : M.stun * 0.5; z.st = ZSTATE.STAGGER;
    z.vx = (dx / k) * M.knock; z.vz = (dz / k) * M.knock;
  }
}

/**
 * Launcher impact claim. Pairs with the oldest unclaimed grenade, checks the impact is in
 * range of where it was fired and in sight of it (2D, through the grid), then blasts:
 * linear falloff, walls block. Survivors near the centre take a little (BLAST_FF, not scaled by
 * difficulty) and a hop of knockback.
 */
export function onBlast(room: CombatHost, p: Player, m: Extract<ClientMsg, { t: 'g' }>): void {
  if (room.state !== 'play' || p.st === PSTATE.DEAD) return;
  while (p.nades.length && p.nades[0].t < room.time - 6) p.nades.shift();
  // Match the claim to its shell by sequence number, so a dropped 'f' can't shift claims by one.
  const at = m.n ? p.nades.findIndex((q) => q.seq === ((m.n ?? 0) | 0)) : 0;
  if (at < 0) return;
  const n = p.nades.splice(at, 1)[0];
  const wp = n && WEAPONS[n.w], B = wp?.blast;
  if (!n || !wp || !B || ![m.x, m.y, m.z].every(Number.isFinite)) return;
  const dx = m.x - n.x, dz = m.z - n.z, d = Math.hypot(dx, dz);
  if (d > wp.range + 4 || m.y < -1 || m.y > 60) return;
  // Time of flight: the shell can't land sooner than its launch speed allows.
  if (room.time - n.t < d / (B.speed * 1.3) - 0.15) return;
  // It lands near the line it was aimed along (it may stop short on a zombie or wall).
  const ax = n.ex - n.x, az = n.ez - n.z, al = Math.hypot(ax, az);
  if (al > 1 && (Math.abs(dx * az - dz * ax) / al > 3 || (dx * ax + dz * az) / al > al + 4)) return;
  // Pull the point back off the wall face it struck before the sight checks (lifted off the floor it landed on).
  const k = d > 0.01 ? Math.max(0, d - 0.6) / d : 0;
  const bx = n.x + dx * k, bz = n.z + dz * k, gb = room.L.groundY(bx, m.y, bz);
  const ay = n.y + EYE, by = Math.max(gb + 0.3, ay + (m.y - ay) * k);
  if (!room.L.hasLOS(n.x, ay, n.z, bx, by, bz, room.doors) && !lobClear(room, n.x, ay, n.z, bx, by, bz)) return;
  // Throwables: the landing starts a fire or a rattle instead of a blast.
  if (wp.thrown === 'fire') { room.addFire(bx, gb, bz, p); return; }
  if (wp.thrown === 'lure') { room.addLure(bx, gb, bz, p, n.w); return; }
  const power = blastPower(B, d);
  room.events.push(['blast', p.id, r2(m.x), r2(m.y), r2(m.z), power]);
  applyBlast(room, p, B, bx, m.y, bz, power);
}

/**
 * Multi-storey maps: a lobbed shell or throw may arc over what the straight line clips (a roof edge,
 * up onto a roof): clear along two legs through an apex above the midpoint. Flat maps keep the
 * straight-line rule (their walls are sky-high anyway).
 */
function lobClear(room: CombatHost, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  if (room.L.levels === 1) return false;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = Math.max(ay, by) + Math.min(6, 0.3 * Math.hypot(bx - ax, bz - az));
  return room.L.hasLOS(ax, ay, az, mx, my, mz, room.doors) && room.L.hasLOS(mx, my, mz, bx, by, bz, room.doors);
}

/** Blast `B` at (bx, by, bz): zombies in its radius and sight, a nick and a hop for survivors near the centre. */
export function applyBlast(room: CombatHost, by: Player | null, B: BlastDef, bx: number, y: number, bz: number, power: number): void {
  const R = blastRadius(B, power), gb = room.L.groundY(bx, y, bz), ly = Math.max(y, gb + 0.3);
  for (const z of [...room.zombies.values()]) {
    const T = ZTYPES[z.type], zc = z.y + T.scale * 0.7;
    const zd = Math.max(0, Math.hypot(z.x - bx, zc - y, z.z - bz) - T.radius);
    if (zd > R || !room.L.hasLOS(bx, ly, bz, z.x, Math.max(zc, z.y + 0.3), z.z, room.doors)) continue;
    if (isCommon(z.type) && zd < R * 0.8) {
      const a = Math.hypot(z.x - bx, z.z - bz) || 1;
      z.stun = 0.9; z.vx = ((z.x - bx) / a) * 8; z.vz = ((z.z - bz) / a) * 8; z.st = ZSTATE.STAGGER;
    }
    room.damageZombie(z, blastDamage(B, power, zd), by, false);
  }
  for (const q of room.players.values()) {
    if (q.st !== PSTATE.ALIVE || q.pinned || Math.abs(q.gy - gb) > REACH_DY) continue;
    const qd = Math.hypot(q.x - bx, q.z - bz);
    if (qd > R * 0.5) continue;
    const ff = Math.round(BLAST_FF * power * (1 - qd / (R * 0.5)));
    if (ff >= 1) room.damagePlayer(q, ff, bx, bz, false, false);
    if (qd < 0.01) continue;
    room.events.push(['kb', q.id, r2(((q.x - bx) / qd) * 6 * power), r2(((q.z - bz) / qd) * 6 * power)]);
  }
  room.alertNear(bx, gb, bz, 30);
}

export function onShove(room: CombatHost, p: Player): void {
  if (p.st !== PSTATE.ALIVE || p.pinned) return;
  // Fatigue gets the same 0.8 slack as the cooldown, so arrival jitter can't tip it past shoveMax before the client.
  const rest = room.time - p.lastShove, fat = shoveFatigue(p.shoveFat, rest / 0.8);
  if (rest < shoveCooldown(fat) * 0.8) return;
  p.lastShove = room.time; p.shoveFat = fat + 1;
  const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
  for (const z of [...room.zombies.values()]) {
    const dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, dz);
    const T = ZTYPES[z.type];
    if (d > PLAYER.shoveRange + T.radius || d < 0.001 || Math.abs(z.y - p.gy) > REACH_DY) continue;
    if ((dx * fx + dz * fz) / d < 0.3) continue;
    if (z.type === ZT.BRUTE) continue;
    // Shoving the Weeper just makes her angry.
    if (z.type === ZT.WEEPER) { room.damageZombie(z, 8, p, false); continue; }
    // A pinning Charger isn't freed by one shove: it counts toward CHARGER.pinBreakDmg.
    if (z.type === ZT.CHARGER && z.st === ZSTATE.PIN) {
      z.pinHit += CHARGER.shovePin - 8;
      room.damageZombie(z, 8, p, false);
      continue;
    }
    // A shove interrupts any windup, charge or ring. Chargers are heavy and barely budge.
    const kick = z.type === ZT.CHARGER ? 3 : 9;
    // A Tinpot reels for longer: the window to shoot it while its guard is down.
    z.stun = z.type === ZT.TINPOT ? 1.7 : isCommon(z.type) ? 1.1 : 0.7;
    z.vx = (dx / d) * kick; z.vz = (dz / d) * kick;
    z.st = ZSTATE.STAGGER; z.dormant = false;
    room.damageZombie(z, 8, p, false);
  }
  // Shoving a lassoed or ridden teammate knocks their captor loose.
  for (const q of room.players.values()) {
    if (q === p || !q.pinned) continue;
    const z = room.zombies.get(q.pinned), dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
    if (!z || !GRABBER(z.type) || d > PLAYER.shoveRange + PLAYER.radius || Math.abs(q.gy - p.gy) > REACH_DY || (d > 0.3 && (dx * fx + dz * fz) / d < 0.3)) continue;
    z.stun = 1.2; z.st = ZSTATE.STAGGER; z.vx = z.vz = 0;
    room.unpin(q);
  }
  room.events.push(['shove', p.id]);
}
