// Chibi Outbreak client: rendering, local player simulation, and reconciling
// the server's authoritative zombies / health with what you see.
import * as THREE from 'three';
import { TILE, CEIL_H, PLAYER, WEAPONS, ZTYPES, ZT, ZSTATE, PSTATE, ZHIT, SURVIVORS } from '../../shared/constants';
import { MAP, F, floorAt, moveSlide, rayGrid } from '../../shared/map';
import type { GameEvent, PlayerSnap, RosterEntry, ServerMsg, ZombieSnap } from '../../shared/protocol';
import { buildWorld, type PickupView } from './world';
import { Chibi, survivorLook, zombieLook, nameTag, type Pose } from './chibi';
import { ViewModel, buildGun } from './viewmodel';
import { FX } from './fx';
import { Sfx } from './audio';
import { Hud, type MateView } from './hud';
import { Net } from './net';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const lerpAngle = (a: number, b: number, k: number) => {
  const d = (((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * k;
};

// ------------------------------------------------------------------ renderer
const canvas = $<HTMLCanvasElement>('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x7a4f8e, 24, 105);
const camera = new THREE.PerspectiveCamera(74, 1, 0.08, 600);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xc9d2ff, 0x6a557f, 1.9));
const moon = new THREE.DirectionalLight(0xffe1cf, 1.7);
moon.position.set(-0.4, 1, 0.9);
scene.add(moon);
const torch = new THREE.SpotLight(0xfff3d6, 9, 30, 0.52, 0.6, 0.9);
torch.position.set(0.15, -0.1, 0);
torch.target.position.set(0, -0.05, -1);
camera.add(torch, torch.target);

const world = buildWorld(scene, renderer);
const fx = new FX(scene);
const sfx = new Sfx();
const hud = new Hud();
const net = new Net();
const vm = new ViewModel(WEAPONS.map((w) => w.id));

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  vm.resize(w / h);
  world.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// --------------------------------------------------------------------- state
interface Mate {
  id: number; name: string; look: number; chibi: Chibi; tag: THREE.Sprite; gun: THREE.Group | null; gunW: number;
  x: number; y: number; z: number; ry: number; tx: number; ty: number; tz: number; tr: number;
  hp: number; st: number; respawn: number; rev: number; speed: number;
}
interface Zed { id: number; type: number; chibi: Chibi; x: number; z: number; ry: number; tx: number; tz: number; tr: number; st: number }
interface Corpse { chibi: Chibi; t: number; vx: number; vz: number }

const me = {
  id: 0, x: MAP.spawns[0].x, y: 0, z: MAP.spawns[0].z, vx: 0, vz: 0, vy: 0, kx: 0, kz: 0, yaw: Math.PI, pitch: 0,
  hp: PLAYER.hp as number, st: PSTATE.ALIVE as number, medkits: 0, respawn: 0, rev: 0,
  weapon: 0, primary: -1, mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve),
  fireCd: 0, reloadT: 0, shoveCd: 0, healT: 0, healLatch: false, slowT: 0, recoil: 0, bloom: 0, trauma: 0, reviving: 0, onGround: true,
};
const roster = new Map<number, RosterEntry>();
const mates = new Map<number, Mate>();
const zeds = new Map<number, Zed>();
const corpses: Corpse[] = [];
let inGame = false, locked = false, ended = false;
let gateOpen = false, genStarted = false, holdout = -1, serverState: 'play' | 'won' | 'lost' = 'play';
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
    case 'Digit2': switchWeapon(0); break;
    case 'KeyF': torchOn = !torchOn; torch.visible = torchOn; sfx.dryFire(); break;
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
document.addEventListener('wheel', () => { if (active() && me.primary >= 0) switchWeapon(me.weapon === 0 ? me.primary : 0); }, { passive: true });
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

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _end = new THREE.Vector3(), _muz = new THREE.Vector3();

/** Hitscan against walls, floor and zombie hit spheres. */
function castShot(o: THREE.Vector3, d: THREE.Vector3, range: number): { t: number; zed: Zed | null; head: boolean } {
  const h = Math.hypot(d.x, d.z);
  let t = range;
  if (h > 1e-5) t = Math.min(t, rayGrid(o.x, o.z, d.x / h, d.z / h, range * h, gateOpen) / h);
  if (d.y < -1e-5) t = Math.min(t, -o.y / d.y);
  const f = floorAt(o.x, o.z);
  if (d.y > 1e-5 && f >= F.INTERIOR) t = Math.min(t, (CEIL_H - o.y) / d.y);
  let zed: Zed | null = null, head = false;
  const sphere = (cx: number, cy: number, cz: number, r: number): number => {
    const ox = cx - o.x, oy = cy - o.y, oz = cz - o.z;
    const tca = ox * d.x + oy * d.y + oz * d.z;
    if (tca < 0) return Infinity;
    const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
    return d2 > r * r ? Infinity : tca - Math.sqrt(r * r - d2);
  };
  for (const z of zeds.values()) {
    const s = ZTYPES[z.type].scale, fat = z.type === ZT.PUFFER ? 1.35 : z.type === ZT.BRUTE ? 1.25 : 1;
    const th = sphere(z.x, (z.type === ZT.PUFFER ? 1.16 : ZHIT.headY) * s, z.z, ZHIT.headR * s * (z.type === ZT.BRUTE ? 0.85 : 1));
    const tb = sphere(z.x, ZHIT.bodyY * s, z.z, ZHIT.bodyR * s * fat);
    const tz = Math.min(th, tb);
    if (tz < t) { t = tz; zed = z; head = th <= tb; }
  }
  return { t, zed, head };
}

function fire(): void {
  const wi = me.weapon, w = WEAPONS[wi];
  if (me.fireCd > 0 || me.reloadT > 0 || me.healT > 0) return;
  if (me.mag[wi] <= 0) {
    if (me.reserve[wi] > 0) startReload(); else { sfx.dryFire(); me.fireCd = 0.3; }
    return;
  }
  me.mag[wi]--; me.fireCd = w.rate;
  camera.getWorldPosition(_o);
  camera.getWorldDirection(_f);
  _r.crossVectors(_f, camera.up).normalize(); _u.crossVectors(_r, _f);
  _muz.set(0.2, -0.15, -0.7); camera.localToWorld(_muz);
  const spread = w.spread + me.bloom;
  const hits = new Map<number, [number, number, number]>();
  let anyHead = false, first: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < w.pellets; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    _d.copy(_f).addScaledVector(_r, Math.cos(a) * r).addScaledVector(_u, Math.sin(a) * r).normalize();
    const hit = castShot(_o, _d, w.range);
    _end.copy(_o).addScaledVector(_d, hit.t);
    if (i === 0) first = [_end.x, _end.y, _end.z];
    if (i < 4) fx.tracer(_muz, _end, w.pellets > 1 ? 0.02 : 0.032);
    if (hit.zed) {
      const e = hits.get(hit.zed.id) ?? [hit.zed.id, 0, 0];
      if (hit.head) { e[2]++; anyHead = true; } else e[1]++;
      hits.set(hit.zed.id, e);
      hit.zed.chibi.punch = 1;
      fx.burst(_end, 0xb4f05a, 2, 3, 0.07);
      if (hit.head) fx.burst(_end, 0xffd43b, 2, 3.5, 0.12, true, 0.3, 4);
    } else if (hit.t < w.range) {
      fx.burst(_end, 0xfff1a8, 2, 2.5, 0.07, true, 0.22, 3);
    }
  }
  if (hits.size) { hud.hitmark(anyHead, false); sfx.hit(anyHead); }
  net.send({ t: 'f', w: wi, h: [...hits.values()], e: first });
  vm.fire(); sfx.shoot(wi);
  me.recoil += w.pellets > 1 ? 0.07 : 0.012 + w.dmg * 0.0005;
  me.bloom = Math.min(0.05, me.bloom + w.spread * 0.45);
  me.trauma = Math.min(1, me.trauma + (w.pellets > 1 ? 0.3 : 0.07));
  if (me.mag[wi] === 0 && me.reserve[wi] > 0) startReload();
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
type Target = { kind: 'revive'; mate: Mate } | { kind: 'pickup'; pv: PickupView; usable: boolean; text: string } | null;
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
  for (const pv of world.pickups) {
    if (pv.taken) continue;
    const d = Math.hypot(pv.def.x - me.x, pv.def.z - me.z);
    if (d >= bestD) continue;
    const k = pv.def.kind;
    let usable = true, text = '';
    if (k === 'medkit') { usable = me.medkits < 1; text = usable ? 'Grab medkit' : 'Already carrying a medkit'; }
    else if (k === 'ammo') { usable = me.primary >= 0; text = usable ? 'Refill ammo' : 'Ammo pile (pistol ammo is endless)'; }
    else if (k === 'gen') { if (genStarted || gateOpen) continue; text = 'Start the generator (it will be LOUD)'; }
    else { const wi = WEAPONS.findIndex((w) => w.id === k); text = me.primary === wi ? `Restock ${WEAPONS[wi].name}` : `Take ${WEAPONS[wi].name}`; }
    bestD = d; best = { kind: 'pickup', pv, usable, text };
  }
  return best;
}

function interact(): void {
  if (!target) return;
  if (target.kind === 'pickup' && target.usable) net.send({ t: 'u', id: target.pv.def.id });
}

function onGot(pickupId: number): void {
  const pv = world.pickups[pickupId];
  if (!pv) return;
  const k = pv.def.kind;
  if (k === 'medkit') hud.feed('Medkit grabbed — hold Q to heal');
  else if (k === 'ammo') { if (me.primary >= 0) me.reserve[me.primary] = WEAPONS[me.primary].reserve; hud.feed('Ammo topped up'); }
  else if (k !== 'gen') {
    const wi = WEAPONS.findIndex((w) => w.id === k);
    me.primary = wi; me.mag[wi] = WEAPONS[wi].mag; me.reserve[wi] = WEAPONS[wi].reserve;
    switchWeapon(wi);
    hud.feed(`Picked up the ${WEAPONS[wi].name}`);
  }
  sfx.pickup();
}

// ------------------------------------------------------------------ entities
function addMate(r: RosterEntry): Mate {
  const chibi = new Chibi(survivorLook(r.look));
  const tag = nameTag(r.name, hex(SURVIVORS[r.look % SURVIVORS.length].shirt));
  tag.position.y = 1.72;
  chibi.group.add(tag);
  chibi.group.visible = false;
  scene.add(chibi.group);
  const m: Mate = { id: r.id, name: r.name, look: r.look, chibi, tag, gun: null, gunW: -1, x: 0, y: 0, z: 0, ry: 0, tx: 0, ty: 0, tz: 0, tr: 0, hp: 100, st: 0, respawn: 0, rev: 0, speed: 0 };
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
    const fresh = !m.chibi.group.visible && st !== PSTATE.DEAD;
    m.tx = x; m.ty = y; m.tz = z; m.tr = ry; m.hp = hp; m.st = st; m.rev = rev; m.respawn = respawn;
    if (fresh || Math.hypot(x - m.x, z - m.z) > 8) { m.x = x; m.y = y; m.z = z; m.ry = ry; }
    m.chibi.group.visible = st !== PSTATE.DEAD;
    if (m.gunW !== w) {
      m.gun?.removeFromParent();
      m.gun = buildGun(WEAPONS[w]?.id ?? 'pistol');
      m.gun.position.set(0.1, 0.74, -0.36); m.gun.scale.setScalar(1.15);
      m.chibi.root.add(m.gun); m.gunW = w;
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
      chibi.group.scale.setScalar(ZTYPES[type].scale);
      scene.add(chibi.group);
      zd = { id, type, chibi, x, z, ry, tx: x, tz: z, tr: ry, st };
      zeds.set(id, zd);
    }
    zd.tx = x; zd.tz = z; zd.tr = ry;
    if (st === ZSTATE.WINDUP && zd.st !== ZSTATE.WINDUP) sfx.leap(Math.hypot(x - me.x, z - me.z));
    zd.st = st;
  }
  for (const [id, zd] of zeds) if (!seen.has(id)) { zd.chibi.dispose(); zeds.delete(id); }
}

function killZed(id: number, head: boolean): void {
  const zd = zeds.get(id);
  if (!zd) return;
  zeds.delete(id);
  const dx = zd.x - me.x, dz = zd.z - me.z, d = Math.hypot(dx, dz) || 1;
  corpses.push({ chibi: zd.chibi, t: 0, vx: (dx / d) * 3, vz: (dz / d) * 3 });
  const s = ZTYPES[zd.type].scale;
  if (head) fx.burst({ x: zd.x, y: 1.1 * s, z: zd.z }, 0xffd43b, 5, 4, 0.14, true, 0.4, 5);
  fx.burst({ x: zd.x, y: 0.8 * s, z: zd.z }, 0xb4f05a, zd.type === ZT.BRUTE ? 16 : 4, 4, 0.1 * s);
  sfx.pop(d);
}

const POSE: Pose[] = ['idle', 'run', 'attack', 'stagger', 'windup', 'leap'];

// -------------------------------------------------------------------- events
function onEvent(ev: GameEvent): void {
  switch (ev[0]) {
    case 'reset':
      for (const z of zeds.values()) z.chibi.dispose();
      zeds.clear();
      for (const c of corpses) c.chibi.dispose();
      corpses.length = 0;
      Object.assign(me, { weapon: 0, primary: -1, mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve), reloadT: 0, vy: 0, y: 0, kx: 0, kz: 0, pitch: 0 });
      vm.setWeapon(0);
      gateOpen = false; genStarted = false; ended = false;
      world.setGate(false, true); world.setGenerator(false);
      for (const pv of world.pickups) world.setTaken(pv.def.id, false);
      hud.hideEnd();
      hud.pause(inGame && !locked && !DEBUG);
      break;
    case 'tp': if (ev[1] === me.id) { me.x = ev[2]; me.z = ev[3]; me.yaw = ev[4]; me.y = 0; me.vy = 0; me.vx = me.vz = 0; } break;
    case 'msg': hud.feed(ev[1]); break;
    case 'heal': if (ev[1] === me.id) sfx.heal(); break;
    case 'shot': {
      if (ev[1] === me.id) break;
      const m = mates.get(ev[1]);
      if (!m) break;
      _muz.set(m.x - Math.sin(m.ry) * 0.5, m.y + 0.78, m.z - Math.cos(m.ry) * 0.5);
      _end.set(ev[3], ev[4], ev[5]);
      fx.tracer(_muz, _end);
      fx.burst(_muz, 0xffd43b, 1, 0.5, 0.16, true, 0.08, 0);
      sfx.shoot(ev[2], Math.max(1, Math.hypot(m.x - me.x, m.z - me.z)));
      break;
    }
    case 'shove': { const m = mates.get(ev[1]); if (m) m.chibi.punch = 0.6; break; }
    case 'pk': world.setTaken(ev[1], true); break;
    case 'got': if (ev[1] === me.id) onGot(ev[2]); break;
    case 'holdstart':
      genStarted = true; world.setGenerator(true);
      hud.banner('HOLD OUT!', true); sfx.horde(); sfx.gate();
      hud.feed(`${ev[1] === me.id ? 'You' : roster.get(ev[1])?.name ?? 'Someone'} started the generator`);
      break;
    case 'gate': gateOpen = true; world.setGate(true); hud.banner('The gate is open — RUN!'); sfx.gate(); break;
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
    case 'kb': if (ev[1] === me.id) { me.kx = ev[2]; me.kz = ev[3]; me.vy = 4; me.onGround = false; me.trauma = 1; } break;
    case 'horde': hud.banner('HORDE INCOMING!', true); sfx.horde(); break;
    case 'brute': hud.banner('A BRUTE approaches…', true); sfx.brute(); break;
    case 'end': {
      ended = true;
      const board = (ev[4] ?? []).map(([id, kills]) => ({ name: id === me.id ? 'You' : roster.get(id)?.name ?? '???', kills }));
      hud.showEnd(ev[1] === 1, ev[2], ev[3], board);
      hud.pause(false);
      if (ev[1] === 1) sfx.win(); else sfx.lose();
      break;
    }
  }
}

net.onMessage = (m: ServerMsg) => {
  switch (m.t) {
    case 'w':
      me.id = m.id; me.x = m.x; me.z = m.z;
      for (const id of m.taken) world.setTaken(id, true);
      gateOpen = m.gate === 1; world.setGate(gateOpen, true);
      history.replaceState(null, '', `${location.pathname}${location.search}#${m.room}`);
      hud.setRoom(m.room);
      enterGame();
      break;
    case 'ro': syncRoster(m.players); break;
    case 'err': $('lobbymsg').textContent = m.msg; break;
    case 's':
      serverState = m.st; holdout = m.ho;
      if ((m.g === 1) !== gateOpen) { gateOpen = m.g === 1; world.setGate(gateOpen); }
      for (const ev of m.ev) onEvent(ev);
      applyPlayers(m.p);
      applyZombies(m.z);
      break;
  }
};
net.onClose = () => {
  if (!inGame) { ($('play') as HTMLButtonElement).disabled = false; return; }
  inGame = false;
  document.exitPointerLock();
  hud.show(false); hud.pause(false);
  $('lobby').hidden = false;
  $('lobbymsg').textContent = 'Disconnected from the server.';
  ($('play') as HTMLButtonElement).disabled = false;
};

// --------------------------------------------------------------------- lobby
const nameInput = $<HTMLInputElement>('name'), codeInput = $<HTMLInputElement>('code');
nameInput.value = params.get('name') ?? localStorage.getItem('chibi.name') ?? '';
codeInput.value = (params.get('room') ?? location.hash.slice(1)).toUpperCase();

async function join(): Promise<void> {
  const btn = $<HTMLButtonElement>('play');
  btn.disabled = true;
  $('lobbymsg').textContent = '';
  sfx.unlock();
  try { localStorage.setItem('chibi.name', nameInput.value.trim()); } catch { /* private mode */ }
  try { await net.connect(nameInput.value.trim(), codeInput.value.trim()); }
  catch (e) { $('lobbymsg').textContent = (e as Error).message; btn.disabled = false; }
}
$('join').addEventListener('submit', (e) => { e.preventDefault(); void join(); });
$('pause').addEventListener('mousedown', () => { void canvas.requestPointerLock(); });

function enterGame(): void {
  inGame = true; ended = false;
  $('lobby').hidden = true;
  hud.show(true);
  hud.pause(!locked && !DEBUG);
  if (!DEBUG) void canvas.requestPointerLock();
}
if (DEBUG && params.has('room')) void join();

// ---------------------------------------------------------------- simulation
function updateMe(dt: number): void {
  const alive = me.st === PSTATE.ALIVE, on = active() && alive;
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
    moveSlide(me, (me.vx + me.kx) * dt, (me.vz + me.kz) * dt, PLAYER.radius, gateOpen);
    me.kx *= Math.max(0, 1 - dt * 5); me.kz *= Math.max(0, 1 - dt * 5);
    if (on && keys.has('Space') && me.onGround) { me.vy = 6.4; me.onGround = false; }
    me.vy -= 19 * dt; me.y += me.vy * dt;
    if (me.y <= 0) { me.y = 0; me.vy = 0; me.onGround = true; }
    // Zombies are solid: get shouldered out of them.
    for (const z of zeds.values()) {
      const min = PLAYER.radius + ZTYPES[z.type].radius * 0.85, dx = me.x - z.x, dz = me.z - z.z;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 0.001) moveSlide(me, (dx / d) * (min - d), (dz / d) * (min - d), PLAYER.radius, gateOpen);
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
    const m = [...mates.values()].find((q) => q.st === PSTATE.ALIVE) ?? [...mates.values()].find((q) => q.st !== PSTATE.DEAD);
    if (m) {
      camera.position.set(m.x + Math.sin(m.ry) * 3.2, 2.6, m.z + Math.cos(m.ry) * 3.2);
      camera.lookAt(m.x, 1.0, m.z);
    } else { camera.position.set(me.x, 6, me.z + 4); camera.lookAt(me.x, 0, me.z); }
    return;
  }
  const down = me.st === PSTATE.DOWN;
  const eye = down ? 0.42 : PLAYER.eye;
  camera.position.set(me.x, me.y + eye, me.z);
  camera.rotation.set(me.pitch + me.recoil + (Math.random() - 0.5) * shake, me.yaw + (Math.random() - 0.5) * shake, down ? 0.35 : (Math.random() - 0.5) * shake);
}

function updateEntities(dt: number): void {
  const k = Math.min(1, dt * 13);
  for (const m of mates.values()) {
    if (!m.chibi.group.visible) continue;
    const px = m.x, pz = m.z;
    m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; m.z += (m.tz - m.z) * k; m.ry = lerpAngle(m.ry, m.tr, k);
    m.speed += (Math.hypot(m.x - px, m.z - pz) / Math.max(dt, 1e-4) - m.speed) * 0.2;
    m.chibi.group.position.set(m.x, m.y, m.z);
    m.chibi.group.rotation.y = m.ry;
    if (m.gun) m.gun.visible = m.st === PSTATE.ALIVE;
    m.chibi.animate(m.st === PSTATE.DOWN ? 'down' : m.speed > 1 ? 'run' : 'aim', time, dt);
    if (m.st !== PSTATE.DOWN && m.speed > 1) { m.chibi.armL.rotation.x = 1.25; m.chibi.armR.rotation.x = 1.4; }
  }
  for (const z of zeds.values()) {
    z.x += (z.tx - z.x) * k; z.z += (z.tz - z.z) * k; z.ry = lerpAngle(z.ry, z.tr, k);
    z.chibi.group.position.set(z.x, 0, z.z);
    z.chibi.group.rotation.y = z.ry;
    z.chibi.animate(POSE[z.st] ?? 'idle', time, dt);
  }
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.t += dt;
    const g = c.chibi.group;
    g.position.x += c.vx * dt; g.position.z += c.vz * dt;
    c.chibi.root.rotation.x = Math.min(1.5, c.t * 6);
    c.chibi.root.position.y = Math.sin(Math.min(1, c.t / 0.4) * Math.PI) * 0.35;
    if (c.t > 0.4) {
      fx.poof({ x: g.position.x, y: 0.2 * g.scale.y, z: g.position.z }, 0xf3f0ff, g.scale.y > 1.5 ? 14 : 6, 0.3 * g.scale.y);
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

function updateHud(dt: number): void {
  const w = WEAPONS[me.weapon];
  hud.setHealth(me.hp, me.st, me.medkits);
  hud.setAmmo(w.name, me.mag[me.weapon], me.reserve[me.weapon], w.mag, me.reloadT > 0, me.primary >= 0, me.weapon === 0 ? 2 : 1);
  const team: MateView[] = [...mates.values()].map((m) => ({ id: m.id, name: m.name, color: hex(SURVIVORS[m.look % SURVIVORS.length].shirt), hp: m.hp, st: m.st, respawn: m.respawn }));
  hud.setTeam(team);
  hud.setHoldout(holdout);
  hud.setObjective(serverState !== 'play' ? '—' : holdout >= 0 ? 'Survive until the gate opens!' : gateOpen ? 'Get everyone into the safe house!'
    : me.z > 61 * TILE ? 'Start the generator to open the gate' : floorAt(me.x, me.z) === F.SAFE_A ? 'Gear up, then head out the door' : 'Fight your way to the safe house');
  hud.crosshair(me.st === PSTATE.ALIVE);
  hud.spread(6 + (w.spread + me.bloom) * 260);
  hud.spectate(me.st === PSTATE.DEAD ? `Knocked out — a teammate will rescue you in ${me.respawn}s` : me.st === PSTATE.DOWN ? 'You are down! Wait for a teammate to help you up' : null);

  if (me.st === PSTATE.DOWN && me.rev > 0) { hud.ring(me.rev, 'Being helped up…'); hud.prompt(null); }
  else if (me.healT > 0) { hud.ring(me.healT / PLAYER.healTime, 'Patching up…', 'var(--pink)'); hud.prompt(null); }
  else if (target?.kind === 'revive') {
    if (me.reviving) { hud.ring(target.mate.rev, `Helping ${target.mate.name}…`); hud.prompt(null); }
    else { hud.ring(null); hud.prompt(`<kbd>Hold E</kbd> Help ${target.mate.name} up`); }
  } else {
    hud.ring(null);
    hud.prompt(target?.kind === 'pickup' ? (target.usable ? `<kbd>E</kbd> ${target.text}` : target.text) : null);
  }
  hud.update(dt);
}

// ---------------------------------------------------------------------- loop
let last = performance.now();
let orbit = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; time += dt;
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
    camera.position.set(43 + Math.sin(orbit) * 6, 3.2, 30 + Math.cos(orbit * 0.7) * 8);
    camera.rotation.set(-0.05, Math.PI + Math.sin(orbit * 0.5) * 0.5, 0);
  }
  world.update(time, dt, camera);
  fx.update(dt, camera);
  renderer.clear();
  renderer.render(scene, camera);
  if (inGame && vm.visible) { renderer.clearDepth(); renderer.render(vm.scene, vm.camera); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (DEBUG) Object.assign(window, { __game: { me, zeds, mates, keys, mouse, net, camera, scene, renderer, world, fire, shove, interact, state: () => ({ inGame, locked, ended, gateOpen, genStarted, holdout, serverState }) } });
