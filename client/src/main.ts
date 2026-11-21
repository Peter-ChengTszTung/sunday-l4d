// Chibi Outbreak client: rendering, local player simulation, and reconciling
// the server's authoritative zombies / health with what you see.
import * as pc from 'playcanvas';
import { TILE, CEIL_H, PLAYER, WEAPONS, ZTYPES, ZT, ZSTATE, PSTATE, ZHIT, SURVIVORS, ALARM, weaponIndex, type WeaponId } from '../../shared/constants';
import { F, isIndoor, cellOf, type Level } from '../../shared/level';
import { CHAPTERS, getLevel } from '../../shared/chapters';
import type { GameEvent, PlayerSnap, RoomInfo, RosterEntry, ServerMsg, ZombieSnap } from '../../shared/protocol';
import { buildWorld, type PickupView, type NoteView, type World } from './world';
import { Chibi, survivorLook, zombieLook, nameTag, type Pose } from './chibi';
import { ViewModel, worldGun } from './viewmodel';
import { app, setTorch } from './gfx';
import { quatYXZ } from './geo';
import { FX } from './fx';
import { Sfx } from './audio';
import { Hud, type MateView } from './hud';
import { Net, type JoinOpts } from './net';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const RAD = 180 / Math.PI;
const lerpAngle = (a: number, b: number, k: number) => {
  const d = (((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};

// -------------------------------------------------------------------- scene
const canvas = $<HTMLCanvasElement>('game');
const camera = new pc.Entity('camera');
camera.addComponent('camera', { fov: 74, nearClip: 0.08, farClip: 600, clearColor: new pc.Color(0.1, 0.07, 0.15) });
// 74° vertical FOV (about 105° horizontal at 16:9). On wider screens, hold the horizontal angle
// instead so ultrawide monitors don't get a fish-eye view.
const FOV_V = 74, FOV_H_MAX = 2 * Math.atan(Math.tan((FOV_V * Math.PI) / 360) * (16 / 9));
function fitFov(): void {
  const aspect = (canvas.clientWidth || 16) / (canvas.clientHeight || 9);
  camera.camera!.fov = aspect > 16 / 9 ? (2 * Math.atan(Math.tan(FOV_H_MAX / 2) / aspect) * 180) / Math.PI : FOV_V;
}
fitFov();
window.addEventListener('resize', fitFov);
app.root.addChild(camera);
const cam = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, rot: new pc.Quat() };

let chapter = Math.max(0, Math.min(CHAPTERS.length - 1, Number(params.get('ch') ?? localStorage.getItem('chibi.ch') ?? 0) || 0));
let L: Level = getLevel(chapter);
let world: World = buildWorld(L);
/** Swap the rendered world when the room moves to another chapter. */
function loadChapter(ch: number): void {
  if (ch === chapter && world) return;
  world.dispose();
  chapter = ch; L = getLevel(ch); world = buildWorld(L);
  step = 0; qc = 0; doors = 0;
}
const fx = new FX();
const sfx = new Sfx();
fx.onSplat = (x, z) => sfx.splat(Math.hypot(x - me.x, z - me.z));
const hud = new Hud();
const net = new Net();
const vm = new ViewModel(WEAPONS.map((w) => w.id));

// --------------------------------------------------------------------- state
interface Mate {
  id: number; name: string; look: number; /** Shirt colour as CSS, for the name tag and HUD. */ color: string; chibi: Chibi; tag: pc.Entity; gun: pc.Entity | null; gunW: number;
  x: number; y: number; z: number; ry: number; tx: number; ty: number; tz: number; tr: number;
  hp: number; st: number; respawn: number; rev: number; speed: number;
}
interface Zed { id: number; type: number; chibi: Chibi; x: number; z: number; ry: number; tx: number; tz: number; tr: number; st: number; sfxT: number }
interface Corpse { chibi: Chibi; t: number; vx: number; vz: number; x: number; z: number; scale: number }

const me = {
  id: 0, x: L.def.spawns[0].x, y: 0, z: L.def.spawns[0].z, vx: 0, vz: 0, vy: 0, kx: 0, kz: 0, yaw: Math.PI, pitch: 0,
  hp: PLAYER.hp as number, st: PSTATE.ALIVE as number, medkits: 0, respawn: 0, rev: 0,
  weapon: 0, primary: -1, sidearm: 0, mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve),
  fireCd: 0, reloadT: 0, shoveCd: 0, healT: 0, healLatch: false, slowT: 0, recoil: 0, bloom: 0, trauma: 0, reviving: 0, onGround: true,
  /** Pinned to a wall by a Charger: no moving, shooting or healing until 'unpin'. */
  pinned: false, pinX: 0, pinZ: 0,
};
const roster = new Map<number, RosterEntry>();
const mates = new Map<number, Mate>();
const zeds = new Map<number, Zed>();
const corpses: Corpse[] = [];
let inGame = false, locked = false, ended = false;
let doors = 0, step = 0, qc = 0, holdout = -1, serverState: 'play' | 'won' | 'lost' = 'play', debugServer = false;
let torchOn = true, groanT = 2, sendT = 0, lookDX = 0, lookDY = 0, time = 0;
const keys = new Set<string>();
const mouse = { left: false };

// --------------------------------------------------------------------- input
const active = () => inGame && (locked || DEBUG) && !ended;
document.addEventListener('keydown', (e) => {
  if (!inGame || e.repeat) return;
  keys.add(e.code);
  if (!active()) return;
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  switch (e.code) {
    case 'KeyR': startReload(); break;
    case 'Digit1': if (me.primary >= 0) switchWeapon(me.primary); break;
    case 'Digit2': switchWeapon(me.sidearm); break;
    case 'KeyF': torchOn = !torchOn; sfx.dryFire(); break;
    case 'KeyM': sfx.setMuted(!sfx.muted); hud.feed(sfx.muted ? 'Sound off' : 'Sound on'); break;
    case 'KeyE': interact(); break;
  }
});
document.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyQ') me.healLatch = false; });
window.addEventListener('blur', () => { keys.clear(); mouse.left = false; });
document.addEventListener('mousemove', (e) => {
  if (!locked || me.st === PSTATE.DEAD) return;
  me.yaw -= e.movementX * 0.0023;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * 0.0023));
  lookDX += e.movementX; lookDY += e.movementY;
});
document.addEventListener('mousedown', (e) => {
  if (!inGame) return;
  sfx.unlock();
  if (!locked && !DEBUG) { if (!ended) void canvas.requestPointerLock(); return; }
  if (e.button === 0) mouse.left = true;
  if (e.button === 2) shove();
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; });
document.addEventListener('contextmenu', (e) => { if (inGame) e.preventDefault(); });
document.addEventListener('wheel', () => { if (active() && me.primary >= 0) switchWeapon(me.weapon === me.primary ? me.sidearm : me.primary); }, { passive: true });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) { keys.clear(); mouse.left = false; }
  hud.pause(inGame && !locked && !ended && !DEBUG);
});

// ------------------------------------------------------------------- weapons
function switchWeapon(i: number): void {
  if (i === me.weapon || me.st !== PSTATE.ALIVE) return;
  me.weapon = i; me.reloadT = 0; me.fireCd = Math.max(me.fireCd, 0.3);
  vm.setWeapon(i);
}

function startReload(): void {
  const w = WEAPONS[me.weapon];
  if (me.reloadT > 0 || me.mag[me.weapon] >= w.mag || me.reserve[me.weapon] <= 0 || me.st !== PSTATE.ALIVE) return;
  me.reloadT = w.reload;
  sfx.reload();
}

type V3 = { x: number; y: number; z: number };
const _d: V3 = { x: 0, y: 0, z: 0 }, _end: V3 = { x: 0, y: 0, z: 0 }, _muz: V3 = { x: 0, y: 0, z: 0 };
interface ShotHit { zed: Zed; head: boolean; t: number }

/**
 * Hitscan against walls, floor and zombie hit spheres. A bullet passes through up to `pierce`
 * zombies (nearest first) and stops at a Brute; `t` is where it stopped.
 */
function castShot(o: V3, d: V3, range: number, pierce = 1): { t: number; hits: ShotHit[] } {
  const h = Math.hypot(d.x, d.z);
  let t = range;
  if (h > 1e-5) t = Math.min(t, L.rayGrid(o.x, o.z, d.x / h, d.z / h, range * h, doors) / h);
  if (d.y < -1e-5) t = Math.min(t, -o.y / d.y);
  const f = L.floorAt(o.x, o.z);
  if (d.y > 1e-5 && isIndoor(f)) t = Math.min(t, (CEIL_H - o.y) / d.y);
  const hits: ShotHit[] = [];
  const sphere = (cx: number, cy: number, cz: number, r: number): number => {
    const ox = cx - o.x, oy = cy - o.y, oz = cz - o.z;
    const tca = ox * d.x + oy * d.y + oz * d.z;
    if (tca < 0) return Infinity;
    const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
    return d2 > r * r ? Infinity : tca - Math.sqrt(r * r - d2);
  };
  for (const z of zeds.values()) {
    const s = ZTYPES[z.type].scale, fat = z.type === ZT.PUFFER ? 1.35 : z.type === ZT.BRUTE ? 1.25 : z.type === ZT.CHARGER ? 1.4 : 1;
    // Chargers duck their (smaller) head when winding up and rushing.
    const headY = z.type === ZT.PUFFER ? 1.16 : z.type === ZT.CHARGER && (z.st === ZSTATE.WINDUP || z.st === ZSTATE.CHARGE) ? ZHIT.headY * 0.84 : ZHIT.headY;
    const th = sphere(z.x, headY * s, z.z, ZHIT.headR * s * (z.type === ZT.BRUTE ? 0.85 : z.type === ZT.CHARGER ? 0.9 : 1));
    const tb = sphere(z.x, ZHIT.bodyY * s, z.z, ZHIT.bodyR * s * fat);
    const tz = Math.min(th, tb);
    if (tz < t) hits.push({ zed: z, head: th <= tb, t: tz });
  }
  hits.sort((a, b) => a.t - b.t);
  let n = 0;
  while (n < hits.length && n < pierce) if (hits[n++].zed.type === ZT.BRUTE) break;
  hits.length = n;
  if (n && (n === pierce || hits[n - 1].zed.type === ZT.BRUTE)) t = hits[n - 1].t;
  return { t, hits };
}

/** Camera basis for a shot: forward (cam.f*), right (rx, rz) and up (ux, uy, uz); also places `_muz`. */
function aimBasis(): { fwx: number; fwy: number; fwz: number; rx: number; rz: number; ux: number; uy: number; uz: number } {
  const fwx = cam.fx, fwy = cam.fy, fwz = cam.fz, rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
  const ux = -rz * fwy, uy = rz * fwx - rx * fwz, uz = rx * fwy;
  _muz.x = cam.x + rx * 0.2 - ux * 0.15 + fwx * 0.7; _muz.y = cam.y - uy * 0.15 + fwy * 0.7; _muz.z = cam.z + rz * 0.2 - uz * 0.15 + fwz * 0.7;
  return { fwx, fwy, fwz, rx, rz, ux, uy, uz };
}
/** Random direction in a disc of radius `spread` around forward, into `_d`. */
function spreadDir(b: ReturnType<typeof aimBasis>, spread: number): void {
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
  const ca = Math.cos(a) * r, sa = Math.sin(a) * r;
  _d.x = b.fwx + b.rx * ca + b.ux * sa; _d.y = b.fwy + b.uy * sa; _d.z = b.fwz + b.rz * ca + b.uz * sa;
  const dl = Math.hypot(_d.x, _d.y, _d.z); _d.x /= dl; _d.y /= dl; _d.z /= dl;
}

function fire(): void {
  const wi = me.weapon, w = WEAPONS[wi];
  if (me.fireCd > 0 || me.reloadT > 0 || me.healT > 0) return;
  if (me.mag[wi] <= 0) {
    if (me.reserve[wi] > 0) startReload(); else { sfx.dryFire(); me.fireCd = 0.3; }
    return;
  }
  me.mag[wi]--;
  // Scheduled shot clock: keep this frame's leftover so auto fire holds its rate at any FPS
  // (resetting to `rate` lost up to a frame per shot: the SMG ran at ~12 rounds/s at 60 FPS).
  me.fireCd = (me.fireCd < -w.rate ? 0 : me.fireCd) + w.rate;
  const b = aimBasis();
  const spread = w.spread + me.bloom;
  let first: [number, number, number] = [0, 0, 0];
  const hits = new Map<number, [number, number, number]>();
  let anyHead = false;
  if (w.blast) {
    spreadDir(b, spread);
    first = launchNade(wi);
  } else {
    for (let i = 0; i < w.pellets; i++) {
      spreadDir(b, spread);
      const shot = castShot(cam, _d, w.range, w.pierce);
      _end.x = cam.x + _d.x * shot.t; _end.y = cam.y + _d.y * shot.t; _end.z = cam.z + _d.z * shot.t;
      if (i === 0) first = [_end.x, _end.y, _end.z];
      if (i < 4) fx.tracer(_muz, _end, w.pellets > 1 ? 0.02 : w.pierce > 2 ? 0.05 : 0.032);
      for (const hit of shot.hits) {
        const p = { x: cam.x + _d.x * hit.t, y: cam.y + _d.y * hit.t, z: cam.z + _d.z * hit.t };
        const e = hits.get(hit.zed.id) ?? [hit.zed.id, 0, 0];
        if (hit.head) { e[2]++; anyHead = true; } else e[1]++;
        hits.set(hit.zed.id, e);
        hit.zed.chibi.punch = 1;
        fx.burst(p, 0xb4f05a, 2, 3, 0.07);
        if (hit.head) fx.burst(p, 0xffd43b, 2, 3.5, 0.12, true, 0.3, 4);
      }
      if (!shot.hits.length && shot.t < w.range) fx.burst(_end, 0xfff1a8, 2, 2.5, 0.07, true, 0.22, 3);
    }
  }
  if (hits.size) { hud.hitmark(anyHead, false); sfx.hit(anyHead); }
  net.send({ t: 'f', w: wi, h: [...hits.values()], e: first, ...(w.blast ? { n: nadeSeq } : {}) });
  vm.fire(); sfx.shoot(wi);
  me.recoil += w.recoil;
  me.bloom = Math.min(0.05, me.bloom + w.spread * 0.45);
  me.trauma = Math.min(1, me.trauma + w.shake);
  if (me.mag[wi] === 0 && me.reserve[wi] > 0) startReload();
}

// ----------------------------------------------------------------- grenades
/**
 * Launcher grenades. Your own fly for real (walls, floor, ceilings, zombies) and claim their
 * impact with 'g' when they land; teammates' are a visual arc to the end point their 'shot'
 * predicted (the boom itself comes from the server's 'blast').
 */
interface Nade {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; w: number;
  mine: boolean; ox: number; oz: number; shell: pc.Entity; trail: number;
  /** Visual offset from the eye to the muzzle, eased out over the first moments of flight. */ mx: number; my: number; mz: number;
  /** Remote arcs: lifetime. */ life: number;
  /** Own grenades: sequence number sent with 'f' and echoed in the 'g' impact claim. */ seq: number;
}
let nadeSeq = 0;
const nades: Nade[] = [];
/** Launcher reserve an ammo pile tops up to. */
const LAUNCHER_PILE = 6;

/** Step a grenade by dt. Returns true when it hits something (position left on the near side). */
function flyNade(n: Nade, dt: number, hitZeds: boolean): boolean {
  const B = WEAPONS[n.w].blast!;
  const steps = Math.max(1, Math.ceil((Math.hypot(n.vx, n.vy, n.vz) * dt) / 0.35)), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    n.vy -= B.grav * h; n.t += h;
    const x = n.x + n.vx * h, y = n.y + n.vy * h, z = n.z + n.vz * h;
    if (y <= 0.06) { n.x = x; n.z = z; n.y = 0.06; return true; }
    const tx = cellOf(x), tz = cellOf(z);
    if (L.opaqueAt(tx, tz, doors) || (y < 1 && L.solidAt(tx, tz, doors))) return true;
    if (y >= CEIL_H - 0.1 && isIndoor(L.floorAt(x, z))) return true;
    n.x = x; n.y = y; n.z = z;
    if (hitZeds) for (const zd of zeds.values()) {
      const T = ZTYPES[zd.type], r = T.radius * 1.2 + 0.2;
      if (y < T.scale * 1.5 && Math.abs(zd.x - x) < r && Math.abs(zd.z - z) < r && Math.hypot(zd.x - x, zd.z - z) < r) return true;
    }
    if (n.t >= B.fuse) return true;
  }
  return false;
}

/** Fire a grenade along `_d` from the eye. Returns the predicted landing point (walls only) for teammates. */
function launchNade(wi: number): [number, number, number] {
  const B = WEAPONS[wi].blast!;
  const n: Nade = {
    x: cam.x, y: cam.y, z: cam.z, vx: _d.x * B.speed, vy: _d.y * B.speed, vz: _d.z * B.speed, t: 0, w: wi,
    mine: true, ox: me.x, oz: me.z, shell: fx.shell(), trail: 0, mx: _muz.x - cam.x, my: _muz.y - cam.y, mz: _muz.z - cam.z, life: 0,
    seq: ++nadeSeq,
  };
  const ghost = { ...n };
  for (let i = 0; i < 400 && !flyNade(ghost, 1 / 60, false); i++);
  nades.push(n);
  placeNade(n);
  return [ghost.x, ghost.y, ghost.z];
}

function placeNade(n: Nade): void {
  const k = Math.max(0, 1 - n.t / 0.15);
  n.shell.setPosition(n.x + n.mx * k, n.y + n.my * k, n.z + n.mz * k);
  n.shell.lookAt(n.x + n.vx, n.y + n.vy, n.z + n.vz);
}

function boomFx(x: number, y: number, z: number, power: number): void {
  fx.blast({ x, y, z }, power);
  const d = Math.hypot(x - me.x, z - me.z);
  sfx.blast(d, power);
  me.trauma = Math.min(1, me.trauma + (power < 1 ? 0.5 : 1) / (1 + d * 0.15));
}

function updateNades(dt: number): void {
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    let done: boolean;
    if (n.mine) done = flyNade(n, dt, true);
    else { n.vy -= WEAPONS[n.w].blast!.grav * dt; n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt; n.t += dt; done = n.t >= n.life; }
    placeNade(n);
    n.trail -= dt;
    if (n.trail <= 0) { n.trail = 0.03; fx.trail(n.shell.getPosition()); }
    if (!done) continue;
    fx.dropShell(n.shell);
    nades.splice(i, 1);
    if (!n.mine) continue;
    // Predict the boom locally; the server validates the claim and does the damage.
    const B = WEAPONS[n.w].blast!;
    const power = Math.hypot(n.x - n.ox, n.z - n.oz) < B.arm ? 0.4 : 1;
    boomFx(n.x, n.y, n.z, power);
    net.send({ t: 'g', x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(2), n: n.seq });
  }
}

/** Debug (`window.__game.give(i)`): hand yourself weapon `i` with full ammo. */
function debugGive(wi: number): void {
  const w = WEAPONS[wi];
  if (!w) return;
  if (w.slot === 'sidearm') me.sidearm = wi; else me.primary = wi;
  me.mag[wi] = w.mag; me.reserve[wi] = w.reserve;
  switchWeapon(wi);
}

function clearNades(): void {
  for (const n of nades) fx.dropShell(n.shell);
  nades.length = 0;
}

function shove(): void {
  if (me.st !== PSTATE.ALIVE || me.shoveCd > 0 || !active()) return;
  me.shoveCd = PLAYER.shoveCd;
  net.send({ t: 'v' });
  vm.shove(); sfx.shove();
  // Predict the stagger squash locally so the shove feels instant.
  const fxd = -Math.sin(me.yaw), fzd = -Math.cos(me.yaw);
  for (const z of zeds.values()) {
    const dx = z.x - me.x, dz = z.z - me.z, d = Math.hypot(dx, dz);
    if (d < PLAYER.shoveRange + 0.4 && d > 0.01 && (dx * fxd + dz * fzd) / d > 0.3) { z.chibi.punch = 1; fx.burst({ x: z.x, y: 0.9, z: z.z }, 0xffffff, 2, 3, 0.1, true, 0.25, 3); }
  }
}

// ------------------------------------------------------------- interactions
type Target = { kind: 'revive'; mate: Mate } | { kind: 'pickup'; pv: PickupView; usable: boolean; text: string } | { kind: 'note'; nv: NoteView } | null;
let target: Target = null;

function findTarget(): Target {
  if (me.st !== PSTATE.ALIVE) return null;
  let best: Target = null, bestD = PLAYER.useRange;
  for (const m of mates.values()) {
    if (m.st !== PSTATE.DOWN) continue;
    const d = Math.hypot(m.x - me.x, m.z - me.z);
    if (d < bestD) { bestD = d; best = { kind: 'revive', mate: m }; }
  }
  if (best) return best;
  for (const nv of world.notes) {
    const d = Math.hypot(nv.def.x - me.x, nv.def.z - me.z);
    if (d < bestD) { bestD = d; best = { kind: 'note', nv }; }
  }
  for (const pv of world.pickups) {
    if (pv.taken || !pv.shown) continue;
    const d = Math.hypot(pv.def.x - me.x, pv.def.z - me.z);
    if (d >= bestD) continue;
    const k = pv.def.kind;
    let usable = true, text = '';
    if (k === 'medkit') { usable = me.medkits < 1; text = usable ? 'Grab medkit' : 'Already carrying a medkit'; }
    else if (k === 'ammo') { usable = me.primary >= 0; text = usable ? 'Refill ammo' : 'Ammo pile (pistol ammo is endless)'; }
    else if (k === 'obj') { if (holdout >= 0) continue; text = pv.def.label ?? 'Use'; }
    else if (k === 'item') text = `Pick up ${pv.def.label ?? 'item'}`;
    else {
      const wi = weaponIndex(k), w = WEAPONS[wi], cur = w.slot === 'sidearm' ? me.sidearm : me.primary;
      if (cur === wi) { usable = w.slot !== 'sidearm'; text = usable ? `Restock ${w.name}` : `Already carrying the ${w.name}`; }
      else text = cur >= 0 ? `Swap your ${WEAPONS[cur].name} for the ${w.name}` : `Take the ${w.name}`;
    }
    bestD = d; best = { kind: 'pickup', pv, usable, text };
  }
  return best;
}

function interact(): void {
  if (hud.noteOpen) { hud.note(null); return; }
  if (!target) return;
  if (target.kind === 'pickup' && target.usable) net.send({ t: 'u', id: target.pv.def.id });
  if (target.kind === 'note') { hud.note(target.nv.def.title, target.nv.def.text); openNote = target.nv; world.setNoteRead(target.nv.def.id); sfx.pickup(); }
}
let openNote: NoteView | null = null;

function onGot(pickupId: number): void {
  const pv = world.pickups[pickupId];
  if (!pv) return;
  const k = pv.def.kind;
  if (k === 'medkit') hud.feed('Medkit grabbed — hold Q to heal');
  else if (k === 'ammo') {
    if (me.primary >= 0) {
      // Launchers are a support tool: an ammo pile tops them up to 6 shells, not a full reserve.
      const w = WEAPONS[me.primary];
      me.reserve[me.primary] = w.blast ? Math.min(w.reserve, Math.max(me.reserve[me.primary], LAUNCHER_PILE)) : w.reserve;
    }
    hud.feed('Ammo topped up');
  }
  else if (k !== 'obj' && k !== 'item') {
    const wi = weaponIndex(k as WeaponId), w = WEAPONS[wi];
    if (w.slot === 'sidearm') me.sidearm = wi; else me.primary = wi;
    me.mag[wi] = w.mag; me.reserve[wi] = w.reserve;
    if (me.weapon === wi) me.reloadT = 0; else switchWeapon(wi);
    hud.feed(`Picked up the ${w.name}`);
  }
  sfx.pickup();
}

// ------------------------------------------------------------------ entities
function addMate(r: RosterEntry): Mate {
  const chibi = new Chibi(survivorLook(r.look));
  const color = hex(SURVIVORS[r.look % SURVIVORS.length].shirt);
  const tag = nameTag(r.name, color);
  tag.setLocalPosition(0, 1.72, 0);
  chibi.group.addChild(tag);
  chibi.group.enabled = false;
  app.root.addChild(chibi.group);
  const m: Mate = { id: r.id, name: r.name, look: r.look, color, chibi, tag, gun: null, gunW: -1, x: 0, y: 0, z: 0, ry: 0, tx: 0, ty: 0, tz: 0, tr: 0, hp: 100, st: 0, respawn: 0, rev: 0, speed: 0 };
  mates.set(r.id, m);
  return m;
}

function syncRoster(list: RosterEntry[]): void {
  roster.clear();
  for (const r of list) roster.set(r.id, r);
  for (const [id, m] of mates) if (!roster.has(id)) { m.chibi.dispose(); mates.delete(id); }
  for (const r of list) if (r.id !== me.id && !mates.has(r.id)) addMate(r);
}

function applyPlayers(list: PlayerSnap[]): void {
  for (const p of list) {
    const [id, x, y, z, ry, , hp, st, w, medkits, rev, , respawn] = p;
    if (id === me.id) {
      if (st !== me.st) {
        if (st === PSTATE.DOWN) { hud.banner('You are down!', true); sfx.down(); me.reloadT = 0; }
        vm.visible = st === PSTATE.ALIVE;
      }
      me.hp = hp; me.st = st; me.medkits = medkits; me.rev = rev; me.respawn = respawn;
      continue;
    }
    const m = mates.get(id);
    if (!m) continue;
    const fresh = !m.chibi.group.enabled && st !== PSTATE.DEAD;
    m.tx = x; m.ty = y; m.tz = z; m.tr = ry; m.hp = hp; m.st = st; m.rev = rev; m.respawn = respawn;
    if (fresh || Math.hypot(x - m.x, z - m.z) > 8) { m.x = x; m.y = y; m.z = z; m.ry = ry; }
    m.chibi.group.enabled = st !== PSTATE.DEAD;
    if (m.gunW !== w) {
      // The gun meshes are shared per weapon (see worldGun), so swapping only replaces a small entity.
      m.gun?.destroy();
      m.gun = worldGun(WEAPONS[w]?.id ?? 'pistol');
      m.gun.setLocalPosition(0.1, 0.74, -0.36); m.gun.setLocalScale(1.15, 1.15, 1.15);
      m.chibi.root.addChild(m.gun); m.gunW = w;
    }
  }
}

function applyZombies(list: ZombieSnap[]): void {
  const seen = new Set<number>();
  for (const [id, type, x, z, ry, st] of list) {
    seen.add(id);
    let zd = zeds.get(id);
    if (!zd) {
      const chibi = new Chibi(zombieLook(type, id));
      const sc = ZTYPES[type].scale;
      chibi.group.setLocalScale(sc, sc, sc);
      chibi.group.setPosition(x, 0, z);
      app.root.addChild(chibi.group);
      zd = { id, type, chibi, x, z, ry, tx: x, tz: z, tr: ry, st, sfxT: 0 };
      zeds.set(id, zd);
    }
    zd.tx = x; zd.tz = z; zd.tr = ry;
    if (st !== zd.st) {
      const dist = Math.hypot(x - me.x, z - me.z);
      if (st === ZSTATE.WINDUP) {
        if (type === ZT.CHARGER) { sfx.chargeTell(dist); if (dist < 24) fx.poof({ x, y: 0.1, z }, 0xd8cfe8, 4, 0.22); }
        else if (type === ZT.DROOLER) sfx.gurgle(dist);
        else sfx.leap(dist);
      }
      if (st === ZSTATE.CHARGE) sfx.chargeGo(dist);
    }
    zd.st = st;
  }
  for (const [id, zd] of zeds) if (!seen.has(id)) { zd.chibi.dispose(); zeds.delete(id); }
}

function killZed(id: number, head: boolean): void {
  const zd = zeds.get(id);
  if (!zd) return;
  zeds.delete(id);
  const dx = zd.x - me.x, dz = zd.z - me.z, d = Math.hypot(dx, dz) || 1;
  const s = ZTYPES[zd.type].scale;
  corpses.push({ chibi: zd.chibi, t: 0, vx: (dx / d) * 3, vz: (dz / d) * 3, x: zd.x, z: zd.z, scale: s });
  if (head) fx.burst({ x: zd.x, y: 1.1 * s, z: zd.z }, 0xffd43b, 5, 4, 0.14, true, 0.4, 5);
  fx.burst({ x: zd.x, y: 0.8 * s, z: zd.z }, 0xb4f05a, zd.type === ZT.BRUTE ? 16 : zd.type === ZT.CHARGER ? 9 : 4, 4, 0.1 * s);
  sfx.pop(d);
}

// Indexed by ZSTATE.
const POSE: Pose[] = ['idle', 'run', 'attack', 'stagger', 'windup', 'leap', 'charge', 'pin', 'ring'];
/** Survivors currently pinned by a Charger (drawn staggered against the wall). */
const pinned = new Set<number>();

// -------------------------------------------------------------------- events
function onEvent(ev: GameEvent): void {
  switch (ev[0]) {
    case 'reset': {
      const [, ch, st, dm, taken, keep] = ev;
      for (const z of zeds.values()) z.chibi.dispose();
      zeds.clear();
      for (const c of corpses) c.chibi.dispose();
      corpses.length = 0;
      fx.clearGoo(); pinned.clear(); me.pinned = false;
      const newChapter = ch !== chapter;
      clearNades();
      loadChapter(ch);
      if (keep) {
        // Checkpoint restart: keep your gun, top the ammo back up.
        for (let i = 0; i < WEAPONS.length; i++) { me.mag[i] = WEAPONS[i].mag; me.reserve[i] = WEAPONS[i].reserve; }
        Object.assign(me, { reloadT: 0, vy: 0, y: 0, kx: 0, kz: 0 });
      } else {
        Object.assign(me, { weapon: 0, primary: -1, sidearm: 0, mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve), reloadT: 0, vy: 0, y: 0, kx: 0, kz: 0, pitch: 0 });
        vm.setWeapon(0);
      }
      ended = false;
      doors = dm; world.setDoors(dm, true);
      for (const pv of world.pickups) world.setTaken(pv.def.id, false);
      for (const id of taken) world.setTaken(id, true);
      enterStep(st, false);
      if (!keep || newChapter) showIntro();
      else { hud.banner('Back to the checkpoint!'); hud.radio([], true); }
      hud.hideEnd();
      hud.pause(inGame && !locked && !DEBUG);
      break;
    }
    case 'tp': if (ev[1] === me.id) { me.x = ev[2]; me.z = ev[3]; me.yaw = ev[4]; me.y = 0; me.vy = 0; me.vx = me.vz = 0; } break;
    case 'msg': hud.feed(ev[1]); break;
    case 'heal': if (ev[1] === me.id) sfx.heal(); break;
    case 'shot': {
      if (ev[1] === me.id) break;
      const m = mates.get(ev[1]);
      if (!m) break;
      _muz.x = m.x - Math.sin(m.ry) * 0.5; _muz.y = m.y + 0.78; _muz.z = m.z - Math.cos(m.ry) * 0.5;
      _end.x = ev[3]; _end.y = ev[4]; _end.z = ev[5];
      const w = WEAPONS[ev[2]];
      if (w?.blast) {
        // A visual arc to the predicted landing point; the boom arrives as 'blast'.
        const B = w.blast, dist = Math.hypot(_end.x - _muz.x, _end.y - _muz.y, _end.z - _muz.z);
        const life = Math.min(B.fuse, Math.max(0.05, dist / B.speed));
        nades.push({ seq: 0, x: _muz.x, y: _muz.y, z: _muz.z, vx: (_end.x - _muz.x) / life, vy: (_end.y - _muz.y + 0.5 * B.grav * life * life) / life, vz: (_end.z - _muz.z) / life,
          t: 0, w: ev[2], mine: false, ox: 0, oz: 0, shell: fx.shell(), trail: 0, mx: 0, my: 0, mz: 0, life });
      } else fx.tracer(_muz, _end, w?.pierce > 2 ? 0.05 : 0.03);
      fx.burst(_muz, 0xffd43b, 1, 0.5, 0.16, true, 0.08, 0);
      sfx.shoot(ev[2], Math.max(1, Math.hypot(m.x - me.x, m.z - me.z)));
      break;
    }
    case 'shove': { const m = mates.get(ev[1]); if (m) m.chibi.punch = 0.6; break; }
    case 'pk': world.setTaken(ev[1], true); break;
    case 'got': if (ev[1] === me.id) onGot(ev[2]); break;
    case 'use': {
      world.setTaken(ev[2], true);
      const s = L.def.steps[step];
      const who = ev[1] === me.id ? 'You' : roster.get(ev[1])?.name ?? 'Someone';
      hud.feed(`${who}: ${(L.def.pickups[ev[2]]?.label ?? 'used it').replace(/\s*\(.*\)$/, '')}`);
      sfx.gate();
      if (s?.hold) { hud.banner('HOLD OUT!', true); if (!s.horde) sfx.horde(); } // with `horde` the server's 'horde' event (just before) already roared
      break;
    }
    case 'door': doors = ev[2] ? doors | (1 << ev[1]) : doors & ~(1 << ev[1]); world.setDoors(doors); sfx.gate(); break;
    case 'step': enterStep(ev[1], true); break;
    case 'item': {
      const who = ev[1] === me.id ? 'You' : roster.get(ev[1])?.name ?? 'Someone';
      hud.feed(`${who} found a ${L.def.pickups[ev[2]]?.label ?? 'item'} (${ev[3]}/${ev[4]})`);
      sfx.pickup();
      break;
    }
    case 'checkpoint': hud.banner('Checkpoint saved'); sfx.heal(); break;
    case 'zdie': killZed(ev[1], ev[5] === 1); if (ev[6] === me.id) hud.hitmark(ev[5] === 1, true); break;
    case 'boom': {
      const p = { x: ev[1], y: 0.9, z: ev[2] };
      fx.burst(p, 0xc8f25a, 26, 8, 0.22); fx.poof(p, 0xe9f76a, 10, 0.5);
      const d = Math.hypot(ev[1] - me.x, ev[2] - me.z);
      sfx.boom(d); me.trauma = Math.min(1, me.trauma + 1 / (1 + d * 0.2));
      break;
    }
    case 'goo': if (ev[1] === me.id) hud.goo(); break;
    case 'hurt':
      if (ev[1] !== me.id) { const m = mates.get(ev[1]); if (m) m.chibi.punch = 0.8; break; }
      {
        const dx = ev[3] - me.x, dz = ev[4] - me.z;
        hud.hurt(Math.atan2(dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw), -dx * Math.sin(me.yaw) - dz * Math.cos(me.yaw)));
        sfx.hurt(); me.slowT = 0.35; me.trauma = Math.min(1, me.trauma + 0.25 + ev[2] * 0.02);
      }
      break;
    case 'down': if (ev[1] !== me.id) { hud.feed(`${roster.get(ev[1])?.name ?? 'A teammate'} is down!`); sfx.down(); } break;
    case 'dead': hud.feed(`${ev[1] === me.id ? 'You are' : (roster.get(ev[1])?.name ?? 'A teammate') + ' is'} out — rescue in ${PLAYER.respawnTime}s`); break;
    case 'revived':
      if (ev[1] === me.id) { hud.banner('Back on your feet!'); sfx.heal(); }
      else hud.feed(`${roster.get(ev[1])?.name ?? 'A teammate'} was helped up`);
      break;
    case 'blast': if (ev[1] !== me.id) boomFx(ev[2], ev[3], ev[4], ev[5]); break;
    case 'kb': if (ev[1] === me.id) { me.kx = ev[2]; me.kz = ev[3]; me.vy = 4; me.onGround = false; me.trauma = 1; } break;
    case 'horde': hud.banner('HORDE INCOMING!', true); sfx.horde(); break;
    case 'brute': hud.banner('A BRUTE approaches…', true); sfx.brute(); break;
    case 'slam': {
      const d = Math.hypot(ev[2] - me.x, ev[3] - me.z);
      fx.burst({ x: ev[2], y: 0.6, z: ev[3] }, 0xffffff, 6, 4, 0.14, true, 0.35, 4);
      fx.poof({ x: ev[2], y: 0.3, z: ev[3] }, 0xd8cfe8, 7, 0.35);
      sfx.thud(d); me.trauma = Math.min(1, me.trauma + 0.8 / (1 + d * 0.25));
      break;
    }
    case 'pin': {
      pinned.add(ev[1]);
      if (ev[1] === me.id) {
        Object.assign(me, { pinned: true, pinX: ev[3], pinZ: ev[4], x: ev[3], z: ev[4], kx: 0, kz: 0, vx: 0, vz: 0, reloadT: 0, healT: 0, trauma: 1 });
        hud.banner('PINNED! Hang on…', true);
      } else {
        const who = roster.get(ev[1])?.name ?? 'A teammate';
        hud.banner(`${who} is PINNED — shoot the Charger!`, true);
        hud.feed(`A Charger slammed ${who} into a wall!`);
      }
      sfx.down();
      break;
    }
    case 'unpin':
      pinned.delete(ev[1]);
      if (ev[1] === me.id) { me.pinned = false; if (me.st === PSTATE.ALIVE) hud.feed('Free from the Charger!'); }
      break;
    case 'spit': {
      const [, , x0, z0, x1, z1, flight] = ev;
      fx.glob(x0, z0, x1, z1, flight);
      sfx.spit(Math.hypot(x0 - me.x, z0 - me.z));
      // Warn whoever is about to be gooed: the target spot is where they stand.
      if (Math.hypot(x1 - me.x, z1 - me.z) < 3.5 && me.st !== PSTATE.DEAD) hud.feed('Goo incoming — move!');
      break;
    }
    case 'puddle': fx.puddle(ev[1], ev[2], ev[3], ev[4], ev[5]); break;
    case 'sizzle':
      if (ev[1] === me.id) { sfx.sizzle(); me.trauma = Math.min(1, me.trauma + 0.08); }
      else { const m = mates.get(ev[1]); if (m) m.chibi.punch = 0.4; }
      break;
    case 'ring': {
      const zd = zeds.get(ev[1]);
      const d = zd ? Math.hypot(zd.x - me.x, zd.z - me.z) : 20;
      hud.banner(`ALARM CLOCK! Shoot it — ${ALARM.ringTime} s!`, true);
      hud.feed(`An Alarm Clock is ringing ${Math.round(d)} m away`);
      break;
    }
    case 'alarm': {
      hud.banner('The alarm rang out — sleepers incoming!', true);
      sfx.alarmOut();
      fx.burst({ x: ev[2], y: 1.4, z: ev[3] }, 0xffd43b, 10, 5, 0.16, true, 0.5, 2);
      break;
    }
    case 'end': {
      ended = true;
      const board = (ev[4] ?? []).map(([id, kills]) => ({ name: id === me.id ? 'You' : roster.get(id)?.name ?? '???', kills }));
      const ni = ev[5] ?? -1, next = CHAPTERS[ni];
      hud.showEnd(ev[1] === 1, ev[2], ev[3], board,
        ev[1] === 1 ? (next ? (ni === 0 ? 'Campaign complete! Back to chapter 1…' : `Next: Chapter ${ni + 1} — ${next.title}`) : '')
          : 'Back to the last checkpoint (or the chapter start)…');
      hud.pause(false);
      if (ev[1] === 1) sfx.win(); else sfx.lose();
      break;
    }
  }
}

net.onMessage = (m: ServerMsg) => {
  switch (m.t) {
    case 'w':
      loadChapter(m.ch);
      me.id = m.id; me.x = m.x; me.z = m.z;
      for (const pv of world.pickups) world.setTaken(pv.def.id, false);
      for (const id of m.taken) world.setTaken(id, true);
      doors = m.doors; world.setDoors(doors, true);
      debugServer = m.debug === 1;
      enterStep(m.step, false);
      showIntro();
      history.replaceState(null, '', `${location.pathname}${location.search}#${m.room}`);
      hud.setRoom(m.room);
      enterGame();
      break;
    case 'ro': syncRoster(m.players); break;
    case 'err': $('lobbymsg').textContent = m.msg; break;
    case 's':
      serverState = m.st; holdout = m.ho; qc = m.qc;
      if (m.g !== doors) { doors = m.g; world.setDoors(doors); }
      for (const ev of m.ev) onEvent(ev);
      applyPlayers(m.p);
      applyZombies(m.z);
      break;
  }
};
net.onClose = () => {
  if (!inGame) { for (const b of lobbyButtons()) b.disabled = false; return; }
  inGame = false;
  document.exitPointerLock();
  hud.show(false); hud.pause(false);
  $('lobby').hidden = false;
  $('lobbymsg').textContent = 'Disconnected from the server.';
  for (const b of lobbyButtons()) b.disabled = false;
  void refreshRooms();
};

// --------------------------------------------------------------------- lobby
const nameInput = $<HTMLInputElement>('name');
nameInput.value = params.get('name') ?? localStorage.getItem('chibi.name') ?? '';
const inviteCode = (params.get('room') ?? location.hash.slice(1)).toUpperCase().replace(/[^A-Z0-9]/g, '');

const lobbyButtons = () => [...document.querySelectorAll<HTMLButtonElement>('#lobby button')];
async function join(opts: Omit<JoinOpts, 'name'>): Promise<void> {
  for (const b of lobbyButtons()) b.disabled = true;
  $('lobbymsg').textContent = '';
  sfx.unlock();
  try { localStorage.setItem('chibi.name', nameInput.value.trim()); localStorage.setItem('chibi.ch', String(chapter)); } catch { /* private mode */ }
  try { await net.connect({ name: nameInput.value.trim(), ...opts }); }
  catch (e) { $('lobbymsg').textContent = (e as Error).message; for (const b of lobbyButtons()) b.disabled = false; }
}
$('create').addEventListener('submit', (e) => {
  e.preventDefault();
  void join({ room: '', create: true, ch: chapter, cp: Number($<HTMLSelectElement>('startat').value), priv: $<HTMLInputElement>('priv').checked });
});
$('quick').addEventListener('click', () => { void join({ room: '' }); });
$('pause').addEventListener('mousedown', () => { void canvas.requestPointerLock(); });
if (inviteCode) {
  $('invite').hidden = false;
  $('invitecode').textContent = inviteCode;
  $('joininvite').addEventListener('click', () => { void join({ room: inviteCode }); });
}

/** Open rooms, polled while the lobby is showing. */
async function refreshRooms(): Promise<void> {
  if (inGame || $('lobby').hidden) return;
  let list: RoomInfo[];
  try { list = await (await fetch('/api/rooms', { cache: 'no-store' })).json(); } catch { return; }
  const ul = $('rooms');
  $('roomcount').textContent = list.length ? `(${list.length})` : '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No open rooms yet. Create one!'; ul.replaceChildren(li); return; }
  ul.replaceChildren(...list.map((r) => {
    const li = document.createElement('li');
    const t = document.createElement('div'); t.className = 'rt';
    const code = document.createElement('b'); code.textContent = r.code;
    t.append(code, `Ch ${r.ch + 1} · ${r.title}`);
    const st = document.createElement('div'); st.className = 'rs';
    st.textContent = `${r.state === 'play' ? `Step ${r.step}/${r.steps}: ${r.objective}` : r.state === 'won' ? 'Chapter complete' : 'Regrouping'} · ${r.players.length}/${r.max} ${r.players.join(', ')}`;
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn';
    btn.textContent = r.players.length >= r.max ? 'FULL' : 'JOIN';
    btn.disabled = r.players.length >= r.max;
    btn.addEventListener('click', () => { void join({ room: r.code }); });
    li.append(t, btn, st);
    return li;
  }));
}
setInterval(() => { void refreshRooms(); }, 3000);
void refreshRooms();

function enterGame(): void {
  inGame = true; ended = false; vm.visible = me.st === PSTATE.ALIVE;
  $('lobby').hidden = true;
  hud.show(true);
  hud.pause(!locked && !DEBUG);
  if (!DEBUG) void canvas.requestPointerLock();
}
// `?room=X&step=N` (from the map viewer) joins straight away and jumps to that quest step on a dev server.
if ((DEBUG || params.has('step')) && params.has('room')) void join({ room: inviteCode, ch: chapter });

// Chapter picker (also swaps the lobby backdrop).
const chapterSelect = $<HTMLSelectElement>('chapter');
chapterSelect.replaceChildren(...CHAPTERS.map((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i + 1}. ${c.title}`; return o; }));
chapterSelect.value = String(chapter);
const startSelect = $<HTMLSelectElement>('startat');
/** "Start at" choices: the chapter start or any of its checkpoint safe rooms. */
function fillStarts(): void {
  const opts: [number, string][] = [[-1, 'Chapter start']];
  L.def.steps.forEach((s, i) => { if (s.kind === 'gather' && s.checkpoint) opts.push([i, `Safe room ${opts.length}: ${s.objective.replace(/^(Get everyone into|Regroup in|Shelter in|Hole up in|Rest up in|Lock yourselves in)\s+/i, '')}`]); });
  startSelect.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = t; return o; }));
}
fillStarts();
chapterSelect.addEventListener('change', () => { loadChapter(Number(chapterSelect.value)); fillStarts(); });

function showIntro(): void {
  const d = L.def;
  hud.intro(chapter + 1, d.title, d.subtitle, d.intro);
}

/** A new quest step became active: update markers, play its radio lines. */
function enterStep(i: number, announce: boolean): void {
  step = i; qc = 0;
  world.setStep(i);
  const s = L.def.steps[i];
  if (!s) return;
  hud.radio(s.radio, true);
  if (announce) { hud.flashObjective(); sfx.pickup(); }
}

/** Where the quest marker should point right now (world metres). */
function waypointTarget(): { x: number; z: number } | null {
  const s = L.def.steps[step];
  if (!s || serverState !== 'play') return null;
  if (s.kind === 'collect') {
    let best: { x: number; z: number } | null = null, bd = Infinity;
    for (const pv of world.pickups) {
      if (pv.def.kind !== 'item' || pv.def.group !== s.group || pv.taken) continue;
      const d = Math.hypot(pv.def.x - me.x, pv.def.z - me.z);
      if (d < bd) { bd = d; best = pv.def; }
    }
    return best;
  }
  if ((s.kind === 'reach' || s.kind === 'gather') && s.area && L.inRect(me.x, me.z, s.area)) return null;
  if (holdout >= 0 && s.kind !== 'holdout') return null;
  return s.at;
}

const _wp = new pc.Vec3(), _scr = new pc.Vec3();
function updateWaypoint(): void {
  const t = me.st === PSTATE.DEAD ? null : waypointTarget();
  if (!t) { hud.waypoint(null); return; }
  const dist = Math.hypot(t.x - me.x, t.z - me.z);
  _wp.set(t.x, 1.6, t.z);
  const w = canvas.clientWidth, h = canvas.clientHeight, m = 36;
  const ahead = (t.x - cam.x) * cam.fx + (1.6 - cam.y) * cam.fy + (t.z - cam.z) * cam.fz;
  camera.camera!.worldToScreen(_wp, _scr);
  let x = _scr.x, y = _scr.y;
  let edge = false;
  if (ahead <= 0.1) { x = w - x; y = h - y; edge = true; } // behind: mirror, then push to the edge
  if (edge || x < m || x > w - m || y < m || y > h - m) {
    const cx = w / 2, cy = h / 2;
    let dx = x - cx, dy = y - cy;
    if (ahead <= 0.1 && Math.abs(dy) > Math.abs(dx) * 0.2) dy = Math.abs(dy); // behind → bottom edge reads better
    const k = Math.min((w / 2 - m) / Math.max(1e-3, Math.abs(dx)), (h / 2 - m) / Math.max(1e-3, Math.abs(dy)));
    x = cx + dx * k; y = cy + dy * k; edge = true;
  }
  hud.waypoint(x, y, dist, edge);
}

// ---------------------------------------------------------------- simulation
function updateMe(dt: number): void {
  if (me.pinned && me.st !== PSTATE.ALIVE) me.pinned = false;
  const alive = me.st === PSTATE.ALIVE, on = active() && alive && !me.pinned;
  me.fireCd -= dt; me.shoveCd -= dt; me.slowT -= dt;
  me.bloom = Math.max(0, me.bloom - dt * 0.09);
  me.recoil += (0 - me.recoil) * Math.min(1, dt * 9);

  // Movement.
  let f = 0, s = 0;
  if (on) { f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0); s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0); }
  const len = Math.hypot(f, s) || 1;
  const speed = PLAYER.speed * (me.hp < 40 ? 0.82 : 1) * (me.slowT > 0 ? 0.55 : 1) * (me.healT > 0 ? 0.35 : 1);
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  const wx = ((-sin * f + cos * s) / len) * speed, wz = ((-cos * f - sin * s) / len) * speed;
  const k = Math.min(1, dt * (me.onGround ? 14 : 4));
  me.vx += (wx - me.vx) * k; me.vz += (wz - me.vz) * k;
  if (alive) {
    if (me.pinned) { me.x = me.pinX; me.z = me.pinZ; me.vx = me.vz = me.kx = me.kz = 0; }
    else L.moveSlide(me, (me.vx + me.kx) * dt, (me.vz + me.kz) * dt, PLAYER.radius, doors);
    me.kx *= Math.max(0, 1 - dt * 5); me.kz *= Math.max(0, 1 - dt * 5);
    if (on && keys.has('Space') && me.onGround) { me.vy = 6.4; me.onGround = false; }
    me.vy -= 19 * dt; me.y += me.vy * dt;
    if (me.y <= 0) { me.y = 0; me.vy = 0; me.onGround = true; }
    // Zombies are solid: get shouldered out of them.
    for (const z of zeds.values()) {
      const min = PLAYER.radius + ZTYPES[z.type].radius * 0.85, dx = me.x - z.x, dz = me.z - z.z;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 0.001) L.moveSlide(me, (dx / d) * (min - d), (dz / d) * (min - d), PLAYER.radius, doors);
    }
  } else { me.vx = me.vz = 0; me.y = 0; }

  // Weapons.
  if (me.reloadT > 0) {
    const w = WEAPONS[me.weapon];
    me.reloadT -= dt;
    vm.setReload(1 - me.reloadT / w.reload);
    if (me.reloadT <= 0) {
      const take = Math.min(w.mag - me.mag[me.weapon], me.reserve[me.weapon]);
      me.mag[me.weapon] += take; me.reserve[me.weapon] -= take;
      vm.setReload(0); sfx.reloadDone();
    }
  }
  if (on && mouse.left) fire();
  updateNades(dt);

  // Medkit channel.
  const healing = on && keys.has('KeyQ') && !me.healLatch && me.medkits > 0 && me.hp < PLAYER.hp;
  if (healing) {
    me.healT += dt;
    if (me.healT >= PLAYER.healTime) { net.send({ t: 'h' }); me.healT = 0; me.healLatch = true; }
  } else me.healT = 0;

  // Revive channel.
  target = on ? findTarget() : null;
  const wantRevive = target?.kind === 'revive' && keys.has('KeyE') ? target.mate.id : 0;
  if (wantRevive !== me.reviving) { me.reviving = wantRevive; net.send({ t: 'r', id: wantRevive }); }

  sendT -= dt;
  if (sendT <= 0) {
    sendT = 0.05;
    net.send({ t: 'p', x: +me.x.toFixed(2), y: +me.y.toFixed(2), z: +me.z.toFixed(2), ry: +me.yaw.toFixed(3), rx: +me.pitch.toFixed(3), w: me.weapon, a: 0 });
  }
}

function updateCamera(dt: number): void {
  me.trauma = Math.max(0, me.trauma - dt * 2.2);
  const shake = me.trauma * me.trauma * 0.05;
  if (me.st === PSTATE.DEAD) {
    // Watch the first teammate still standing, else the first one who is only down.
    let m: Mate | undefined, alt: Mate | undefined;
    for (const q of mates.values()) {
      if (q.st === PSTATE.ALIVE) { m = q; break; }
      if (!alt && q.st !== PSTATE.DEAD) alt = q;
    }
    m ??= alt;
    if (m) { cam.x = m.x + Math.sin(m.ry) * 3.2; cam.y = 2.6; cam.z = m.z + Math.cos(m.ry) * 3.2; camera.setPosition(cam.x, cam.y, cam.z); camera.lookAt(m.x, 1.0, m.z); }
    else { cam.x = me.x; cam.y = 6; cam.z = me.z + 4; camera.setPosition(cam.x, cam.y, cam.z); camera.lookAt(me.x, 0, me.z); }
    cam.rot.copy(camera.getRotation());
    setTorch(false, 0, 0, 0, 0, 0, -1);
    return;
  }
  const down = me.st === PSTATE.DOWN;
  const pitch = me.pitch + me.recoil;
  cam.x = me.x; cam.y = me.y + (down ? 0.42 : PLAYER.eye); cam.z = me.z;
  cam.fx = -Math.sin(me.yaw) * Math.cos(pitch); cam.fy = Math.sin(pitch); cam.fz = -Math.cos(me.yaw) * Math.cos(pitch);
  quatYXZ(pitch + (Math.random() - 0.5) * shake, me.yaw + (Math.random() - 0.5) * shake, down ? 0.35 : (Math.random() - 0.5) * shake, cam.rot);
  camera.setPosition(cam.x, cam.y, cam.z);
  camera.setRotation(cam.rot);
  setTorch(torchOn && !down, cam.x, cam.y - 0.1, cam.z, cam.fx, cam.fy, cam.fz);
}

function updateEntities(dt: number): void {
  const k = Math.min(1, dt * 13);
  for (const m of mates.values()) {
    if (!m.chibi.group.enabled) continue;
    const px = m.x, pz = m.z;
    m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; m.z += (m.tz - m.z) * k; m.ry = lerpAngle(m.ry, m.tr, k);
    m.speed += (Math.hypot(m.x - px, m.z - pz) / Math.max(dt, 1e-4) - m.speed) * 0.2;
    m.chibi.group.setPosition(m.x, m.y, m.z);
    m.chibi.group.setLocalEulerAngles(0, m.ry * RAD, 0);
    if (m.gun) m.gun.enabled = m.st === PSTATE.ALIVE;
    m.chibi.animate(m.st === PSTATE.DOWN ? 'down' : pinned.has(m.id) ? 'stagger' : m.speed > 1 ? 'run' : 'aim', time, dt);
    m.tag.setRotation(cam.rot);
  }
  for (const z of zeds.values()) {
    z.x += (z.tx - z.x) * k; z.z += (z.tz - z.z) * k; z.ry = lerpAngle(z.ry, z.tr, k);
    z.chibi.group.setPosition(z.x, 0, z.z);
    z.chibi.group.setLocalEulerAngles(0, z.ry * RAD, 0);
    z.chibi.animate(POSE[z.st] ?? 'idle', time, dt);
    // A ringing Alarm Clock keeps rattling until it is shot (or rings out).
    if (z.st === ZSTATE.RING) {
      z.sfxT -= dt;
      if (z.sfxT <= 0) { z.sfxT = 0.3; sfx.ring(Math.hypot(z.x - me.x, z.z - me.z)); if (Math.random() < 0.5) fx.burst({ x: z.x, y: 1.45 * ZTYPES[z.type].scale, z: z.z }, 0xffd43b, 1, 2, 0.1, true, 0.25, 0); }
    }
  }
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.t += dt;
    c.x += c.vx * dt; c.z += c.vz * dt;
    c.chibi.group.setPosition(c.x, 0, c.z);
    c.chibi.tumble(Math.min(1.5, c.t * 6), Math.sin(Math.min(1, c.t / 0.4) * Math.PI) * 0.35);
    if (c.t > 0.4) {
      fx.poof({ x: c.x, y: 0.2 * c.scale, z: c.z }, 0xf3f0ff, c.scale > 1.5 ? 14 : 6, 0.3 * c.scale);
      c.chibi.dispose();
      corpses.splice(i, 1);
    }
  }
  groanT -= dt;
  if (groanT <= 0 && zeds.size) {
    groanT = 0.5 + Math.random() * 1.6;
    const near = [...zeds.values()].filter((z) => z.st !== ZSTATE.IDLE && Math.hypot(z.x - me.x, z.z - me.z) < 26);
    if (near.length) { const z = near[(Math.random() * near.length) | 0]; sfx.groan(Math.hypot(z.x - me.x, z.z - me.z), z.type === ZT.BRUTE); }
  }
}

/** Reused every frame by `updateHud`. */
const team: MateView[] = [];
function updateHud(dt: number): void {
  const w = WEAPONS[me.weapon];
  hud.setHealth(me.hp, me.st, me.medkits);
  hud.setAmmo(w.name, me.mag[me.weapon], me.reserve[me.weapon], w.mag, me.reloadT > 0, WEAPONS[me.primary]?.name ?? '', me.weapon === me.primary ? 1 : 2, WEAPONS[me.sidearm].name);
  let n = 0;
  for (const m of mates.values()) {
    const v = team[n] ?? (team[n] = { id: 0, name: '', color: '', hp: 0, st: 0, respawn: 0 });
    v.id = m.id; v.name = m.name; v.color = m.color; v.hp = m.hp; v.st = m.st; v.respawn = m.respawn;
    n++;
  }
  team.length = n;
  hud.setTeam(team);
  hud.setHoldout(holdout);
  const s = L.def.steps[step];
  hud.setObjective(serverState !== 'play' || !s ? '—' : s.kind === 'collect' ? `${s.objective} ${qc}/${s.count}` : s.objective);
  updateWaypoint();
  if (openNote && Math.hypot(openNote.def.x - me.x, openNote.def.z - me.z) > PLAYER.useRange + 1) { hud.note(null); openNote = null; }
  hud.crosshair(me.st === PSTATE.ALIVE);
  hud.spread(6 + (w.spread + me.bloom) * 260);
  hud.spectate(me.st === PSTATE.DEAD ? `Knocked out — a teammate will rescue you in ${me.respawn}s` : me.st === PSTATE.DOWN ? 'You are down! Wait for a teammate to help you up'
    : me.pinned ? 'Pinned by a Charger! Teammates can shoot or shove it off you' : null);

  if (me.st === PSTATE.DOWN && me.rev > 0) { hud.ring(me.rev, 'Being helped up…'); hud.prompt(null); }
  else if (me.healT > 0) { hud.ring(me.healT / PLAYER.healTime, 'Patching up…', 'var(--pink)'); hud.prompt(null); }
  else if (target?.kind === 'revive') {
    if (me.reviving) { hud.ring(target.mate.rev, `Helping ${target.mate.name}…`); hud.prompt(null); }
    else { hud.ring(null); hud.prompt(`<kbd>Hold E</kbd> Help ${target.mate.name} up`); }
  } else {
    hud.ring(null);
    hud.prompt(target?.kind === 'pickup' ? (target.usable ? `<kbd>E</kbd> ${target.text}` : target.text)
      : target?.kind === 'note' && !hud.noteOpen ? `<kbd>E</kbd> Read: ${target.nv.def.title}`
        : me.st !== PSTATE.DEAD && fx.inGoo(me.x, me.z) ? 'Get out of the goo!' : null);
  }
  hud.update(dt);
}

// ---------------------------------------------------------------------- loop
let orbit = 0;
// `dt` is already capped by `app.maxDeltaTime` (gfx.ts).
app.on('update', (dt: number) => {
  time += dt;
  if (inGame) {
    updateMe(dt);
    updateCamera(dt);
    updateEntities(dt);
    updateHud(dt);
    const moving = Math.min(1, Math.hypot(me.vx, me.vz) / PLAYER.speed) * (me.onGround ? 1 : 0.2);
    vm.update(dt, moving, lookDX, lookDY);
    lookDX = lookDY = 0;
  } else {
    // Lobby backdrop: a slow drift down the main street.
    orbit += dt * 0.12;
    const cpSel = Number(startSelect.value);
    const look = (cpSel >= 0 ? L.def.steps[cpSel]?.at : L.def.steps[0]?.at) ?? L.def.spawns[0];
    cam.x = look.x + Math.sin(orbit) * 4; cam.y = 3.2; cam.z = look.z + Math.cos(orbit * 0.7) * 4;
    quatYXZ(-0.05, Math.PI + Math.sin(orbit * 0.5) * 0.5, 0, cam.rot);
    camera.setPosition(cam.x, cam.y, cam.z);
    camera.setRotation(cam.rot);
    vm.visible = false;
    vm.update(dt, 0, 0, 0);
  }
  world.update(time, dt, cam.x, cam.y, cam.z);
  fx.update(dt, cam.rot);
});
app.start();

// Debug: `?debug&step=N` jumps the room to quest step N after joining (dev server only).
const jump = (n: number) => { if (debugServer) net.send({ t: 'dbg', step: n }); };
if (params.has('step')) { const n = Number(params.get('step')); const t = setInterval(() => { if (me.id && debugServer) { jump(n); clearInterval(t); } }, 200); }
if (DEBUG) Object.assign(window, { __game: { me, zeds, mates, keys, mouse, net, camera, app, get world() { return world; }, get level() { return L; }, fire, shove, interact, jump, give: debugGive, state: () => ({ inGame, locked, ended, chapter, step, qc, doors, holdout, serverState }) } });
