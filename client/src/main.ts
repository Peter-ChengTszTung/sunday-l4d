// Chibi Outbreak client: rendering, local player simulation, and reconciling
// the server's authoritative zombies / health with what you see.
import * as pc from 'playcanvas';
import { TILE, CEIL_H, STOREY, STEP_UP, LADDER_SPEED, PLAYER, WEAPONS, ZTYPES, ZT, PSTATE, ALARM, ARMOR, THROW_MAX, THROWABLES, unpackThrowables, armoredFront, SURVIVOR_RULES, difficultyLabel, parseDifficulty, shoveFatigue, shoveCooldown, weaponIndex, type DifficultyId, type WeaponId, MEDS, medIndex, unpackMeds, medSelect, medNext, medUseful, healAmount, MOUNT } from '../../shared/constants';
import { isIndoor, cellOf, type Level } from '../../shared/level';
import { CHAPTERS, getLevel } from '../../shared/chapters';
import type { GameEvent, PlayerSnap, RosterEntry, ServerMsg } from '../../shared/protocol';
import { buildWorld, type PickupView, type NoteView, type World } from './world';
import { buildSetPieces } from './setpieces';
import { buildMounts, type MountAim } from './mounts';
import { Chibi, survivorLook, zombieHorde } from './chibi';
import { ViewModel, gunMuzzle } from './viewmodel';
import { app, setTorch } from './gfx';
import { quatYXZ } from './geo';
import { FX } from './fx';
import { Sfx } from './audio';
import { Hud, type MateView } from './hud';
import { Net } from './net';
import { ShootingRange } from './range';
import { initLobby } from './lobby';
import { Remotes, type Mate, type Zed } from './remotes';
import { castShot, spreadDir, type AimBasis, type V3 } from './shots';
import { rangePanelHtml } from './rangepanel';
import { rangeLevel } from '../../shared/range';
import { t, tMsg, translatePage } from './i18n';
import { initGraphicsUi } from './gfxui';

translatePage();

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const RAD = 180 / Math.PI;

// -------------------------------------------------------------------- scene
const canvas = $<HTMLCanvasElement>('game');
const camera = new pc.Entity('camera');
camera.addComponent('camera', { fov: 74, nearClip: 0.08, farClip: 600, clearColor: new pc.Color(0.1, 0.07, 0.15) });
// 74° vertical FOV (about 105° horizontal at 16:9). On wider screens, hold the horizontal angle
// instead so ultrawide monitors don't get a fish-eye view.
const FOV_V = 74, FOV_H_MAX = 2 * Math.atan(Math.tan((FOV_V * Math.PI) / 360) * (16 / 9));
/** The vertical FOV for this window (see fitFov). */
let baseFov = FOV_V;
function fitFov(): void {
  const aspect = (canvas.clientWidth || 16) / (canvas.clientHeight || 9);
  baseFov = aspect > 16 / 9 ? (2 * Math.atan(Math.tan(FOV_H_MAX / 2) / aspect) * 180) / Math.PI : FOV_V;
  camera.camera!.fov = baseFov;
}
fitFov();
window.addEventListener('resize', fitFov);
app.root.addChild(camera);
/** Grab the mouse. The browser refuses (a rejected promise) e.g. just after Esc released it: the pause card's click tries again. */
function lockPointer(): void {
  const p = canvas.requestPointerLock() as Promise<void> | undefined; // older browsers return nothing
  p?.catch((e: unknown) => console.debug('pointer lock refused:', e));
}
const cam = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, rot: new pc.Quat() };

let chapter = Math.max(0, Math.min(CHAPTERS.length - 1, Number(params.get('ch') ?? localStorage.getItem('chibi.ch') ?? 0) || 0));
let L: Level = getLevel(chapter);
let world: World = buildWorld(L);
/** Swap the rendered world when the room moves to another chapter. */
function loadChapter(ch: number): void {
  if (ch === chapter && L === getLevel(ch)) return;
  useLevel(getLevel(ch));
  chapter = ch;
}
function useLevel(next: Level): void {
  world.dispose(); pieces.dispose(); mounts.dispose();
  L = next; world = buildWorld(L); pieces = buildSetPieces(L, sfx, fx); mounts = buildMounts(L);
  me.mount = -1;
  step = 0; qc = 0; doors = 0;
}
const fx = new FX();
const sfx = new Sfx();
/** Scripted moments on cue steps (the elevator, the tram). */
let pieces = buildSetPieces(L, sfx, fx);
/** Mounted guns in the world. */
let mounts = buildMounts(L);
fx.onSplat = (x, y, z) => sfx.at(y).splat(x, z);
fx.onCrackle = (x, y, z) => sfx.at(y).fireCrackle(x, z);
fx.onRattle = (x, y, z) => sfx.at(y).rattle(x, z);
fx.groundAt = (x, y, z) => L.floorBelow(x, y, z);
// Walls (and floors) between you and a sound muffle it. A sound with no known floor is taken to be on the
// floor nearest your own height there.
sfx.occluded = (x, z, y) => !L.hasLOS(cam.x, cam.y, cam.z, x, (y ?? L.floorBelow(x, cam.y - 0.4, z)) + 1, z, doors);
const hud = new Hud();
// Radio chatter: crackle under each subtitle line and a sign-off when it ends; the speaker picks the handset.
hud.onRadioLine = (who, _text, sec) => sfx.radioLine(who === t('Voice') ? 'voice' : who === t('Dot') ? 'dot' : 'team', sec);
hud.onRadioEnd = (cleared) => sfx.radioEnd(!cleared);
const net = new Net();
const vm = new ViewModel(WEAPONS.map((w) => w.id));

// --------------------------------------------------------------------- state
const me = {
  /**
   * `gy`: the floor height you stand on (follows stairs and ladders through `L.moveSlide`); `jy`: how far a
   * jump or knockback has lifted your feet off it; `y` = gy + jy, your feet (sent to the server, and the
   * camera is PLAYER.eye above it).
   */
  id: 0, x: L.def.spawns[0].x, y: L.def.spawns[0].y ?? 0, z: L.def.spawns[0].z, gy: L.def.spawns[0].y ?? 0, jy: 0, vx: 0, vz: 0, vy: 0, kx: 0, kz: 0, yaw: Math.PI, pitch: 0,
  hp: PLAYER.hp as number, st: PSTATE.ALIVE as number, respawn: 0, rev: 0,
  /**
   * Medical items carried (per kind, MEDS order), the one Q uses (Z picks the next; -1 = none carried), and
   * whether you are on your last legs (one more down is the end: Hot Cocoa is worth drinking even at full health).
   */
  meds: MEDS.map(() => 0), medSel: -1, lastLegs: false,
  weapon: 0, primary: -1, sidearm: 0, mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve),
  /** Close-in weapon (slot 3): weapon index, -1 = none. Armour points left; seconds until you can throw again. */
  melee: -1, armor: 0, throwCd: 0,
  /**
   * Throwables carried, how many of each kind in THROWABLES order (THROW_MAX in all), and which kind G throws (T switches).
   * `thrAt[k]`: when you last threw kind k: until the server's count catches up (or 3 s pass) its higher count is ignored.
   */
  thr: THROWABLES.map(() => 0), thrSel: 0, thrAt: THROWABLES.map(() => -99),
  /** Left mouse held with a throwable in hand: the arm is back and the arc is showing; letting go throws. */
  aiming: false,
  /** Left mouse has to be let go before it can wind up a throw (a shove cancelled one, or it was held while switching to the throwable). */
  aimBlock: false,
  /** Snap to the server's position on the next snapshot (a hold just ended). */
  snapPos: false,
  fireCd: 0, reloadT: 0, /** Seconds since the last shove, and shove fatigue (PLAYER.shoveMax). */ shoveRest: 99, shoveFat: 0, healT: 0, healLatch: false, slowT: 0, recoil: 0, bloom: 0, trauma: 0, reviving: 0, onGround: true,
  /**
   * Held by a zombie of type `pinType` (Charger pin, Snatcher lasso, Piggyback ride): no moving, shooting or
   * healing until 'unpin'. The server owns your position meanwhile: (pinX, pinZ) follows your own snapshot.
   */
  pinned: false, pinX: 0, pinY: 0, pinZ: 0, pinType: 0,
  /** Metres since the last footstep sound. */ stride: 0,
  /** Mounted gun you man (ChapterDef.mounts index, -1 = none): you stand at its seat and fire its gun. */ mount: -1,
};
/** Eye-height offset that eases a sudden floor change (a step onto a ledge) out of the camera; 0 on smooth stairs. */
let camDip = 0;
/** Put yourself at (x, z) on the floor at height y, feet down (spawn, teleport, checkpoint). */
function placeMe(x: number, y: number, z: number): void {
  me.x = x; me.z = z; me.gy = y; me.jy = 0; me.y = y; me.vy = 0; me.onGround = true; camDip = 0;
}
const _mv = { x: 0, y: 0, z: 0 };
/** Slide yourself by (dx, dz) with collision; your floor height follows stairs and ladders. */
function slideMe(dx: number, dz: number): void {
  _mv.x = me.x; _mv.y = me.gy; _mv.z = me.z;
  L.moveSlide(_mv, dx, dz, PLAYER.radius, doors);
  me.x = _mv.x; me.z = _mv.z; me.gy = _mv.y;
}
/** Current spread before bloom. */
const baseSpread = (): number => WEAPONS[me.weapon].spread;
/** Spread added by moving (scaled by speed) and by being in the air (WeaponDef.moving). */
function moveSpread(): number {
  const run = Math.min(1, Math.hypot(me.vx, me.vz) / PLAYER.speed);
  return WEAPONS[me.weapon].moving * (run + (me.onGround ? 0 : 1.5));
}
/** Everything that decides where the next shot can go: base, bloom from firing, and movement. */
const shotSpread = (): number => baseSpread() + me.bloom + moveSpread();
const roster = new Map<number, RosterEntry>();
/** This room's difficulty (from the welcome), for the survivor rules in messages. */
let roomDiff: DifficultyId = 'normal';
/** "rescue in 30s" / "rescue at the next safe room" for a respawn time (SURVIVOR_RULES). */
const rescueIn = (secs: number): string => (Number.isFinite(secs) ? t('rescue in {s}s', { s: secs }) : t('rescue at the next safe room'));
/** Teammates and zombies as the server reports them (drawn, eased, voiced). */
const remotes = new Remotes({ fx, sfx, hud, me, inRange: () => range !== null });
const mates = remotes.mates, zeds = remotes.zeds;
let inGame = false, locked = false, ended = false;
let doors = 0, step = 0, qc = 0, holdout = -1, serverState: 'play' | 'won' | 'lost' = 'play', debugServer = false;
/** The offline shooting range, while you are in it (it stands in for the server). */
let range: ShootingRange | null = null;
/** Seconds a Space press stays buffered: a tap shorter than a frame (between two updates) still jumps, as does one just before landing. */
const JUMP_BUFFER = 0.15;
let jumpBuf = 0;
let torchOn = true, sendT = 0, lookDX = 0, lookDY = 0, time = 0;
const keys = new Set<string>();
const mouse = { left: false };

// --------------------------------------------------------------------- input
const active = () => inGame && (locked || DEBUG) && !ended;
document.addEventListener('keydown', (e) => {
  if (!inGame || e.repeat) return;
  keys.add(e.code);
  if (!active()) return;
  if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
  if (e.code === 'Space' && me.mount < 0) jumpBuf = JUMP_BUFFER;
  // Range: X clears the numbers. Weapons come off the rack; the number keys are the same slots as in a room.
  if (range && e.code === 'KeyX') { range.resetStats(); hud.feed(t('Stats cleared')); return; }
  // Manning a mounted gun: E or Space lets go; the gun overheats instead of reloading, and nothing else is in reach.
  if (me.mount >= 0) {
    if (e.code === 'KeyE' || e.code === 'Space') letGo();
    else if (e.code === 'KeyF') { torchOn = !torchOn; sfx.dryFire(); }
    else if (e.code === 'KeyM') { sfx.setMuted(!sfx.muted); hud.feed(t(sfx.muted ? 'Sound off' : 'Sound on')); }
    return;
  }
  switch (e.code) {
    case 'KeyR': startReload(); break;
    case 'Digit1': if (me.primary >= 0) switchWeapon(me.primary); break;
    case 'Digit2': switchWeapon(me.sidearm); break;
    case 'Digit3': if (me.melee >= 0) switchWeapon(me.melee); break;
    // 4 / 5: take a throwable in hand (hold left mouse to aim, release to throw). G throws one straight away.
    case 'Digit4': case 'Digit5': { const k = Number(e.code.slice(5)) - 4; if (me.thr[k] > 0) { me.thrSel = k; switchWeapon(THROWABLES[k]); } break; }
    case 'KeyG': throwIt(); break;
    case 'KeyZ': {
      // Next medical item for Q (not while one is half used).
      const k = medNext(me.meds, me.medSel);
      if (k >= 0 && k !== me.medSel && me.healT <= 0) { me.medSel = k; sfx.dryFire(); hud.feed(t('{item} ready — hold Q', { item: t(MEDS[k].name) })); }
      break;
    }
    case 'KeyF': torchOn = !torchOn; sfx.dryFire(); break;
    case 'KeyM': sfx.setMuted(!sfx.muted); hud.feed(t(sfx.muted ? 'Sound off' : 'Sound on')); break;
    case 'KeyE': interact(); break;
    case 'KeyV': shove(); break;
  }
});
document.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'KeyQ') me.healLatch = false; });
window.addEventListener('blur', () => { keys.clear(); mouse.left = false; });
document.addEventListener('mousemove', (e) => {
  if (!locked || me.st === PSTATE.DEAD) return;
  const sens = 0.0023;
  me.yaw -= e.movementX * sens;
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch - e.movementY * sens));
  lookDX += e.movementX; lookDY += e.movementY;
});
document.addEventListener('mousedown', (e) => {
  if (!inGame) return;
  sfx.unlock();
  if (!locked && !DEBUG) { if (!ended) lockPointer(); return; }
  if (e.button === 0) mouse.left = true;
  // Right mouse (or V): shove.
  if (e.button === 2 && me.mount < 0) shove();
});
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; });
document.addEventListener('contextmenu', (e) => { if (inGame) e.preventDefault(); });
document.addEventListener('wheel', (e) => {
  if (!active() || me.mount >= 0) return;
  // Cycle through what you carry: primary, sidearm, close-in, throwables.
  const have = [me.primary, me.sidearm, me.melee, ...THROWABLES.filter((_, k) => me.thr[k] > 0)].filter((w) => w >= 0), i = have.indexOf(me.weapon);
  if (have.length > 1) switchWeapon(have[(i + (e.deltaY > 0 ? 1 : have.length - 1)) % have.length]);
}, { passive: true });

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (!locked) { keys.clear(); mouse.left = false; }
  hud.pause(inGame && !locked && !ended && !DEBUG);
});

// ------------------------------------------------------------------- weapons
/** The weapon in hand when you went down (-1: not down): back in hand when you get up. */
let downFrom = -1;
/** Put weapon `i` in hand without the alive-only checks of `switchWeapon` (going down, getting up). */
function equip(i: number): void {
  me.weapon = i; me.reloadT = 0; me.fireCd = Math.max(me.fireCd, 0.3); me.bloom = 0; me.aiming = false; me.aimBlock = mouse.left;
  vm.setWeapon(i);
  sfx.cancelReload(); sfx.draw(i);
}
/** Down but still fighting: not held by anything, sidearm in hand (the server takes those shots too). */
function downShooter(): boolean {
  return me.st === PSTATE.DOWN && !me.pinned && me.weapon === me.sidearm && active();
}
function switchWeapon(i: number): void {
  if (i === me.weapon || me.st !== PSTATE.ALIVE) return;
  equip(i);
  range?.resetStats(); // each weapon's numbers start clean
}

/** The weapon in hand when you manned a mounted gun: back in hand when you let go. */
let mountFrom = 0;
/** Where you stand to man mount `id` (MOUNT.seat m behind its pivot), on its floor. */
function seatOf(id: number): { x: number; y: number; z: number } {
  const m = L.def.mounts[id];
  return { x: m.x + Math.sin(m.yaw) * MOUNT.seat, y: m.y, z: m.z + Math.cos(m.yaw) * MOUNT.seat };
}
/** You took mount `id` (the server said so): stand at its seat facing its way, its gun in hand. */
function manMount(id: number): void {
  const m = L.def.mounts[id];
  if (!m) return;
  if (me.mount < 0) mountFrom = me.weapon;
  me.mount = id; me.aiming = false;
  const s = seatOf(id);
  placeMe(s.x, s.y, s.z); me.vx = me.vz = me.kx = me.kz = 0;
  me.yaw = m.yaw; me.pitch = 0;
  const wi = weaponIndex(m.kind);
  me.mag[wi] = WEAPONS[wi].mag;
  equip(wi);
  range?.resetStats();
  hud.feed(t('Manning the {w} — E or Space to let go', { w: t(WEAPONS[wi].name) }));
}
/** You let go (or were knocked off): your own weapon back in hand. */
function leftMount(): void {
  if (me.mount < 0) return;
  me.mount = -1;
  const back = mountFrom, tk = THROWABLES.indexOf(back);
  const owned = back === me.primary || back === me.sidearm || back === me.melee || (tk >= 0 && me.thr[tk] > 0);
  const own = owned ? back : me.primary >= 0 ? me.primary : me.sidearm;
  // Downed on the gun: the sidearm is out (applyPlayers), and getting up brings back what you had before the gun.
  if (downFrom >= 0 && WEAPONS[downFrom]?.slot === 'mount') downFrom = own;
  if (me.st === PSTATE.ALIVE || WEAPONS[me.weapon]?.slot === 'mount') equip(me.st === PSTATE.DOWN ? me.sidearm : own);
}
function letGo(): void { if (me.mount >= 0) net.send({ t: 'm', id: -1 }); }

function startReload(): void {
  const w = WEAPONS[me.weapon];
  if (me.reloadT > 0 || me.mag[me.weapon] >= w.mag || me.reserve[me.weapon] <= 0 || !(me.st === PSTATE.ALIVE || downShooter())) return;
  me.reloadT = w.reload;
  sfx.reload(me.weapon);
}

const _d: V3 = { x: 0, y: 0, z: 0 }, _end: V3 = { x: 0, y: 0, z: 0 }, _muz: V3 = { x: 0, y: 0, z: 0 };
const _v3 = new pc.Vec3();

/** Camera basis for a shot: forward (cam.f*), right (rx, rz) and up (ux, uy, uz). */
function aimBasis(): AimBasis {
  const fwx = cam.fx, fwy = cam.fy, fwz = cam.fz, rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
  const ux = -rz * fwy, uy = rz * fwx - rx * fwz, uz = rx * fwy;
  return { fwx, fwy, fwz, rx, rz, ux, uy, uz };
}

/**
 * Own tracers ([end x, y, z, width] each) and the grenade launched this frame, waiting for their
 * muzzle point. Shots are cast from the eye, but drawn from the gun: that needs this frame's camera
 * and first-person rig pose, which are only final after `updateCamera` and `vm.update`.
 */
const ownTracers: number[] = [];
let ownNade: Nade | null = null;
/** Draw this frame's own shots from the first-person gun's muzzle to where the eye ray ended. */
function flushOwnShots(): void {
  if (!ownTracers.length && !ownNade) return;
  vm.muzzleWorld(camera, _muz);
  const mx = _muz.x - cam.x, my = _muz.y - cam.y, mz = _muz.z - cam.z;
  for (let i = 0; i < ownTracers.length; i += 4) {
    _end.x = ownTracers[i]; _end.y = ownTracers[i + 1]; _end.z = ownTracers[i + 2];
    // Point-blank hits end nearer than the muzzle: no streak rather than one flying backwards.
    const ex = _end.x - cam.x, ey = _end.y - cam.y, ez = _end.z - cam.z;
    if ((ex * mx + ey * my + ez * mz) > mx * mx + my * my + mz * mz) fx.tracer(_muz, _end, ownTracers[i + 3]);
  }
  ownTracers.length = 0;
  if (ownNade) { ownNade.mx = mx; ownNade.my = my; ownNade.mz = mz; placeNade(ownNade); ownNade = null; }
}

/** Close-in swings and shoves only reach zombies whose floor is within this height of yours (m). */
const MELEE_DY = 1.6;
/**
 * Close-in swing: everything in the weapon's cone and reach, nearest first, up to its cleave. Same
 * rule as the server's check (server/combat.ts meleeHits), from where you stand and face.
 */
function swing(wi: number): void {
  const w = WEAPONS[wi], M = w.melee!;
  me.fireCd = (me.fireCd < -w.rate ? 0 : me.fireCd) + w.rate;
  const fxd = -Math.sin(me.yaw), fzd = -Math.cos(me.yaw);
  const near: { z: Zed; d: number }[] = [];
  for (const z of zeds.values()) {
    const dx = z.x - me.x, dz = z.z - me.z, d = Math.hypot(dx, dz);
    if (d > M.reach + ZTYPES[z.type].radius || (d > 0.6 && (dx * fxd + dz * fzd) / d < M.arc) || Math.abs(z.y - me.gy) > MELEE_DY) continue;
    if (L.hasLOS(me.x, me.gy + 1.2, me.z, z.x, z.y + 1.2, z.z, doors)) near.push({ z, d }); // eye to eye, as the server checks
  }
  near.sort((a, b) => a.d - b.d);
  near.length = Math.min(near.length, M.cleave);
  for (const { z } of near) {
    z.chibi.punch = 1;
    const p = { x: z.x, y: z.y + 0.9 * ZTYPES[z.type].scale, z: z.z };
    fx.burst(p, 0xb4f05a, 4, 4, 0.09);
    fx.burst(p, 0xffffff, 3, 4, 0.14, true, 0.25, 3);
  }
  sendPos(); // the server checks the swing against where it has you facing: make that now
  net.send({ t: 'f', w: wi, h: near.map(({ z }): [number, number, number] => [z.id, 1, 0]), e: [cam.x + cam.fx * M.reach, cam.y + cam.fy * M.reach, cam.z + cam.fz * M.reach] });
  vm.fire(); sfx.shoot(wi);
  if (near.length) { hud.hitmark(false, false); sfx.meleeHit(w.dmg > 120); me.trauma = Math.min(1, me.trauma + w.shake); }
}

/** How many throwables you carry in all. */
const throwCount = (): number => me.thr.reduce((a, b) => a + b, 0);
/** The kind G throws (index into THROWABLES): the selected one, or the next kind you still have; -1 with empty pockets. */
function throwSel(): number {
  for (let i = 0; i < me.thr.length; i++) { const k = (me.thrSel + i) % me.thr.length; if (me.thr[k] > 0) { me.thrSel = k; return k; } }
  return -1;
}
/** Empty your pockets (a fresh start, a new room). */
function clearThrowables(): void { me.thr.fill(0); me.thrAt.fill(-99); me.thrSel = 0; me.aiming = false; }
/** The kind of throwable in your hand (index into THROWABLES), or -1 if you are holding something else. */
const heldThrowable = (): number => (WEAPONS[me.weapon].thrown ? THROWABLES.indexOf(me.weapon) : -1);
/** The direction a throw leaves the hand, into `_d`: where you look, with a little loft so a level throw still carries. */
function throwDir(): void {
  spreadDir(aimBasis(), 0, _d);
  _d.y += 0.16;
  const dl = Math.hypot(_d.x, _d.y, _d.z); _d.x /= dl; _d.y /= dl; _d.z /= dl;
}
/** Throw one of kind `k`. It flies like a launcher shell and claims its landing with 'g'. */
function doThrow(k: number): void {
  const wi = THROWABLES[k];
  throwDir();
  const first = launchNade(wi);
  net.send({ t: 'f', w: wi, h: [], e: first, n: nadeSeq });
  me.thr[k]--; me.thrAt[k] = time; me.throwCd = 0.9;
  vm.toss(); sfx.shoot(wi);
}
/** G: quick throw, without taking it in hand first (the kind in your hand if there is one, else the last one selected). */
function throwIt(): void {
  const k = heldThrowable() >= 0 ? heldThrowable() : throwSel();
  if (k < 0 || me.thr[k] <= 0 || me.throwCd > 0 || me.st !== PSTATE.ALIVE || me.pinned || me.healT > 0 || !active()) return;
  me.aiming = false;
  doThrow(k);
}
/** The last one in your hand is gone: take out the other kind if you have it, else go back to a gun. */
function holster(): void {
  const k = throwSel();
  switchWeapon(k >= 0 ? THROWABLES[k] : me.primary >= 0 ? me.primary : me.sidearm);
}
const _arc: number[] = [];
/** While aiming: the path the throw will take (walls and floor only), dashed, with a ring where it lands. */
function drawAimArc(k: number): void {
  const wi = THROWABLES[k], B = WEAPONS[wi].blast!;
  throwDir();
  const ghost = { x: cam.x, y: cam.y, z: cam.z, vx: _d.x * B.speed, vy: _d.y * B.speed, vz: _d.z * B.speed, t: 0, w: wi } as Nade;
  _arc.length = 0;
  for (let i = 0; i < 160; i++) {
    const done = flyNade(ghost, 1 / 40, false);
    if (ghost.t > 0.12) _arc.push(ghost.x, ghost.y, ghost.z); // starts a little way out, about where the hand lets go
    if (done) break;
  }
  fx.aimArc(_arc);
}
/**
 * A throwable in hand: holding left mouse winds up and shows the arc, letting go throws it. Being
 * grabbed, downed or shoving while aiming just lowers the arm. Returns false if you hold something else.
 */
function updateThrowAim(on: boolean): boolean {
  const k = heldThrowable();
  if (k < 0) { me.aiming = false; vm.setAim(false, true); return false; }
  if (!mouse.left) me.aimBlock = false;
  const ready = on && !me.aimBlock && me.thr[k] > 0 && me.fireCd <= 0 && me.throwCd <= 0 && me.healT <= 0;
  if (ready && mouse.left) me.aiming = true;
  else if (me.aiming) { me.aiming = false; if (ready) doThrow(k); }
  // Out of this kind (and the throw has left the hand): put the empty hand away.
  if (me.thr[k] <= 0 && me.throwCd <= 0.5 && me.st === PSTATE.ALIVE) holster();
  // The hand is empty for a moment after a throw.
  vm.setAim(me.aiming, me.thr[k] > 0 && me.throwCd <= 0.5);
  if (me.aiming) drawAimArc(k);
  return true;
}

function fire(): void {
  const wi = me.weapon, w = WEAPONS[wi];
  if (me.fireCd > 0 || me.reloadT > 0 || me.healT > 0) return;
  if (w.melee) { swing(wi); return; }
  if (me.mag[wi] <= 0) {
    if (me.reserve[wi] > 0) startReload(); else { sfx.dryFire(); me.fireCd = 0.3; }
    return;
  }
  me.mag[wi]--;
  // Scheduled shot clock: keep this frame's leftover so auto fire holds its rate at any FPS
  // (resetting to `rate` lost up to a frame per shot: the SMG ran at ~12 rounds/s at 60 FPS).
  me.fireCd = (me.fireCd < -w.rate ? 0 : me.fireCd) + w.rate;
  const b = aimBasis();
  const spread = shotSpread();
  let first: [number, number, number] = [0, 0, 0];
  const hits = new Map<number, [number, number, number]>();
  let anyHead = false, landed = false;
  if (w.blast) {
    spreadDir(b, spread, _d);
    first = launchNade(wi);
  } else {
    for (let i = 0; i < w.pellets; i++) {
      spreadDir(b, spread, _d);
      const shot = castShot(L, doors, zeds.values(), cam, _d, w.range, w.pierce);
      _end.x = cam.x + _d.x * shot.t; _end.y = cam.y + _d.y * shot.t; _end.z = cam.z + _d.z * shot.t;
      if (i === 0) first = [_end.x, _end.y, _end.z];
      if (i < 4) ownTracers.push(_end.x, _end.y, _end.z, w.pellets > 1 ? 0.02 : w.pierce > 2 ? 0.05 : 0.032);
      for (const hit of shot.hits) {
        const p = { x: cam.x + _d.x * hit.t, y: cam.y + _d.y * hit.t, z: cam.z + _d.z * hit.t };
        // A Tinpot's front: sparks and a clang, a quarter of the damage (the server works it out), and the bullet stops there.
        const zd = hit.zed, front = armoredFront(zd.type, zd.st, zd.ry, zd.x, zd.z, me.x, me.z);
        landed = true;
        if (front) {
          fx.burst(p, 0xfff1a8, 3, 3.5, 0.1, true, 0.22, 3);
          remotes.tinpotTip();
          const e = hits.get(zd.id) ?? [zd.id, 0, 0];
          if (hit.head) e[2]++; else e[1]++;
          hits.set(zd.id, e);
          zd.chibi.punch = 0.5;
          break;
        }
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
  if (landed) { hud.hitmark(anyHead, false); sfx.hit(anyHead); }
  net.send({ t: 'f', w: wi, h: [...hits.values()], e: first, ...(w.blast ? { n: nadeSeq } : {}) });
  vm.fire(); sfx.shoot(wi);
  me.recoil += w.recoil;
  me.bloom = Math.min(w.bloom[1], me.bloom + w.bloom[0]);
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
    const mx = n.vx * h, my = n.vy * h, mz = n.vz * h, len = Math.hypot(mx, my, mz);
    // Walls, tall props, closed doors, the ground, floor slabs and ceilings along this step: stop just short of it.
    const hit = len > 1e-6 ? L.ray(n.x, n.y, n.z, mx / len, my / len, mz / len, len, doors) : len;
    if (hit < len) {
      const k = Math.max(0, hit - 0.04) / len;
      n.x += mx * k; n.y += my * k; n.z += mz * k;
      settleNade(n);
      return true;
    }
    const x = n.x + mx, y = n.y + my, z = n.z + mz;
    // Low props (barriers, benches, bushes) and water don't block sight, but a grenade under a metre up still hits them.
    const tx = cellOf(x), tz = cellOf(z);
    if (L.inBounds(tx, tz)) {
      const lv = L.storeyOf(y), nd = L.node(tx, tz, lv), base = lv * STOREY;
      if (L.def.solid[nd] && !L.def.air[nd] && L.def.doorCell[nd] < 0 && y >= base - 0.05 && y < base + 1) return true;
    }
    // Stair steps and ladders aren't in the ray's solid columns: dropping below a ramp's surface lands on it.
    if (L.levels > 1) {
      const nd = L.nodeAt(x, y, z), g = L.heightAt(nd, x, z);
      if (L.def.ramp[nd] && y < g && y > g - STEP_UP) { n.x = x; n.z = z; n.y = g + 0.06; return true; }
    }
    n.x = x; n.y = y; n.z = z;
    if (hitZeds) for (const zd of zeds.values()) {
      const T = ZTYPES[zd.type], r = T.radius * 1.2 + 0.2, dy = y - zd.y;
      if (dy > -0.3 && dy < T.scale * 1.5 && Math.abs(zd.x - x) < r && Math.abs(zd.z - z) < r && Math.hypot(zd.x - x, zd.z - z) < r) return true;
    }
    if (n.t >= B.fuse) return true;
  }
  return false;
}

/** A grenade that stopped just above a floor lies on it. */
function settleNade(n: Nade): void {
  const g = L.floorBelow(n.x, n.y + 0.1, n.z);
  if (n.y - g < 0.35 && n.y > g - 0.1) n.y = g + 0.06;
}

/** Fire a grenade along `_d` from the eye. Returns the predicted landing point (walls only) for teammates. */
function launchNade(wi: number): [number, number, number] {
  const B = WEAPONS[wi].blast!;
  const n: Nade = {
    x: cam.x, y: cam.y, z: cam.z, vx: _d.x * B.speed, vy: _d.y * B.speed, vz: _d.z * B.speed, t: 0, w: wi,
    mine: true, ox: me.x, oz: me.z, shell: fx.shell(), trail: 0, mx: 0, my: 0, mz: 0, life: 0, // muzzle offset: flushOwnShots
    seq: ++nadeSeq,
  };
  const ghost = { ...n };
  for (let i = 0; i < 400 && !flyNade(ghost, 1 / 60, false); i++);
  nades.push(n);
  ownNade = n;
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
  const d = Math.hypot(x - me.x, y - me.y, z - me.z);
  sfx.at(L.floorBelow(x, y, z)).blast(x, z, power);
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
    // Predict the boom locally; the server validates the claim and does the damage. A throwable
    // has no boom of its own: its fire or rattle comes back from the server.
    const B = WEAPONS[n.w].blast!;
    const power = Math.hypot(n.x - n.ox, n.z - n.oz) < B.arm ? 0.4 : 1;
    if (!WEAPONS[n.w].thrown) boomFx(n.x, n.y, n.z, power);
    net.send({ t: 'g', x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(2), n: n.seq });
  }
}

/** Debug (`window.__game.give(i)`): hand yourself weapon `i` with full ammo. */
function debugGive(wi: number): void {
  const w = WEAPONS[wi];
  if (!w) return;
  if (w.slot === 'throw') { const k = THROWABLES.indexOf(wi); if (throwCount() < THROW_MAX) me.thr[k]++; me.thrSel = k; me.throwCd = 0; switchWeapon(wi); return; }
  if (w.slot === 'sidearm') me.sidearm = wi; else if (w.slot === 'melee') me.melee = wi; else me.primary = wi;
  me.mag[wi] = w.mag; me.reserve[wi] = w.reserve;
  switchWeapon(wi);
}

function clearNades(): void {
  for (const n of nades) fx.dropShell(n.shell);
  nades.length = 0; ownNade = null; ownTracers.length = 0;
}

function shove(): void {
  if (me.st !== PSTATE.ALIVE || me.pinned || !active()) return;
  if (me.aiming) { me.aiming = false; me.aimBlock = true; } // a shove lowers a wound-up throw: let go and press again to aim
  // Same fatigue rule as the server (onShove), so a tired shove isn't shown and then ignored.
  const fat = shoveFatigue(me.shoveFat, me.shoveRest);
  if (me.shoveRest < shoveCooldown(fat)) return;
  me.shoveFat = fat + 1; me.shoveRest = 0;
  if (fat < PLAYER.shoveMax && me.shoveFat >= PLAYER.shoveMax) hud.feed(t('Arms tired — shoves slow down for a moment'));
  net.send({ t: 'v' });
  vm.shove(); sfx.shove();
  // Predict the stagger squash locally so the shove feels instant.
  const fxd = -Math.sin(me.yaw), fzd = -Math.cos(me.yaw);
  for (const z of zeds.values()) {
    const dx = z.x - me.x, dz = z.z - me.z, d = Math.hypot(dx, dz);
    if (d < PLAYER.shoveRange + 0.4 && d > 0.01 && (dx * fxd + dz * fzd) / d > 0.3 && Math.abs(z.y - me.gy) < MELEE_DY) { z.chibi.punch = 1; fx.burst({ x: z.x, y: z.y + 0.9, z: z.z }, 0xffffff, 2, 3, 0.1, true, 0.25, 3); }
  }
}

// ------------------------------------------------------------- interactions
type Target = { kind: 'revive'; mate: Mate } | { kind: 'pickup'; pv: PickupView; usable: boolean; text: string } | { kind: 'note'; nv: NoteView }
  | { kind: 'mount'; id: number; usable: boolean; text: string } | null;
let target: Target = null;

function findTarget(): Target {
  if (me.st !== PSTATE.ALIVE) return null;
  let best: Target = null, bestD = PLAYER.useRange;
  for (const m of mates.values()) {
    if (m.st !== PSTATE.DOWN) continue;
    const d = Math.hypot(m.x - me.x, m.y - me.gy, m.z - me.z);
    if (d < bestD) { bestD = d; best = { kind: 'revive', mate: m }; }
  }
  if (best) return best;
  // Mounted guns: reach the pivot or the seat.
  for (const m of L.def.mounts) {
    if (Math.abs(m.y - me.gy) > 1.6) continue;
    const s = seatOf(m.id), d = Math.min(Math.hypot(m.x - me.x, m.z - me.z), Math.hypot(s.x - me.x, s.z - me.z) + 0.3);
    if (d >= Math.max(bestD, MOUNT.useRange)) continue;
    const name = t(WEAPONS[weaponIndex(m.kind)].name), taken = [...mates.values()].find((q) => q.mount === m.id && q.st === PSTATE.ALIVE);
    bestD = d; best = { kind: 'mount', id: m.id, usable: !taken, text: taken ? t('{who} is on the {w}', { who: taken.name, w: name }) : t('Man the {w}', { w: name }) };
  }
  for (const nv of world.notes) {
    const d = Math.hypot(nv.def.x - me.x, (nv.def.y ?? 0) - me.gy, nv.def.z - me.z);
    if (d < bestD) { bestD = d; best = { kind: 'note', nv }; }
  }
  for (const pv of world.pickups) {
    if (pv.taken || !pv.shown) continue;
    const d = Math.hypot(pv.def.x - me.x, (pv.def.y ?? 0) - me.gy, pv.def.z - me.z);
    if (d >= bestD) continue;
    const k = pv.def.kind;
    let usable = true, text = '';
    const mk = medIndex(k);
    if (k === 'medkit') { usable = me.meds[0] < 1; text = t(usable ? 'Grab medkit' : 'Already carrying a medkit'); }
    else if (mk > 0) { usable = me.meds[mk] < MEDS[mk].max; text = usable ? t('Take the {w}', { w: t(MEDS[mk].name) }) : t('No room for more {w} ({n})', { w: t(MEDS[mk].name), n: MEDS[mk].max }); }
    else if (k === 'ammo') { usable = me.primary >= 0; text = t(usable ? 'Refill ammo' : 'Ammo pile (pistol ammo is endless)'); }
    else if (k === 'obj') { if (holdout >= 0) continue; text = t(pv.def.label ?? 'Use'); }
    else if (k === 'item') {
      // A holdout's items only count once its timer is running.
      const sc = L.def.steps[step];
      usable = sc?.kind === 'collect' || holdout >= 0;
      text = usable ? t('Pick up {item}', { item: t(pv.def.label ?? 'item') }) : t('{item}: needed once the hold starts', { item: t(pv.def.label ?? 'item') });
    }
    else if (k === 'armor') { usable = me.armor < ARMOR.max; text = t(usable ? 'Strap on a Pillow Vest' : 'Your Pillow Vest is still plump'); }
    else {
      const wi = weaponIndex(k as WeaponId), w = WEAPONS[wi], cur = w.slot === 'sidearm' ? me.sidearm : w.slot === 'melee' ? me.melee : me.primary;
      if (w.slot === 'throw') { usable = throwCount() < THROW_MAX; text = usable ? t('Take the {w}', { w: t(w.name) }) : t('Pockets full ({n} throwables)', { n: THROW_MAX }); }
      else if (cur === wi) { usable = w.slot === 'primary'; text = t(usable ? 'Restock {w}' : 'Already carrying the {w}', { w: t(w.name) }); }
      else text = cur >= 0 ? t('Swap your {old} for the {w}', { old: t(WEAPONS[cur].name), w: t(w.name) }) : t('Take the {w}', { w: t(w.name) });
    }
    bestD = d; best = { kind: 'pickup', pv, usable, text };
  }
  return best;
}

function interact(): void {
  if (hud.noteOpen) { hud.note(null); return; }
  if (!target) return;
  if (target.kind === 'pickup' && target.usable) net.send({ t: 'u', id: target.pv.def.id });
  if (target.kind === 'mount' && target.usable) net.send({ t: 'm', id: target.id });
  if (target.kind === 'note') { hud.note(t(target.nv.def.title), t(target.nv.def.text)); openNote = target.nv; world.setNoteRead(target.nv.def.id); sfx.pickup(); }
}
let openNote: NoteView | null = null;

function onGot(pickupId: number): void {
  const pv = world.pickups[pickupId];
  if (!pv) return;
  const k = pv.def.kind;
  const mk = medIndex(k);
  if (mk >= 0) {
    // Count it now (the next snapshot confirms) so the tray and Q's pick are right at once.
    me.meds[mk] = Math.min(MEDS[mk].max, me.meds[mk] + 1); me.medSel = medSelect(me.meds, me.medSel);
    const others = me.meds.some((n, i) => i !== mk && n > 0);
    if (mk === 0) hud.feed(t(others ? 'Medkit grabbed — Z to pick it, hold Q to heal' : 'Medkit grabbed — hold Q to heal'));
    else hud.feed(t(others ? '{item}: {what} — Z picks, hold Q to use' : '{item}: {what} — hold Q to use', { item: t(MEDS[mk].name), what: t(MEDS[mk].blurb) }));
    sfx.pickup();
    // On the range nothing bites: taking one off the shelf leaves you hurt (and on your last legs) so there is something to treat.
    if (range && (me.hp > 40 || !me.lastLegs)) { me.hp = Math.min(me.hp, 40); me.lastLegs = true; rangeRegen.left = 0; hud.feed(t('Health set to 40 so you can try it')); }
  }
  else if (k === 'ammo') {
    if (me.primary >= 0) {
      // Launchers are a support tool: an ammo pile tops them up to 6 shells, not a full reserve.
      const w = WEAPONS[me.primary];
      me.reserve[me.primary] = w.blast ? Math.min(w.reserve, Math.max(me.reserve[me.primary], LAUNCHER_PILE)) : w.reserve;
    }
    world.setTaken(pickupId, true); // spent for you; teammates can still use this pile
    hud.feed(t('Ammo topped up'));
  }
  else if (k === 'armor') { me.armor = ARMOR.max; hud.feed(t('Pillow Vest on — it soaks up half of every bite until it bursts')); }
  else if (k !== 'obj' && k !== 'item' && mk < 0) {
    const wi = weaponIndex(k as WeaponId), w = WEAPONS[wi];
    if (!range && L.stacks().has(pickupId)) world.setTaken(pickupId, true); // yours is taken; the rest of the stack is for teammates (the range rack never empties)
    if (w.slot === 'throw') {
      const tk = THROWABLES.indexOf(wi);
      if (throwCount() < THROW_MAX) me.thr[tk]++;
      if (throwCount() === 1) me.thrSel = tk;
      me.thrAt[tk] = -99; me.throwCd = 0;
      hud.feed(t('Picked up the {w} — press {key} to hold it, hold left mouse to aim, release to throw', { w: t(w.name), key: 4 + tk }));
    } else {
      // A close-in weapon goes on your belt (3): it doesn't take your gun out of your hands.
      const had = w.slot === 'melee' && me.melee < 0 ? false : true;
      if (w.slot === 'sidearm') me.sidearm = wi; else if (w.slot === 'melee') me.melee = wi; else me.primary = wi;
      me.mag[wi] = w.mag; me.reserve[wi] = w.reserve;
      if (me.weapon === wi) me.reloadT = 0; else if (w.slot !== 'melee' || me.primary < 0) switchWeapon(wi);
      else if (!WEAPONS[me.weapon] || (me.weapon !== me.primary && me.weapon !== me.sidearm)) switchWeapon(wi); // the one it replaced was in hand
      hud.feed(w.slot === 'melee' ? t(had ? 'Picked up the {w}' : 'Picked up the {w} — press 3 to swing it (quiet, never runs out)', { w: t(w.name) }) : t('Picked up the {w}', { w: t(w.name) }));
    }
  }
  sfx.pickup();
}

// ------------------------------------------------------------------ entities
function syncRoster(list: RosterEntry[]): void {
  roster.clear();
  for (const r of list) roster.set(r.id, r);
  remotes.sync(list, me.id);
}

function applyPlayers(list: PlayerSnap[]): void {
  for (const p of list) {
    const [id, x, y, z, , , hp, st, , medkits, rev, , respawn] = p;
    if (id !== me.id) continue;
    if (st !== me.st) {
      if (st === PSTATE.DOWN) {
        hud.banner(t('You are down!'), true); sfx.down(); sfx.cancelReload(); me.reloadT = 0;
        // Down, you can still shoot: the sidearm comes out (whatever was in hand goes back on getting up).
        downFrom = me.weapon;
        if (me.weapon !== me.sidearm) equip(me.sidearm);
      } else if (st === PSTATE.ALIVE && me.st === PSTATE.DOWN) {
        const back = downFrom;
        downFrom = -1;
        const tk = THROWABLES.indexOf(back), owned = back === me.primary || back === me.melee || back === me.sidearm || (tk >= 0 && me.thr[tk] > 0);
        if (back >= 0 && back !== me.weapon && owned) equip(back);
      } else downFrom = -1;
      vm.visible = st === PSTATE.ALIVE || st === PSTATE.DOWN;
    }
    me.hp = hp; me.st = st; me.rev = rev; me.respawn = respawn;
    me.meds = unpackMeds(medkits); me.medSel = medSelect(me.meds, me.medSel);
    me.armor = p[13] ?? 0;
    // The server decides who mans what: follow it if an event was missed (a reconnect, a restart).
    const mt = p[15] ?? -1;
    if (mt !== me.mount) { if (mt >= 0) manMount(mt); else leftMount(); }
    // Just after a throw the snapshot may still count it: per kind, keep your own lower count until the server
    // agrees (or, after a few seconds, accept that the throw never counted and it is still yours).
    const thr = unpackThrowables(p[14] ?? 0);
    for (let k = 0; k < thr.length; k++) if (!(time - me.thrAt[k] < 3 && thr[k] > me.thr[k])) { me.thr[k] = thr[k]; me.thrAt[k] = -99; }
    if (me.pinned) { me.pinX = x; me.pinY = y; me.pinZ = z; }
    // A hold just ended: stand exactly where the server dragged you to.
    if (me.snapPos) { me.snapPos = false; placeMe(x, L.groundY(x, y, z), z); }
  }
  remotes.applyMates(list, me.id);
}

// -------------------------------------------------------------------- events
function onEvent(ev: GameEvent): void {
  switch (ev[0]) {
    case 'reset': {
      const [, ch, st, dm, taken, keep] = ev;
      remotes.clear();
      fx.clearGoo(); me.pinned = false; me.shoveFat = 0; me.armor = 0; me.throwCd = 0; me.mount = -1;
      const newChapter = ch !== chapter;
      clearNades();
      loadChapter(ch);
      if (keep) {
        // Checkpoint restart: keep your gun, top the ammo back up.
        for (let i = 0; i < WEAPONS.length; i++) { me.mag[i] = WEAPONS[i].mag; me.reserve[i] = WEAPONS[i].reserve; }
        Object.assign(me, { reloadT: 0, vy: 0, jy: 0, y: me.gy, onGround: true, kx: 0, kz: 0 });
        if (WEAPONS[me.weapon]?.slot === 'mount') equip(me.primary >= 0 ? me.primary : me.sidearm);
      } else {
        Object.assign(me, { weapon: 0, primary: -1, sidearm: 0, melee: -1, mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve), reloadT: 0, vy: 0, jy: 0, y: me.gy, onGround: true, kx: 0, kz: 0, pitch: 0 });
        clearThrowables();
        vm.setWeapon(0);
      }
      ended = false;
      doors = dm; world.setDoors(dm, true);
      for (const pv of world.pickups) world.setTaken(pv.def.id, false);
      for (const id of taken) world.setTaken(id, true);
      enterStep(st, false);
      if (!keep || newChapter) showIntro();
      else { hud.banner(t('Back to the checkpoint!')); hud.radio([], true); }
      hud.hideEnd();
      hud.pause(inGame && !locked && !DEBUG);
      break;
    }
    case 'tp': if (ev[1] === me.id) { placeMe(ev[2], ev[5] ?? 0, ev[3]); me.yaw = ev[4]; me.vx = me.vz = 0; } break;
    case 'mount': {
      if (ev[1] === me.id) { if (ev[2] >= 0) manMount(ev[2]); else leftMount(); }
      else if (ev[2] >= 0) { const m = mates.get(ev[1]), mk = L.def.mounts[ev[2]]; if (m && mk) hud.feed(t('{who} is on the {w}', { who: m.name, w: t(WEAPONS[weaponIndex(mk.kind)].name) })); }
      sfx.gate();
      break;
    }
    case 'msg': hud.feed(tMsg(ev[1])); break;
    case 'heal': if (ev[1] === me.id) { sfx.heal(); if (MEDS[ev[2]]?.steady) me.lastLegs = false; if (range) rangeHeal(ev[2]); } break;
    case 'shot': {
      if (ev[1] === me.id) break;
      const m = mates.get(ev[1]);
      if (!m) break;
      _end.x = ev[3]; _end.y = ev[4]; _end.z = ev[5];
      const w = WEAPONS[ev[2]];
      if (m.gun && WEAPONS[m.gunW] && m.st === PSTATE.ALIVE) {
        // From the muzzle of the gun the chibi is holding (as posed last frame).
        const [gx, gy, gz] = gunMuzzle(WEAPONS[m.gunW].id);
        m.gun.getWorldTransform().transformPoint(_v3.set(gx, gy, gz), _v3);
        _muz.x = _v3.x; _muz.y = _v3.y; _muz.z = _v3.z;
      } else { // no gun shown (downed, or not built yet): roughly the hands
        _muz.x = m.x - Math.sin(m.ry) * 0.5; _muz.y = m.y + (m.st === PSTATE.DOWN ? 0.3 : 0.78); _muz.z = m.z - Math.cos(m.ry) * 0.5;
      }
      if (w?.melee) {
        // A swing: no tracer, just the pose and the whoosh.
        m.swing = w.id === 'machete' ? 0.3 : 0.45; sfx.at(m.y).shoot(ev[2], m.x, m.z);
        break;
      }
      if (w?.blast) {
        // A visual arc to the predicted landing point; the boom arrives as 'blast'.
        const B = w.blast, dist = Math.hypot(_end.x - _muz.x, _end.y - _muz.y, _end.z - _muz.z);
        const life = Math.min(B.fuse, Math.max(0.05, dist / B.speed));
        nades.push({ seq: 0, x: _muz.x, y: _muz.y, z: _muz.z, vx: (_end.x - _muz.x) / life, vy: (_end.y - _muz.y + 0.5 * B.grav * life * life) / life, vz: (_end.z - _muz.z) / life,
          t: 0, w: ev[2], mine: false, ox: 0, oz: 0, shell: fx.shell(), trail: 0, mx: 0, my: 0, mz: 0, life });
      } else fx.tracer(_muz, _end, w?.pierce > 2 ? 0.05 : 0.03);
      if (!w?.thrown) fx.burst(_muz, 0xffd43b, 1, 0.5, 0.16, true, 0.08, 0);
      sfx.at(m.y).shoot(ev[2], m.x, m.z);
      break;
    }
    case 'shove': { const m = mates.get(ev[1]); if (m) m.chibi.punch = 0.6; break; }
    case 'pk': world.setTaken(ev[1], true); break;
    case 'got': if (ev[1] === me.id) onGot(ev[2]); break;
    case 'loot': for (const id of ev[1]) world.setTaken(id, false); break;
    case 'last': if (ev[1] === me.id) { me.lastLegs = true; hud.banner(t('Last legs! One more down and you\'re out — find a medkit'), true); sfx.down(); } break;
    case 'use': {
      world.setTaken(ev[2], true);
      const s = L.def.steps[step];
      const who = ev[1] === me.id ? t('You') : roster.get(ev[1])?.name ?? t('Someone');
      hud.feed(t('{a}: {b}', { a: who, b: t(L.def.pickups[ev[2]]?.label ?? 'used it').replace(/\s*[(（].*[)）]$/, '') }));
      sfx.gate();
      if (s?.hold) { hud.banner(t(s.big ? 'THE BIG HOLD ON! Man the guns!' : 'HOLD OUT!'), true); if (!s.horde) sfx.horde(); } // with `horde` the server's 'horde' event (just before) already roared
      break;
    }
    case 'door': {
      doors = ev[2] ? doors | (1 << ev[1]) : doors & ~(1 << ev[1]); world.setDoors(doors);
      // The drawbridge and the boom gate have their own machinery; every other door clanks open.
      const d = L.def.doors[ev[1]], dx = d ? ((d.x0 + d.x1 + 1) / 2) * TILE : 0, dz = d ? ((d.z0 + d.z1 + 1) / 2) * TILE : 0, dy = (d?.lv ?? 0) * STOREY;
      if (d?.kind === 'bridge' && ev[2]) sfx.at(dy).drawbridge(dx, dz);
      else if (d?.kind === 'boom' && ev[2]) sfx.at(dy).boomGate(dx, dz);
      else sfx.gate();
      break;
    }
    case 'step': enterStep(ev[1], true); break;
    case 'item': {
      const who = ev[1] === me.id ? t('You') : roster.get(ev[1])?.name ?? t('Someone');
      hud.feed(t('{who} found a {item} ({have}/{need})', { who, item: t(L.def.pickups[ev[2]]?.label ?? 'item'), have: ev[3], need: ev[4] }));
      sfx.pickup();
      break;
    }
    case 'checkpoint': me.lastLegs = false; hud.banner(t('Checkpoint saved')); sfx.heal(); break;
    // The corpse falls where the zombie is shown (its own y); ev[7] is the floor it died on.
    case 'zdie': remotes.kill(ev[1], ev[5] === 1); if (ev[6] === me.id) hud.hitmark(ev[5] === 1, true); break;
    case 'boom': {
      const y = ev[3] ?? 0, p = { x: ev[1], y: y + 0.9, z: ev[2] };
      fx.burst(p, 0xc8f25a, 26, 8, 0.22); fx.poof(p, 0xe9f76a, 10, 0.5);
      const d = Math.hypot(ev[1] - me.x, y - me.gy, ev[2] - me.z);
      sfx.at(y).boom(ev[1], ev[2]); me.trauma = Math.min(1, me.trauma + 1 / (1 + d * 0.2));
      break;
    }
    case 'goo': if (ev[1] === me.id) hud.goo(); break;
    case 'hurt':
      if (ev[1] !== me.id) { const m = mates.get(ev[1]); if (m) { m.chibi.punch = 0.8; sfx.at(m.y).oof(m.x, m.z); } break; }
      {
        const dx = ev[3] - me.x, dz = ev[4] - me.z;
        hud.hurt(Math.atan2(dx * Math.cos(me.yaw) - dz * Math.sin(me.yaw), -dx * Math.sin(me.yaw) - dz * Math.cos(me.yaw)));
        sfx.hurt(); me.slowT = 0.35; me.trauma = Math.min(1, me.trauma + 0.25 + ev[2] * 0.02);
      }
      break;
    case 'down': if (ev[1] !== me.id) { hud.feed(t('{who} is down!', { who: roster.get(ev[1])?.name ?? t('A teammate') })); sfx.down(); } break;
    case 'dead': hud.feed(ev[1] === me.id ? t('You are out — {rescue}', { rescue: rescueIn(SURVIVOR_RULES[roomDiff].respawn) })
      : t('{who} is out — {rescue}', { who: roster.get(ev[1])?.name ?? t('A teammate'), rescue: rescueIn(SURVIVOR_RULES[roomDiff].respawn) })); break;
    case 'revived':
      if (ev[1] === me.id) { hud.banner(t(ev[2] === me.id ? 'You got yourself up!' : 'Back on your feet!')); sfx.heal(); }
      else hud.feed(t('{who} was helped up', { who: roster.get(ev[1])?.name ?? t('A teammate') }));
      break;
    case 'blast': if (ev[1] !== me.id || ev[1] === 0) boomFx(ev[2], ev[3], ev[4], ev[5]); break;
    case 'kb': if (ev[1] === me.id) { me.kx = ev[2]; me.kz = ev[3]; me.vy = 4; me.onGround = false; me.trauma = 1; } break;
    case 'horde': hud.banner(t('HORDE INCOMING!'), true); sfx.horde(); break;
    case 'brute': hud.banner(t('A BRUTE approaches…'), true); sfx.brute(); break;
    case 'slam': {
      const y = ev[4] ?? 0, d = Math.hypot(ev[2] - me.x, y - me.gy, ev[3] - me.z);
      fx.burst({ x: ev[2], y: y + 0.6, z: ev[3] }, 0xffffff, 6, 4, 0.14, true, 0.35, 4);
      fx.poof({ x: ev[2], y: y + 0.3, z: ev[3] }, 0xd8cfe8, 7, 0.35);
      sfx.at(y).thud(ev[2], ev[3]); me.trauma = Math.min(1, me.trauma + 0.8 / (1 + d * 0.25));
      break;
    }
    case 'pin': {
      remotes.pin(ev[1], ev[2]);
      const type = zeds.get(ev[2])?.type ?? ZT.CHARGER;
      if (ev[1] === me.id) {
        Object.assign(me, { pinned: true, pinType: type, pinX: ev[3], pinY: ev[5] ?? me.gy, pinZ: ev[4], kx: 0, kz: 0, vx: 0, vz: 0, reloadT: 0, healT: 0, trauma: 1 });
        if (type === ZT.CHARGER) placeMe(ev[3], ev[5] ?? me.gy, ev[4]);
        hud.banner(t(type === ZT.SNATCHER ? 'LASSOED! Hang on…' : type === ZT.PIGGYBACK ? 'Something is on your back!' : 'PINNED! Hang on…'), true);
      } else {
        const who = roster.get(ev[1])?.name ?? t('A teammate');
        if (type === ZT.SNATCHER) { hud.banner(t('{who} is LASSOED — shoot the Snatcher or shove them free!', { who }), true); hud.feed(t('A Snatcher is reeling {who} in!', { who })); }
        else if (type === ZT.PIGGYBACK) { hud.banner(t('A Piggyback is riding {who} — shove it off!', { who }), true); hud.feed(t('A Piggyback jumped on {who}!', { who })); }
        else { hud.banner(t('{who} is PINNED — shoot the Charger!', { who }), true); hud.feed(t('A Charger slammed {who} into a wall!', { who })); }
      }
      if (type === ZT.SNATCHER) { const zd = zeds.get(ev[2]); sfx.at(zd?.y ?? ev[5] ?? 0).snatch(zd?.x ?? ev[3], zd?.z ?? ev[4]); } else sfx.down();
      break;
    }
    case 'unpin':
      remotes.unpin(ev[1]);
      if (ev[1] === me.id) {
        me.pinned = false; me.snapPos = me.pinType !== ZT.CHARGER;
        if (me.st === PSTATE.ALIVE) hud.feed(t(me.pinType === ZT.SNATCHER ? 'Free from the Snatcher!' : me.pinType === ZT.PIGGYBACK ? 'The Piggyback is off you!' : 'Free from the Charger!'));
      }
      break;
    case 'fire': fx.fire(ev[1], ev[2], ev[3], ev[4], ev[5], ev[6] ?? 0); sfx.at(ev[6] ?? 0).fireStart(ev[2], ev[3]); break;
    case 'lure': fx.lure(ev[1], ev[2], ev[3], ev[4] ?? 0); break;
    case 'clang': { const zd = zeds.get(ev[1]); if (zd) { zd.chibi.punch = 0.5; sfx.at(zd.y).clang(zd.x, zd.z); if (range === null && Math.hypot(zd.x - me.x, zd.z - me.z) < 12) remotes.tinpotTip(); } break; }
    case 'armor':
      if (ev[1] === me.id) { sfx.armorHit(); fx.burst({ x: cam.x + cam.fx * 0.8, y: cam.y - 0.35, z: cam.z + cam.fz * 0.8 }, 0xffffff, 5, 2, 0.07, false, 0.5, 3); }
      else { const m = mates.get(ev[1]); if (m) fx.burst({ x: m.x, y: m.y + 0.8, z: m.z }, 0xffffff, 5, 2.5, 0.07, false, 0.5, 3); }
      break;
    case 'weeper': {
      const zd = zeds.get(ev[1]);
      if (ev[2] === 1) { if (zd && Math.hypot(zd.x - me.x, zd.z - me.z) < 14) hud.banner(t('The Weeper is stirring — back away!'), true); }
      else {
        if (zd) { sfx.at(zd.y).weeperScream(zd.x, zd.z); me.trauma = Math.min(1, me.trauma + 0.6 / (1 + Math.hypot(zd.x - me.x, zd.z - me.z) * 0.1)); }
        hud.banner(ev[3] === me.id ? t('You woke the Weeper — RUN or shoot!') : t('The Weeper is awake!'), true);
      }
      break;
    }
    case 'spit': {
      const [, , x0, z0, x1, z1, flight] = ev, y0 = ev[7] ?? 0, y1 = ev[8] ?? 0;
      fx.glob(x0, z0, x1, z1, flight, y0, y1);
      sfx.at(y0).spit(x0, z0);
      // Warn whoever is about to be gooed: the target spot is where they stand.
      if (Math.hypot(x1 - me.x, z1 - me.z) < 3.5 && Math.abs(y1 - me.gy) < 2 && me.st !== PSTATE.DEAD) hud.feed(t('Goo incoming — move!'));
      break;
    }
    case 'puddle': fx.puddle(ev[1], ev[2], ev[3], ev[4], ev[5], ev[6] ?? 0); break;
    case 'sizzle':
      if (ev[1] === me.id) { sfx.sizzle(); me.trauma = Math.min(1, me.trauma + 0.08); }
      else { const m = mates.get(ev[1]); if (m) m.chibi.punch = 0.4; }
      break;
    case 'ring': {
      const zd = zeds.get(ev[1]);
      const d = zd ? Math.hypot(zd.x - me.x, zd.z - me.z) : 20;
      hud.banner(t('ALARM CLOCK! Shoot it — {s} s!', { s: ALARM.ringTime }), true);
      hud.feed(t('An Alarm Clock is ringing {m} m away', { m: Math.round(d) }));
      break;
    }
    case 'alarm': {
      hud.banner(t('The alarm rang out — sleepers incoming!'), true);
      sfx.alarmOut();
      fx.burst({ x: ev[2], y: (ev[4] ?? 0) + 1.4, z: ev[3] }, 0xffd43b, 10, 5, 0.16, true, 0.5, 2);
      break;
    }
    case 'end': {
      ended = true;
      const board = (ev[4] ?? []).map(([id, kills]) => ({ name: id === me.id ? t('You') : roster.get(id)?.name ?? '???', kills }));
      const ni = ev[5] ?? -1, next = CHAPTERS[ni];
      hud.showEnd(ev[1] === 1, ev[2], ev[3], board,
        ev[1] === 1 ? (next ? (ni === 0 ? t('Campaign complete! Back to chapter 1…') : t('Next: Chapter {n} — {title}', { n: ni + 1, title: t(next.title) })) : '')
          : t('Back to the last checkpoint (or the chapter start)…'));
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
      me.id = m.id; placeMe(m.x, m.y ?? 0, m.z);
      // A new room starts you with the pistol only, whatever you carried in the last one.
      Object.assign(me, { weapon: 0, primary: -1, sidearm: 0, melee: -1, armor: 0, pinned: false, mount: -1 });
      clearThrowables();
      vm.setWeapon(0);
      for (const pv of world.pickups) world.setTaken(pv.def.id, false);
      for (const id of m.taken) world.setTaken(id, true);
      doors = m.doors; world.setDoors(doors, true);
      debugServer = m.debug === 1;
      enterStep(m.step, false);
      showIntro();
      history.replaceState(null, '', `${location.pathname}${location.search}#${m.room}`);
      roomDiff = parseDifficulty(m.diff ?? 'normal');
      hud.setRoom(m.room, difficultyLabel(roomDiff));
      enterGame();
      break;
    case 'ro': syncRoster(m.players); break;
    case 'err': lobby.message(tMsg(m.msg)); break;
    case 's':
      serverState = m.st; holdout = m.ho; qc = m.qc;
      if (m.g !== doors) { doors = m.g; world.setDoors(doors); }
      for (const ev of m.ev) onEvent(ev);
      applyPlayers(m.p);
      remotes.applyZombies(m.z, time);
      break;
  }
};
net.onClose = () => {
  if (!inGame) { lobby.setButtons(true); return; }
  inGame = false;
  document.exitPointerLock();
  hud.show(false); hud.pause(false);
  $('lobby').hidden = false;
  lobby.message(t('Disconnected from the server.'));
  lobby.setButtons(true);
  void lobby.refreshRooms();
};

// --------------------------------------------------------------------- lobby
const lobby = initLobby({ net, sfx, params, chapter: () => chapter, level: () => L, loadChapter, inGame: () => inGame });
$('pause').addEventListener('mousedown', () => { lockPointer(); });
// Graphics settings: the same section on the lobby card and (open) on the pause card.
initGraphicsUi([{ host: $('lobbygfx') }, { host: $('pausegfx'), open: true, leaves: true }]);

function enterGame(): void {
  inGame = true; ended = false; vm.visible = me.st === PSTATE.ALIVE || me.st === PSTATE.DOWN;
  $('lobby').hidden = true;
  hud.show(true);
  hud.pause(!locked && !DEBUG);
  if (!DEBUG) lockPointer();
}
// ------------------------------------------------------------- shooting range
/** Shooting range: health still trickling back from Gummy Vitamins, and the rate (per second). The range has no server to do it. */
const rangeRegen = { left: 0, rate: 0, /** Fraction of a health point not yet handed over. */ frac: 0 };
/** Shooting range: apply medical item `k` to yourself, by the same rules as a room on Normal. */
function rangeHeal(k: number): void {
  const med = MEDS[k];
  if (!med) return;
  me.hp = Math.min(PLAYER.hp, Math.ceil(me.hp + healAmount(k, me.hp, SURVIVOR_RULES.normal.heal)));
  if (med.regen > 0) { rangeRegen.left = Math.max(rangeRegen.left, med.regen); rangeRegen.rate = med.regen / med.over; }
}
/** Drop every zombie and corpse on screen (leaving or entering the range). */
function clearZeds(): void {
  remotes.clear();
  clearNades(); fx.clearGoo();
}

/** Offline practice: no room or server; ShootingRange answers our messages locally. */
function enterRange(): void {
  sfx.unlock();
  const RANGE_PID = 1;
  clearZeds();
  syncRoster([]);
  useLevel(rangeLevel());
  const s = L.def.spawns[0];
  Object.assign(me, {
    id: RANGE_PID, vx: 0, vz: 0, kx: 0, kz: 0, yaw: Math.PI, pitch: 0, hp: PLAYER.hp, st: PSTATE.ALIVE, meds: MEDS.map(() => 0), medSel: -1, lastLegs: false,
    weapon: 0, primary: -1, sidearm: 0, melee: -1, armor: 0, mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve), reloadT: 0, pinned: false, shoveFat: 0,
  });
  placeMe(s.x, s.y ?? 0, s.z);
  clearThrowables();
  vm.setWeapon(0);
  range = new ShootingRange(L, RANGE_PID, (m) => net.onMessage(m));
  net.local = (m) => range?.handle(m);
  serverState = 'play'; holdout = -1;
  world.setDoors(0, true);
  enterStep(0, false);
  hud.radio([], true);
  const room = $<HTMLButtonElement>('room');
  room.textContent = t('Shooting range'); room.onclick = null;
  $('rangepanel').hidden = false;
  $('leaverange').hidden = false;
  hud.banner(t('Shooting range'));
  hud.feed(t('Take anything off the rack behind you (E): it never runs out'));
  hud.feed(t('1 2 3: gun / sidearm / close-in · 4 5: throwables · X: clear stats · Esc: leave'));
  enterGame();
}

function leaveRange(): void {
  if (!range) return;
  range = null; net.local = null;
  inGame = false;
  document.exitPointerLock();
  clearZeds();
  me.id = 0;
  loadChapter(lobby.pickedChapter());
  hud.show(false); hud.pause(false);
  $('rangepanel').hidden = true;
  $('leaverange').hidden = true;
  $('lobby').hidden = false;
  lobby.setButtons(true);
  void lobby.refreshRooms();
}
$('range').addEventListener('click', enterRange);
// Inside the pause card: don't let the card's own mousedown re-grab the pointer.
$('leaverange').addEventListener('mousedown', (e) => e.stopPropagation());
$('leaverange').addEventListener('click', leaveRange);

/** The range's numbers panel, rewritten only when it changes. */
function updateRangePanel(): void {
  if (!range) return;
  const html = rangePanelHtml(WEAPONS[me.weapon], range.stats, { base: baseSpread(), now: shotSpread() });
  if (html !== rangeHtml) { rangeHtml = html; $('rangepanel').innerHTML = html; }
}
let rangeHtml = '';

// `?room=X&step=N` (from the map viewer) joins straight away and jumps to that quest step on a dev server.
if ((DEBUG || params.has('step')) && params.has('room')) void lobby.join({ room: lobby.inviteCode, ch: chapter });


function showIntro(): void {
  const d = L.def;
  hud.intro(chapter + 1, t(d.title), t(d.subtitle), t(d.intro));
}

/** A new quest step became active: update markers, play its radio lines. */
function enterStep(i: number, announce: boolean): void {
  step = i; qc = 0;
  world.setStep(i);
  const s = L.def.steps[i];
  if (!s) return;
  hud.radio(s.radio.map(([who, line]): [string, string] => [t(who), t(line)]), true);
  if (announce) { hud.flashObjective(); sfx.pickup(); }
  if (announce && s.kind === 'holdout' && s.big) hud.banner(t('THE BIG HOLD ON! Man the guns!'), true);
}

/** Where the quest marker should point right now (world metres; `y` = the floor height there). */
function waypointTarget(): { x: number; z: number; y?: number } | null {
  const s = L.def.steps[step];
  if (!s || serverState !== 'play') return null;
  if (s.kind === 'collect') {
    let best: { x: number; z: number; y?: number } | null = null, bd = Infinity;
    for (const pv of world.pickups) {
      if (pv.def.kind !== 'item' || pv.def.group !== s.group || pv.taken) continue;
      const d = Math.hypot(pv.def.x - me.x, (pv.def.y ?? 0) - me.gy, pv.def.z - me.z);
      if (d < bd) { bd = d; best = pv.def; }
    }
    return best;
  }
  if ((s.kind === 'reach' || s.kind === 'gather') && s.area && L.inRect(me.x, me.gy, me.z, s.area)) return null;
  if (holdout >= 0 && s.kind !== 'holdout') return null;
  return s.at;
}

const _wp = new pc.Vec3(), _scr = new pc.Vec3();
function updateWaypoint(): void {
  const t = me.st === PSTATE.DEAD ? null : waypointTarget();
  if (!t) { hud.waypoint(null); return; }
  const dist = Math.hypot(t.x - me.x, t.z - me.z), ty = (t.y ?? 0) + 1.6;
  // A storey or more above or below you: say so next to the distance.
  const dy = (t.y ?? 0) - me.gy, vert = dy > STOREY / 2 ? 1 : dy < -STOREY / 2 ? -1 : 0;
  _wp.set(t.x, ty, t.z);
  const w = canvas.clientWidth, h = canvas.clientHeight, m = 36;
  const ahead = (t.x - cam.x) * cam.fx + (ty - cam.y) * cam.fy + (t.z - cam.z) * cam.fz;
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
  hud.waypoint(x, y, dist, edge, vert);
}

// ---------------------------------------------------------------- simulation
function updateMe(dt: number): void {
  if (me.pinned && me.st !== PSTATE.ALIVE) me.pinned = false;
  const alive = me.st === PSTATE.ALIVE, on = active() && alive && !me.pinned;
  if (!on) jumpBuf = 0;
  me.fireCd -= dt; me.shoveRest += dt; me.slowT -= dt; me.throwCd -= dt;
  me.bloom = Math.max(0, me.bloom - dt * WEAPONS[me.weapon].bloom[2]);
  me.recoil += (0 - me.recoil) * Math.min(1, dt * 9);

  // Movement.
  let f = 0, s = 0;
  const manned = me.mount >= 0 && !!L.def.mounts[me.mount];
  if (on && !manned) { f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0); s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0); }
  if (manned) {
    // At a mounted gun you turn within its arc and tilt within its limits.
    const m = L.def.mounts[me.mount];
    let rel = me.yaw - m.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    me.yaw = m.yaw + Math.max(-MOUNT.arc, Math.min(MOUNT.arc, rel));
    me.pitch = Math.max(MOUNT.pitchDown, Math.min(MOUNT.pitchUp, me.pitch));
  }
  const len = Math.hypot(f, s) || 1;
  // Slow on a ladder: the one you're on, or the one this frame's step would put you on.
  const ladder = Math.min(L.speedAt(me.x, me.gy, me.z, LADDER_SPEED), L.speedAt(me.x + me.vx * dt, me.gy, me.z + me.vz * dt, LADDER_SPEED));
  const speed = PLAYER.speed * WEAPONS[me.weapon].move * (me.hp < 40 ? 0.82 : 1) * (me.slowT > 0 ? 0.55 : 1) * (me.healT > 0 ? MEDS[me.medSel]?.move ?? 0.35 : 1) * ladder;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  const wx = ((-sin * f + cos * s) / len) * speed, wz = ((-cos * f - sin * s) / len) * speed;
  const k = Math.min(1, dt * (me.onGround ? 14 : 4));
  me.vx += (wx - me.vx) * k; me.vz += (wz - me.vz) * k;
  // On a ladder the limit is hard from the first frame: the run speed you arrive with doesn't ease down onto it.
  if (ladder < 1) { const v = Math.hypot(me.vx, me.vz); if (v > speed) { me.vx *= speed / v; me.vz *= speed / v; } }
  const gy0 = me.gy, x0 = me.x, z0 = me.z;
  if (alive) {
    // Held: the server moves you (dragged by a Snatcher, steered by a Piggyback); ease toward where it has you.
    if (me.pinned) {
      const pk = Math.min(1, dt * 14);
      me.x += (me.pinX - me.x) * pk; me.z += (me.pinZ - me.z) * pk; me.gy += (me.pinY - me.gy) * pk;
      me.vx = me.vz = me.kx = me.kz = 0;
    } else if (manned) {
      const st = seatOf(me.mount);
      me.x = st.x; me.z = st.z; me.gy = st.y; me.vx = me.vz = me.kx = me.kz = 0;
    } else slideMe((me.vx + me.kx) * dt, (me.vz + me.kz) * dt);
    me.kx *= Math.max(0, 1 - dt * 5); me.kz *= Math.max(0, 1 - dt * 5);
    // Jumps (and knockback) lift you off whatever floor you are on; you land back on it.
    // Held Space keeps hopping; a buffered press (jumpBuf) catches taps that came and went between two frames.
    if (on && !manned && (keys.has('Space') || jumpBuf > 0) && me.onGround) { me.vy = 6.4; me.onGround = false; jumpBuf = 0; }
    jumpBuf = Math.max(0, jumpBuf - dt);
    me.vy -= 19 * dt; me.jy += me.vy * dt;
    if (me.jy <= 0) { if (!me.onGround) sfx.land(-me.vy, indoorAt(me.x, me.gy, me.z)); me.jy = 0; me.vy = 0; me.onGround = true; }
    // Footsteps every stride on the ground.
    if (me.onGround) {
      me.stride += Math.hypot(me.vx, me.vz) * dt;
      if (me.stride > 1.8) { me.stride = 0; sfx.step(indoorAt(me.x, me.gy, me.z)); }
    }
    // Zombies are solid: get shouldered out of them (not while one has hold of you; only on your floor).
    // In a crowd the pushes add up: move by their sum, but never further than the deepest single overlap
    // (summed in full, a pack of 70 shoved you 15 m in a second).
    if (!me.pinned && !manned) {
      let px = 0, pz = 0, deepest = 0;
      for (const z of zeds.values()) {
        const min = PLAYER.radius + ZTYPES[z.type].radius * 0.85, dx = me.x - z.x, dz = me.z - z.z;
        if (Math.abs(dx) > min || Math.abs(dz) > min || Math.abs(z.y - me.gy) > 1.2) continue;
        const d = Math.hypot(dx, dz);
        if (d >= min || d <= 0.001) continue;
        px += (dx / d) * (min - d); pz += (dz / d) * (min - d); deepest = Math.max(deepest, min - d);
      }
      const len = Math.hypot(px, pz);
      if (len > 0.0001) { const k = Math.min(1, deepest / len); slideMe(px * k, pz * k); }
    }
    // Teammates are soft: ease apart from one you stand inside (each client pushes itself, so the two of
    // you part halfway each). Standing in one put your eye inside their model and the screen went black.
    // Not off a downed one (you crouch over them to help them up) or while held.
    if (!me.pinned && !manned) for (const m of mates.values()) {
      if (m.st !== PSTATE.ALIVE || !m.chibi.group.enabled || Math.abs(m.y - me.gy) > 1.2) continue;
      const min = PLAYER.radius * 2, dx = me.x - m.x, dz = me.z - m.z;
      if (Math.abs(dx) > min || Math.abs(dz) > min) continue;
      const d = Math.hypot(dx, dz);
      if (d >= min) continue;
      // Exactly on top of each other: split along a fixed axis, the lower id one way, the higher the other.
      const ux = d > 0.001 ? dx / d : me.id < m.id ? 1 : -1, uz = d > 0.001 ? dz / d : 0;
      // A gentle nudge (at most 2 m/s): each of you sees the other a little late, and a hard shove on that
      // stale position can make the pair chase each other across the floor.
      const push = Math.min((min - d) * Math.min(1, dt * 10), 2 * dt);
      slideMe(ux * push, uz * push);
    }
  } else { me.vx = me.vz = 0; me.jy = 0; me.vy = 0; me.onGround = true; }
  // Stairs and ladders are smooth slopes and the camera rides them as they are; a sudden floor change
  // (stepping up onto a ledge) is eased out of the camera instead of snapping it.
  const dg = me.gy - gy0;
  if (Math.abs(dg) > 2.2 * Math.hypot(me.x - x0, me.z - z0) + 0.05 && Math.abs(dg) < STOREY / 2) camDip -= dg;
  camDip *= Math.exp(-dt * 14);
  me.y = me.gy + me.jy;

  // Weapons. The range never runs dry: reserves stay full.
  if (range) for (let i = 0; i < WEAPONS.length; i++) me.reserve[i] = WEAPONS[i].reserve;
  if (me.reloadT > 0) {
    const w = WEAPONS[me.weapon];
    me.reloadT -= dt;
    vm.setReload(1 - me.reloadT / w.reload);
    if (me.reloadT <= 0) {
      const take = Math.min(w.mag - me.mag[me.weapon], me.reserve[me.weapon]);
      me.mag[me.weapon] += take; me.reserve[me.weapon] -= take;
      vm.setReload(0); sfx.reloadDone(me.weapon);
    }
  }
  if (!updateThrowAim(on) && (on || downShooter()) && mouse.left) fire();
  updateNades(dt);

  if (range && rangeRegen.left > 0) {
    const give = Math.min(rangeRegen.left, rangeRegen.rate * dt);
    rangeRegen.left -= give; rangeRegen.frac += give;
    // Whole points as they build up; the last sliver rounds off when the trickle ends.
    const whole = rangeRegen.left > 1e-6 ? Math.floor(rangeRegen.frac) : Math.round(rangeRegen.frac);
    if (whole > 0) { rangeRegen.frac -= whole; me.hp = Math.min(PLAYER.hp, me.hp + whole); }
  }
  // Medical item channel: hold Q to use the selected one (small items are quick; the medkit takes its time).
  const mk = me.medSel, med = MEDS[mk];
  const healing = on && !manned && keys.has('KeyQ') && !me.healLatch && !!med && me.meds[mk] > 0 && medUseful(mk, me.hp, me.lastLegs ? 1 : 0);
  if (healing) {
    if (me.healT === 0) sfx.bandage();
    me.healT += dt;
    if (me.healT >= med.time) {
      net.send({ t: 'h', k: mk }); me.healT = 0; me.healLatch = true;
      // Spent (the snapshot will agree): Q moves on to whatever is left.
      me.meds[mk]--; me.medSel = medSelect(me.meds, mk);
    }
  } else {
    // Q with nothing it could do: say why, once per press.
    if (on && keys.has('KeyQ') && !me.healLatch && me.healT === 0) {
      me.healLatch = true;
      if (!med || me.meds[mk] <= 0) hud.feed(t('No medical items — look beside ammo piles'));
      else if (me.hp >= PLAYER.hp) hud.feed(t('Already at full health'));
    }
    me.healT = 0;
  }

  // Revive channel.
  target = on && !manned ? findTarget() : null;
  const wantRevive = target?.kind === 'revive' && keys.has('KeyE') ? target.mate.id : 0;
  if (wantRevive !== me.reviving) { me.reviving = wantRevive; net.send({ t: 'r', id: wantRevive }); }

  sendT -= dt;
  if (sendT <= 0) sendPos();
}
function sendPos(): void {
  sendT = 0.05;
  // y: your feet (floor height plus any jump).
  net.send({ t: 'p', x: +me.x.toFixed(2), y: +me.y.toFixed(2), z: +me.z.toFixed(2), ry: +me.yaw.toFixed(3), rx: +me.pitch.toFixed(3), w: me.weapon, a: 0 });
}

/**
 * Ridden by a Piggyback you can't see what has you from your own eyes, so the camera pulls out behind
 * you for as long as it is on (`rideCam`: 0 = first person, 1 = fully out) and your own survivor is drawn,
 * reeling under it. The mouse still looks around; you still can't act until it is knocked off.
 */
let rideCam = 0;
const RIDE_CAM = { dist: 3.6, lift: 0.55, secs: 0.28 };
/** Your own survivor, built the first time the camera leaves your head (`look`: roster look it was built for). */
let selfBody: { chibi: Chibi; look: number } | null = null;
/** Draw (or hide) your own survivor at your position. */
function updateSelfBody(dt: number, show: boolean): void {
  if (!show) { if (selfBody) selfBody.chibi.group.enabled = false; return; }
  const look = roster.get(me.id)?.look ?? 0;
  if (!selfBody || selfBody.look !== look) {
    selfBody?.chibi.dispose();
    selfBody = { chibi: new Chibi(survivorLook(look)), look };
    app.root.addChild(selfBody.chibi.group);
  }
  // Facing the way you look, as teammates see you: the camera is then always behind your back, and the rider on it.
  const g = selfBody.chibi.group;
  g.enabled = true;
  g.setPosition(me.x, me.y, me.z);
  g.setLocalEulerAngles(0, me.yaw * RAD, 0);
  selfBody.chibi.animate('stagger', time, dt);
}

function updateCamera(dt: number): void {
  camera.camera!.fov = baseFov;
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
    if (m) { cam.x = m.x + Math.sin(m.ry) * 3.2; cam.y = m.y + 2.6; cam.z = m.z + Math.cos(m.ry) * 3.2; camera.setPosition(cam.x, cam.y, cam.z); camera.lookAt(m.x, m.y + 1.0, m.z); }
    else { cam.x = me.x; cam.y = me.y + 6; cam.z = me.z + 4; camera.setPosition(cam.x, cam.y, cam.z); camera.lookAt(me.x, me.y, me.z); }
    cam.rot.copy(camera.getRotation());
    setTorch(false, 0, 0, 0, 0, 0, -1);
    rideCam = 0; updateSelfBody(dt, false);
    return;
  }
  const down = me.st === PSTATE.DOWN;
  const pitch = me.pitch + me.recoil;
  cam.x = me.x; cam.y = me.y + camDip + (down ? 0.42 : PLAYER.eye); cam.z = me.z;
  cam.fx = -Math.sin(me.yaw) * Math.cos(pitch); cam.fy = Math.sin(pitch); cam.fz = -Math.cos(me.yaw) * Math.cos(pitch);
  // Piggyback ride: ease out behind your own shoulders (not through a wall), and back in when it is off.
  const riding = me.pinned && me.pinType === ZT.PIGGYBACK && !down;
  rideCam = Math.max(0, Math.min(1, rideCam + (riding ? dt : -dt) / RIDE_CAM.secs));
  if (rideCam > 0) {
    // Back along the view and up a little, stopped short of walls, floors and ceilings (always at least
    // 0.6 m back, behind your own head).
    const e = rideCam * rideCam * (3 - 2 * rideCam), want = RIDE_CAM.dist * e;
    const ox = -cam.fx * want, oy = -cam.fy * want + RIDE_CAM.lift * e, oz = -cam.fz * want, len = Math.hypot(ox, oy, oz) || 1;
    const room = L.ray(cam.x, cam.y, cam.z, ox / len, oy / len, oz / len, len + 0.35, doors) - 0.35;
    const k = Math.max(Math.min(1, (0.6 * e) / len), Math.min(1, room / len));
    cam.x += ox * k; cam.z += oz * k;
    cam.y = Math.max(me.gy + 0.45, Math.min(me.gy + CEIL_H - 0.35, cam.y + oy * k));
  }
  updateSelfBody(dt, rideCam > 0.2);
  quatYXZ(pitch + (Math.random() - 0.5) * shake, me.yaw + (Math.random() - 0.5) * shake, down ? 0.35 : (Math.random() - 0.5) * shake, cam.rot);
  camera.setPosition(cam.x, cam.y, cam.z);
  camera.setRotation(cam.rot);
  setTorch(torchOn && !down, cam.x, cam.y - 0.1, cam.z, cam.fx, cam.fy, cam.fz);
}

/** Radio sets in the current level, each with its own timer until it next crackles. */
let radioSets: { x: number; y: number; z: number; t: number }[] = [], radioLevel: Level | null = null;
/** The nearest radio set within earshot hisses and crackles to itself, so it draws you over. */
function radioAudio(dt: number): void {
  if (radioLevel !== L) {
    radioLevel = L;
    radioSets = L.def.props.filter((p) => p.type === 'radio').map((p) => ({ x: (p.x + p.w / 2) * TILE, y: (p.lv ?? 0) * STOREY, z: (p.z + p.d / 2) * TILE, t: Math.random() * 2 }));
  }
  let near: (typeof radioSets)[number] | null = null, best = 18;
  for (const r of radioSets) { const d = Math.hypot(r.x - cam.x, r.y - listenY, r.z - cam.z); if (d < best) { best = d; near = r; } }
  if (near && (near.t -= dt) <= 0) near.t = sfx.at(near.y).radioProp(near.x, near.z);
}

/** Indoors at (x, z) on the floor at about height y (footsteps, landings, the listener's room). */
const indoorAt = (x: number, y: number, z: number): boolean => isIndoor(L.floorAt(x, y, z));
const _fwd = new pc.Vec3();
/** Floor height under the listener (the camera), updated every frame by `listen`. */
let listenY = 0;
/** Feed the audio listener: where you hear from (the camera, so spectating works), and how you are. */
function listen(dt: number): void {
  listenY = L.floorBelow(cam.x, cam.y - 0.4, cam.z); // eye height less a little: also right while down (eye 0.42 up)
  _fwd.copy(camera.forward);
  const h = Math.hypot(_fwd.x, _fwd.z) || 1;
  sfx.setScene(range ? -1 : chapter);
  if (inGame && !range) radioAudio(dt);
  sfx.update(dt, {
    x: cam.x, z: cam.z, y: listenY, fx: _fwd.x / h, fz: _fwd.z / h, indoor: indoorAt(cam.x, listenY, cam.z),
    hurt: inGame && me.st === PSTATE.ALIVE ? 1 - me.hp / PLAYER.hp : 0,
    down: inGame && me.st === PSTATE.DOWN, dead: !inGame || me.st === PSTATE.DEAD, pinned: inGame && me.pinned,
    threat: inGame ? remotes.threat : 0, holdout: inGame && holdout >= 0,
  });
}

/** Reused every frame by `updateHud`. */
const team: MateView[] = [];
function updateHud(dt: number): void {
  const w = WEAPONS[me.weapon];
  hud.setHealth(me.hp, me.st, me.armor, ARMOR.max);
  hud.setMeds(me.meds, me.medSel);
  // In hand: a gun shows its magazine, a close-in weapon nothing, a throwable how many you have left.
  const held = heldThrowable();
  if (w.slot === 'mount') hud.setAmmo(me.reloadT > 0 ? `${t(w.name)} · ${t('cooling…')}` : t(w.name), me.mag[me.weapon], -1, w.mag, false, me.primary >= 0 ? t(WEAPONS[me.primary].name) : '', 0, t(WEAPONS[me.sidearm].name), me.melee >= 0 ? t(WEAPONS[me.melee].name) : '');
  else hud.setAmmo(t(w.name), w.melee ? Infinity : held >= 0 ? me.thr[held] : me.mag[me.weapon], held >= 0 ? -1 : me.reserve[me.weapon], w.mag, me.reloadT > 0, me.primary >= 0 ? t(WEAPONS[me.primary].name) : '',
    held >= 0 ? 4 + held : me.weapon === me.primary ? 1 : me.weapon === me.melee ? 3 : 2, t(WEAPONS[me.sidearm].name), me.melee >= 0 ? t(WEAPONS[me.melee].name) : '',
    me.thr.map((n, k) => (n > 0 ? `${t(WEAPONS[THROWABLES[k]].name)} ×${n}` : '')));
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
  hud.setObjective(serverState !== 'play' || !s ? '—' : s.kind === 'collect' || s.count ? `${t(s.objective)} ${qc}/${s.count}` : t(s.objective));
  updateWaypoint();
  if (openNote && Math.hypot(openNote.def.x - me.x, (openNote.def.y ?? 0) - me.gy, openNote.def.z - me.z) > PLAYER.useRange + 1) { hud.note(null); openNote = null; }
  hud.crosshair(me.st === PSTATE.ALIVE || downShooter());
  hud.spread(6 + shotSpread() * 260);
  const solo = roster.size <= 1;
  hud.spectate(me.st === PSTATE.DEAD ? (me.respawn < 0 ? t('Knocked out — your team can rescue you at the next safe room') : t('Knocked out — a teammate will rescue you in {s}s', { s: me.respawn }))
    : me.st === PSTATE.DOWN ? t(solo ? (me.rev > 0 ? 'You are down! Getting yourself up…' : 'You are down — and alone.') : 'You are down! Wait for a teammate to help you up')
    : me.pinned ? t(me.pinType === ZT.SNATCHER ? 'Lassoed by a Snatcher! Teammates can shoot it or shove you free'
      : me.pinType === ZT.PIGGYBACK ? 'A Piggyback is steering you! Teammates can shove or shoot it off' : 'Pinned by a Charger! Teammates can shoot or shove it off you') : null);

  if (me.st === PSTATE.DOWN && me.rev > 0) { hud.ring(me.rev, t(solo ? 'Getting up…' : 'Being helped up…')); hud.prompt(null); }
  else if (me.healT > 0) { hud.ring(me.healT / (MEDS[me.medSel]?.time ?? PLAYER.healTime), me.medSel > 0 ? t(MEDS[me.medSel].name) : t('Patching up…'), 'var(--pink)'); hud.prompt(null); }
  else if (target?.kind === 'revive') {
    if (me.reviving) { hud.ring(target.mate.rev, t('Helping {who}…', { who: target.mate.name })); hud.prompt(null); }
    else { hud.ring(null); hud.prompt(`<kbd>${t('Hold E')}</kbd> ${t('Help {who} up', { who: target.mate.name })}`); }
  } else {
    hud.ring(null);
    hud.prompt(me.mount >= 0 && me.st === PSTATE.ALIVE ? `<kbd>E</kbd> ${t('Let go')}`
      : target?.kind === 'pickup' || target?.kind === 'mount' ? (target.usable ? `<kbd>E</kbd> ${target.text}` : target.text)
      : target?.kind === 'note' && !hud.noteOpen ? `<kbd>E</kbd> ${t('Read: {title}', { title: t(target.nv.def.title) })}`
        : me.st !== PSTATE.DEAD && fx.inFire(me.x, me.z, me.gy) ? t('You are standing in the fire!')
          : me.st !== PSTATE.DEAD && fx.inGoo(me.x, me.z, me.gy) ? t('Get out of the goo!') : null);
  }
  hud.update(dt);
}

/** Who is aiming mount `id` right now (you, or a teammate on it), for mounts.ts. */
function mountAim(id: number): MountAim | null {
  if (me.mount === id && me.st === PSTATE.ALIVE) return { yaw: me.yaw, pitch: me.pitch + me.recoil, mine: true };
  for (const m of mates.values()) if (m.mount === id && m.st === PSTATE.ALIVE) return { yaw: m.ry, pitch: m.pitch, mine: false };
  return null;
}

// ---------------------------------------------------------------------- loop
let orbit = 0;
// `dt` is already capped by `app.maxDeltaTime` (gfx.ts).
app.on('update', (dt: number) => {
  time += dt;
  if (inGame) {
    range?.tick(dt);
    if (range) updateRangePanel();
    updateMe(dt);
    updateCamera(dt);
    remotes.update(dt, time, { cam, listenY, level: L });
    mounts.update(dt, mountAim);
    updateHud(dt);
    const moving = Math.min(1, Math.hypot(me.vx, me.vz) / PLAYER.speed) * (me.onGround ? 1 : 0.2);
    vm.visible = (me.st === PSTATE.ALIVE || downShooter()) && rideCam < 0.05; // none in the ride camera
    vm.update(dt, moving, lookDX, lookDY);
    flushOwnShots();
    lookDX = lookDY = 0;
  } else {
    // Lobby backdrop: a slow drift down the main street.
    orbit += dt * 0.12;
    const cpSel = lobby.startAt();
    const look = (cpSel >= 0 ? L.def.steps[cpSel]?.at : L.def.steps[0]?.at) ?? L.def.spawns[0];
    cam.x = look.x + Math.sin(orbit) * 4; cam.y = (look.y ?? 0) + 3.2; cam.z = look.z + Math.cos(orbit * 0.7) * 4;
    quatYXZ(-0.05, Math.PI + Math.sin(orbit * 0.5) * 0.5, 0, cam.rot);
    camera.setPosition(cam.x, cam.y, cam.z);
    camera.setRotation(cam.rot);
    vm.visible = false;
    camera.camera!.fov = baseFov;
    vm.update(dt, 0, 0, 0);
    mounts.update(dt, () => null);
  }
  world.update(time, dt, cam.x, cam.y, cam.z);
  pieces.update(time, dt, step, inGame && holdout >= 0);
  listen(dt);
  fx.update(dt, cam.rot);
});
app.start();
// The stats panel (frame time, CPU/GPU, draw calls) is a Graphics setting, always on under `?debug`: see gfxui.ts.

// Debug: `?debug&step=N` jumps the room to quest step N after joining (dev server only).
const jump = (n: number) => { if (debugServer) net.send({ t: 'dbg', step: n }); };
if (params.has('step')) { const n = Number(params.get('step')); const timer = setInterval(() => { if (me.id && debugServer) { jump(n); clearInterval(timer); } }, 200); }
// Debug test switches (dev server only): `?god` survivors take no damage, `?calm` no director zombies.
const cheat = (o: { god?: boolean; calm?: boolean }) => { if (debugServer) net.send({ t: 'dbgf', ...(o.god !== undefined ? { god: o.god ? 1 : 0 } : {}), ...(o.calm !== undefined ? { calm: o.calm ? 1 : 0 } : {}) } as const); };
if (params.has('god') || params.has('calm')) { const timer = setInterval(() => { if (me.id && debugServer) { cheat({ ...(params.has('god') ? { god: true } : {}), ...(params.has('calm') ? { calm: true } : {}) }); clearInterval(timer); } }, 200); }
if (DEBUG) Object.assign(window, { __game: { me, zeds, mates, keys, mouse, net, camera, app, fx, /** What the instanced zombie draws did last frame: { bodies, shadows, draws }. */ get horde() { return zombieHorde()?.stats ?? null; }, get world() { return world; }, get level() { return L; }, fire, shove, interact, jump, give: debugGive, /** Dev server: `cheat({ god, calm })` test switches. */ cheat, /** Dev server: spawn zombie type `zt` at (x, z). */ spawn: (zt: number, x: number, z: number) => { if (debugServer) net.send({ t: 'dbgz', zt, x, z }); }, state: () => ({ inGame, locked, ended, chapter, step, qc, doors, holdout, serverState }) } });
