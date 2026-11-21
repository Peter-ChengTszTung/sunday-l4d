// One co-op session: authoritative zombies, director, health, pickups and the
// chapter's quest steps. Players are trusted for their own movement and hit
// claims (validated loosely).
import type { WebSocket } from 'ws';
import { TILE, TICK_HZ, SNAP_EVERY, MAX_PLAYERS, PLAYER, WEAPONS, HEAD_MULT, ZTYPES, ZT, ZSTATE, PSTATE, SURVIVORS, CHARGER, DROOLER, ALARM } from '../shared/constants';
import { F, ALL_OPEN, cellOf, type Level, type Step, type Vec2 } from '../shared/level';
import { getLevel, chapterCount } from '../shared/chapters';
import type { ClientMsg, GameEvent, PlayerSnap, ServerMsg, ZombieSnap } from '../shared/protocol';

const INF = 32767;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r2 = (v: number) => Math.round(v * 100) / 100;
// Overridable so the smoke test doesn't have to sit through holdouts.
const HOLD_SCALE = Number(process.env.HOLDOUT_SCALE) || 1;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Dormant walkers are kept in a band this many tiles ahead of the team's furthest progress. */
const BELT_NEAR = 14, BELT_FAR = 46, BELT_MAX = 34;
/** Director spawns never appear closer than this (metres) to any survivor. */
const MIN_SPAWN_DIST = 16;
/** Horde waves: members spawn within CLUSTER tiles of their source; FLANK_CHANCE that a big team-sourced
 * wave (FLANK_MIN+) also comes from a second side; NOISE_REACH: how far (path tiles) a noise source may sit
 * from the noise; GOO_HUNT: seconds a gooed survivor stays marked (wave members chase them first). */
const CLUSTER = 3, FLANK_CHANCE = 0.22, FLANK_MIN = 10, NOISE_REACH = 12, GOO_HUNT = 12;

export interface Player {
  id: number; ws: WebSocket; name: string; look: number;
  x: number; y: number; z: number; ry: number; rx: number;
  hp: number; st: number; medkits: number; w: number; anim: number;
  revT: number; reviving: number; respawnT: number; lastFire: number; lastShove: number; kills: number;
  /** Shot clock: scheduled time of the last accepted shot, and the weapon it came from. */ fireW: number;
  /** Launcher grenades fired and not yet claimed ('g'): where and when they left the tube. */
  nades: { x: number; z: number; t: number; w: number; seq: number; ex: number; ez: number }[];
  /** Weapons the server has seen this player pick up (-1 = none). Fire claims must use one of these or the pistol. */
  primary: number; sidearm: number;
  /** Shot clock per weapon index, so alternating weapons can't beat each weapon's own rate. */
  shotAt: Record<number, number>;
  /** Id of the Charger pinning this survivor (0 = free). While pinned the server ignores their movement. */
  pinned: number;
}

interface Zombie {
  id: number; type: number; x: number; z: number; ry: number; st: number; hp: number; speed: number;
  offX: number; offZ: number; t: number; hitDone: boolean; target: number; dormant: boolean;
  stun: number; vx: number; vz: number; leapCd: number; lx: number; lz: number;
  /** Special-ability cooldown (charge, spit, ring), separate from the leaper's `leapCd`. */
  sp: number;
  /** Seconds left fleeing (alarm clock after ringing). */
  flee: number;
  /** Charger pin: time pinned, damage accumulator. */
  pinT: number; acc: number;
  /** Damage taken from survivors while pinning (knocks it off at CHARGER.pinBreakDmg). */ pinHit: number;
  /** Until this room time, chase goo-marked survivors first (puffer wave members). */ hunt: number;
}

/**
 * A queued horde. Members drip in from hidden cells clustered around `srcs` (spawn cells; a second
 * one flanks from another side). `anchor`: cell of the noise that called it (-1 = the team); a lost
 * source is re-picked by the same rule. `hunt`: room time until which members chase marked survivors.
 */
interface Wave { left: number; srcs: number[]; anchor: number; hunt: number; repicks: number }

/** Drooler goo in flight (simulated on the server along the same arc the clients draw). */
interface Glob { x1: number; z1: number; t: number }
/** A damaging goo puddle on the floor. */
interface Puddle { id: number; x: number; z: number; r: number; life: number; age: number; tick: number }

/** Per-chapter static data the director needs. */
interface ChapterData {
  L: Level;
  progress: Int16Array; // BFS distance from the start with every door open
  /** Spawnable cells (not safe rooms/doors) bucketed by progress. */
  byProgress: number[][];
  open: number[];
  /** 1 where `open` has the cell. */ spawnable: Uint8Array;
}
const chapterData = new Map<number, ChapterData>();
function dataFor(ch: number): ChapterData {
  let d = chapterData.get(ch);
  if (d) return d;
  const L = getLevel(ch), { W, H } = L, def = L.def;
  const progress = L.distanceField([def.startCell.z * W + def.startCell.x], ALL_OPEN);
  const byProgress: number[][] = [], open: number[] = [], spawnable = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (def.solid[i] || def.floor[i] === F.SAFE || def.doorCell[i] >= 0 || progress[i] >= INF) continue;
    open.push(i); spawnable[i] = 1;
    (byProgress[progress[i]] ??= []).push(i);
  }
  d = { L, progress, byProgress, open, spawnable };
  chapterData.set(ch, d);
  return d;
}

interface Checkpoint { step: number; doors: number; taken: number[] }

export class Room {
  players = new Map<number, Player>();
  zombies = new Map<number, Zombie>();
  private nextPid = 1;
  private nextZid = 1;
  private ch = 0;
  private cd!: ChapterData;
  private L!: Level;
  private flow = new Int16Array(1);
  private tickN = 0;
  private interval: ReturnType<typeof setInterval>;
  private doors = 0;
  private state: 'play' | 'won' | 'lost' = 'play';
  private endTimer = 0;
  private started = false;
  private step = 0;
  private holdout = -1; // seconds left; -1 = not running
  private collected = 0;
  private checkpoint: Checkpoint | null = null;
  private taken = new Set<number>();
  private events: GameEvent[] = [];
  private time = 0;
  private kills = 0;
  private best = 0; // furthest progress (tiles) reached this attempt
  private pendingBrute = false;
  private globs: Glob[] = [];
  private puddles: Puddle[] = [];
  private nextPuddle = 1;
  /** Earliest `time` the director may send another Alarm Clock. */
  private alarmAt = 0;
  private t = { flow: 0, ambient: 3, horde: 90, special: 25, hordeTick: 0, holdSpecial: 8, belt: 0 };

  /**
   * `startAt`: step index of a checkpoint (gather) step to begin the chapter in that safe room,
   * or -1 for the chapter start. `listed`: shown in the lobby's room list.
   */
  constructor(public code: string, chapter = 0, private allowDebug = false, startAt = -1, readonly listed = true) {
    this.loadChapter(chapter);
    const cp = this.checkpointFor(startAt);
    if (cp) { this.checkpoint = cp; this.reset(true, true); } else this.reset(false);
    this.interval = setInterval(() => this.tick(1 / TICK_HZ), 1000 / TICK_HZ);
  }

  destroy(): void { clearInterval(this.interval); }

  get chapter(): number { return this.ch; }
  private get def() { return this.L.def; }
  private get cur(): Step | undefined { return this.def.steps[this.step]; }

  private loadChapter(ch: number): void {
    this.ch = ((ch % chapterCount()) + chapterCount()) % chapterCount();
    this.cd = dataFor(this.ch);
    this.L = this.cd.L;
    this.flow = new Int16Array(this.L.W * this.L.H);
    this.checkpoint = null;
  }

  // ------------------------------------------------------------------ setup
  /**
   * Checkpoint state as if the team had just completed checkpoint step `step` (objective
   * machines and quest items before it count as done). Null if `step` isn't a checkpoint.
   */
  private checkpointFor(step: number): Checkpoint | null {
    const s = this.def.steps[step];
    if (!s || s.kind !== 'gather' || !s.checkpoint) return null;
    const taken: number[] = [];
    for (let i = 0; i <= step; i++) {
      const t = this.def.steps[i];
      if (t.kind === 'use' && t.target !== undefined) taken.push(t.target);
      if (t.kind === 'collect') for (const p of this.def.pickups) if (p.kind === 'item' && p.group === t.group) taken.push(p.id);
    }
    return { step, doors: this.L.doorsAfter(step + 1), taken };
  }

  /** Where a player (re)spawns when there's no teammate to join: the active checkpoint's safe room or the start. */
  private spawnPoints(): Vec2[] {
    return (this.checkpoint && this.def.checkpointSpawns[this.checkpoint.step]) || this.def.spawns;
  }

  /** Lobby room-list entry. */
  info() {
    const s = this.cur;
    return {
      code: this.code, ch: this.ch, title: this.def.title, step: this.step + 1, steps: this.def.steps.length,
      objective: s ? s.objective : '', players: [...this.players.values()].map((p) => p.name), max: MAX_PLAYERS, state: this.state,
    };
  }

  /**
   * Start the chapter, or (fromCheckpoint) restart at the last checkpoint. `freshStart`: a new run
   * that begins at the checkpoint (picked in the lobby) rather than a restart after a wipe.
   */
  reset(fromCheckpoint: boolean, freshStart = false): void {
    const cp = fromCheckpoint ? this.checkpoint : null;
    this.zombies = new Map();
    this.nextZid = 1;
    this.state = 'play';
    this.endTimer = 0;
    this.holdout = -1;
    this.collected = 0;
    this.time = cp && !freshStart ? this.time : 0;
    if (!cp || freshStart) this.kills = 0;
    if (!cp) this.checkpoint = null;
    this.pendingBrute = false;
    this.clearHazards();
    this.alarmAt = 0;
    this.waves = []; this.marks.clear();
    this.t = { flow: 0, ambient: 3, horde: rand(80, 110), special: rand(20, 30), hordeTick: 0, holdSpecial: 8, belt: 0 };
    this.doors = cp ? cp.doors : 0;
    this.taken = new Set(cp ? cp.taken : []);
    this.step = cp ? cp.step + 1 : 0;
    this.started = !!cp;
    this.events = [['reset', this.ch, this.step, this.doors, [...this.taken], cp && !freshStart ? 1 : 0]];
    const spawns = this.spawnPoints();
    let slot = 0;
    for (const p of this.players.values()) this.spawnPlayer(p, spawns[slot++ % spawns.length], !cp || freshStart);
    const sp = spawns[0];
    this.best = this.progressAt(sp.x, sp.z);
    this.beginStep(true);
    this.fillBelt(BELT_MAX);
  }

  private spawnPlayer(p: Player, s: Vec2, fresh: boolean): void {
    Object.assign(p, { x: s.x, y: 0, z: s.z, ry: Math.PI, rx: 0, hp: PLAYER.hp, st: PSTATE.ALIVE, w: 0, anim: 0,
      revT: 0, reviving: 0, respawnT: 0, lastFire: 0, lastShove: 0, pinned: 0, fireW: 0, nades: [], shotAt: {} });
    if (fresh || p.primary === undefined) { p.primary = -1; p.sidearm = 0; }
    if (fresh) { p.medkits = 0; p.kills = 0; }
    this.events.push(['tp', p.id, s.x, s.z, Math.PI]);
  }

  addPlayer(ws: WebSocket, name: string): Player | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.look));
    let look = 0;
    while (used.has(look)) look++;
    const p = { id: this.nextPid++, ws, name: name || SURVIVORS[look].name, look, medkits: 0, kills: 0 } as Player;
    const mate = this.standing()[0];
    this.players.set(p.id, p);
    const spawns = this.spawnPoints();
    this.spawnPlayer(p, spawns[look % spawns.length], true);
    // Late joiners start beside the team if the run is already under way.
    if (mate && (this.started || this.step > 0)) {
      p.x = mate.x; p.z = mate.z;
      this.events.pop();
      this.events.push(['tp', p.id, p.x, p.z, mate.ry]);
    }
    this.send(p, { t: 'w', id: p.id, room: this.code, ch: this.ch, step: this.step, taken: [...this.taken], doors: this.doors, x: p.x, z: p.z, debug: this.allowDebug ? 1 : 0 });
    this.broadcastRoster();
    this.events.push(['msg', `${p.name} joined the squad`]);
    return p;
  }

  removePlayer(p: Player): void {
    this.players.delete(p.id);
    this.broadcastRoster();
    this.events.push(['msg', `${p.name} left`]);
  }

  private broadcastRoster(): void {
    this.broadcast({ t: 'ro', players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, look: p.look })) });
  }

  private send(p: Player, obj: ServerMsg): void { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }
  private broadcast(obj: ServerMsg): void {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
  }

  private standing(): Player[] { return [...this.players.values()].filter((p) => p.st === PSTATE.ALIVE); }
  private progressAt(x: number, z: number): number {
    const tx = cellOf(x), tz = cellOf(z);
    if (!this.L.inBounds(tx, tz)) return 0;
    const v = this.cd.progress[tz * this.L.W + tx];
    return v < INF ? v : 0;
  }

  // ------------------------------------------------------------------ quest
  private beginStep(silent = false): void {
    const s = this.cur;
    if (!s) return;
    this.collected = 0;
    this.holdout = s.kind === 'holdout' ? (s.hold ?? 60) * HOLD_SCALE : -1;
    if (!silent) this.events.push(['step', this.step]);
    // A lever with a holdout saves its horde for the pull (the crescendo's opening burst), see onUse.
    if (s.horde && !(s.kind === 'use' && s.hold)) this.horde();
    if (s.brute) this.pendingBrute = true;
  }

  private completeStep(): void {
    const s = this.cur;
    if (!s) return;
    for (const d of s.opens) if (!(this.doors & (1 << d))) { this.doors |= 1 << d; this.events.push(['door', d, 1]); }
    for (const d of s.closes) if (this.doors & (1 << d)) { this.doors &= ~(1 << d); this.events.push(['door', d, 0]); this.clearDoorway(d, s.area); }
    this.holdout = -1;
    if (s.checkpoint) {
      // Only objective pickups stay taken across a checkpoint restart; loot respawns.
      const keep = [...this.taken].filter((id) => { const k = this.def.pickups[id]?.kind; return k === 'obj' || k === 'item'; });
      this.checkpoint = { step: this.step, doors: this.doors, taken: keep };
      this.events.push(['checkpoint']);
    }
    this.step++;
    if (this.step >= this.def.steps.length) { this.win(); return; }
    this.beginStep();
  }

  private updateQuest(dt: number): void {
    const s = this.cur;
    if (!s) return;
    const stand = this.standing();
    if (this.holdout >= 0) {
      this.holdout -= dt;
      if (this.holdout <= 0) this.completeStep();
      return;
    }
    switch (s.kind) {
      case 'reach': if (s.area && stand.some((p) => this.L.inRect(p.x, p.z, s.area!))) this.completeStep(); break;
      case 'gather': if (s.area && stand.length && stand.every((p) => this.L.inRect(p.x, p.z, s.area!))) this.completeStep(); break;
      case 'collect': if (this.collected >= (s.count ?? 0)) this.completeStep(); break;
      default: break; // use: driven by onUse; holdout: timer above
    }
  }

  private win(): void {
    this.state = 'won'; this.endTimer = 16;
    const next = (this.ch + 1) % chapterCount();
    this.events.push(['end', 1, this.kills, Math.round(this.time), [...this.players.values()].map((p): [number, number] => [p.id, p.kills]), next]);
  }

  /** Dev tool: skip to a step with the team standing where the previous step ended. */
  private debugJump(step: number): void {
    const n = this.def.steps.length;
    step = Math.max(0, Math.min(n - 1, step | 0));
    this.zombies = new Map();
    this.clearHazards();
    this.doors = this.L.doorsAfter(step);
    this.step = step;
    this.started = step > 0;
    this.taken = new Set();
    this.events.push(['reset', this.ch, this.step, this.doors, [], 1]);
    const prev = this.def.steps[step - 1];
    const at = this.nearestOpen(prev ? prev.at : this.def.spawns[0]);
    let i = 0;
    for (const p of this.players.values()) {
      const s = { x: at.x + (i % 2) * 0.9, z: at.z + (i >> 1) * 0.9 }; i++;
      Object.assign(p, { x: s.x, z: s.z, st: PSTATE.ALIVE, hp: PLAYER.hp, pinned: 0 });
      this.events.push(['tp', p.id, s.x, s.z, Math.PI]);
    }
    this.best = this.progressAt(at.x, at.z);
    this.beginStep();
    this.fillBelt(BELT_MAX);
  }

  /** A door just shut: zombies caught in the doorway are removed, players in it are moved into the room. */
  private clearDoorway(id: number, area?: { x0: number; z0: number; x1: number; z1: number }): void {
    const d = this.def.doors[id], pad = 1;
    const inDoor = (x: number, z: number, r: number) =>
      x + r > d.x0 * TILE - pad && x - r < (d.x1 + 1) * TILE + pad && z + r > d.z0 * TILE - pad && z - r < (d.z1 + 1) * TILE + pad;
    for (const z of [...this.zombies.values()]) if (inDoor(z.x, z.z, ZTYPES[z.type].radius)) this.zombies.delete(z.id);
    if (!area) return;
    const c = this.nearestOpen({ x: ((area.x0 + area.x1 + 1) / 2) * TILE, z: ((area.z0 + area.z1 + 1) / 2) * TILE });
    for (const p of this.players.values()) if (p.st !== PSTATE.DEAD && inDoor(p.x, p.z, PLAYER.radius)) {
      if (p.pinned) this.unpin(p);
      p.x = c.x; p.z = c.z;
      this.events.push(['tp', p.id, r2(p.x), r2(p.z), p.ry]);
    }
  }

  /** Centre of the walkable tile nearest to `p` (waypoints can sit on solid machines). */
  private nearestOpen(p: Vec2): Vec2 {
    const cx = cellOf(p.x), cz = cellOf(p.z);
    for (let r = 0; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (!this.L.solidAt(cx + dx, cz + dz, this.doors)) return { x: (cx + dx + 0.5) * TILE, z: (cz + dz + 0.5) * TILE };
    }
    return p;
  }

  // --------------------------------------------------------------- messages
  onMessage(p: Player, m: ClientMsg): void {
    switch (m.t) {
      case 'p': {
        if (p.st === PSTATE.DEAD) return;
        if (![m.x, m.y, m.z, m.ry, m.rx].every(Number.isFinite)) return;
        if (p.st === PSTATE.ALIVE && !p.pinned) { p.x = m.x; p.y = m.y; p.z = m.z; }
        p.ry = m.ry; p.rx = m.rx; p.w = m.w | 0; p.anim = m.a | 0;
        break;
      }
      case 'f': this.onFire(p, m); break;
      case 'g': this.onBlast(p, m); break;
      case 'v': this.onShove(p); break;
      case 'u': if (!p.pinned) this.onUse(p, m.id | 0); break;
      case 'h': {
        if (p.st !== PSTATE.ALIVE || p.pinned || p.medkits < 1 || p.hp >= PLAYER.hp) return;
        p.medkits--; p.hp = Math.min(PLAYER.hp, p.hp + PLAYER.healAmount);
        this.events.push(['heal', p.id]);
        break;
      }
      case 'r': p.reviving = p.pinned ? 0 : m.id | 0; break;
      case 'dbg': if (this.allowDebug && this.state === 'play') this.debugJump(m.step); break;
    }
  }
  private onFire(p: Player, m: Extract<ClientMsg, { t: 'f' }>): void {
    const wi = m.w | 0, wp = WEAPONS[wi];
    if (!wp || p.st !== PSTATE.ALIVE || p.pinned || this.state !== 'play') return; // pinned by a Charger: can't shoot
    // Only the pistol and weapons this player actually picked up (dev servers allow debug gives).
    if (wi !== 0 && wi !== p.primary && wi !== p.sidearm && !this.allowDebug) return;
    // Shot clock: scheduled from the previous accepted shot rather than reset to "now", so ordinary
    // jitter (bursts within about 0.35 s) doesn't drop real shots; a longer lag spike can still lose
    // some. Sustained rate is capped at 1.25x the weapon's own; an idle gap banks at most 0.25 s;
    // a weapon swap needs 0.25 s (the client spends 0.3 s) and each weapon keeps its own clock, so
    // alternating weapons can't beat either weapon's rate.
    const gap = wi === p.fireW ? wp.rate * 0.8 : 0.25;
    const clock = Math.max(p.lastFire + gap, (p.shotAt[wi] ?? -1e9) + wp.rate * 0.8, this.time - 0.25);
    if (clock > this.time + 0.1) return;
    p.lastFire = clock; p.fireW = wi; p.shotAt[wi] = clock;
    const e = Array.isArray(m.e) && m.e.length === 3 && m.e.every(Number.isFinite) ? m.e : null;
    if (e) this.events.push(['shot', p.id, wi, r2(e[0]), r2(e[1]), r2(e[2])]);
    this.alertNear(p.x, p.z, 22);
    if (wp.blast) {
      // Damage waits for the impact claim ('g'); remember where it was fired from.
      p.nades.push({ x: p.x, z: p.z, t: this.time, w: wi, seq: (m.n ?? 0) | 0, ex: e ? e[0] : p.x, ez: e ? e[2] : p.z });
      if (p.nades.length > 6) p.nades.shift();
      return;
    }
    if (!Array.isArray(m.h)) return;
    if (wp.pierce > 1) { this.pierceHits(p, wi, m.h, e); return; }
    let budget = wp.pellets;
    for (const h of m.h.slice(0, wp.pellets)) {
      if (!Array.isArray(h)) continue;
      const z = this.zombies.get(h[0] | 0);
      if (!z) continue;
      const nb = Math.max(0, Math.min(budget, h[1] | 0)); budget -= nb;
      const nh = Math.max(0, Math.min(budget, h[2] | 0)); budget -= nh;
      if (nb + nh === 0) continue;
      if (Math.hypot(z.x - p.x, z.z - p.z) > wp.range + 4) continue;
      this.damageZombie(z, wp.dmg * (nb + nh * HEAD_MULT), p, nh > 0);
    }
  }

  /**
   * A piercing bullet: up to `pierce` distinct zombies, one hit each. Checked nearest first:
   * every one in range; the ones after the first in line of sight and inside a lane around the
   * shooter -> end-point line. The bullet stops at a Brute.
   */
  private pierceHits(p: Player, wi: number, claims: unknown[], e: [number, number, number] | null): void {
    const wp = WEAPONS[wi];
    const seen = new Set<number>();
    const hits: { z: Zombie; head: boolean; d: number }[] = [];
    for (const h of claims.slice(0, wp.pierce)) {
      if (!Array.isArray(h)) continue;
      const z = this.zombies.get(h[0] | 0);
      const nb = Math.max(0, h[1] | 0), nh = Math.max(0, h[2] | 0);
      if (!z || seen.has(z.id) || nb + nh === 0) continue;
      seen.add(z.id);
      hits.push({ z, head: nh > 0, d: Math.hypot(z.x - p.x, z.z - p.z) });
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
        if (!this.L.hasLOS(p.x, p.z, z.x, z.z, this.doors)) break;
      }
      this.damageZombie(z, wp.dmg * (head ? HEAD_MULT : 1), p, head);
      if (z.type === ZT.BRUTE) break;
    }
  }

  /**
   * Launcher impact claim. Pairs with the oldest unclaimed grenade, checks the impact is in
   * range of where it was fired and in sight of it (2D, through the grid), then blasts:
   * linear falloff, walls block, no damage to survivors (a hop of knockback instead).
   */
  private onBlast(p: Player, m: Extract<ClientMsg, { t: 'g' }>): void {
    if (this.state !== 'play' || p.st === PSTATE.DEAD) return;
    while (p.nades.length && p.nades[0].t < this.time - 6) p.nades.shift();
    // Match the claim to its shell by sequence number, so a dropped 'f' can't shift claims by one.
    const at = m.n ? p.nades.findIndex((q) => q.seq === ((m.n ?? 0) | 0)) : 0;
    if (at < 0) return;
    const n = p.nades.splice(at, 1)[0];
    const wp = n && WEAPONS[n.w], B = wp?.blast;
    if (!n || !wp || !B || ![m.x, m.y, m.z].every(Number.isFinite)) return;
    const dx = m.x - n.x, dz = m.z - n.z, d = Math.hypot(dx, dz);
    if (d > wp.range + 4 || m.y < -1 || m.y > 60) return;
    // Time of flight: the shell can't land sooner than its launch speed allows.
    if (this.time - n.t < d / (B.speed * 1.3) - 0.15) return;
    // It lands near the line it was aimed along (it may stop short on a zombie or wall).
    const ax = n.ex - n.x, az = n.ez - n.z, al = Math.hypot(ax, az);
    if (al > 1 && (Math.abs(dx * az - dz * ax) / al > 3 || (dx * ax + dz * az) / al > al + 4)) return;
    // Pull the point back off the wall face it struck before the sight checks.
    const k = d > 0.01 ? Math.max(0, d - 0.6) / d : 0;
    const bx = n.x + dx * k, bz = n.z + dz * k;
    if (!this.L.hasLOS(n.x, n.z, bx, bz, this.doors)) return;
    const power = d < B.arm ? 0.4 : 1, R = B.radius * (power < 1 ? 0.6 : 1);
    this.events.push(['blast', p.id, r2(m.x), r2(m.y), r2(m.z), power]);
    for (const z of [...this.zombies.values()]) {
      const T = ZTYPES[z.type];
      const zd = Math.max(0, Math.hypot(z.x - bx, T.scale * 0.7 - m.y, z.z - bz) - T.radius);
      if (zd > R || !this.L.hasLOS(bx, bz, z.x, z.z, this.doors)) continue;
      if (z.type === ZT.WALKER && zd < R * 0.8) {
        const a = Math.hypot(z.x - bx, z.z - bz) || 1;
        z.stun = 0.9; z.vx = ((z.x - bx) / a) * 8; z.vz = ((z.z - bz) / a) * 8; z.st = ZSTATE.STAGGER;
      }
      this.damageZombie(z, B.dmg * power * (1 - (1 - B.edge) * (zd / R)), p, false);
    }
    for (const q of this.players.values()) {
      if (q.st !== PSTATE.ALIVE || q.pinned) continue;
      const qd = Math.hypot(q.x - bx, q.z - bz);
      if (qd > R * 0.5 || qd < 0.01) continue;
      this.events.push(['kb', q.id, r2(((q.x - bx) / qd) * 6 * power), r2(((q.z - bz) / qd) * 6 * power)]);
    }
    this.alertNear(bx, bz, 30);
  }

  private onShove(p: Player): void {
    if (p.st !== PSTATE.ALIVE || p.pinned || this.time - p.lastShove < PLAYER.shoveCd * 0.8) return;
    p.lastShove = this.time;
    const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
    for (const z of [...this.zombies.values()]) {
      const dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, dz);
      const T = ZTYPES[z.type];
      if (d > PLAYER.shoveRange + T.radius || d < 0.001) continue;
      if ((dx * fx + dz * fz) / d < 0.3) continue;
      if (z.type === ZT.BRUTE) continue;
      // A shove interrupts any windup, charge, pin or ring. Chargers are heavy and barely budge.
      const kick = z.type === ZT.CHARGER ? 3 : 9;
      z.stun = z.type === ZT.WALKER ? 1.1 : 0.7;
      z.vx = (dx / d) * kick; z.vz = (dz / d) * kick;
      z.st = ZSTATE.STAGGER; z.dormant = false;
      this.damageZombie(z, 8, p, false);
    }
    this.events.push(['shove', p.id]);
  }

  private onUse(p: Player, id: number): void {
    const pk = this.def.pickups[id];
    if (!pk || p.st !== PSTATE.ALIVE || this.state !== 'play') return;
    if (Math.hypot(pk.x - p.x, pk.z - p.z) > PLAYER.useRange + 1) return;
    const s = this.cur;
    if (pk.kind === 'medkit') {
      if (this.taken.has(id) || p.medkits >= 1) return;
      this.taken.add(id); p.medkits = 1;
      this.events.push(['pk', id]);
    } else if (pk.kind === 'obj') {
      if (!s || s.kind !== 'use' || s.target !== id || this.holdout >= 0 || this.taken.has(id)) return;
      this.taken.add(id);
      this.alertNear(pk.x, pk.z, 30);
      // Holdout first so the horde's source ignores the ahead bias. Its event goes before 'use' (whose HOLD OUT banner wins).
      if (s.hold) { this.holdout = s.hold * HOLD_SCALE; if (s.horde) this.horde(); }
      this.events.push(['use', p.id, id]);
      if (!s.hold) this.completeStep();
      return;
    } else if (pk.kind === 'item') {
      if (!s || s.kind !== 'collect' || s.group !== pk.group || this.taken.has(id)) return;
      this.taken.add(id); this.collected++;
      this.events.push(['pk', id], ['item', p.id, id, this.collected, s.count ?? 0]);
      return;
    }
    // Weapons and ammo are single-use: whoever grabs it first takes it off the map.
    if (this.taken.has(id)) return;
    this.taken.add(id);
    const wi = WEAPONS.findIndex((w) => w.id === pk.kind);
    if (wi >= 0) { if (WEAPONS[wi].slot === 'sidearm') p.sidearm = wi; else p.primary = wi; }
    this.events.push(['pk', id], ['got', p.id, id]);
  }

  // ---------------------------------------------------------------- zombies
  private spawnZombie(type: number, x: number, z: number, dormant = false): Zombie {
    const T = ZTYPES[type];
    const zb: Zombie = {
      id: this.nextZid++, type, x, z, ry: rand(0, Math.PI * 2), st: dormant ? ZSTATE.IDLE : ZSTATE.RUN,
      hp: type === ZT.BRUTE ? T.hp + 700 * (this.players.size - 1) : T.hp,
      speed: T.speed * rand(0.86, 1.14), offX: rand(-0.55, 0.55), offZ: rand(-0.55, 0.55),
      t: 0, hitDone: true, target: 0, dormant, stun: 0, vx: 0, vz: 0, leapCd: rand(1, 3), lx: 0, lz: 0,
      sp: rand(1.5, 3), flee: 0, pinT: 0, acc: 0, pinHit: 0, hunt: 0,
    };
    this.zombies.set(zb.id, zb);
    return zb;
  }

  /** Keep up to `max` dormant walkers spread through the band ahead of the team, and drop ones left far behind. */
  private fillBelt(max: number): void {
    const { W } = this.L, prog = this.cd.progress;
    let dormant = 0;
    for (const z of [...this.zombies.values()]) {
      if (!z.dormant) continue;
      const c = cellOf(z.z) * W + cellOf(z.x);
      if (prog[c] < this.best - 24) { this.zombies.delete(z.id); continue; }
      dormant++;
    }
    const players = this.standing();
    for (let tries = 0; dormant < max && tries < max * 4; tries++) {
      const bucket = this.cd.byProgress[this.best + BELT_NEAR + ((Math.random() * (BELT_FAR - BELT_NEAR)) | 0)];
      if (!bucket?.length) continue;
      const c = bucket[(Math.random() * bucket.length) | 0];
      const x = (c % W + 0.5) * TILE + rand(-0.4, 0.4), z = (((c / W) | 0) + 0.5) * TILE + rand(-0.4, 0.4);
      if (!this.hidden(x, z, players, 20)) continue;
      this.spawnZombie(ZT.WALKER, x, z, true);
      dormant++;
    }
  }

  private alertNear(x: number, z: number, radius: number): void {
    for (const zb of this.zombies.values()) if (zb.dormant && Math.hypot(zb.x - x, zb.z - z) < radius) zb.dormant = false;
  }

  private damageZombie(z: Zombie, dmg: number, by: Player | null, head: boolean): void {
    if (z.hp <= 0) return;
    z.hp -= dmg;
    z.dormant = false;
    // Enough teammate fire knocks a pinning Charger off its victim.
    if (z.hp > 0 && by && z.type === ZT.CHARGER && z.st === ZSTATE.PIN) {
      z.pinHit += dmg;
      if (z.pinHit >= CHARGER.pinBreakDmg) {
        for (const q of this.players.values()) if (q.pinned === z.id) this.unpin(q);
        z.st = ZSTATE.STAGGER; z.stun = 1.2; z.vx = -z.lx * 2; z.vz = -z.lz * 2;
      }
    }
    if (z.hp > 0) return;
    this.zombies.delete(z.id);
    this.kills++;
    if (by) by.kills++;
    this.events.push(['zdie', z.id, r2(z.x), r2(z.z), z.type, head ? 1 : 0, by ? by.id : 0]);
    if (z.type === ZT.PUFFER) this.explode(z);
    if (z.type === ZT.BRUTE) this.events.push(['msg', 'The Brute is down!']);
    if (z.type === ZT.DROOLER) this.addPuddle(z.x, z.z, DROOLER.deathR, DROOLER.deathLife);
    if (z.type === ZT.ALARM && z.st === ZSTATE.RING) this.events.push(['msg', 'Alarm Clock silenced!']);
    if (z.type === ZT.CHARGER) for (const p of this.players.values()) if (p.pinned === z.id) this.unpin(p);
  }

  // ------------------------------------------------- goo, pins and alarms
  private clearHazards(): void {
    this.globs = []; this.puddles = [];
    for (const p of this.players.values()) p.pinned = 0;
  }

  private addPuddle(x: number, z: number, r: number, life: number): void {
    if (this.puddles.length >= DROOLER.maxPuddles) this.puddles.shift();
    const pd: Puddle = { id: this.nextPuddle++, x, z, r, life, age: 0, tick: DROOLER.delay };
    this.puddles.push(pd);
    this.events.push(['puddle', pd.id, r2(x), r2(z), r, life]);
  }

  /** Globs in flight land as puddles; puddles burn whoever stands in them. */
  private updateHazards(dt: number): void {
    for (let i = this.globs.length - 1; i >= 0; i--) {
      const g = this.globs[i];
      g.t -= dt;
      if (g.t > 0) continue;
      this.globs.splice(i, 1);
      this.addPuddle(g.x1, g.z1, DROOLER.puddleR, DROOLER.puddleLife);
    }
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const pd = this.puddles[i];
      pd.age += dt;
      if (pd.age >= pd.life) { this.puddles.splice(i, 1); continue; }
      if (pd.age < pd.tick) continue;
      pd.tick += DROOLER.tick;
      for (const p of this.players.values()) {
        if (p.st === PSTATE.DEAD || Math.hypot(p.x - pd.x, p.z - pd.z) > pd.r + PLAYER.radius * 0.5) continue;
        // Downed survivors can't crawl out, so the goo goes easier on them.
        const dmg = DROOLER.dps * DROOLER.tick * (p.st === PSTATE.DOWN ? 0.5 : 1);
        this.damagePlayer(p, dmg, pd.x, pd.z, true);
      }
    }
  }

  private unpin(p: Player): void {
    if (!p.pinned) return;
    p.pinned = 0;
    this.events.push(['unpin', p.id]);
  }

  /** Drop pins whose Charger is gone, stunned or no longer holding this survivor. */
  private checkPins(): void {
    for (const p of this.players.values()) {
      if (!p.pinned) continue;
      const z = this.zombies.get(p.pinned);
      if (p.st !== PSTATE.ALIVE || !z || z.st !== ZSTATE.PIN || z.target !== p.id || z.stun > 0) this.unpin(p);
    }
  }

  /**
   * Charger hit survivor `p` while rushing along (lx, lz). With a wall close behind them they
   * are slammed and pinned there; otherwise they're bowled over. Returns true for a pin.
   */
  private chargeHit(z: Zombie, p: Player): boolean {
    const T = ZTYPES[ZT.CHARGER], go = this.doors;
    this.damagePlayer(p, CHARGER.hitDmg, z.x, z.z);
    if (p.st !== PSTATE.ALIVE) return false;
    // March from the survivor along the charge until a wall stops them.
    let x = p.x, zz = p.z, wall = false;
    for (let s = 0.25; s <= CHARGER.pinWallDist; s += 0.25) {
      const nx = p.x + z.lx * s, nz = p.z + z.lz * s;
      if (this.L.boxBlocked(nx, nz, PLAYER.radius, go)) { wall = true; break; }
      x = nx; zz = nz;
    }
    if (!wall) {
      this.events.push(['kb', p.id, r2(z.lx * CHARGER.knock), r2(z.lz * CHARGER.knock)]);
      return false;
    }
    p.x = x; p.z = zz; p.pinned = z.id; p.reviving = 0;
    z.st = ZSTATE.PIN; z.target = p.id; z.pinT = 0; z.acc = 0; z.pinHit = 0;
    // Plant the Charger right in front of its victim.
    const back = T.radius + PLAYER.radius + 0.05;
    this.L.moveSlide(z, x - z.lx * back - z.x, zz - z.lz * back - z.z, T.radius, go);
    this.events.push(['pin', p.id, z.id, r2(x), r2(zz)], ['slam', z.id, r2(x), r2(zz)]);
    return true;
  }

  /** Retreat one flow-field step away from the survivors (idles when cornered). */
  private backOff(z: Zombie, mult: number, dt: number): void {
    const to = this.flowStep(z, 1);
    if (!to) { z.st = ZSTATE.IDLE; return; }
    const dx = to.x - z.x, dz = to.z - z.z, len = Math.hypot(dx, dz);
    if (len > 0.01) {
      const sp = z.speed * mult * dt;
      this.L.moveSlide(z, (dx / len) * sp, (dz / len) * sp, ZTYPES[z.type].radius, this.doors);
      z.ry = Math.atan2(-dx, -dz);
    }
    z.st = ZSTATE.RUN;
  }

  /** Next flow-field cell centre toward (dir = -1) or away from (dir = 1) the survivors, or null if stuck. */
  private flowStep(z: Zombie, dir: 1 | -1): { x: number; z: number } | null {
    const L = this.L, W = L.W, go = this.doors;
    const cx = cellOf(z.x), cz = cellOf(z.z);
    let best = this.flow[cz * W + cx], bx = cx, bz = cz;
    if (best >= INF) return null;
    for (const [ox, oz] of DIRS8) {
      const nx = cx + ox, nz = cz + oz;
      if (L.solidAt(nx, nz, go)) continue;
      if (ox && oz && (L.solidAt(cx + ox, cz, go) || L.solidAt(cx, cz + oz, go))) continue;
      const v = this.flow[nz * W + nx];
      if (v >= INF) continue;
      if (dir < 0 ? v < best : v > best) { best = v; bx = nx; bz = nz; }
    }
    if (bx === cx && bz === cz) return null;
    return { x: (bx + 0.5) * TILE + z.offX, z: (bz + 0.5) * TILE + z.offZ };
  }

  private explode(z: Zombie): void {
    const T = ZTYPES[ZT.PUFFER];
    this.events.push(['boom', r2(z.x), r2(z.z)]);
    let gooed = false;
    for (const p of this.players.values()) {
      if (p.st === PSTATE.DEAD) continue;
      if (Math.hypot(p.x - z.x, p.z - z.z) > T.boomRadius) continue;
      this.damagePlayer(p, T.boomDmg, z.x, z.z);
      this.events.push(['goo', p.id]);
      this.marks.set(p.id, this.time + GOO_HUNT);
      gooed = true;
    }
    for (const o of [...this.zombies.values()]) {
      if (o.type !== ZT.WALKER) continue;
      if (Math.hypot(o.x - z.x, o.z - z.z) < 3) this.damageZombie(o, 60, null, false);
    }
    // Like bile: the called wave comes at the gooed survivors and goes for them first.
    if (gooed) { this.recomputeMarks(); this.spawnWave(6 + this.players.size, { hunt: GOO_HUNT }); this.events.push(['msg', 'The goo is attracting more of them!']); }
  }

  /** `quiet`: damage over time (goo) that shouldn't stagger/slow the victim on their client. */
  private damagePlayer(p: Player, dmg: number, sx: number, sz: number, quiet = false): void {
    if (p.st === PSTATE.DEAD || this.state !== 'play') return;
    p.hp -= dmg;
    this.events.push(quiet ? ['sizzle', p.id, dmg] : ['hurt', p.id, dmg, r2(sx), r2(sz)]);
    if (p.hp > 0) return;
    if (p.st === PSTATE.ALIVE) {
      this.unpin(p);
      p.st = PSTATE.DOWN; p.hp = PLAYER.hp; p.revT = 0;
      this.events.push(['down', p.id]);
    } else {
      this.killPlayer(p);
    }
  }

  private killPlayer(p: Player): void {
    this.unpin(p);
    p.st = PSTATE.DEAD; p.hp = 0; p.respawnT = PLAYER.respawnTime;
    this.events.push(['dead', p.id]);
  }

  // ---------------------------------------------------- "ahead of the team"
  /** BFS distance to the current objective (recomputed when the step, doors or items change). */
  private objField = new Int16Array(1);
  private objKey = '';
  private objectiveField(): Int16Array | null {
    const s = this.cur;
    if (!s) return null;
    const key = `${this.step}|${this.doors}|${this.collected}`;
    if (key === this.objKey) return this.objField;
    this.objKey = key;
    const { W } = this.L, src: number[] = [];
    const add = (tx: number, tz: number) => { if (!this.L.solidAt(tx, tz, this.doors)) src.push(tz * W + tx); };
    if (s.kind === 'collect') {
      for (const p of this.def.pickups) if (p.kind === 'item' && p.group === s.group && !this.taken.has(p.id)) add(cellOf(p.x), cellOf(p.z));
    } else if (s.area) {
      for (let z = s.area.z0; z <= s.area.z1; z++) for (let x = s.area.x0; x <= s.area.x1; x++) add(x, z);
    } else {
      const tx = cellOf(s.at.x), tz = cellOf(s.at.z);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) add(tx + dx, tz + dz);
    }
    if (this.objField.length !== W * this.L.H) this.objField = new Int16Array(W * this.L.H);
    this.L.distanceField(src, this.doors, this.objField);
    return this.objField;
  }

  // Choose a tile to spawn on: a decent walk away, out of sight and (with probability `ahead`)
  // between the team and its objective rather than behind it.
  private pickSpawnCell(minD: number, maxD: number, ahead: number): number {
    const forward = Math.random() < ahead;
    // Stages: in range (ahead if rolled) → a bit further out → any direction further out.
    return this.trySpawnCell(minD, maxD, forward)
      ?? this.trySpawnCell(minD, maxD + 8, forward)
      ?? (forward ? this.trySpawnCell(minD + 4, maxD + 16, true) ?? this.trySpawnCell(minD, maxD + 8, false) : null)
      ?? -1;
  }

  /** `field`: path distances `minD`..`maxD` are measured on (default: to the nearest survivor). */
  private trySpawnCell(minD: number, maxD: number, forward: boolean, field = this.flow): number | null {
    const players = this.standing();
    const { W } = this.L, open = this.cd.open;
    let limit = INF;
    const obj = forward ? this.objectiveField() : null;
    if (obj) {
      let team = INF;
      for (const p of players) team = Math.min(team, obj[cellOf(p.z) * W + cellOf(p.x)]);
      if (team < INF) limit = team + 2; // no further from the objective than the lead survivor
    }
    // Sample near the team first (most open cells are far away on a big map).
    const near = this.nearCells();
    for (let tries = 0; tries < 90; tries++) {
      const c = near.length && tries < 80 ? near[(Math.random() * near.length) | 0] : open[(Math.random() * open.length) | 0];
      const d = field[c];
      if (d < minD || d > maxD) continue;
      if (obj && obj[c] > limit) continue;
      const x = (c % W + 0.5) * TILE, z = (((c / W) | 0) + 0.5) * TILE;
      if (this.hidden(x, z, players, MIN_SPAWN_DIST)) return c;
    }
    return null; // never spawn where a survivor can see it
  }

  /**
   * True if a zombie at (x, z) can't be seen by any survivor: at least `minDist` metres away,
   * and no line of sight to the body's centre or its edges, from where each survivor stands
   * or from a few metres ahead of where they are looking/walking (so a spawn isn't revealed
   * the moment they step through a doorway or turn a corner).
   */
  private hidden(x: number, z: number, players: Player[], minDist: number): boolean {
    const L = this.L, o = this.doors, e = 0.7;
    for (const p of players) {
      if (Math.hypot(p.x - x, p.z - z) < minDist) return false;
      const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
      const eyes: [number, number][] = [[p.x, p.z]];
      for (const k of [2.5, 5]) {
        const ex = p.x + fx * k, ez = p.z + fz * k;
        if (!L.solidAt(cellOf(ex), cellOf(ez), o)) eyes.push([ex, ez]); else break;
      }
      for (const [ex, ez] of eyes) {
        if (L.hasLOS(ex, ez, x, z, o) || L.hasLOS(ex, ez, x + e, z, o) || L.hasLOS(ex, ez, x - e, z, o)
          || L.hasLOS(ex, ez, x, z + e, o) || L.hasLOS(ex, ez, x, z - e, o)) return false;
      }
    }
    return true;
  }

  private nearCache: { t: number; cells: number[] } = { t: -1, cells: [] };
  /** Spawnable cells within 40 path tiles of the team (refreshed once per tick). */
  private nearCells(): number[] {
    if (this.nearCache.t === this.tickN) return this.nearCache.cells;
    const cells: number[] = [];
    for (const c of this.cd.open) if (this.flow[c] <= 40) cells.push(c);
    this.nearCache = { t: this.tickN, cells };
    return cells;
  }

  /** `ahead`: chance the spawn must be on the objective side of the team. */
  private spawnAt(type: number, minD: number, maxD: number, ahead = 0.85): Zombie | null {
    const c = this.pickSpawnCell(minD, maxD, this.holdout >= 0 ? 0 : ahead);
    if (c < 0) return null;
    const { W } = this.L;
    return this.spawnZombie(type, (c % W + 0.5) * TILE + rand(-0.5, 0.5), (((c / W) | 0) + 0.5) * TILE + rand(-0.5, 0.5));
  }

  // ------------------------------------------------------------------ waves
  private waves: Wave[] = [];
  /** Goo-marked survivors (pid → room time the mark wears off) and the BFS field toward them. */
  private marks = new Map<number, number>();
  private markFlow = new Int16Array(1);
  private noiseField = new Int16Array(1);

  private cellPos(c: number): Vec2 { const W = this.L.W; return { x: (c % W + 0.5) * TILE, z: (((c / W) | 0) + 0.5) * TILE }; }

  /** A full horde: queue it and tell clients where it's coming from. */
  private horde(): void {
    const at = this.spawnWave(12 + 4 * this.players.size);
    this.events.push(at ? ['horde', r2(at.x), r2(at.z)] : ['horde']);
  }

  /**
   * Queue `n` walkers that arrive together from one place. `noise`: cell of a noise they come from
   * (else a hidden cell a walk from the team, ahead-biased; or from the goo-marked survivors with
   * `hunt`). Big team-sourced waves sometimes split to flank from a second side. `hunt`: seconds the
   * members chase marked survivors first. Returns the main source (metres), null if none was found
   * (members then pick cells one by one, as before).
   */
  private spawnWave(n: number, o: { noise?: number; hunt?: number } = {}): Vec2 | null {
    const w: Wave = { left: n, srcs: [], anchor: o.noise ?? -1, hunt: o.hunt ? this.time + o.hunt : 0, repicks: 0 };
    const s = this.waveSource(w);
    if (s >= 0) {
      w.srcs.push(s);
      if (w.anchor < 0 && !w.hunt && n >= FLANK_MIN && Math.random() < FLANK_CHANCE) { const f = this.flankSource(s); if (f >= 0) w.srcs.push(f); }
    }
    this.waves.push(w);
    return s >= 0 ? this.cellPos(s) : null;
  }

  /** Pick (or re-pick) a wave's main source by its rule; -1 if none. */
  private waveSource(w: Wave): number {
    if (w.anchor >= 0) { const c = this.noiseSource(w.anchor); if (c >= 0) return c; }
    if (w.hunt > this.time && this.marks.size) {
      const c = this.trySpawnCell(7, 18, false, this.markFlow) ?? this.trySpawnCell(7, 26, false, this.markFlow);
      if (c !== null) return c;
    }
    return this.pickSpawnCell(8, 20, this.holdout >= 0 ? 0 : 0.75);
  }

  /**
   * The hidden spawn cell nearest (by walking) to a noise at cell `at`, within NOISE_REACH of it
   * and a walk from the team; -1 if none. Event-time only: one BFS plus a bounded number of sight tests.
   */
  private noiseSource(at: number): number {
    const { W, H } = this.L;
    if (this.noiseField.length !== W * H) this.noiseField = new Int16Array(W * H);
    const nf = this.L.distanceField([at], this.doors, this.noiseField);
    const cand: number[] = [];
    for (const c of this.nearCells()) if (nf[c] <= NOISE_REACH && this.flow[c] >= 6) cand.push(c);
    cand.sort((a, b) => nf[a] - nf[b]);
    // Cells right by the noise are usually in view (survivors are looking at it): test the
    // nearest ones, then stride further out.
    const players = this.standing();
    for (let i = 0, k = 0; i < cand.length && k < 40; i += k < 20 ? 1 : 3, k++) {
      const p = this.cellPos(cand[i]);
      if (this.hidden(p.x, p.z, players, MIN_SPAWN_DIST)) return cand[i];
    }
    return -1;
  }

  /** A second source on another side of the team from `main` (a flanking split), or -1. */
  private flankSource(main: number): number {
    const stand = this.standing();
    let cx = 0, cz = 0;
    for (const p of stand) { cx += p.x / stand.length; cz += p.z / stand.length; }
    const m = this.cellPos(main), ax = m.x - cx, az = m.z - cz, al = Math.hypot(ax, az) || 1;
    for (let i = 0; i < 4; i++) {
      const f = this.trySpawnCell(8, 22, false);
      if (f === null) return -1;
      const q = this.cellPos(f), bx = q.x - cx, bz = q.z - cz;
      // At least ~80 degrees round from the main source (as seen from the team) and well apart.
      if ((ax * bx + az * bz) / (al * (Math.hypot(bx, bz) || 1)) < 0.2 && Math.hypot(q.x - m.x, q.z - m.z) > 14) return f;
    }
    return -1;
  }

  /**
   * A hidden spawnable cell within CLUSTER tiles of source `src` and about as far from the team by
   * path (so not across a wall from it); -1 if the source is lost (seen, crowded, or left far behind).
   */
  private clusterCell(src: number, players: Player[]): number {
    const { W } = this.L, f = this.flow, fs = f[src];
    if (fs > 30) return -1;
    const sx = src % W, sz = (src / W) | 0, span = 2 * CLUSTER + 1;
    for (let i = 0; i < 10; i++) {
      const x = sx + ((Math.random() * span) | 0) - CLUSTER, z = sz + ((Math.random() * span) | 0) - CLUSTER;
      if (!this.L.inBounds(x, z)) continue;
      const c = z * W + x;
      if (!this.cd.spawnable[c] || f[c] < 5 || Math.abs(f[c] - fs) > CLUSTER + 1) continue;
      const p = this.cellPos(c);
      if (this.hidden(p.x, p.z, players, MIN_SPAWN_DIST)) return c;
    }
    return -1;
  }

  /** Spawn one member of wave `w` near one of its sources, moving a lost source (twice per wave at most) before falling back to a lone pick. */
  private spawnWaveMember(w: Wave): boolean {
    const players = this.standing();
    let c = -1;
    if (w.srcs.length) {
      const i = w.srcs.length > 1 && Math.random() < 0.35 ? 1 : 0;
      c = this.clusterCell(w.srcs[i], players);
      if (c < 0 && w.repicks < 2) {
        w.repicks++;
        const s = i ? this.flankSource(w.srcs[0]) : this.waveSource(w);
        if (s >= 0) { w.srcs[i] = s; c = this.clusterCell(s, players); }
      }
    }
    let zb: Zombie | null = null;
    if (c >= 0) {
      const p = this.cellPos(c);
      zb = this.spawnZombie(ZT.WALKER, p.x + rand(-0.5, 0.5), p.z + rand(-0.5, 0.5));
    } else zb = this.spawnAt(ZT.WALKER, 7, 18, 0.75);
    if (zb) zb.hunt = w.hunt;
    return !!zb;
  }

  /** Drop worn-off marks and rebuild the field toward the marked survivors (shared by all hunters). */
  private recomputeMarks(): void {
    if (!this.marks.size) return;
    const src: number[] = [];
    for (const [id, until] of this.marks) {
      const p = this.players.get(id);
      if (!p || p.st !== PSTATE.ALIVE || until <= this.time) { this.marks.delete(id); continue; }
      const tx = cellOf(p.x), tz = cellOf(p.z);
      if (!this.L.solidAt(tx, tz, this.doors)) src.push(tz * this.L.W + tx);
    }
    if (!this.marks.size) return;
    if (this.markFlow.length !== this.flow.length) this.markFlow = new Int16Array(this.flow.length);
    this.L.distanceField(src, this.doors, this.markFlow);
  }

  private director(dt: number): void {
    const n = this.players.size;
    const stand = this.standing();
    if (!stand.length) return;
    const allSafe = stand.every((p) => this.L.floorAt(p.x, p.z) === F.SAFE);
    if (!this.started) {
      if (allSafe) return;
      this.started = true;
    }
    // Furthest progress drives the wanderer belt.
    for (const p of stand) this.best = Math.max(this.best, this.progressAt(p.x, p.z));
    const t = this.t;
    t.belt -= dt;
    if (t.belt <= 0) { t.belt = 2; this.fillBelt(BELT_MAX); }

    let commons = 0, specials = 0;
    const byType = ZTYPES.map(() => 0);
    for (const z of this.zombies.values()) { if (z.dormant) continue; byType[z.type]++; if (z.type === ZT.WALKER) commons++; else specials++; }
    const cap = Math.min(46, 20 + 6 * n);

    if (this.pendingBrute && this.spawnAt(ZT.BRUTE, 12, 24)) { this.pendingBrute = false; this.events.push(['brute']); }

    // Drain queued hordes a walker at a time (oldest wave first), each from its wave's source.
    const wave = this.waves[0];
    if (wave) {
      t.hordeTick -= dt;
      if (t.hordeTick <= 0) {
        t.hordeTick = 0.22;
        if (commons < cap && this.spawnWaveMember(wave)) wave.left--;
        if (wave.left <= 0) this.waves.shift();
      }
    }

    if (this.holdout >= 0) {
      // Holdout: constant pressure until the timer runs out.
      t.ambient -= dt;
      if (t.ambient <= 0) { t.ambient = Math.max(0.35, 0.8 - 0.1 * n); if (commons < cap - 4) this.spawnAt(ZT.WALKER, 6, 18); }
      t.holdSpecial -= dt;
      if (t.holdSpecial <= 0) {
        t.holdSpecial = 14 - n;
        const type = specials < (n > 2 ? 3 : 2) ? this.pickSpecial(byType, true) : -1;
        if (type >= 0) this.spawnAt(type, 8, 20);
      }
      return;
    }
    // Safe rooms are a breather: no new pressure while the whole team is inside one.
    if (allSafe) return;

    t.ambient -= dt;
    if (t.ambient <= 0) {
      t.ambient = rand(1.6, 3.2) - 0.25 * n;
      if (commons < 6 + 3 * n) this.spawnAt(ZT.WALKER, 10, 22);
    }
    t.horde -= dt;
    if (t.horde <= 0) {
      t.horde = rand(90, 150);
      this.horde();
    }
    t.special -= dt;
    if (t.special <= 0) {
      t.special = rand(24, 38) - 2 * n;
      const type = specials < 1 + (n >> 1) ? this.pickSpecial(byType, false) : -1;
      if (type === ZT.ALARM) {
        // Alarm clocks lurk a bit further out so they have room to keep their distance.
        if (this.spawnAt(type, 12, 24)) this.alarmAt = this.time + 75;
      } else if (type >= 0) this.spawnAt(type, 9, 20);
    }
  }

  /**
   * Weighted pick of the next special, respecting per-type caps for the team size (-1 = none).
   * While someone is down (the team is struggling) no Chargers or Alarm Clocks join in.
   */
  private pickSpecial(byType: number[], holdout: boolean): number {
    const n = this.players.size;
    const struggling = [...this.players.values()].some((p) => p.st !== PSTATE.ALIVE);
    const big = n >= 3 ? 1 : 0;
    // [type, weight, cap]
    const table: [number, number, number][] = [
      [ZT.LEAPER, 3, 1 + big],
      [ZT.PUFFER, holdout ? 1.5 : 2.5, 1],
      [ZT.CHARGER, struggling ? 0 : 2, 1 + (n >= 4 ? 1 : 0)],
      [ZT.DROOLER, holdout ? 2.5 : 2, 1 + big],
      [ZT.ALARM, holdout || struggling || this.time < ALARM.minChapterTime || this.time < this.alarmAt ? 0 : 1.3, 1],
    ];
    let sum = 0;
    for (const e of table) { if (byType[e[0]] >= e[2]) e[1] = 0; sum += e[1]; }
    if (sum <= 0) return -1;
    let r = Math.random() * sum;
    for (const [type, w] of table) { r -= w; if (r < 0 && w > 0) return type; }
    return -1;
  }

  private recomputeFlow(): void {
    const src: number[] = [];
    let targets = this.standing();
    if (!targets.length) targets = [...this.players.values()].filter((p) => p.st === PSTATE.DOWN);
    for (const p of targets) {
      const tx = cellOf(p.x), tz = cellOf(p.z);
      if (!this.L.solidAt(tx, tz, this.doors)) src.push(tz * this.L.W + tx);
    }
    this.L.distanceField(src, this.doors, this.flow);
  }

  /** Zombies the soft separation never pushes: the Brute, and Chargers mid-rush or pinning. */
  private anchored(z: Zombie): boolean {
    return z.type === ZT.BRUTE || (z.type === ZT.CHARGER && (z.st === ZSTATE.CHARGE || z.st === ZSTATE.PIN));
  }

  private updateZombies(dt: number): void {
    const players = [...this.players.values()].filter((p) => p.st !== PSTATE.DEAD);
    const zs = [...this.zombies.values()];
    const go = this.doors, L = this.L, W = L.W;
    this.checkPins();

    for (const z of zs) {
      if (z.hp <= 0) continue;
      const T = ZTYPES[z.type];
      // Nearest standing player; fall back to a downed one.
      let tgt: Player | null = null, d = Infinity, tgtDown: Player | null = null, dDown = Infinity;
      for (const p of players) {
        const pd = Math.hypot(p.x - z.x, p.z - z.z);
        if (p.st === PSTATE.ALIVE) { if (pd < d) { d = pd; tgt = p; } } else if (pd < dDown) { dDown = pd; tgtDown = p; }
      }
      if (tgtDown && (!tgt || (dDown < T.range && d > T.range + 1))) { tgt = tgtDown; d = dDown; }
      // Goo wave members go for the nearest marked survivor while the mark lasts (they path on markFlow).
      let field = this.flow;
      if (z.hunt > this.time && this.marks.size && this.markFlow[cellOf(z.z) * W + cellOf(z.x)] < INF) {
        let mt: Player | null = null, md = Infinity;
        for (const p of players) {
          if (p.st !== PSTATE.ALIVE || !this.marks.has(p.id)) continue;
          const pd = Math.hypot(p.x - z.x, p.z - z.z);
          if (pd < md) { md = pd; mt = p; }
        }
        if (mt) { tgt = mt; d = md; field = this.markFlow; }
      }

      if (z.dormant) {
        if (tgt && (d < 5 || (d < 15 && L.hasLOS(z.x, z.z, tgt.x, tgt.z, go)))) { z.dormant = false; this.alertNear(z.x, z.z, 7); }
        else { z.st = ZSTATE.IDLE; continue; }
      }
      if (z.stun > 0) {
        z.stun -= dt;
        L.moveSlide(z, z.vx * dt, z.vz * dt, T.radius, go);
        z.vx *= 0.86; z.vz *= 0.86;
        z.st = ZSTATE.STAGGER;
        if (z.type === ZT.ALARM) z.sp = Math.max(z.sp, 6); // a shove cuts a ring short
        continue;
      }
      if (z.st === ZSTATE.STAGGER) z.st = ZSTATE.RUN;
      if (!tgt) { z.st = ZSTATE.IDLE; continue; }
      const target: Player = tgt;
      const face = () => { z.ry = Math.atan2(-(target.x - z.x), -(target.z - z.z)); };
      z.leapCd -= dt;

      if (z.st === ZSTATE.ATTACK) {
        z.t -= dt; face();
        if (!z.hitDone && z.t <= T.cd - 0.3) {
          z.hitDone = true;
          const victim = this.players.get(z.target);
          if (victim && victim.st !== PSTATE.DEAD && Math.hypot(victim.x - z.x, victim.z - z.z) < T.range + 0.6) {
            const wasUp = victim.st === PSTATE.ALIVE;
            this.damagePlayer(victim, wasUp ? T.dmg : T.dmg * 1.5, z.x, z.z);
            if (z.type === ZT.BRUTE && wasUp) {
              const k = Math.hypot(victim.x - z.x, victim.z - z.z) || 1;
              this.events.push(['kb', victim.id, r2(((victim.x - z.x) / k) * 13), r2(((victim.z - z.z) / k) * 13)]);
            }
          }
        }
        if (z.t <= 0) z.st = ZSTATE.RUN;
        continue;
      }
      if (z.st === ZSTATE.WINDUP) {
        z.t -= dt; face();
        if (z.t <= 0) {
          const k = d || 1; z.lx = (target.x - z.x) / k; z.lz = (target.z - z.z) / k;
          if (z.type === ZT.CHARGER) { z.st = ZSTATE.CHARGE; z.t = CHARGER.maxTime; }
          else if (z.type === ZT.DROOLER) {
            z.st = ZSTATE.RUN; z.sp = DROOLER.cooldown * rand(0.85, 1.2);
            // Lob at where the survivor stands now (no lead), so stepping aside always works.
            if (L.hasLOS(z.x, z.z, target.x, target.z, go)) {
              const flight = Math.max(0.6, Math.min(1.6, d / DROOLER.globSpeed));
              this.globs.push({ x1: target.x, z1: target.z, t: flight });
              this.events.push(['spit', z.id, r2(z.x), r2(z.z), r2(target.x), r2(target.z), r2(flight)]);
            }
          } else { z.st = ZSTATE.LEAP; z.t = 0.75; }
        }
        continue;
      }
      if (z.st === ZSTATE.CHARGE) {
        z.t -= dt;
        const bx = z.x, bz = z.z, step = CHARGER.speed * dt;
        L.moveSlide(z, z.lx * step, z.lz * step, T.radius, go);
        z.ry = Math.atan2(-z.lx, -z.lz);
        // Walkers in the way get bowled aside.
        for (const o of zs) {
          if (o === z || o.hp <= 0 || o.type === ZT.BRUTE || o.type === ZT.CHARGER) continue;
          const ox = o.x - z.x, oz = o.z - z.z, od = Math.hypot(ox, oz);
          if (od > T.radius + ZTYPES[o.type].radius + 0.3) continue;
          const side = ox * z.lz - oz * z.lx >= 0 ? 1 : -1; // which side of the charge line
          o.dormant = false; o.stun = 0.9; o.st = ZSTATE.STAGGER;
          o.vx = z.lz * side * 8 + z.lx * 4; o.vz = -z.lx * side * 8 + z.lz * 4;
        }
        let hit = false;
        for (const p of players) {
          if (p.st !== PSTATE.ALIVE || p.pinned || Math.hypot(p.x - z.x, p.z - z.z) > T.radius + PLAYER.radius + 0.35) continue;
          hit = true;
          if (!this.chargeHit(z, p)) { z.st = ZSTATE.RUN; z.stun = CHARGER.skidStun; z.vx = z.lx * 3; z.vz = z.lz * 3; }
          break;
        }
        if (hit) { z.sp = CHARGER.cooldown; continue; }
        const moved = (z.x - bx) * z.lx + (z.z - bz) * z.lz;
        if (moved < step * 0.5) {
          // Ran into a wall: dazed for a good while (the big punish window).
          z.st = ZSTATE.STAGGER; z.stun = CHARGER.wallStun; z.vx = -z.lx * 2; z.vz = -z.lz * 2; z.sp = CHARGER.cooldown;
          this.events.push(['slam', z.id, r2(z.x), r2(z.z)]);
        } else if (z.t <= 0) {
          z.st = ZSTATE.RUN; z.stun = CHARGER.skidStun; z.vx = z.lx * 5; z.vz = z.lz * 5; z.sp = CHARGER.cooldown;
        }
        continue;
      }
      if (z.st === ZSTATE.PIN) {
        const victim = this.players.get(z.target);
        if (!victim || victim.pinned !== z.id || victim.st !== PSTATE.ALIVE) { z.st = ZSTATE.RUN; continue; }
        z.pinT += dt; z.acc += dt;
        z.ry = Math.atan2(-(victim.x - z.x), -(victim.z - z.z));
        if (z.acc >= 0.5) { z.acc -= 0.5; this.damagePlayer(victim, CHARGER.pinDps * 0.5, z.x, z.z); }
        // Teammates break pins by shoving, killing it, or dealing CHARGER.pinBreakDmg (see damageZombie). With nobody able to help, it lets go on its own.
        let helpers = 0;
        for (const p of players) if (p !== victim && p.st === PSTATE.ALIVE && !p.pinned) helpers++;
        if (victim.pinned === z.id && (z.pinT >= CHARGER.pinMax || (!helpers && z.pinT >= CHARGER.soloPinBreak))) {
          this.unpin(victim);
          z.st = ZSTATE.STAGGER; z.stun = 1.2; z.vx = -z.lx * 2; z.vz = -z.lz * 2;
        }
        continue;
      }
      if (z.st === ZSTATE.RING) {
        z.t -= dt; face();
        if (z.t <= 0) {
          // Rang out: sleepers for streets around wake, and a mini-horde comes from round the clock.
          this.alertNear(z.x, z.z, 25);
          this.spawnWave(5 + 3 * this.players.size, { noise: cellOf(z.z) * W + cellOf(z.x) });
          this.events.push(['alarm', z.id, r2(z.x), r2(z.z)]);
          z.st = ZSTATE.RUN; z.flee = ALARM.flee; z.sp = ALARM.cooldown;
        }
        continue;
      }
      if (z.st === ZSTATE.LEAP) {
        z.t -= dt;
        const bx = z.x, bz = z.z, step = 17 * dt;
        L.moveSlide(z, z.lx * step, z.lz * step, T.radius, go);
        let done = z.t <= 0 || Math.hypot(z.x - bx, z.z - bz) < step * 0.5;
        for (const p of players) {
          if (p.st !== PSTATE.ALIVE || Math.hypot(p.x - z.x, p.z - z.z) > 1.15) continue;
          this.damagePlayer(p, T.leapDmg, z.x, z.z);
          this.events.push(['kb', p.id, r2(z.lx * 9), r2(z.lz * 9)]);
          done = true; break;
        }
        if (done) { z.st = ZSTATE.RUN; z.leapCd = 4.5; }
        continue;
      }

      if (z.type === ZT.PUFFER && target.st === PSTATE.ALIVE && d < T.range) { this.damageZombie(z, 9999, null, false); continue; }
      z.sp -= dt;
      if (z.type === ZT.CHARGER && target.st === PSTATE.ALIVE && !target.pinned && z.sp <= 0 && d > CHARGER.minRange && d < CHARGER.maxRange
        && L.hasLOS(z.x, z.z, target.x, target.z, go)) {
        z.st = ZSTATE.WINDUP; z.t = CHARGER.windup; face();
        continue;
      }
      // Never spit at someone who can't step out of it (downed or pinned).
      if (z.type === ZT.DROOLER && z.sp <= 0 && target.st === PSTATE.ALIVE && !target.pinned && d > DROOLER.minRange && d < DROOLER.maxRange && L.hasLOS(z.x, z.z, target.x, target.z, go)) {
        z.st = ZSTATE.WINDUP; z.t = DROOLER.windup; face();
        continue;
      }
      if (z.type === ZT.ALARM) {
        const sees = d < ALARM.ringRange && L.hasLOS(z.x, z.z, target.x, target.z, go);
        if (z.flee <= 0 && z.sp <= 0 && target.st === PSTATE.ALIVE && sees) {
          z.st = ZSTATE.RING; z.t = ALARM.ringTime; face();
          this.events.push(['ring', z.id]);
          continue;
        }
        z.flee -= dt;
        // Keep its distance: back off when close or after ringing, creep closer when it can't see anyone.
        const away = z.flee > 0 || (d < ALARM.keepAway && sees);
        if (!away && sees && d < ALARM.keepAway + 7) { z.st = ZSTATE.IDLE; face(); continue; }
        if (away) { this.backOff(z, 1.15, dt); continue; }
      }
      if (z.type === ZT.DROOLER && d < DROOLER.keepAway && d > T.range && L.hasLOS(z.x, z.z, target.x, target.z, go)) {
        this.backOff(z, 0.9, dt); continue;
      }
      if (z.type === ZT.DROOLER && d < DROOLER.maxRange - 6 && d >= DROOLER.keepAway && L.hasLOS(z.x, z.z, target.x, target.z, go)) {
        z.st = ZSTATE.IDLE; face(); continue; // in its comfort band: wait for the next spit
      }
      if (z.type === ZT.LEAPER && target.st === PSTATE.ALIVE && z.leapCd <= 0 && d > 4.5 && d < 12 && L.hasLOS(z.x, z.z, target.x, target.z, go)) {
        z.st = ZSTATE.WINDUP; z.t = 0.6; face();
        continue;
      }
      if (T.dmg > 0 && d < T.range) {
        z.st = ZSTATE.ATTACK; z.t = T.cd; z.hitDone = false; z.target = target.id; face();
        continue;
      }

      // Movement: beeline when close and visible, otherwise follow the flow field.
      let dx = 0, dz = 0;
      if (d < 6 && L.hasLOS(z.x, z.z, target.x, target.z, go)) { dx = target.x - z.x; dz = target.z - z.z; }
      else {
        const cx = cellOf(z.x), cz = cellOf(z.z);
        let best = field[cz * W + cx], bx = cx, bz = cz;
        if (best >= INF) { z.st = ZSTATE.IDLE; continue; }
        for (const [ox, oz] of DIRS8) {
          const nx = cx + ox, nz = cz + oz;
          if (L.solidAt(nx, nz, go)) continue;
          if (ox && oz && (L.solidAt(cx + ox, cz, go) || L.solidAt(cx, cz + oz, go))) continue;
          const v = field[nz * W + nx];
          if (v < best) { best = v; bx = nx; bz = nz; }
        }
        dx = (bx + 0.5) * TILE + z.offX - z.x; dz = (bz + 0.5) * TILE + z.offZ - z.z;
      }
      const len = Math.hypot(dx, dz);
      if (len > 0.01) {
        const sp = z.speed * (this.holdout >= 0 || d > 16 ? 1.12 : 1) * dt;
        L.moveSlide(z, (dx / len) * sp, (dz / len) * sp, T.radius, go);
        z.ry = Math.atan2(-dx, -dz);
      }
      z.st = ZSTATE.RUN;
    }

    // Soft separation so the horde doesn't collapse into one blob.
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i];
      if (a.dormant || a.hp <= 0) continue;
      const ra = ZTYPES[a.type].radius;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        if (b.hp <= 0) continue;
        const rb = ZTYPES[b.type].radius, min = ra + rb;
        const dx = b.x - a.x, dz = b.z - a.z;
        if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        const push = (min - d) * 0.5, nx = d > 0.001 ? dx / d : 1, nz = d > 0.001 ? dz / d : 0;
        if (!this.anchored(a)) L.moveSlide(a, -nx * push, -nz * push, ra, go);
        if (!this.anchored(b) && !b.dormant) L.moveSlide(b, nx * push, nz * push, rb, go);
      }
    }

    // Cull stragglers that are hopelessly far behind so the director can reuse them.
    if (this.tickN % 60 === 0) {
      for (const z of zs) {
        if (z.dormant || z.type === ZT.BRUTE || z.hp <= 0) continue;
        if (this.flow[cellOf(z.z) * W + cellOf(z.x)] > 34) this.zombies.delete(z.id);
      }
    }
  }

  private updatePlayers(dt: number): void {
    const all = [...this.players.values()];
    const revived = new Set<number>();
    for (const p of all) {
      if (p.st !== PSTATE.ALIVE || !p.reviving) continue;
      const tg = this.players.get(p.reviving);
      if (!tg || tg.st !== PSTATE.DOWN || Math.hypot(tg.x - p.x, tg.z - p.z) > PLAYER.useRange + 0.8) continue;
      if (revived.has(tg.id)) continue;
      revived.add(tg.id);
      tg.revT += dt;
      if (tg.revT >= PLAYER.reviveTime) {
        tg.st = PSTATE.ALIVE; tg.hp = 30; tg.revT = 0; p.reviving = 0;
        this.events.push(['revived', tg.id, p.id]);
      }
    }
    for (const p of all) {
      if (p.st === PSTATE.DOWN) {
        if (!revived.has(p.id)) { p.revT = 0; p.hp -= PLAYER.bleedRate * dt; }
        if (p.hp <= 0) this.killPlayer(p);
      } else if (p.st === PSTATE.DEAD) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          const mate = this.standing()[0];
          if (mate) {
            p.st = PSTATE.ALIVE; p.hp = 50; p.x = mate.x; p.z = mate.z; p.y = 0;
            this.events.push(['tp', p.id, r2(p.x), r2(p.z), mate.ry], ['msg', `${p.name} is back in the fight!`]);
          } else p.respawnT = 1;
        }
      }
    }
  }

  private checkEnd(): void {
    if (!this.players.size || this.standing().length) return;
    this.state = 'lost'; this.endTimer = this.checkpoint ? 6 : 9;
    this.events.push(['end', 0, this.kills, Math.round(this.time)]);
  }

  // ------------------------------------------------------------------- tick
  tick(dt: number): void {
    this.tickN++;
    if (!this.players.size) return;
    this.time += dt;
    if (this.state === 'play') {
      this.updatePlayers(dt);
      this.updateHazards(dt);
      this.t.flow -= dt;
      if (this.t.flow <= 0) { this.t.flow = 0.25; this.recomputeFlow(); this.recomputeMarks(); }
      this.director(dt);
      this.updateZombies(dt);
      if (this.state === 'play') this.updateQuest(dt);
      if (this.state === 'play') this.checkEnd();
    } else {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        if (this.state === 'won') { this.loadChapter(this.ch + 1); this.reset(false); }
        else this.reset(!!this.checkpoint);
      }
    }
    if (this.tickN % SNAP_EVERY === 0) this.snapshot();
  }

  private snapshot(): void {
    const p: PlayerSnap[] = [];
    for (const q of this.players.values()) {
      p.push([q.id, r2(q.x), r2(q.y), r2(q.z), r2(q.ry), r2(q.rx), Math.ceil(q.hp), q.st, q.w, q.medkits,
        r2(q.revT / PLAYER.reviveTime), q.anim, q.st === PSTATE.DEAD ? Math.ceil(q.respawnT) : 0]);
    }
    const z: ZombieSnap[] = [];
    for (const q of this.zombies.values()) z.push([q.id, q.type, r2(q.x), r2(q.z), r2(q.ry), q.st]);
    this.broadcast({ t: 's', st: this.state, g: this.doors, ho: this.holdout >= 0 ? Math.ceil(this.holdout) : -1, q: this.step, qc: this.collected, p, z, ev: this.events });
    this.events = [];
  }
}
