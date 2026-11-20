// One co-op session: authoritative zombies, director, health, pickups.
// Players are trusted for their own movement and hit claims (validated loosely).
import type { WebSocket } from 'ws';
import { TILE, TICK_HZ, SNAP_EVERY, MAX_PLAYERS, PLAYER, WEAPONS, HEAD_MULT, ZTYPES, ZT, ZSTATE, PSTATE, SURVIVORS } from '../shared/constants';
import { MAP, F, cellOf, solidAt, floorAt, moveSlide, hasLOS, distanceField } from '../shared/map';
import type { ClientMsg, GameEvent, PlayerSnap, ServerMsg, ZombieSnap } from '../shared/protocol';

const { W, H } = MAP;
const INF = 32767;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r2 = (v: number) => Math.round(v * 100) / 100;

// Static "how far along the level is this tile" field (gate treated as open).
const PROGRESS = distanceField([MAP.startCell.z * W + MAP.startCell.x], true);
const PROGRESS_MAX = PROGRESS[MAP.endCell.z * W + MAP.endCell.x];
const OPEN_CELLS: number[] = [];
for (let i = 0; i < W * H; i++) {
  const f = MAP.floor[i];
  if (!MAP.solid[i] && f !== F.SAFE_A && f !== F.SAFE_B && f !== F.GATE && PROGRESS[i] < INF) OPEN_CELLS.push(i);
}
// Overridable so the smoke test doesn't have to sit through the whole finale.
const HOLDOUT_SECONDS = Number(process.env.HOLDOUT_SECONDS) || 55;
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

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

export class Room {
  players = new Map<number, Player>();
  zombies = new Map<number, Zombie>();
  private nextPid = 1;
  private nextZid = 1;
  private flow = new Int16Array(W * H);
  private tickN = 0;
  private interval: ReturnType<typeof setInterval>;
  private gateOpen = false;
  private state: 'play' | 'won' | 'lost' = 'play';
  private endTimer = 0;
  private started = false;
  private holdout = -1; // seconds left; -1 = not triggered
  private holdDone = false;
  private taken = new Set<number>();
  private events: GameEvent[] = [];
  private time = 0;
  private bruteSpawned = false;
  private kills = 0;
  private t = { flow: 0, ambient: 3, horde: 50, special: 25, hordeLeft: 0, hordeTick: 0, holdSpecial: 8 };

  constructor(public code: string) {
    this.reset();
    this.interval = setInterval(() => this.tick(1 / TICK_HZ), 1000 / TICK_HZ);
  }

  destroy(): void { clearInterval(this.interval); }

  // ------------------------------------------------------------------ setup
  reset(): void {
    this.zombies = new Map();
    this.nextZid = 1;
    this.gateOpen = false;
    this.state = 'play';
    this.endTimer = 0;
    this.started = false;
    this.holdout = -1;
    this.holdDone = false;
    this.taken = new Set();
    this.events = [['reset']];
    this.time = 0;
    this.bruteSpawned = false;
    this.kills = 0;
    this.t = { flow: 0, ambient: 3, horde: rand(45, 60), special: rand(20, 30), hordeLeft: 0, hordeTick: 0, holdSpecial: 8 };
    let slot = 0;
    for (const p of this.players.values()) this.spawnPlayer(p, slot++);
    this.spawnWanderers();
  }

  private spawnPlayer(p: Player, slot: number): void {
    const s = MAP.spawns[slot % MAP.spawns.length];
    Object.assign(p, { x: s.x, y: 0, z: s.z, ry: Math.PI, rx: 0, hp: PLAYER.hp, st: PSTATE.ALIVE, medkits: 0, w: 0, anim: 0,
      revT: 0, reviving: 0, respawnT: 0, lastFire: 0, lastShove: 0, kills: 0 });
    this.events.push(['tp', p.id, s.x, s.z, Math.PI]);
  }

  addPlayer(ws: WebSocket, name: string): Player | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map((p) => p.look));
    let look = 0;
    while (used.has(look)) look++;
    const p = { id: this.nextPid++, ws, name: name || SURVIVORS[look].name, look } as Player;
    const mate = this.standing()[0];
    this.players.set(p.id, p);
    this.spawnPlayer(p, look);
    // Late joiners start beside the team if the run is already under way.
    if (this.started && mate) {
      p.x = mate.x; p.z = mate.z;
      this.events.pop();
      this.events.push(['tp', p.id, p.x, p.z, mate.ry]);
    }
    this.send(p, { t: 'w', id: p.id, room: this.code, taken: [...this.taken], gate: this.gateOpen ? 1 : 0, x: p.x, z: p.z });
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
    const pk = MAP.pickups[id];
    if (!pk || p.st !== PSTATE.ALIVE) return;
    if (Math.hypot(pk.x - p.x, pk.z - p.z) > PLAYER.useRange + 1) return;
    if (pk.kind === 'medkit') {
      if (this.taken.has(id) || p.medkits >= 1) return;
      this.taken.add(id); p.medkits = 1;
      this.events.push(['pk', id]);
    } else if (pk.kind === 'gen') {
      if (this.holdout >= 0 || this.holdDone) return;
      this.holdout = HOLDOUT_SECONDS;
      this.t.hordeLeft = 0;
      this.events.push(['holdstart', p.id]);
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

  private spawnWanderers(): void {
    for (let i = 0; i < 34; i++) {
      const c = OPEN_CELLS[(Math.random() * OPEN_CELLS.length) | 0];
      if (PROGRESS[c] < 12) continue; // keep the doorstep of the safe room quiet
      this.spawnZombie(ZT.WALKER, (c % W + 0.5) * TILE + rand(-0.4, 0.4), (((c / W) | 0) + 0.5) * TILE + rand(-0.4, 0.4), true);
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

  // Choose a tile to spawn on: a decent walk away and, ideally, out of sight.
  private pickSpawnCell(minD: number, maxD: number): number {
    const players = this.standing();
    let fallback = -1, fallbackD = 0;
    for (let tries = 0; tries < 60; tries++) {
      const c = OPEN_CELLS[(Math.random() * OPEN_CELLS.length) | 0];
      const d = this.flow[c];
      if (d < minD || d > maxD) continue;
      const x = (c % W + 0.5) * TILE, z = (((c / W) | 0) + 0.5) * TILE;
      let seen = false;
      for (const p of players) if (hasLOS(p.x, p.z, x, z, this.gateOpen)) { seen = true; break; }
      if (!seen) return c;
      if (d > fallbackD) { fallbackD = d; fallback = c; }
    }
    return fallbackD >= 13 ? fallback : -1;
  }

  private spawnAt(type: number, minD: number, maxD: number): Zombie | null {
    const c = this.pickSpawnCell(minD, maxD);
    if (c < 0) return null;
    return this.spawnZombie(type, (c % W + 0.5) * TILE + rand(-0.5, 0.5), (((c / W) | 0) + 0.5) * TILE + rand(-0.5, 0.5));
  }

  private spawnWave(n: number): void { this.t.hordeLeft += n; }

  private director(dt: number): void {
    const n = this.players.size;
    const stand = this.standing();
    if (!stand.length) return;
    if (!this.started) {
      if (!stand.some((p) => floorAt(p.x, p.z) !== F.SAFE_A)) return;
      this.started = true;
      this.events.push(['msg', 'Reach the safe house. Stick together!']);
    }
    let commons = 0, specials = 0;
    for (const z of this.zombies.values()) { if (z.dormant) continue; if (z.type === ZT.WALKER) commons++; else specials++; }
    const cap = Math.min(46, 20 + 6 * n);
    const t = this.t;

    // Drain queued horde spawns a few at a time.
    if (t.hordeLeft > 0) {
      t.hordeTick -= dt;
      if (t.hordeTick <= 0) {
        t.hordeTick = 0.22;
        if (commons < cap && this.spawnAt(ZT.WALKER, 7, 18)) t.hordeLeft--;
      }
    }

    if (this.holdout >= 0) {
      // Holdout: constant pressure until the gate opens.
      this.holdout -= dt;
      t.ambient -= dt;
      if (t.ambient <= 0) { t.ambient = Math.max(0.35, 0.8 - 0.1 * n); if (commons < cap - 4) this.spawnAt(ZT.WALKER, 6, 18); }
      t.holdSpecial -= dt;
      if (t.holdSpecial <= 0) { t.holdSpecial = 14; if (specials < 2) this.spawnAt(Math.random() < 0.5 ? ZT.LEAPER : ZT.PUFFER, 8, 20); }
      if (this.holdout <= 0) {
        this.holdout = -1; this.holdDone = true; this.gateOpen = true;
        this.events.push(['gate']);
      }
      return;
    }

    t.ambient -= dt;
    if (t.ambient <= 0) {
      t.ambient = rand(1.6, 3.2) - 0.25 * n;
      if (commons < 6 + 3 * n) this.spawnAt(ZT.WALKER, 9, 20);
    }
    t.horde -= dt;
    if (t.horde <= 0) {
      t.horde = rand(55, 80);
      this.spawnWave(12 + 4 * n);
      this.events.push(['horde']);
    }
    t.special -= dt;
    if (t.special <= 0) {
      t.special = rand(24, 38) - 2 * n;
      if (specials < 1 + (n > 2 ? 1 : 0)) this.spawnAt(Math.random() < 0.55 ? ZT.LEAPER : ZT.PUFFER, 9, 20);
    }
    if (!this.bruteSpawned) {
      let best = 0;
      for (const p of stand) { const c = cellOf(p.z) * W + cellOf(p.x); if (PROGRESS[c] < INF) best = Math.max(best, PROGRESS[c]); }
      if (best / PROGRESS_MAX > 0.5 && this.spawnAt(ZT.BRUTE, 12, 22)) {
        this.bruteSpawned = true;
        this.events.push(['brute']);
      }
    }
  }

  private recomputeFlow(): void {
    const src: number[] = [];
    let targets = this.standing();
    if (!targets.length) targets = [...this.players.values()].filter((p) => p.st === PSTATE.DOWN);
    for (const p of targets) {
      const tx = cellOf(p.x), tz = cellOf(p.z);
      if (!solidAt(tx, tz, this.gateOpen)) src.push(tz * W + tx);
    }
    distanceField(src, this.gateOpen, this.flow);
  }

  private updateZombies(dt: number): void {
    const players = [...this.players.values()].filter((p) => p.st !== PSTATE.DEAD);
    const zs = [...this.zombies.values()];
    const go = this.gateOpen;

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
        if (tgt && (d < 5 || (d < 15 && hasLOS(z.x, z.z, tgt.x, tgt.z, go)))) { z.dormant = false; this.alertNear(z.x, z.z, 7); }
        else { z.st = ZSTATE.IDLE; continue; }
      }
      if (z.stun > 0) {
        z.stun -= dt;
        moveSlide(z, z.vx * dt, z.vz * dt, T.radius, go);
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
        moveSlide(z, z.lx * step, z.lz * step, T.radius, go);
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
      if (z.type === ZT.LEAPER && target.st === PSTATE.ALIVE && z.leapCd <= 0 && d > 4.5 && d < 12 && hasLOS(z.x, z.z, target.x, target.z, go)) {
        z.st = ZSTATE.WINDUP; z.t = 0.6; face();
        continue;
      }
      if (T.dmg > 0 && d < T.range) {
        z.st = ZSTATE.ATTACK; z.t = T.cd; z.hitDone = false; z.target = target.id; face();
        continue;
      }

      // Movement: beeline when close and visible, otherwise follow the flow field.
      let dx = 0, dz = 0;
      if (d < 6 && hasLOS(z.x, z.z, target.x, target.z, go)) { dx = target.x - z.x; dz = target.z - z.z; }
      else {
        const cx = cellOf(z.x), cz = cellOf(z.z);
        let best = this.flow[cz * W + cx], bx = cx, bz = cz;
        if (best >= INF) { z.st = ZSTATE.IDLE; continue; }
        for (const [ox, oz] of DIRS8) {
          const nx = cx + ox, nz = cz + oz;
          if (solidAt(nx, nz, go)) continue;
          if (ox && oz && (solidAt(cx + ox, cz, go) || solidAt(cx, cz + oz, go))) continue;
          const v = this.flow[nz * W + nx];
          if (v < best) { best = v; bx = nx; bz = nz; }
        }
        dx = (bx + 0.5) * TILE + z.offX - z.x; dz = (bz + 0.5) * TILE + z.offZ - z.z;
      }
      const len = Math.hypot(dx, dz);
      if (len > 0.01) {
        const sp = z.speed * (this.holdout >= 0 || d > 16 ? 1.12 : 1) * dt;
        moveSlide(z, (dx / len) * sp, (dz / len) * sp, T.radius, go);
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
        if (a.type !== ZT.BRUTE) moveSlide(a, -nx * push, -nz * push, ra, go);
        if (b.type !== ZT.BRUTE && !b.dormant) moveSlide(b, nx * push, nz * push, rb, go);
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
    const stand = this.standing();
    if (!this.players.size) return;
    if (!stand.length) {
      this.state = 'lost'; this.endTimer = 9;
      this.events.push(['end', 0, this.kills, Math.round(this.time)]);
      return;
    }
    if (this.gateOpen && stand.every((p) => floorAt(p.x, p.z) === F.SAFE_B)) {
      this.state = 'won'; this.endTimer = 14;
      this.events.push(['end', 1, this.kills, Math.round(this.time), [...this.players.values()].map((p): [number, number] => [p.id, p.kills])]);
    }
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
      this.checkEnd();
    } else {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.reset();
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
    this.broadcast({ t: 's', st: this.state, g: this.gateOpen ? 1 : 0, ho: this.holdout >= 0 ? Math.ceil(this.holdout) : -1, p, z, ev: this.events });
    this.events = [];
  }
}
