// Offline shooting range: stands in for the server while you practise (no room, no WebSocket).
// It takes the client's own messages ('f' shots, 'g' grenade impacts, 'v' shoves, 'u' rack use) and
// answers with ordinary 's' snapshots, so main.ts renders the dummies, deaths and pickups through
// its usual paths. Damage uses the same shared formulas as server/room.ts (shotDamage, blastDamage).
import { STOREY, WEAPONS, ZTYPES, ZT, ZSTATE, PLAYER, FIRE, LURE, armoredFront, TINPOT_FRONT, shotDamage, falloffAt, blastPower, blastRadius, blastDamage } from '../../shared/constants';
import { RANGE_DUMMIES, type RangeDummy } from '../../shared/range';
import type { Level } from '../../shared/level';
import type { ClientMsg, GameEvent, ServerMsg, ZombieSnap } from '../../shared/protocol';
import type { BlastDef } from '../../shared/constants';

/** Seconds a dummy stays down before it stands back up. */
const RESPAWN = 1.2;
/** Seconds the stagger pose shows after a hit. */
const FLINCH = 0.22;
/** DPS is averaged over this many seconds of shooting. */
const DPS_WINDOW = 3;

/** `y`: the floor height it stands on (the range is flat, but it follows the same rules as a room). */
interface Dummy {
  id: number; slot: number; def: RangeDummy; x: number; y: number; z: number; ry: number; hp: number; st: number;
  flinch: number; phase: number; firstHit: number; shots: number;
}

/** What the range panel shows (see main.ts updateRangePanel). */
export interface RangeStats {
  /**
   * Last shot: damage dealt, body and head hits, zombies hit, distance to the first one hit (m; -1 =
   * none) and the falloff multiplier there.
   */
  shot: { dmg: number; body: number; head: number; zeds: number; dist: number; falloff: number } | null;
  /** Damage per second over the last DPS_WINDOW s of shooting. */ dps: number;
  total: number; shotsFired: number; shotsHit: number; kills: number;
  /** Last kill: type, time from its first hit, shots that hit it. */ kill: { type: number; ttk: number; shots: number } | null;
  /** Health of the dummy hit last. */ target: { type: number; hp: number; max: number } | null;
}

export class ShootingRange {
  private dummies = new Map<number, Dummy>();
  private respawns: { slot: number; t: number }[] = [];
  private events: GameEvent[] = [];
  private nextId = 1;
  private time = 0;
  private player = { x: 0, y: 0, z: 0, ry: 0 };
  /** Launcher shells in flight: where each was fired from, by sequence number. */
  private nades = new Map<number, { x: number; z: number; w: number }>();
  private hits: { t: number; dmg: number }[] = [];
  /** Burning patches from thrown firebombs. */
  private fires: { x: number; y: number; z: number; age: number; tick: number }[] = [];
  /** Rattle Bombs counting down to their blast (same fuse as the server: LURE.time). */
  private lures: { x: number; y: number; z: number; t: number; B: BlastDef }[] = [];
  stats: RangeStats = ShootingRange.freshStats();

  constructor(private L: Level, private pid: number, private emit: (m: ServerMsg) => void) {
    RANGE_DUMMIES.forEach((_, slot) => this.spawn(slot));
  }

  private static freshStats(): RangeStats {
    return { shot: null, dps: 0, total: 0, shotsFired: 0, shotsHit: 0, kills: 0, kill: null, target: null };
  }
  /** Clear the numbers (a new weapon gets a clean slate). */
  resetStats(): void { this.stats = ShootingRange.freshStats(); this.hits.length = 0; }

  private spawn(slot: number): void {
    const def = RANGE_DUMMIES[slot], id = this.nextId++;
    this.dummies.set(id, { id, slot, def, x: def.x, y: this.L.groundY(def.x, 0, def.z), z: def.z, ry: Math.PI, hp: ZTYPES[def.type].hp, st: ZSTATE.IDLE, flinch: 0, phase: Math.random() * 6, firstHit: -1, shots: 0 });
  }

  handle(m: ClientMsg): void {
    switch (m.t) {
      case 'p': this.player.x = m.x; this.player.y = m.y ?? 0; this.player.z = m.z; this.player.ry = m.ry; break;
      case 'f': this.onFire(m); break;
      case 'g': this.onBlast(m); break;
      case 'v': this.onShove(); break;
      // The rack never empties: hand the gun over without marking it taken.
      case 'u': if (this.L.def.pickups[m.id]) this.events.push(['got', this.pid, m.id]); break;
      // Medical items: the client keeps its own health here (no player snapshots), so just confirm the use.
      case 'h': this.events.push(['heal', this.pid, m.k ?? 0]); break;
    }
  }

  private onFire(m: Extract<ClientMsg, { t: 'f' }>): void {
    const wi = m.w | 0, w = WEAPONS[wi];
    if (!w) return;
    if (w.blast) { this.nades.set(m.n ?? 0, { x: this.player.x, z: this.player.z, w: wi }); return; }
    this.stats.shotsFired++;
    const shot = { dmg: 0, body: 0, head: 0, zeds: 0, dist: -1, falloff: 1 };
    for (const [id, nb, nh] of m.h ?? []) {
      const d = this.dummies.get(id);
      if (!d || d.hp <= 0) continue;
      // Same rule as the server: a Tinpot's front stops bullets (not a close-in swing).
      const front = !w.melee && armoredFront(d.def.type, d.st, d.ry, d.x, d.z, this.player.x, this.player.z);
      if (front) this.events.push(['clang', d.id]);
      const dist = Math.min(Math.hypot(d.x - this.player.x, d.z - this.player.z), w.range);
      if (shot.dist < 0) { shot.dist = dist; shot.falloff = falloffAt(w, dist); }
      shot.body += nb; shot.head += nh; shot.zeds++;
      shot.dmg += this.damage(d, shotDamage(w, d.def.type, nb, nh, dist) * (front ? TINPOT_FRONT : 1), nh > 0 && !front, true);
    }
    if (shot.zeds) this.stats.shotsHit++;
    this.stats.shot = shot;
  }

  private onBlast(m: Extract<ClientMsg, { t: 'g' }>): void {
    const n = this.nades.get(m.n ?? 0);
    this.nades.delete(m.n ?? 0);
    const B = n && WEAPONS[n.w].blast;
    if (!n || !B) return;
    const thrown = WEAPONS[n.w].thrown;
    // Fire and rattles lie on the floor under where it landed.
    const fy = this.L.groundY(m.x, m.y ?? 0, m.z);
    if (thrown === 'fire') {
      this.fires.push({ x: m.x, y: fy, z: m.z, age: 0, tick: 0 });
      this.events.push(['fire', this.nextId++, m.x, m.z, FIRE.r, FIRE.life, fy]);
      return;
    }
    // A Rattle Bomb rattles for its fuse first, as in a real room (the dummies just don't walk over to it).
    if (thrown) {
      this.lures.push({ x: m.x, y: fy, z: m.z, t: LURE.time, B });
      this.events.push(['lure', m.x, m.z, LURE.time, fy]);
      return;
    }
    this.blastAt(B, m.x, m.y, m.z, blastPower(B, Math.hypot(m.x - n.x, m.z - n.z)));
  }

  /** Blast `B` at (x, y, z): damage the dummies in its radius and record it as the last shot. */
  private blastAt(B: BlastDef, x: number, y: number, z: number, power: number): void {
    // Sight from just above the floor under it (a shell lying there) to the dummy's middle, as server/room.ts applyBlast.
    const R = blastRadius(B, power), m = { x, y, z }, ly = Math.max(y, this.L.groundY(x, y, z) + 0.3);
    this.stats.shotsFired++;
    const shot = { dmg: 0, body: 0, head: 0, zeds: 0, dist: Math.hypot(m.x - this.player.x, m.z - this.player.z), falloff: 1 };
    for (const d of [...this.dummies.values()]) {
      if (d.hp <= 0) continue;
      const T = ZTYPES[d.def.type];
      const zc = d.y + T.scale * 0.7, zd = Math.max(0, Math.hypot(d.x - m.x, zc - m.y, d.z - m.z) - T.radius);
      if (zd > R || !this.L.hasLOS(m.x, ly, m.z, d.x, Math.max(zc, d.y + 0.3), d.z, 0)) continue;
      shot.zeds++; shot.body++;
      shot.dmg += this.damage(d, blastDamage(B, power, zd), false, true);
    }
    if (shot.zeds) this.stats.shotsHit++;
    this.stats.shot = shot;
  }

  /** Same reach and cone as the server's shove; 8 damage and a flinch (shove fatigue is the client's). */
  private onShove(): void {
    const fx = -Math.sin(this.player.ry), fz = -Math.cos(this.player.ry);
    for (const d of [...this.dummies.values()]) {
      const dx = d.x - this.player.x, dz = d.z - this.player.z, dist = Math.hypot(dx, dz);
      if (d.hp <= 0 || dist > PLAYER.shoveRange + ZTYPES[d.def.type].radius || dist < 0.001 || (dx * fx + dz * fz) / dist < 0.3) continue;
      if (d.def.type === ZT.BRUTE) continue;
      this.damage(d, 8, false, false);
      // A shoved Tinpot reels as long as it does on the server: the window to shoot past its armour.
      if (d.def.type === ZT.TINPOT) d.flinch = 1.7;
    }
  }

  /** Apply `dmg`; returns the damage that counted (capped at the health left). */
  private damage(d: Dummy, dmg: number, head: boolean, shot: boolean): number {
    const dealt = Math.min(d.hp, dmg);
    if (d.firstHit < 0) d.firstHit = this.time;
    if (shot) d.shots++;
    d.hp -= dmg;
    d.flinch = FLINCH;
    this.stats.total += dealt;
    this.hits.push({ t: this.time, dmg: dealt });
    const max = ZTYPES[d.def.type].hp;
    this.stats.target = { type: d.def.type, hp: Math.max(0, Math.ceil(d.hp)), max };
    if (d.hp <= 0) {
      this.dummies.delete(d.id);
      this.events.push(['zdie', d.id, d.x, d.z, d.def.type, head ? 1 : 0, this.pid, d.y]);
      this.stats.kills++;
      this.stats.kill = { type: d.def.type, ttk: this.time - d.firstHit, shots: d.shots };
      this.respawns.push({ slot: d.slot, t: RESPAWN });
    }
    return dealt;
  }

  /** Advance dummies and respawns, then send this frame's snapshot. */
  tick(dt: number): void {
    this.time += dt;
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      if ((this.respawns[i].t -= dt) > 0) continue;
      this.spawn(this.respawns[i].slot);
      this.respawns.splice(i, 1);
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.age += dt;
      if (f.age >= FIRE.life) { this.fires.splice(i, 1); continue; }
      if (f.age < f.tick) continue;
      f.tick += FIRE.tick;
      for (const d of [...this.dummies.values()]) {
        if (d.hp <= 0 || d.def.type === ZT.RAINCOAT || Math.abs(d.y - f.y) > STOREY / 2 || Math.hypot(d.x - f.x, d.z - f.z) > FIRE.r + ZTYPES[d.def.type].radius) continue;
        this.damage(d, FIRE.dps * FIRE.tick, false, false);
      }
    }
    for (let i = this.lures.length - 1; i >= 0; i--) {
      const l = this.lures[i];
      if ((l.t -= dt) > 0) continue;
      this.lures.splice(i, 1);
      this.events.push(['blast', 0, l.x, l.y + 0.4, l.z, 1]);
      this.blastAt(l.B, l.x, l.y + 0.4, l.z, 1);
    }
    const z: ZombieSnap[] = [];
    for (const d of this.dummies.values()) {
      if (d.def.sway) {
        d.phase += dt * (d.def.speed ?? 3) / d.def.sway;
        d.x = d.def.x + Math.sin(d.phase) * d.def.sway;
      }
      // Face the shooter, flinch when hit, jog while strafing.
      d.ry = Math.atan2(-(this.player.x - d.x), -(this.player.z - d.z));
      d.flinch -= dt;
      d.st = d.flinch > 0 ? ZSTATE.STAGGER : d.def.sway ? ZSTATE.RUN : ZSTATE.IDLE;
      z.push([d.id, d.def.type, +d.x.toFixed(2), +d.z.toFixed(2), +d.ry.toFixed(3), d.st, +d.y.toFixed(2)]);
    }
    while (this.hits.length && this.hits[0].t < this.time - DPS_WINDOW) this.hits.shift();
    const span = this.hits.length ? Math.max(0.5, this.time - this.hits[0].t) : 1;
    this.stats.dps = this.hits.reduce((a, h) => a + h.dmg, 0) / span;
    const ev = this.events;
    this.events = [];
    this.emit({ t: 's', st: 'play', g: 0, ho: -1, q: 0, qc: 0, p: [], z, ev });
  }
}
