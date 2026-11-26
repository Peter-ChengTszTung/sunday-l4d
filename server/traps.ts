// Booby traps (docs/booby-traps.html): Snoozle alarm cars and nightlights, placed by the chapter
// (ChapterDef.traps). The server owns every trap's state; clients only show it ('trap' / 'traps' events).
// A car goes off when shot, blasted, burnt or charged into: it rings, pulls the commons in, wakes the
// sleepers and brings a horde. A nightlight goes off when a survivor stands in its cone; one hit breaks it.
import { TILE, TRAP, TRAP_ST, PSTATE } from '../shared/constants';
import type { Level, Trap } from '../shared/level';
import type { GameEvent } from '../shared/protocol';
import { EYE, REACH_DY } from './tuning';
import type { Fire, Player, Zombie } from './types';

/** What the traps need from the room (Room implements it). */
export interface TrapHost {
  readonly L: Level;
  readonly doors: number;
  readonly players: Map<number, Player>;
  readonly events: GameEvent[];
  /** Eye-to-eye sight between things standing at floor heights ay and by. */
  sight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean;
  alertNear(x: number, y: number, z: number, radius: number): void;
  /** True while traps must stay dark: a holdout or a Brute fight is on. */
  trapsDark(): boolean;
  /** Trap `tr` went off: its lure (cars), its horde and the director's timer (see Room.trapNoise). */
  trapNoise(tr: Trap): void;
}

/** Who set a trap off, for the 'trap' event: a survivor's id, 0 = nobody, -1 = a charging Charger. */
export const BY_CHARGER = -1;
/** Metres of the shooter's end of a shot line where a blocker is forgiven (see Traps.shot). */
const PEEK = 1.5;
/** Seconds a nightlight waits after re-arming before it chirps again (no chirp storm on its cone's edge). */
const REWARN = 0.5;
/** Once chirping, a nightlight keeps chirping while the survivor stays within this much more range (m) and angle (rad). */
const HOLD_M = 0.75, HOLD_A = 0.12;

export class Traps {
  private st = new Uint8Array(0);
  /** RING: seconds left; WARN: seconds until a nightlight plays. */
  private t = new Float32Array(0);
  /** Cars: seconds fire has burnt on it. */
  private burn = new Float32Array(0);
  /** Who a WARN nightlight is chirping at. */
  private warnBy = new Int32Array(0);
  private dark = false;

  constructor(private readonly h: TrapHost) {}

  /** The chapter's traps; a chapter that changed under us (loaded without a reset) re-arms them all. */
  private get list(): Trap[] {
    const list = this.h.L.def.traps;
    if (list.length !== this.st.length) this.reset();
    return list;
  }

  /** Every trap armed and live again (a chapter load or a restart; clients re-arm on 'reset'). */
  reset(): void {
    const n = this.h.L.def.traps.length;
    this.st = new Uint8Array(n); this.t = new Float32Array(n); this.burn = new Float32Array(n); this.warnBy = new Int32Array(n);
    this.dark = false;
  }

  /** For a joining client ('w'). */
  states(): number[] { return this.list.length ? [...this.st] : []; }
  get live(): boolean { return !this.dark; }

  private set(i: number, s: number, by: number): void {
    this.st[i] = s;
    this.h.events.push(['trap', i, s, by]);
  }

  /** Point (x, y, z) is within `pad` m of car `tr`'s body. */
  private inCar(tr: Trap, x: number, y: number, z: number, pad: number): boolean {
    const x0 = tr.tx * TILE - pad, z0 = tr.tz * TILE - pad, x1 = (tr.tx + tr.w) * TILE + pad, z1 = (tr.tz + tr.d) * TILE + pad;
    return x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= tr.y + 0.2 && y <= tr.y + TRAP.car.top + pad;
  }
  /** Nothing solid between (x, y, z) and trap `tr` (a point just outside the car's side facing it, or just off the nightlight's wall). */
  private reaches(tr: Trap, x: number, y: number, z: number): boolean {
    let tx: number, tz: number;
    const ty = tr.y + (tr.kind === 'car' ? 0.5 : TRAP.light.height);
    if (tr.kind === 'car') {
      // The nearest point of the footprint, pulled 0.3 m back toward the source so it sits in open air.
      const cx = Math.min(Math.max(x, tr.tx * TILE), (tr.tx + tr.w) * TILE), cz = Math.min(Math.max(z, tr.tz * TILE), (tr.tz + tr.d) * TILE);
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
      if (d < 0.35) return true;
      tx = cx + (dx / d) * 0.3; tz = cz + (dz / d) * 0.3;
    } else { tx = tr.x + tr.fx * 0.3; tz = tr.z + tr.fz * 0.3; }
    return this.h.L.hasLOS(x, y, z, tx, ty, tz, this.h.doors);
  }
  /** Flat distance from (x, z) to car `tr`'s footprint (0 inside). */
  private carDist(tr: Trap, x: number, z: number): number {
    const dx = Math.max(tr.tx * TILE - x, 0, x - (tr.tx + tr.w) * TILE), dz = Math.max(tr.tz * TILE - z, 0, z - (tr.tz + tr.d) * TILE);
    return Math.hypot(dx, dz);
  }
  private armed(i: number): boolean { return this.st[i] === TRAP_ST.ARMED || this.st[i] === TRAP_ST.WARN; }

  /**
   * Survivor `p` fired a bullet that stopped at (ex, ey, ez) (the shot's claimed end point). Hitting an
   * alarm car sets it off; hitting a nightlight breaks it. The end point is checked: in the weapon's range
   * and with nothing solid between the shooter's eye and it (the car or the wall itself stops the ray there).
   */
  shot(p: Player, ex: number, ey: number, ez: number, range: number): void {
    const list = this.list;
    if (!list.length) return;
    let hit = -1;
    for (let i = 0; i < list.length && hit < 0; i++) {
      if (!this.armed(i)) continue;
      const tr = list[i];
      if (tr.kind === 'car' ? this.inCar(tr, ex, ey, ez, TRAP.car.pad) : Math.hypot(ex - tr.x, ey - (tr.y + TRAP.light.height), ez - tr.z) < TRAP.light.pad) hit = i;
    }
    if (hit < 0) return;
    const ox = p.x, oy = p.gy + EYE, oz = p.z, dx = ex - ox, dy = ey - oy, dz = ez - oz, d = Math.hypot(dx, dy, dz);
    if (d < 0.05 || d > range + 4) return;
    const ux = dx / d, uy = dy / d, uz = dz / d, L = this.h.L;
    let clear = L.ray(ox, oy, oz, ux, uy, uz, d + 0.5, this.h.doors) >= d - 1.2;
    // The server has the shooter a little behind where they saw themselves (lag): a blocker in the first
    // PEEK m (a door frame they just stepped past) is forgiven if the rest of the line is clear.
    if (!clear && d > PEEK + 1.2) clear = L.ray(ox + ux * PEEK, oy + uy * PEEK, oz + uz * PEEK, ux, uy, uz, d - PEEK + 0.5, this.h.doors) >= d - PEEK - 1.2;
    if (!clear) return;
    if (list[hit].kind === 'car') this.trigger(hit, p.id); else this.set(hit, TRAP_ST.SPENT, p.id);
  }

  /** Survivor `p` swung a close-in weapon with `reach` m: a nightlight in front of them within reach breaks. Cars don't mind. */
  swing(p: Player, reach: number): void {
    const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
    this.list.forEach((tr, i) => {
      if (tr.kind !== 'light' || !this.armed(i) || Math.abs(tr.y - p.gy) > REACH_DY) return;
      const dx = tr.x - p.x, dz = tr.z - p.z, d = Math.hypot(dx, dz);
      if (d > reach + 0.8 || (d > 0.3 && (dx * fx + dz * fz) / d < 0.3)) return;
      if (!this.h.sight(p.x, p.gy, p.z, tr.x + tr.fx * 0.3, tr.y, tr.z + tr.fz * 0.3)) return;
      this.set(i, TRAP_ST.SPENT, p.id);
    });
  }

  /** A blast of radius R at (x, y, z) set off by `by` (a survivor, or null): cars it reaches go off, nightlights break. Puffers don't count (they aren't blasts). */
  blast(x: number, y: number, z: number, R: number, by: Player | null): void {
    this.list.forEach((tr, i) => {
      if (!this.armed(i) || Math.abs(tr.y - y) > REACH_DY + 1) return;
      const near = tr.kind === 'car' ? this.carDist(tr, x, z) <= R * 0.75 : Math.hypot(tr.x - x, tr.z - z) <= R * 0.75;
      if (!near || !this.reaches(tr, x, y, z)) return;
      if (tr.kind === 'car') this.trigger(i, by ? by.id : 0); else this.set(i, TRAP_ST.SPENT, by ? by.id : 0);
    });
  }

  /** Charger `z` (radius r) ran into something solid: if it was an alarm car, that car goes off. */
  charge(z: Zombie, r: number): void {
    const px = z.x + z.lx * (r + 0.7), pz = z.z + z.lz * (r + 0.7);
    this.list.forEach((tr, i) => {
      if (tr.kind === 'car' && this.armed(i) && this.inCar(tr, px, z.y + 0.5, pz, 0.3)) this.trigger(i, BY_CHARGER);
    });
  }

  /** Trap `i` goes off (a dark trap can't). */
  private trigger(i: number, by: number): void {
    // Asked fresh, not the per-tick flag: a shot in the same tick a holdout starts mustn't count.
    if (!this.armed(i) || this.h.trapsDark()) return;
    const tr = this.list[i], car = tr.kind === 'car';
    this.t[i] = car ? TRAP.car.ring : TRAP.light.ring;
    // The horde's event goes first, so the client's trap banner (CAR ALARM!) is the one left showing.
    this.h.alertNear(tr.x, tr.y, tr.z, car ? TRAP.car.wake : TRAP.light.wake);
    this.h.trapNoise(tr);
    this.st[i] = TRAP_ST.RING; // armed() is false from here on, even if trapNoise set something else off
    this.h.events.push(['trap', i, TRAP_ST.RING, by]);
    const who = by > 0 ? this.h.players.get(by)?.name : undefined;
    this.h.events.push(['msg', car
      ? (who ? `${who} set off a car alarm!` : by === BY_CHARGER ? 'A Charger set off a car alarm!' : 'A car alarm went off!')
      : (who ? `${who} tripped a nightlight!` : 'A nightlight went off!')]);
  }

  /** Per tick: dark/live switch, ring timers, nightlight cones, fire on cars. */
  update(dt: number, fires: readonly Fire[]): void {
    const list = this.list;
    if (!list.length) return;
    const dark = this.h.trapsDark();
    if (dark !== this.dark) {
      this.dark = dark;
      this.h.events.push(['traps', dark ? 0 : 1]);
    }
    const cosHalf = Math.cos(TRAP.light.half), cosHold = Math.cos(TRAP.light.half + HOLD_A);
    for (let i = 0; i < list.length; i++) {
      const tr = list[i], s = this.st[i];
      if (s === TRAP_ST.RING) {
        if ((this.t[i] -= dt) <= 0) this.set(i, TRAP_ST.SPENT, 0);
        continue;
      }
      if (s === TRAP_ST.SPENT) continue;
      if (dark) {
        if (s === TRAP_ST.WARN) { this.t[i] = 0; this.set(i, TRAP_ST.ARMED, 0); }
        this.burn[i] = 0;
        continue;
      }
      if (tr.kind === 'car') {
        let burning: Fire | null = null;
        for (const f of fires) if (Math.abs(f.y - tr.y) <= REACH_DY && this.carDist(tr, f.x, f.z) < f.r * 0.7 && this.reaches(tr, f.x, f.y + 0.5, f.z)) { burning = f; break; }
        this.burn[i] = burning ? this.burn[i] + dt : 0;
        if (burning && this.burn[i] >= TRAP.car.burn) this.trigger(i, this.h.players.has(burning.by) ? burning.by : 0);
        continue;
      }
      // Nightlight: who stands in its cone, on its storey and in its sight.
      // Chirping already: a little slack, so standing on the cone's edge doesn't chirp over and over.
      const warn = s === TRAP_ST.WARN, range = TRAP.light.range + (warn ? HOLD_M : 0), cosA = warn ? cosHold : cosHalf;
      if (!warn && (this.t[i] -= dt) > 0) continue; // re-arm cooldown (REWARN)
      let who: Player | null = null;
      for (const p of this.h.players.values()) {
        if (p.st !== PSTATE.ALIVE || Math.abs(p.gy - tr.y) > REACH_DY) continue;
        const vx = p.x - tr.x, vz = p.z - tr.z, d = Math.hypot(vx, vz);
        if (d > range || d < 0.01 || (vx * tr.fx + vz * tr.fz) / d < cosA) continue;
        if (!this.h.sight(tr.x + tr.fx * 0.3, tr.y, tr.z + tr.fz * 0.3, p.x, p.gy, p.z)) continue;
        who = p; break;
      }
      if (!who) { if (warn) { this.t[i] = REWARN; this.set(i, TRAP_ST.ARMED, 0); } continue; }
      if (s === TRAP_ST.ARMED) { this.t[i] = TRAP.light.warn; this.warnBy[i] = who.id; this.set(i, TRAP_ST.WARN, who.id); continue; }
      if ((this.t[i] -= dt) <= 0) this.trigger(i, this.h.players.has(this.warnBy[i]) ? this.warnBy[i] : who.id);
    }
  }
}
