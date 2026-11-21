// One co-op session: authoritative zombies, director, health, pickups and the
// chapter's quest steps. Players are trusted for their own movement and hit
// claims (validated loosely).
import type { WebSocket } from 'ws';
import { TILE, TICK_HZ, SNAP_EVERY, MAX_PLAYERS, PLAYER, WEAPONS, HEAD_MULT, ZTYPES, ZT, ZSTATE, PSTATE, SURVIVORS } from '../shared/constants';
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

export interface Player {
  id: number; ws: WebSocket; name: string; look: number;
  x: number; y: number; z: number; ry: number; rx: number;
  hp: number; st: number; medkits: number; w: number; anim: number;
  revT: number; reviving: number; respawnT: number; lastFire: number; lastShove: number; kills: number;
}

interface Zombie {
  id: number; type: number; x: number; z: number; ry: number; st: number; hp: number; speed: number;
  offX: number; offZ: number; t: number; hitDone: boolean; target: number; dormant: boolean;
  stun: number; vx: number; vz: number; leapCd: number; lx: number; lz: number;
}

/** Per-chapter static data the director needs. */
interface ChapterData {
  L: Level;
  progress: Int16Array; // BFS distance from the start with every door open
  /** Spawnable cells (not safe rooms/doors) bucketed by progress. */
  byProgress: number[][];
  open: number[];
}
const chapterData = new Map<number, ChapterData>();
function dataFor(ch: number): ChapterData {
  let d = chapterData.get(ch);
  if (d) return d;
  const L = getLevel(ch), { W, H } = L, def = L.def;
  const progress = L.distanceField([def.startCell.z * W + def.startCell.x], ALL_OPEN);
  const byProgress: number[][] = [], open: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (def.solid[i] || def.floor[i] === F.SAFE || def.doorCell[i] >= 0 || progress[i] >= INF) continue;
    open.push(i);
    (byProgress[progress[i]] ??= []).push(i);
  }
  d = { L, progress, byProgress, open };
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
  private t = { flow: 0, ambient: 3, horde: 90, special: 25, hordeLeft: 0, hordeTick: 0, holdSpecial: 8, belt: 0 };

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
    this.t = { flow: 0, ambient: 3, horde: rand(80, 110), special: rand(20, 30), hordeLeft: 0, hordeTick: 0, holdSpecial: 8, belt: 0 };
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
      revT: 0, reviving: 0, respawnT: 0, lastFire: 0, lastShove: 0 });
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
    if (s.horde) { this.spawnWave(12 + 4 * this.players.size); this.events.push(['horde']); }
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
      Object.assign(p, { x: s.x, z: s.z, st: PSTATE.ALIVE, hp: PLAYER.hp });
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
        if (p.st === PSTATE.ALIVE) { p.x = m.x; p.y = m.y; p.z = m.z; }
        p.ry = m.ry; p.rx = m.rx; p.w = m.w | 0; p.anim = m.a | 0;
        break;
      }
      case 'f': this.onFire(p, m); break;
      case 'v': this.onShove(p); break;
      case 'u': this.onUse(p, m.id | 0); break;
      case 'h': {
        if (p.st !== PSTATE.ALIVE || p.medkits < 1 || p.hp >= PLAYER.hp) return;
        p.medkits--; p.hp = Math.min(PLAYER.hp, p.hp + PLAYER.healAmount);
        this.events.push(['heal', p.id]);
        break;
      }
      case 'r': p.reviving = m.id | 0; break;
      case 'dbg': if (this.allowDebug && this.state === 'play') this.debugJump(m.step); break;
    }
  }
  private onFire(p: Player, m: Extract<ClientMsg, { t: 'f' }>): void {
    const wp = WEAPONS[m.w | 0];
    if (!wp || p.st !== PSTATE.ALIVE || this.state !== 'play') return;
    if (this.time - p.lastFire < wp.rate * 0.55) return;
    p.lastFire = this.time;
    if (Array.isArray(m.e) && m.e.length === 3 && m.e.every(Number.isFinite)) this.events.push(['shot', p.id, m.w | 0, r2(m.e[0]), r2(m.e[1]), r2(m.e[2])]);
    if (!Array.isArray(m.h)) return;
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
    this.alertNear(p.x, p.z, 22);
  }

  private onShove(p: Player): void {
    if (p.st !== PSTATE.ALIVE || this.time - p.lastShove < PLAYER.shoveCd * 0.8) return;
    p.lastShove = this.time;
    const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
    for (const z of [...this.zombies.values()]) {
      const dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, dz);
      const T = ZTYPES[z.type];
      if (d > PLAYER.shoveRange + T.radius || d < 0.001) continue;
      if ((dx * fx + dz * fz) / d < 0.3) continue;
      if (z.type === ZT.BRUTE) continue;
      z.stun = z.type === ZT.WALKER ? 1.1 : 0.7;
      z.vx = (dx / d) * 9; z.vz = (dz / d) * 9;
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
      this.events.push(['use', p.id, id]);
      this.alertNear(pk.x, pk.z, 30);
      if (s.hold) { this.holdout = s.hold * HOLD_SCALE; this.t.hordeLeft = 0; } else this.completeStep();
      return;
    } else if (pk.kind === 'item') {
      if (!s || s.kind !== 'collect' || s.group !== pk.group || this.taken.has(id)) return;
      this.taken.add(id); this.collected++;
      this.events.push(['pk', id], ['item', p.id, id, this.collected, s.count ?? 0]);
      return;
    }
    this.events.push(['got', p.id, id]);
  }

  // ---------------------------------------------------------------- zombies
  private spawnZombie(type: number, x: number, z: number, dormant = false): Zombie {
    const T = ZTYPES[type];
    const zb: Zombie = {
      id: this.nextZid++, type, x, z, ry: rand(0, Math.PI * 2), st: dormant ? ZSTATE.IDLE : ZSTATE.RUN,
      hp: type === ZT.BRUTE ? T.hp + 700 * (this.players.size - 1) : T.hp,
      speed: T.speed * rand(0.86, 1.14), offX: rand(-0.55, 0.55), offZ: rand(-0.55, 0.55),
      t: 0, hitDone: true, target: 0, dormant, stun: 0, vx: 0, vz: 0, leapCd: rand(1, 3), lx: 0, lz: 0,
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
    if (z.hp > 0) return;
    this.zombies.delete(z.id);
    this.kills++;
    if (by) by.kills++;
    this.events.push(['zdie', z.id, r2(z.x), r2(z.z), z.type, head ? 1 : 0, by ? by.id : 0]);
    if (z.type === ZT.PUFFER) this.explode(z);
    if (z.type === ZT.BRUTE) this.events.push(['msg', 'The Brute is down!']);
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
      gooed = true;
    }
    for (const o of [...this.zombies.values()]) {
      if (o.type !== ZT.WALKER) continue;
      if (Math.hypot(o.x - z.x, o.z - z.z) < 3) this.damageZombie(o, 60, null, false);
    }
    if (gooed) { this.spawnWave(6 + this.players.size); this.events.push(['msg', 'The goo is attracting more of them!']); }
  }

  private damagePlayer(p: Player, dmg: number, sx: number, sz: number): void {
    if (p.st === PSTATE.DEAD || this.state !== 'play') return;
    p.hp -= dmg;
    this.events.push(['hurt', p.id, dmg, r2(sx), r2(sz)]);
    if (p.hp > 0) return;
    if (p.st === PSTATE.ALIVE) {
      p.st = PSTATE.DOWN; p.hp = PLAYER.hp; p.revT = 0;
      this.events.push(['down', p.id]);
    } else {
      this.killPlayer(p);
    }
  }

  private killPlayer(p: Player): void {
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

  private trySpawnCell(minD: number, maxD: number, forward: boolean): number | null {
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
      const d = this.flow[c];
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

  private spawnWave(n: number): void { this.t.hordeLeft += n; }

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
    for (const z of this.zombies.values()) { if (z.dormant) continue; if (z.type === ZT.WALKER) commons++; else specials++; }
    const cap = Math.min(46, 20 + 6 * n);

    if (this.pendingBrute && this.spawnAt(ZT.BRUTE, 12, 24)) { this.pendingBrute = false; this.events.push(['brute']); }

    // Drain queued horde spawns a few at a time.
    if (t.hordeLeft > 0) {
      t.hordeTick -= dt;
      if (t.hordeTick <= 0) {
        t.hordeTick = 0.22;
        if (commons < cap && this.spawnAt(ZT.WALKER, 7, 18, 0.75)) t.hordeLeft--;
      }
    }

    if (this.holdout >= 0) {
      // Holdout: constant pressure until the timer runs out.
      t.ambient -= dt;
      if (t.ambient <= 0) { t.ambient = Math.max(0.35, 0.8 - 0.1 * n); if (commons < cap - 4) this.spawnAt(ZT.WALKER, 6, 18); }
      t.holdSpecial -= dt;
      if (t.holdSpecial <= 0) { t.holdSpecial = 14; if (specials < 2) this.spawnAt(Math.random() < 0.5 ? ZT.LEAPER : ZT.PUFFER, 8, 20); }
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
      this.spawnWave(12 + 4 * n);
      this.events.push(['horde']);
    }
    t.special -= dt;
    if (t.special <= 0) {
      t.special = rand(24, 38) - 2 * n;
      if (specials < 1 + (n > 2 ? 1 : 0)) this.spawnAt(Math.random() < 0.55 ? ZT.LEAPER : ZT.PUFFER, 9, 20);
    }
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

  private updateZombies(dt: number): void {
    const players = [...this.players.values()].filter((p) => p.st !== PSTATE.DEAD);
    const zs = [...this.zombies.values()];
    const go = this.doors, L = this.L, W = L.W;

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

      if (z.dormant) {
        if (tgt && (d < 5 || (d < 15 && L.hasLOS(z.x, z.z, tgt.x, tgt.z, go)))) { z.dormant = false; this.alertNear(z.x, z.z, 7); }
        else { z.st = ZSTATE.IDLE; continue; }
      }
      if (z.stun > 0) {
        z.stun -= dt;
        L.moveSlide(z, z.vx * dt, z.vz * dt, T.radius, go);
        z.vx *= 0.86; z.vz *= 0.86;
        z.st = ZSTATE.STAGGER;
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
          z.st = ZSTATE.LEAP; z.t = 0.75;
          const k = d || 1; z.lx = (target.x - z.x) / k; z.lz = (target.z - z.z) / k;
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
        let best = this.flow[cz * W + cx], bx = cx, bz = cz;
        if (best >= INF) { z.st = ZSTATE.IDLE; continue; }
        for (const [ox, oz] of DIRS8) {
          const nx = cx + ox, nz = cz + oz;
          if (L.solidAt(nx, nz, go)) continue;
          if (ox && oz && (L.solidAt(cx + ox, cz, go) || L.solidAt(cx, cz + oz, go))) continue;
          const v = this.flow[nz * W + nx];
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
        if (a.type !== ZT.BRUTE) L.moveSlide(a, -nx * push, -nz * push, ra, go);
        if (b.type !== ZT.BRUTE && !b.dormant) L.moveSlide(b, nx * push, nz * push, rb, go);
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
      this.t.flow -= dt;
      if (this.t.flow <= 0) { this.t.flow = 0.25; this.recomputeFlow(); }
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
