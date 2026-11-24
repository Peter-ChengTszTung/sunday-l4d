// What the server tells us about everyone else: teammates (from the roster and player snapshots) and
// zombies (zombie snapshots, deaths, holds), eased between snapshots and drawn as chibis, with the
// crowd's voices. main.ts owns the event handling and calls through here.
import * as pc from 'playcanvas';
import { PLAYER, WEAPONS, ZTYPES, ZT, ZSTATE, PSTATE, SURVIVORS, isCommon } from '../../shared/constants';
import { isIndoor, type Level } from '../../shared/level';
import type { PlayerSnap, RosterEntry, ZombieSnap } from '../../shared/protocol';
import { Chibi, survivorLook, zombieLook, nameTag, type Pose } from './chibi';
import { worldGun } from './viewmodel';
import { app } from './gfx';
import type { FX } from './fx';
import type { Sfx } from './audio';
import type { Hud } from './hud';
import type { V3 } from './shots';
import { t } from './i18n';

export interface Mate {
  id: number; name: string; look: number; /** Shirt colour as CSS, for the name tag and HUD. */ color: string; chibi: Chibi; tag: pc.Entity; gun: pc.Entity | null; gunW: number;
  x: number; y: number; z: number; ry: number; tx: number; ty: number; tz: number; tr: number;
  hp: number; st: number; respawn: number; rev: number; speed: number; /** Metres since the last footstep sound. */ stride: number;
  /** Seconds left of the close-in swing pose. */ swing: number;
  /** Body drawn (not swallowed by the fog); the name tag shows regardless. */ near: boolean;
  /** Mounted gun they man (ChapterDef.mounts index, -1 = none) and their look pitch (the gun follows both). */ mount: number; pitch: number;
}
/** `y`/`ty`: the floor height it stands on (shown / latest snapshot); `sfxT`: alarm-ring timer; `vox`: seconds until a special's next presence cue. */
export interface Zed { id: number; type: number; chibi: Chibi; x: number; y: number; z: number; ry: number; tx: number; ty: number; tz: number; tr: number; st: number; sfxT: number; vox: number }
interface Corpse { chibi: Chibi; t: number; vx: number; vz: number; x: number; y: number; z: number; scale: number }

/** You, as the remotes see you: where you stand (`y` feet, `gy` floor) and face. */
export interface SelfView { id: number; x: number; y: number; z: number; gy: number; yaw: number }
/** The listener for a frame: the camera (position and rotation), the floor under it, and the level. */
export interface RemotesView { cam: V3 & { rot: pc.Quat }; listenY: number; level: Level }

export interface RemotesDeps {
  fx: FX; sfx: Sfx; hud: Hud;
  /** Your own state (read only). */
  me: SelfView;
  /** On the offline shooting range (no first-sight tips there). */
  inRange: () => boolean;
}

const RAD = 180 / Math.PI;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const lerpAngle = (a: number, b: number, k: number) => {
  const d = (((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};
/** How far behind its victim's centre a riding Piggyback hangs (m). */
const RIDE_BACK = 0.24;
/** Chibis farther than this past the fog's far distance are fully fogged: not drawn (m). */
const FOG_CULL = 2;
// Indexed by ZSTATE.
const POSE: Pose[] = ['idle', 'run', 'attack', 'stagger', 'windup', 'leap', 'charge', 'pin', 'ring'];
/**
 * The first time each new kind of infected comes close, one line on how to deal with it (the campaign
 * introduces them one at a time, see shared/constants.ts INTRO). Once per page load.
 */
const TIPS: Record<number, string> = {
  [ZT.LEAPER]: 'New threat: Leaper — it pounces from range. Shove it or shoot it mid-crouch',
  [ZT.PUFFER]: 'New threat: Puffer — pop it from a distance: its goo calls a horde',
  [ZT.DROOLER]: 'New threat: Drooler — it spits goo pools. Keep moving',
  [ZT.CHARGER]: 'New threat: Charger — sidestep the rush and it stuns itself on the wall',
  [ZT.ALARM]: 'New threat: Alarm Clock — silence it before it rings out',
  [ZT.SNATCHER]: 'New threat: Snatcher — it lassoes one of you from afar. Break line of sight, or free whoever it catches',
  [ZT.PIGGYBACK]: 'New threat: Piggyback — it rides a survivor away from the team. Shove it off them',
  [ZT.WEEPER]: 'You hear sobbing: a Weeper. Give her a wide berth and do not shoot her — or kill her fast',
  [ZT.TINPOT]: 'New threat: Tinpot — its pots stop most of a bullet from the front. Shove it, flank it, or use a close-in weapon',
  [ZT.RAINCOAT]: 'New threat: Raincoat — fire does nothing to it',
};

const _a: V3 = { x: 0, y: 0, z: 0 }, _b: V3 = { x: 0, y: 0, z: 0 };

export class Remotes {
  readonly mates = new Map<number, Mate>();
  readonly zeds = new Map<number, Zed>();
  /** Survivors currently held (pinned, lassoed, ridden): drawn staggered. */
  readonly pinned = new Set<number>();
  /** Zombie id -> survivor id it has hold of (from 'pin'), for the Snatcher's scarf and the Piggyback's ride. */
  readonly pinBy = new Map<number, number>();
  /** Awake infected within 22 m of the listener, for the horde murmur and tension bed (see main.ts `listen`). */
  threat = 0;
  private readonly corpses: Corpse[] = [];
  private readonly seenTypes = new Set<number>([ZT.WALKER, ZT.BRUTE]);
  private tinpotTipped = false;
  private groanT = 2;
  private lastSwipe = 0;

  constructor(private readonly deps: RemotesDeps) {}

  // ------------------------------------------------------------- teammates
  private addMate(r: RosterEntry): Mate {
    const chibi = new Chibi(survivorLook(r.look));
    chibi.group.name = `mate-${r.id}`;
    const color = hex(SURVIVORS[r.look % SURVIVORS.length].shirt);
    const tag = nameTag(r.name, color);
    tag.setLocalPosition(0, 1.72, 0);
    chibi.group.addChild(tag);
    chibi.group.enabled = false;
    app.root.addChild(chibi.group);
    const m: Mate = { id: r.id, name: r.name, look: r.look, color, chibi, tag, gun: null, gunW: -1, x: 0, y: 0, z: 0, ry: 0, tx: 0, ty: 0, tz: 0, tr: 0, hp: 100, st: 0, respawn: 0, rev: 0, speed: 0, stride: 0, swing: 0, near: true, mount: -1, pitch: 0 };
    this.mates.set(r.id, m);
    return m;
  }

  /** The room's roster changed: drop teammates who left, add those who joined (not `myId`). */
  sync(list: RosterEntry[], myId: number): void {
    const ids = new Set(list.map((r) => r.id));
    for (const [id, m] of this.mates) if (!ids.has(id)) { m.chibi.dispose(); this.mates.delete(id); }
    for (const r of list) if (r.id !== myId && !this.mates.has(r.id)) this.addMate(r);
  }

  /** Teammates' part of a snapshot (your own entry, `myId`, is skipped). */
  applyMates(list: PlayerSnap[], myId: number): void {
    for (const p of list) {
      const [id, x, y, z, ry, rx, hp, st, w, , rev, , respawn] = p;
      if (id === myId) continue;
      const m = this.mates.get(id);
      if (!m) continue;
      const fresh = !m.chibi.group.enabled && st !== PSTATE.DEAD;
      m.tx = x; m.ty = y; m.tz = z; m.tr = ry; m.hp = hp; m.st = st; m.rev = rev; m.respawn = respawn; m.mount = p[15] ?? -1; m.pitch = rx;
      if (fresh || Math.hypot(x - m.x, z - m.z) > 8 || Math.abs(y - m.y) > 2) { m.x = x; m.y = y; m.z = z; m.ry = ry; }
      m.chibi.group.enabled = st !== PSTATE.DEAD;
      if (m.gunW !== w) {
        // The gun meshes are shared per weapon (see worldGun), so swapping only replaces a small entity.
        m.gun?.destroy();
        m.gun = worldGun(WEAPONS[w]?.id ?? 'pistol');
        m.gun.setLocalPosition(0.1, 0.74, -0.36); m.gun.setLocalScale(1.15, 1.15, 1.15);
        if (WEAPONS[w]?.melee) m.gun.setLocalEulerAngles(55, 0, 0); // held upright, not pointed like a gun
        else if (WEAPONS[w]?.thrown) m.gun.setLocalEulerAngles(80, 0, 0); // a bottle or rattle is carried neck up
        m.chibi.root.addChild(m.gun); m.gunW = w;
      }
    }
  }

  // --------------------------------------------------------------- zombies
  /** A zombie snapshot: add new ones, update targets, cue state changes, drop the ones gone. */
  applyZombies(list: ZombieSnap[], time: number): void {
    const { me, sfx, fx } = this.deps;
    const seen = new Set<number>();
    for (const zs of list) {
      const [id, type, x, z, ry, st] = zs, y = zs[6] ?? 0;
      seen.add(id);
      let zd = this.zeds.get(id);
      if (!zd) {
        const chibi = new Chibi(zombieLook(type, id));
        chibi.group.name = `zed-${id}`;
        const sc = ZTYPES[type].scale;
        chibi.group.setLocalScale(sc, sc, sc);
        chibi.group.setPosition(x, y, z);
        app.root.addChild(chibi.group);
        zd = { id, type, chibi, x, y, z, ry, tx: x, ty: y, tz: z, tr: ry, st, sfxT: 0, vox: Math.random() * 3 };
        this.zeds.set(id, zd);
      }
      zd.tx = x; zd.ty = y; zd.tz = z; zd.tr = ry;
      if (st !== zd.st) {
        const dist = Math.hypot(x - me.x, y - me.gy, z - me.z);
        if (st === ZSTATE.WINDUP) {
          if (type === ZT.CHARGER) { sfx.at(y).chargeTell(x, z); if (dist < 24) fx.poof({ x, y: y + 0.1, z }, 0xd8cfe8, 4, 0.22); }
          else if (type === ZT.DROOLER) sfx.at(y).gurgle(x, z);
          else if (type === ZT.SNATCHER) sfx.at(y).lasso(x, z);
          else if (type === ZT.WEEPER) sfx.at(y).weeperWarn(x, z);
          else sfx.at(y).leap(x, z);
        }
        if (st === ZSTATE.CHARGE) sfx.at(y).chargeGo(x, z);
        // Swipes: at most ~7 a second however big the crowd around you is.
        if (st === ZSTATE.ATTACK && dist < 14 && time - this.lastSwipe > 0.14) { this.lastSwipe = time; sfx.at(y).swipe(x, z); }
      }
      zd.st = st;
    }
    for (const [id, zd] of this.zeds) if (!seen.has(id)) { zd.chibi.dispose(); this.zeds.delete(id); }
  }

  /** Zombie `id` died: it tumbles away from you as a corpse and pops. */
  kill(id: number, head: boolean): void {
    const { me, sfx, fx } = this.deps;
    const zd = this.zeds.get(id);
    if (!zd) return;
    this.zeds.delete(id);
    const dx = zd.x - me.x, dz = zd.z - me.z, d = Math.hypot(dx, dz) || 1;
    const s = ZTYPES[zd.type].scale;
    zd.chibi.group.enabled = true; // a fog-culled one still pops
    this.corpses.push({ chibi: zd.chibi, t: 0, vx: (dx / d) * 3, vz: (dz / d) * 3, x: zd.x, y: zd.y, z: zd.z, scale: s });
    if (head) fx.burst({ x: zd.x, y: zd.y + 1.1 * s, z: zd.z }, 0xffd43b, 5, 4, 0.14, true, 0.4, 5);
    fx.burst({ x: zd.x, y: zd.y + 0.8 * s, z: zd.z }, 0xb4f05a, zd.type === ZT.BRUTE ? 16 : zd.type === ZT.CHARGER ? 9 : 4, 4, 0.1 * s);
    sfx.at(zd.y).pop(zd.x, zd.z, zd.type);
  }

  /** Survivor `pid` is held by zombie `zid`. */
  pin(pid: number, zid: number): void { this.pinned.add(pid); this.pinBy.set(zid, pid); }
  /** Survivor `pid` is free. */
  unpin(pid: number): void {
    this.pinned.delete(pid);
    for (const [zid, p] of this.pinBy) if (p === pid) this.pinBy.delete(zid);
  }

  /** Drop every zombie and corpse on screen, and every hold. */
  clear(): void {
    for (const z of this.zeds.values()) z.chibi.dispose();
    this.zeds.clear();
    for (const c of this.corpses) c.chibi.dispose();
    this.corpses.length = 0;
    this.pinned.clear(); this.pinBy.clear();
  }

  /** Bullets bouncing off a Tinpot: say why, once. */
  tinpotTip(): void {
    if (this.tinpotTipped) return;
    this.tinpotTipped = true;
    this.deps.hud.feed(t('A Tinpot\'s front soaks up most of a bullet — shove it first, or hit it from behind'));
  }

  private firstSight(z: Zed): void {
    const { me, hud } = this.deps;
    if (this.deps.inRange() || Math.hypot(z.x - me.x, z.z - me.z) > (z.type === ZT.WEEPER ? 30 : 22)) return;
    this.seenTypes.add(z.type);
    if (TIPS[z.type]) hud.feed(t(TIPS[z.type]));
  }

  // ----------------------------------------------------------------- frame
  /** Ease everyone toward their latest snapshot, pose and draw them, and voice the crowd. */
  update(dt: number, time: number, view: RemotesView): void {
    const { me, sfx, fx } = this.deps;
    const { cam, level: L } = view;
    const far = L.def.theme.fogFar + FOG_CULL, far2 = far * far;
    const inFog = (x: number, y: number, z: number) => (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2 > far2;
    const k = Math.min(1, dt * 13);
    for (const m of this.mates.values()) {
      if (!m.chibi.group.enabled) continue;
      const px = m.x, pz = m.z;
      m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; m.z += (m.tz - m.z) * k; m.ry = lerpAngle(m.ry, m.tr, k);
      m.speed += (Math.hypot(m.x - px, m.z - pz) / Math.max(dt, 1e-4) - m.speed) * 0.2;
      if (m.st === PSTATE.ALIVE && m.speed > 1 && m.speed < 12) {
        const fl = L.floorBelow(m.x, m.y + 0.3, m.z);
        if (Math.abs(m.y - fl) < 0.1) {
          m.stride += m.speed * dt;
          if (m.stride > 1.8) { m.stride = 0; if (Math.hypot(m.x - cam.x, m.y + PLAYER.eye - cam.y, m.z - cam.z) < 16) sfx.at(fl).step(isIndoor(L.floorAt(m.x, fl, m.z)), m.x, m.z); }
        }
      }
      m.chibi.group.setPosition(m.x, m.y, m.z);
      m.chibi.group.setLocalEulerAngles(0, m.ry * RAD, 0);
      // Out in the fog: the body (and its shadow) are not drawn, but the name tag still shows where they are.
      const near = !inFog(m.x, m.y + 0.8, m.z);
      if (near !== m.near) {
        m.near = near;
        for (const c of m.chibi.group.children) if (c !== m.chibi.root && c !== m.tag) c.enabled = near;
      }
      // Your eye inside their body (you walked into them, or a teleport put you there): drawn, its inside and
      // ink hull would black out the whole screen, so leave them out until you have stepped apart.
      m.chibi.root.enabled = near && !(Math.hypot(m.x - cam.x, m.z - cam.z) < 0.55 && cam.y > m.y - 0.1 && cam.y < m.y + 1.9);
      // Manning a mounted gun, the hands are on it (drawn by mounts.ts), not on a gun of their own.
      if (m.gun) m.gun.enabled = m.st === PSTATE.ALIVE && m.mount < 0;
      m.swing -= dt;
      m.chibi.animate(m.st === PSTATE.DOWN ? 'down' : this.pinned.has(m.id) ? 'stagger' : m.swing > 0 ? (WEAPONS[m.gunW]?.id === 'machete' ? 'slash' : 'swing') : m.speed > 1 ? 'run' : 'aim', time, dt);
      m.tag.setRotation(cam.rot);
    }
    for (const z of this.zeds.values()) {
      z.x += (z.tx - z.x) * k; z.y += (z.ty - z.y) * k; z.z += (z.tz - z.z) * k; z.ry = lerpAngle(z.ry, z.tr, k);
      // A riding Piggyback clings to its victim's back: just behind their shoulders, facing the way they face
      // (whichever way it is steering them), so it is never drawn in front of their face.
      const riding = z.type === ZT.PIGGYBACK && z.st === ZSTATE.PIN;
      const rid = riding ? this.pinBy.get(z.id) : undefined, host = rid === me.id ? me : rid !== undefined ? this.mates.get(rid) : undefined;
      const g = z.chibi.group;
      if (host) {
        const hry = host === me ? me.yaw : (host as Mate).ry;
        g.setPosition(host.x + Math.sin(hry) * RIDE_BACK, host.y + 0.62, host.z + Math.cos(hry) * RIDE_BACK);
        g.setLocalEulerAngles(0, hry * RAD, 0);
      } else {
        g.setPosition(z.x, z.y + (riding ? 0.62 : 0), z.z);
        g.setLocalEulerAngles(0, z.ry * RAD, 0);
      }
      // Out in the fog: not drawn (measured from its middle, so a Brute's head can't poke out).
      const p = g.getPosition();
      g.enabled = !inFog(p.x, p.y + 0.75 * ZTYPES[z.type].scale, p.z);
      z.chibi.animate(z.type === ZT.WEEPER && z.st === ZSTATE.IDLE ? 'sit' : POSE[z.st] ?? 'idle', time, dt);
      // A Snatcher's scarf, from its hands to whoever it has.
      if (z.type === ZT.SNATCHER && z.st === ZSTATE.PIN) {
        const pid = this.pinBy.get(z.id), v = pid === me.id ? me : pid !== undefined ? this.mates.get(pid) : undefined;
        if (v) {
          _a.x = z.x - Math.sin(z.ry) * 0.4; _a.y = z.y + 0.95; _a.z = z.z - Math.cos(z.ry) * 0.4;
          _b.x = v.x; _b.y = v.y + (pid === me.id ? 0.75 : 0.8); _b.z = v.z;
          fx.rope(_a, _b);
        }
      }
      if (!this.seenTypes.has(z.type)) this.firstSight(z);
      // A ringing Alarm Clock keeps rattling until it is shot (or rings out).
      if (z.st === ZSTATE.RING) {
        z.sfxT -= dt;
        if (z.sfxT <= 0) { z.sfxT = 0.3; sfx.at(z.y).ring(z.x, z.z); if (Math.random() < 0.5) fx.burst({ x: z.x, y: z.y + 1.45 * ZTYPES[z.type].scale, z: z.z }, 0xffd43b, 1, 2, 0.1, true, 0.25, 0); }
      }
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      c.x += c.vx * dt; c.z += c.vz * dt;
      c.chibi.group.setPosition(c.x, c.y, c.z);
      c.chibi.tumble(Math.min(1.5, c.t * 6), Math.sin(Math.min(1, c.t / 0.4) * Math.PI) * 0.35, Math.min(1, c.t / 0.4), dt);
      if (c.t > 0.4) {
        fx.poof({ x: c.x, y: c.y + 0.2 * c.scale, z: c.z }, 0xf3f0ff, c.scale > 1.5 ? 14 : 6, 0.3 * c.scale);
        c.chibi.dispose();
        this.corpses.splice(i, 1);
      }
    }
    this.audio(dt, cam, view.listenY);
  }

  /**
   * Crowd voices, throttled: one walker voice at a time (more often in a crowd, at most ~5 a second;
   * the horde murmur bed carries the mass), dozing walkers snore, and each special nearby makes its
   * own presence cue on its own timer.
   */
  private audio(dt: number, cam: V3, ly: number): void {
    const { sfx } = this.deps;
    let awake = 0;
    for (const z of this.zeds.values()) {
      const d = Math.hypot(z.x - cam.x, z.y - ly, z.z - cam.z);
      if (z.st !== ZSTATE.IDLE && d < 22) awake++;
      if (!isCommon(z.type) && z.st !== ZSTATE.RING && d < 40) {
        z.vox -= dt;
        if (z.vox <= 0) z.vox = sfx.at(z.y).special(z.type, z.x, z.z, z.st);
      }
    }
    this.threat = awake;
    this.groanT -= dt;
    if (this.groanT <= 0 && this.zeds.size) {
      this.groanT = (0.4 + Math.random() * 1.3) / Math.min(2.5, 1 + awake / 8);
      const near = [...this.zeds.values()].filter((z) => isCommon(z.type) && Math.hypot(z.x - cam.x, z.y - ly, z.z - cam.z) < (z.st === ZSTATE.IDLE ? 14 : 26));
      if (near.length) {
        const z = near[(Math.random() * near.length) | 0];
        if (z.st === ZSTATE.IDLE) sfx.at(z.y).snore(z.x, z.z); else sfx.at(z.y).groan(z.x, z.z);
      }
    }
  }
}
