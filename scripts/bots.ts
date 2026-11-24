// Dev-only bot teammates: joins N scripted survivors to an existing room on a local dev server, so a
// finale can be recorded in a real browser as a 2- or 4-player game. Bots walk to posts round the
// objective, shoot what they can see, reload, revive downed teammates, tag along with player 1 between
// objectives and may man a mounted gun at a Big Hold On. They fire weapons they never picked up, which
// only a dev server accepts (debug gives), so this is no use against production.
//
//   npx tsx scripts/bots.ts --room CODE [--count 1|3] [--port 3000] [--posts "x,z;x,z[,lv];..."]
//                           [--weapons smg,rifle,smg] [--acc 0.7] [--names "A,B,C"] [--no-mount]
//
// --posts: tile coordinates (metres / 2) for the bots' posts at a holdout, one per bot (reused round-robin);
// without it they spread round the step's waypoint. Ctrl-C / SIGTERM leaves cleanly.
import WebSocket from 'ws';
import { getLevel } from '../shared/chapters';
import { TILE, PLAYER, PSTATE, WEAPONS, MOUNT, ZSTATE, type WeaponDef } from '../shared/constants';
import type { Level, Step } from '../shared/level';
import type { ClientMsg, ServerMsg, PlayerSnap, ZombieSnap } from '../shared/protocol';

// ------------------------------------------------------------------ options
const argv = process.argv.slice(2);
const arg = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name: string) => argv.includes(`--${name}`);
if (flag('help') || !arg('room')) {
  console.log('usage: npx tsx scripts/bots.ts --room CODE [--count N] [--port 3000] [--host localhost] [--posts "x,z;x,z[,lv];..."] [--weapons smg,rifle,smg] [--acc 0.7] [--names "A,B,C"] [--no-mount]');
  process.exit(arg('room') ? 0 : 1);
}
const ROOM = arg('room')!.toUpperCase();
const COUNT = Math.max(1, Math.min(3, Number(arg('count', '1')) | 0));
const PORT = Number(arg('port', '3000'));
const HOST = arg('host', 'localhost')!;
const ACC = Math.max(0, Math.min(1, Number(arg('acc', '0.7'))));
const NO_MOUNT = flag('no-mount');
const NAMES = (arg('names') ?? '').split(',').map((s) => s.trim());
const GUNS = (arg('weapons') ?? 'smg,rifle,smg').split(',').map((s) => {
  const i = WEAPONS.findIndex((w) => w.id === s.trim());
  if (i < 0 || WEAPONS[i].slot === 'mount' || WEAPONS[i].slot === 'throw' || WEAPONS[i].melee) { console.error(`unknown or unsupported weapon "${s}"`); process.exit(1); }
  return i;
});
const POSTS = (arg('posts') ?? '').split(';').map((s) => s.split(',').map(Number)).filter((a) => a.length >= 2 && a.every(Number.isFinite)) as number[][];

/** Engagement range (m): nothing past this is shot at, whatever the gun could do. */
const ENGAGE = 40;
const DT = 0.05;
const NOFIELD = 32767;

const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (who: string, msg: string) => console.log(`[${stamp()}] ${who}: ${msg}`);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const levels = new Map<number, Level>();
const levelOf = (ch: number) => { let L = levels.get(ch); if (!L) { L = getLevel(ch); levels.set(ch, L); } return L; };
const isHold = (s: Step | undefined) => !!s && (s.kind === 'holdout' || (s.hold ?? 0) > 0);

interface P3 { x: number; y: number; z: number }

// ------------------------------------------------------------------ the squad (shared bookkeeping)
const bots: Bot[] = [];
const botIds = () => new Set(bots.map((b) => b.id).filter((id) => id > 0));
/** Bot that has claimed the step's mounted gun (by index), and the step it was for. */
let mountBot = -1, mountStep = -1, mountId = -1;
/** Mount left for the lead to take: bots keep off it until this time. */
let mountHandedOver = 0;

class Bot {
  ws: WebSocket;
  id = 0; name: string; ch = -1; L!: Level;
  x = 0; y = 0; z = 0; yaw = Math.PI; pitch = 0;
  snap: Extract<ServerMsg, { t: 's' }> | null = null;
  step = -1; st: number = PSTATE.ALIVE; pinned = false; mount = -1;
  gun: number; mags: Record<number, number> = {}; reloadUntil = 0; nextShot = 0; burst = 0; nadeSeq = 0;
  goal: P3 | null = null; goalKind = ''; atGoal = false; goalNode = -1; goalDoors = -1;
  field: Int16Array | null = null; repickAt = 0; nextMountTry = 0;
  reviving = 0; drift = 0;
  stats = { kills: 0, shots: 0, hits: 0, rubber: 0, tps: 0 };
  timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly idx: number) {
    this.name = NAMES[idx] || '';
    this.gun = GUNS[idx % GUNS.length];
    this.ws = new WebSocket(`ws://${HOST}:${PORT}/ws`);
    this.ws.on('open', () => this.send({ t: 'j', name: this.name, room: ROOM }));
    this.ws.on('error', (e) => log(this.tag, `socket error: ${e.message}`));
    this.ws.on('close', () => { if (this.timer) clearInterval(this.timer); log(this.tag, quitting ? 'disconnected' : 'connection closed by the server (dev server restarted?)'); if (bots.every((b) => b.ws.readyState === WebSocket.CLOSED) && !quitting) process.exit(0); });
    this.ws.on('message', (raw) => this.onMsg(JSON.parse(raw.toString()) as ServerMsg));
  }
  get tag() { return this.name || `bot${this.idx + 1}`; }
  send(m: ClientMsg) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  get wp(): WeaponDef { return WEAPONS[this.gun]; }

  onMsg(m: ServerMsg) {
    if (m.t === 'err') { log(this.tag, `server refused: ${m.msg}`); this.ws.close(); return; }
    if (m.t === 'ro') { const me = m.players.find((p) => p.id === this.id); if (me && me.name !== this.name) this.name = me.name; return; }
    if (m.t === 'w') {
      this.id = m.id; this.setChapter(m.ch); this.step = m.step;
      this.x = m.x; this.y = m.y; this.z = m.z;
      log(this.tag, `joined room ${m.room} as #${m.id} (chapter ${m.ch + 1} "${this.L.def.title}", step ${m.step}: ${this.L.def.steps[m.step]?.objective ?? '?'}) with ${this.wp.name}${m.debug ? '' : ' -- WARNING: not a dev server, its shots will be refused'}`);
      this.timer = setInterval(() => { try { this.tick(); } catch (e) { console.error(e); } }, DT * 1000);
      return;
    }
    if (m.t !== 's') return;
    this.snap = m;
    for (const e of m.ev) {
      switch (e[0]) {
        case 'reset': if (e[1] !== this.ch) this.setChapter(e[1]); this.goal = null; log(this.tag, `room reset (chapter ${e[1] + 1}, step ${e[2]})`); break;
        case 'tp': if (e[1] === this.id) { this.x = e[2]; this.z = e[3]; this.y = e[5]; this.yaw = e[4]; this.stats.tps++; this.drift = 0; } break;
        case 'zdie': if (e[6] === this.id) this.stats.kills++; break;
        case 'pin': if (e[1] === this.id) { this.pinned = true; log(this.tag, 'grabbed by a special'); } break;
        case 'unpin': if (e[1] === this.id) this.pinned = false; break;
        case 'down': if (e[1] === this.id) log(this.tag, 'DOWNED'); break;
        case 'dead': if (e[1] === this.id) log(this.tag, 'DEAD'); break;
        case 'revived': if (e[1] === this.id) log(this.tag, 'back on its feet'); else if (e[2] === this.id) log(this.tag, `revived #${e[1]}`); break;
        case 'mount': if (e[1] === this.id) { this.mount = e[2]; log(this.tag, e[2] >= 0 ? `manning mounted gun ${e[2]} (${this.L.def.mounts[e[2]]?.kind})` : 'let go of the mounted gun'); } break;
        case 'end': if (this.idx === 0) log('squad', `chapter ${e[1] ? 'WON' : 'LOST'} (${e[2]} kills, ${e[3]} s)`); break;
      }
    }
  }

  setChapter(ch: number) { this.ch = ch; this.L = levelOf(ch); this.goal = null; this.field = null; }

  // ---------------------------------------------------------------- per-tick brain
  tick() {
    const s = this.snap;
    if (!s || !this.id) return;
    const me = s.p.find((p) => p[0] === this.id);
    if (!me) return;
    const t = now();
    const st = me[7];
    if (st !== this.st) {
      if (st === PSTATE.ALIVE && this.st === PSTATE.DEAD) log(this.tag, 'back in the game');
      this.st = st;
    }
    this.mount = me[15];
    // Server-owned position: downed, dead, pinned or seated on a gun. Otherwise ours, but if the
    // server keeps disagreeing (it ignored our claims) take its word: that is a rubber-band.
    if (st !== PSTATE.ALIVE || this.pinned || this.mount >= 0) { this.x = me[1]; this.y = me[2]; this.z = me[3]; this.drift = 0; }
    else if (Math.hypot(me[1] - this.x, me[3] - this.z) > 3) {
      if (++this.drift >= 6) { this.x = me[1]; this.y = me[2]; this.z = me[3]; this.drift = 0; this.stats.rubber++; log(this.tag, 'rubber-banded (server moved it back)'); }
    } else this.drift = 0;

    if (s.q !== this.step) {
      const obj = this.L.def.steps[s.q]?.objective ?? '(done)';
      if (this.idx === 0) log('squad', `step ${this.step} -> ${s.q}: ${obj}`);
      this.step = s.q; this.goal = null; this.repickAt = 0;
      if (this.mount >= 0) this.send({ t: 'm', id: -1 });
    }
    if (s.st !== 'play' || st === PSTATE.DEAD) { this.sendPos(); return; }

    if (st === PSTATE.ALIVE && !this.pinned) {
      this.think(s, t);
      if (this.mount < 0) this.walk();
    }
    if (!this.pinned) this.shoot(s, t, st === PSTATE.DOWN);
    this.sendPos();
  }

  sendPos() {
    this.send({ t: 'p', x: +this.x.toFixed(2), y: +this.y.toFixed(2), z: +this.z.toFixed(2), ry: +this.yaw.toFixed(3), rx: +this.pitch.toFixed(3), w: this.mount >= 0 ? this.mountWeapon() : this.st === PSTATE.DOWN ? 0 : this.gun, a: 0 });
  }

  /** Lowest-id survivor in the room that isn't one of ours: the human recording. */
  lead(): PlayerSnap | undefined {
    const ours = botIds();
    return this.snap!.p.filter((p) => !ours.has(p[0])).sort((a, b) => a[0] - b[0])[0];
  }

  /** Decide where to be: revive someone, a mounted gun, a holdout post, or near the lead. */
  think(s: Extract<ServerMsg, { t: 's' }>, t: number) {
    const L = this.L, step = L.def.steps[s.q];
    // A downed teammate close by comes first.
    // One helper per downed survivor: the nearest free bot (a gunner stays on the gun if anyone else can go).
    const free = (b: Bot) => b.id > 0 && b.st === PSTATE.ALIVE && !b.pinned;
    const helpers = bots.filter((b) => free(b) && b.mount < 0);
    const mine = (p: PlayerSnap) => {
      const pool = helpers.length ? helpers : bots.filter(free);
      return pool.sort((a, b) => Math.hypot(a.x - p[1], a.z - p[3]) - Math.hypot(b.x - p[1], b.z - p[3]))[0] === this;
    };
    const down = s.p.filter((p) => p[0] !== this.id && p[7] === PSTATE.DOWN && Math.hypot(p[1] - this.x, p[3] - this.z) < 15 && Math.abs(p[2] - this.y) < 2 && mine(p))
      .sort((a, b) => Math.hypot(a[1] - this.x, a[3] - this.z) - Math.hypot(b[1] - this.x, b[3] - this.z))[0];
    // Leave the gun to the lead if they walk up to it.
    if (this.mount >= 0) {
      const ld = this.lead(), M = L.def.mounts[this.mount];
      if (down || (ld && ld[7] === PSTATE.ALIVE && ld[15] < 0 && M && Math.hypot(ld[1] - M.x, ld[3] - M.z) < 3)) {
        if (!down) { mountHandedOver = t + 30; log(this.tag, 'leaving the mounted gun to the lead'); }
        this.send({ t: 'm', id: -1 }); mountBot = -1;
      }
      return;
    }
    if (down) {
      this.setGoal({ x: down[1] + 0.8, y: down[2], z: down[3] }, 'revive');
      const want = Math.hypot(down[1] - this.x, down[3] - this.z) < PLAYER.useRange - 0.3 ? down[0] : 0;
      if (want !== this.reviving) { this.reviving = want; this.send({ t: 'r', id: want }); if (want) log(this.tag, `reviving #${want}`); }
      return;
    }
    if (this.reviving) { this.reviving = 0; this.send({ t: 'r', id: 0 }); }
    if (t < this.repickAt && this.goal) return this.tryMount(t);
    this.repickAt = t + 1;
    const ld = this.lead();
    if (step && isHold(step) && mountBot === this.idx && mountStep === s.q) {
      // Keep heading for the gun (tryMount below).
    } else if (step && isHold(step)) {
      if (this.goalKind !== 'hold' || !this.goal) this.setGoal(this.holdPost(step, s), 'hold');
    } else if (step && step.kind === 'gather' && step.area && ld && L.inRect(ld[1], ld[2], ld[3], step.area)) {
      if (this.goalKind !== 'gather') this.setGoal(this.areaPost(step), 'gather');
    } else if (ld && ld[7] !== PSTATE.DEAD) {
      // Tag along a few metres off the lead; move up when they get well away from the spot.
      if (this.goalKind !== 'follow' || !this.goal || Math.hypot(this.goal.x - ld[1], this.goal.z - ld[3]) > 7) this.setGoal(this.nearPoint({ x: ld[1], y: ld[2], z: ld[3] }, 3, 1.2), 'follow');
    } else if (step && this.goalKind !== 'hold') this.setGoal(this.holdPost(step, s), 'hold');
    this.tryMount(t);
  }

  /** At a holdout, one bot mans the stand's mounted gun if nobody is on it. */
  tryMount(t: number) {
    const s = this.snap!, step = this.L.def.steps[s.q];
    if (NO_MOUNT || !isHold(step) || t < mountHandedOver) return;
    if (mountStep !== s.q) { mountStep = s.q; mountBot = -1; mountId = -1; }
    if (mountBot >= 0 && mountBot !== this.idx) return;
    const at = step.at, ay = at.y ?? 0;
    const M = this.L.def.mounts.filter((m) => Math.abs(m.y - ay) < 2 && Math.hypot(m.x - at.x, m.z - at.z) < 25)
      .find((m) => !s.p.some((p) => p[15] === m.id && p[0] !== this.id));
    if (!M) { if (mountBot === this.idx) mountBot = -1; return; }
    // Only the bot whose post is nearest the gun takes it.
    if (mountBot < 0) {
      const d = (b: Bot) => (b.goal && b.st === PSTATE.ALIVE ? Math.hypot(b.goal.x - M.x, b.goal.z - M.z) : Infinity);
      const best = bots.filter((b) => b.id).sort((a, b) => d(a) - d(b))[0];
      if (best !== this) return;
      mountBot = this.idx; mountId = M.id;
      log(this.tag, `heading for the mounted ${M.kind}`);
    }
    const seat = { x: M.x + Math.sin(M.yaw) * MOUNT.seat, y: M.y, z: M.z + Math.cos(M.yaw) * MOUNT.seat };
    this.setGoal(seat, 'mount');
    if (Math.hypot(seat.x - this.x, seat.z - this.z) < 1.5 && t >= this.nextMountTry) { this.nextMountTry = t + 1; this.send({ t: 'm', id: M.id }); }
  }

  mountWeapon(): number { const M = this.L.def.mounts[this.mount]; return M ? WEAPONS.findIndex((w) => w.id === M.kind) : this.gun; }

  // ---------------------------------------------------------------- posts
  /** Holdout post: --posts if given, else a spot spread round the waypoint with a view of it. */
  holdPost(step: Step, s: Extract<ServerMsg, { t: 's' }>): P3 {
    const L = this.L;
    if (POSTS.length) {
      const [tx, tz, lv = 0] = POSTS[this.idx % POSTS.length];
      const n = L.node(tx | 0, tz | 0, lv | 0), x = ((tx | 0) + 0.5) * TILE, z = ((tz | 0) + 0.5) * TILE;
      return { x, y: L.heightAt(n, x, z), z };
    }
    const at = { x: step.at.x, y: step.at.y ?? 0, z: step.at.z };
    const ang = (this.idx / COUNT) * Math.PI * 2 + 0.7 + s.q;
    const want = { x: at.x + Math.sin(ang) * 5, y: at.y, z: at.z + Math.cos(ang) * 5 };
    return this.nearPoint(want, 4, 1.5, at);
  }
  /** A spot inside a gather area (spread by bot). */
  areaPost(step: Step): P3 {
    const a = step.area!, L = this.L, lv = a.lv ?? 0, cells: number[] = [];
    for (let tz = a.z0; tz <= a.z1; tz++) for (let tx = a.x0; tx <= a.x1; tx++) if (!L.solidAt(tx, tz, this.snap!.g, lv)) cells.push(L.node(tx, tz, lv));
    if (!cells.length) return { x: step.at.x, y: step.at.y ?? 0, z: step.at.z };
    // Away from the area's edges where possible: the middle third of the list, offset per bot.
    const n = cells[Math.floor(cells.length / 2 + (this.idx - 1) * Math.max(1, cells.length / 6)) % cells.length];
    return L.centre(n);
  }
  /**
   * The open, reachable tile centre nearest `want` (within `r` tiles), not on a stair and at least
   * `gap` m from the other bots' goals. `view`: must also see that point.
   */
  nearPoint(want: P3, r: number, gap: number, view?: P3): P3 {
    const L = this.L, g = this.snap!.g, lv = L.storeyOf(want.y), cx = Math.floor(want.x / TILE), cz = Math.floor(want.z / TILE);
    const others = bots.filter((b) => b !== this && b.goal).map((b) => b.goal!);
    let best: P3 | null = null, bd = Infinity;
    for (let pass = 0; pass < 2 && !best; pass++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const tx = cx + dx, tz = cz + dz;
        if (L.solidAt(tx, tz, g, lv)) continue;
        const n = L.node(tx, tz, lv);
        if (L.def.ramp[n]) continue;
        const c = L.centre(n);
        if (L.boxBlocked(c.x, c.y, c.z, PLAYER.radius + 0.2, g)) continue;
        if (pass === 0 && others.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < gap)) continue;
        if (pass === 0 && view && !L.hasLOS(c.x, c.y + 1.2, c.z, view.x, view.y + 1.2, view.z, g)) continue;
        const d = Math.hypot(c.x - want.x, c.z - want.z);
        if (d < bd) { bd = d; best = c; }
      }
    }
    return best ?? want;
  }

  setGoal(p: P3, kind: string) {
    const L = this.L, n = L.nodeAt(p.x, p.y, p.z);
    if (!this.goal || Math.hypot(this.goal.x - p.x, this.goal.z - p.z) > 0.5 || kind !== this.goalKind) {
      this.atGoal = false;
      if (kind === 'hold' || kind === 'gather') log(this.tag, `${kind === 'hold' ? 'post' : 'gather spot'} (${(p.x / TILE).toFixed(1)}, ${(p.z / TILE).toFixed(1)}) tiles`);
    }
    this.goal = p; this.goalKind = kind;
    if (n !== this.goalNode || this.snap!.g !== this.goalDoors) {
      this.goalNode = n; this.goalDoors = this.snap!.g;
      this.field = L.distanceField([n], this.snap!.g, this.field ?? undefined);
    }
  }

  // ---------------------------------------------------------------- movement
  walk() {
    const L = this.L, goal = this.goal, f = this.field;
    if (!goal || !f) return;
    const g = this.snap!.g, here = L.nodeAt(this.x, this.y, this.z);
    let tx = goal.x, tz = goal.z;
    const dGoal = Math.hypot(goal.x - this.x, goal.z - this.z);
    if (dGoal < 0.15) {
      if (!this.atGoal) { this.atGoal = true; if (this.goalKind === 'hold' || this.goalKind === 'gather') log(this.tag, `at ${this.goalKind === 'hold' ? 'post' : 'gather spot'}`); }
      return;
    }
    if (f[here] > 0 && f[here] < NOFIELD) {
      // Down the distance field, cutting corners: aim at the farthest of the next few nodes in a clear straight line.
      const nb: number[] = [];
      let cur = here, aim = -1;
      for (let k = 0; k < 4; k++) {
        const c = L.neighbors8(cur, g, nb);
        let nx = -1;
        for (let i = 0; i < c; i++) if (f[nb[i]] < f[cur] && (nx < 0 || f[nb[i]] < f[nx])) nx = nb[i];
        if (nx < 0) break;
        const p = L.centre(nx);
        if (aim >= 0 && !this.clear(p)) break;
        aim = nx; cur = nx;
        if (f[nx] === 0) break;
      }
      if (aim >= 0 && f[aim] > 0) { const p = L.centre(aim); tx = p.x; tz = p.z; }
    }
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz) || 1;
    const speed = PLAYER.speed * this.wp.move * (this.goalKind === 'revive' ? 1 : 0.85);
    const stepLen = Math.min(d, speed * DT, dGoal);
    const nx = this.x + (dx / d) * stepLen, nz = this.z + (dz / d) * stepLen;
    const n = L.nodeAt(nx, this.y, nz);
    this.x = nx; this.z = nz; this.y = L.blocked(n, g) ? this.y : L.heightAt(n, nx, nz);
    // Face where it's going unless shooting (shoot() turns it after).
    if (this.nextShot < now() - 0.6) this.yaw = turn(this.yaw, Math.atan2(-dx, -dz), 0.35);
  }
  /** A straight walk from here to p crosses no blocked cell (sampled every half metre). */
  clear(p: P3): boolean {
    const L = this.L, g = this.snap!.g, dx = p.x - this.x, dz = p.z - this.z, d = Math.hypot(dx, dz), k = Math.ceil(d / 0.5);
    let y = this.y;
    for (let i = 1; i <= k; i++) {
      const x = this.x + (dx * i) / k, z = this.z + (dz * i) / k, n = L.nodeAt(x, y, z);
      if (L.blocked(n, g) || L.boxBlocked(x, L.heightAt(n, x, z), z, PLAYER.radius, g)) return false;
      const ny = L.heightAt(n, x, z);
      if (Math.abs(ny - y) > 0.7) return false;
      y = ny;
    }
    return true;
  }

  // ---------------------------------------------------------------- combat
  shoot(s: Extract<ServerMsg, { t: 's' }>, t: number, downed: boolean) {
    if (t < this.reloadUntil || t < this.nextShot) return;
    const L = this.L, g = s.g, mounted = this.mount >= 0;
    const wi = mounted ? this.mountWeapon() : downed ? 0 : this.gun, wp = WEAPONS[wi];
    const M = mounted ? L.def.mounts[this.mount] : null;
    const range = Math.min(ENGAGE * (mounted ? 1.5 : 1), wp.range);
    const ey = this.y + PLAYER.eye;
    let best: ZombieSnap | null = null, bd = Infinity;
    for (const z of s.z) {
      const d = Math.hypot(z[2] - this.x, z[3] - this.z, z[6] - this.y);
      if (d > range || d >= bd) continue;
      if (z[5] === ZSTATE.IDLE && d > 18) continue; // let sleepers lie unless close
      if (M) {
        // Inside the gun's traverse.
        const a = Math.atan2(-(z[2] - M.x), -(z[3] - M.z));
        if (Math.abs(angDiff(a, M.yaw)) > MOUNT.arc) continue;
      }
      if (!L.hasLOS(this.x, ey, this.z, z[2], z[6] + 1.0, z[3], g)) continue;
      best = z; bd = d;
    }
    if (!best) { this.burst = 0; return; }
    const dx = best[2] - this.x, dz = best[3] - this.z;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(best[6] + 1.0 - ey, Math.hypot(dx, dz));
    const hit = Math.random() < ACC * (bd > 25 ? 0.75 : 1), head = hit && Math.random() < 0.25;
    const miss = hit ? 0 : 1.5;
    const e: [number, number, number] = [+(best[2] + rnd(-miss, miss)).toFixed(2), +(best[6] + 1.0 + rnd(-miss / 3, miss / 3)).toFixed(2), +(best[3] + rnd(-miss, miss)).toFixed(2)];
    if (wp.blast) {
      // Shell / rocket: fire, then claim the impact after its time of flight (as the client does).
      const seq = ++this.nadeSeq, flight = bd / wp.blast.speed, gy = +(best[6] + 0.2).toFixed(2);
      this.send({ t: 'f', w: wi, h: [], e, n: seq });
      setTimeout(() => this.send({ t: 'g', x: e[0], y: gy, z: e[2], n: seq }), flight * 1000 + 100);
    } else {
      let h: [number, number, number][] = [];
      if (hit) {
        if (wp.pellets > 1) {
          const n = Math.max(2, Math.round(wp.pellets * rnd(0.4, 0.9) * (bd > wp.falloff[0] ? 0.6 : 1)));
          const nh = head ? Math.min(2, n) : 0;
          h = [[best[0], n - nh, nh]];
        } else h = [[best[0], head ? 0 : 1, head ? 1 : 0]];
      }
      this.send({ t: 'f', w: wi, h, e });
      if (hit) this.stats.hits++;
    }
    this.stats.shots++;
    // Magazine (or, on a mounted gun, heat): empty means a reload / cool-down pause.
    this.mags[wi] = (this.mags[wi] ?? wp.mag) - 1;
    if (this.mags[wi] <= 0) { this.mags[wi] = wp.mag; this.reloadUntil = t + wp.reload + rnd(0, 0.3); }
    // Auto guns in bursts with short pauses; semi-autos paced a bit slower than their limit.
    if (wp.auto) {
      if (++this.burst >= (mounted ? 25 : 6 + ((Math.random() * 5) | 0))) { this.burst = 0; this.nextShot = t + rnd(0.2, 0.45); }
      else this.nextShot = t + wp.rate * 1.1;
    } else this.nextShot = t + Math.max(wp.rate * 1.25, 0.25) + rnd(0, 0.15);
  }
}

function angDiff(a: number, b: number): number { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function turn(from: number, to: number, k: number): number { return from + angDiff(to, from) * k; }

// ------------------------------------------------------------------ run
let quitting = false;
for (let i = 0; i < COUNT; i++) {
  bots.push(new Bot(i));
  await new Promise((r) => setTimeout(r, 300)); // join one at a time: each takes the next survivor look
}

const summary = () => {
  const s = bots[0]?.snap;
  const per = bots.map((b) => `${b.tag} ${b.stats.kills}k/${b.stats.shots}s`).join(', ');
  const tot = bots.reduce((a, b) => ({ k: a.k + b.stats.kills, s: a.s + b.stats.shots, h: a.h + b.stats.hits, r: a.r + b.stats.rubber }), { k: 0, s: 0, h: 0, r: 0 });
  log('squad', `kills ${tot.k} (${per}); hit claims ${tot.h}/${tot.s}; rubber-bands ${tot.r}; zombies around ${s?.z.length ?? '?'}; step ${s?.q ?? '?'}${s && s.ho >= 0 ? `, holdout ${Math.round(s.ho)} s left` : ''}`);
};
const every = setInterval(summary, 30000);
// Leave once the human has been gone a while (so bots don't keep an empty room alive).
let leadSeen = Date.now();
setInterval(() => {
  const b = bots.find((x) => x.snap);
  if (!b || quitting) return;
  if (b.lead()) leadSeen = Date.now();
  else if (Date.now() - leadSeen > 60000) quit('no human player in the room for 60 s');
}, 1000);

const quit = (sig: string) => {
  if (quitting) return;
  quitting = true;
  clearInterval(every);
  log('squad', `${sig}: leaving`);
  summary();
  for (const b of bots) { if (b.mount >= 0) b.send({ t: 'm', id: -1 }); if (b.timer) clearInterval(b.timer); }
  setTimeout(() => { for (const b of bots) b.ws.close(); setTimeout(() => process.exit(0), 200); }, 100);
};
process.on('SIGINT', () => quit('SIGINT'));
process.on('SIGTERM', () => quit('SIGTERM'));
