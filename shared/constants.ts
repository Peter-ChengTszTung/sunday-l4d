// Shared between server and client. Keep this file dependency-free.

export const TILE = 2; // metres per map tile
export const TICK_HZ = 30;
export const SNAP_EVERY = 2; // send a snapshot every N ticks (15 Hz)
export const MAX_PLAYERS = 4;
export const CEIL_H = 4.2;

export const PLAYER = {
  radius: 0.35,
  speed: 5.6,
  hp: 100,
  eye: 1.22,
  reviveTime: 3,
  healTime: 2.2,
  useRange: 2.7,
  bleedRate: 3.2, // hp per second while downed
  shoveCd: 0.7,
  shoveRange: 2.4,
  /**
   * Shove fatigue: each shove adds 1, draining 1 per `shoveRecover` s. At `shoveMax` or more the
   * cooldown is `shoveTiredCd` (so a corner can't be held against commons by shove spam alone).
   */
  shoveMax: 4, shoveRecover: 1.5, shoveTiredCd: 2,
  /** Solo only: getting yourself up takes reviveTime x this, once per attempt (SURVIVOR_RULES.selfRevives). */
  selfReviveMul: 1.5,
};
/** Shove fatigue after `dt` s of rest: the shared rule for client prediction and the server check. */
export const shoveFatigue = (f: number, dt: number): number => Math.max(0, f - dt / PLAYER.shoveRecover);
/** Cooldown that applies to the next shove at fatigue `f`. */
export const shoveCooldown = (f: number): number => (f >= PLAYER.shoveMax ? PLAYER.shoveTiredCd : PLAYER.shoveCd);

export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'autoshotgun' | 'sniper' | 'launcher' | 'magnum'
  | 'bat' | 'machete' | 'axe' | 'firebomb' | 'rattle';
/**
 * Close-in weapon: a swing hits up to `cleave` zombies within `reach` m (plus their radius) inside a
 * cone of half-angle acos(`arc`) around where you face. `stun`/`knock`: stagger seconds and shove-back
 * speed for what survives. Swings are silent (they wake nobody) and ignore a Tinpot's armour.
 */
export interface MeleeDef { reach: number; arc: number; cleave: number; stun: number; knock: number; /** x damage against the Brute. */ brute: number }
/** Explosive projectile (client flies it and claims the impact; the server applies the blast). */
export interface BlastDef {
  dmg: number; // at the centre
  radius: number; // metres
  edge: number; // damage fraction at the rim (linear falloff)
  speed: number; // launch speed m/s
  grav: number; // m/s^2, a floaty lob
  fuse: number; // seconds of flight before an air burst
  arm: number; // impacts closer than this to the shooter only half-arm (weaker, smaller pop)
}
export interface WeaponDef {
  id: WeaponId; name: string; dmg: number; rate: number; mag: number; reserve: number;
  spread: number; pellets: number; range: number; reload: number; auto: boolean;
  /**
   * Which slot it occupies: the sidearm slot keeps infinite reserve; `melee` (key 3) never runs out;
   * `throw` is a throwable (G): up to THROW_MAX carried in any mix, each gone once thrown.
   */
  slot: 'primary' | 'sidearm' | 'melee' | 'throw';
  /** 1 = basic loot, 2 = later, rarer finds. */ tier: 0 | 1 | 2;
  /** Zombies one bullet can pass through (stops at a Brute). */ pierce: number;
  /** View kick (radians of pitch) and camera trauma per shot. */ recoil: number; shake: number;
  /**
   * Damage falloff [near, far, floor]: full damage out to `near` m, easing linearly to `floor` x
   * damage at `far` m and staying there out to `range` (the hard limit: nothing past it hits).
   */
  falloff: readonly [number, number, number];
  /** Movement speed multiplier while this weapon is out (heavy guns slow you down). */ move: number;
  /**
   * Spread build-up (radians) [perShot, max, recover]: each shot adds `perShot` up to `max`, and it
   * recovers at `recover` per second. A gun only blooms if `perShot` beats `recover` x `rate`, so
   * fast spray builds up while paced or burst fire stays tight.
   */
  bloom: readonly [number, number, number];
  /** Extra spread (radians) at full running speed; jumping adds 1.5x this again. Scales with how fast you move. */
  moving: number;
  /** Hold right mouse to aim down a scope: zoomed vertical FOV, spread and move speed while scoped (`spread` is then the hip-fire spread). */
  scope?: { fov: number; spread: number; move: number };
  blast?: BlastDef;
  melee?: MeleeDef;
  /** Throwables (they fly like a launcher shell, see `blast`): what happens where it lands (FIRE / LURE). */
  thrown?: 'fire' | 'lure';
}
export interface ZombieDef {
  id: 'walker' | 'leaper' | 'puffer' | 'brute' | 'charger' | 'drooler' | 'alarm' | 'snatcher' | 'piggyback' | 'weeper' | 'tinpot' | 'raincoat'; hp: number; speed: number; dmg: number; range: number; cd: number;
  scale: number; radius: number; leapDmg: number; boomDmg: number; boomRadius: number;
  /** A common (horde member, counted and paced like a walker) rather than a special. */ common?: boolean;
}
export interface SurvivorLook { name: string; shirt: number; hair: number; style: 'cap' | 'spiky' | 'buns' | 'bob' }

// Index 0 is the starting sidearm with infinite reserve ammo. Indices go over the wire
// (shots, snapshots), so only ever append.
export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: 'Pea Shooter', dmg: 26, rate: 0.17, mag: 15, reserve: Infinity, spread: 0.010, pellets: 1, range: 70, reload: 1.2, auto: false, slot: 'sidearm', tier: 0, pierce: 1, recoil: 0.025, shake: 0.07, falloff: [18, 45, 0.65], move: 1.05, bloom: [0.006, 0.02, 0.15], moving: 0.012 },
  { id: 'smg', name: 'Buzz Blaster', dmg: 20, rate: 0.068, mag: 50, reserve: 450, spread: 0.028, pellets: 1, range: 60, reload: 1.4, auto: true, slot: 'primary', tier: 1, pierce: 1, recoil: 0.02, shake: 0.07, falloff: [14, 35, 0.5], move: 1, bloom: [0.009, 0.02, 0.08], moving: 0.008 },
  { id: 'shotgun', name: 'Boomstick', dmg: 15, rate: 0.72, mag: 8, reserve: 72, spread: 0.055, pellets: 9, range: 26, reload: 2.3, auto: false, slot: 'primary', tier: 1, pierce: 1, recoil: 0.07, shake: 0.3, falloff: [10, 22, 0.25], move: 0.97, bloom: [0.01, 0.02, 0.1], moving: 0.01 },
  { id: 'rifle', name: 'Long Bonker', dmg: 36, rate: 0.105, mag: 30, reserve: 270, spread: 0.014, pellets: 1, range: 90, reload: 2.1, auto: true, slot: 'primary', tier: 1, pierce: 1, recoil: 0.03, shake: 0.07, falloff: [35, 70, 0.75], move: 0.95, bloom: [0.006, 0.03, 0.04], moving: 0.014 },
  // Tier 2: rarer, later finds with a clear job each.
  { id: 'autoshotgun', name: 'Rumble Drum', dmg: 14, rate: 0.26, mag: 10, reserve: 90, spread: 0.075, pellets: 9, range: 24, reload: 2.4, auto: true, slot: 'primary', tier: 2, pierce: 1, recoil: 0.05, shake: 0.22, falloff: [8, 19, 0.25], move: 0.93, bloom: [0.025, 0.03, 0.08], moving: 0.012 },
  { id: 'sniper', name: 'Kebabber', dmg: 90, rate: 0.42, mag: 8, reserve: 64, spread: 0.045, pellets: 1, range: 120, reload: 2.8, auto: false, slot: 'primary', tier: 2, pierce: 4, recoil: 0.09, shake: 0.2, falloff: [120, 120, 1], move: 0.9, bloom: [0.02, 0.04, 0.1], moving: 0.05, scope: { fov: 18, spread: 0.0015, move: 0.45 } },
  { id: 'launcher', name: 'Bloop Tube', dmg: 0, rate: 0.75, mag: 3, reserve: 12, spread: 0.004, pellets: 1, range: 110, reload: 3.2, auto: false, slot: 'primary', tier: 2, pierce: 1, recoil: 0.1, shake: 0.35, falloff: [110, 110, 1], move: 0.88, bloom: [0, 0, 0.1], moving: 0.01,
    blast: { dmg: 240, radius: 4.5, edge: 0.35, speed: 38, grav: 6, fuse: 3, arm: 3 } },
  { id: 'magnum', name: 'Thunder Pea', dmg: 60, rate: 0.32, mag: 8, reserve: Infinity, spread: 0.006, pellets: 1, range: 80, reload: 1.6, auto: false, slot: 'sidearm', tier: 2, pierce: 2, recoil: 0.07, shake: 0.15, falloff: [30, 60, 0.7], move: 1.02, bloom: [0.012, 0.03, 0.12], moving: 0.015 },
  // Close-in weapons (slot 3). `range` is the reach; `pierce` mirrors `melee.cleave`.
  { id: 'bat', name: 'Bonk Bat', dmg: 55, rate: 0.5, mag: 1, reserve: Infinity, spread: 0, pellets: 1, range: 2.3, reload: 0, auto: true, slot: 'melee', tier: 1, pierce: 3, recoil: 0, shake: 0.12, falloff: [3, 3, 1], move: 1.05, bloom: [0, 0, 1], moving: 0,
    melee: { reach: 2.3, arc: 0.3, cleave: 3, stun: 1.1, knock: 8, brute: 0.5 } },
  { id: 'machete', name: 'Snip-Snap', dmg: 75, rate: 0.38, mag: 1, reserve: Infinity, spread: 0, pellets: 1, range: 2.4, reload: 0, auto: true, slot: 'melee', tier: 2, pierce: 4, recoil: 0, shake: 0.1, falloff: [3, 3, 1], move: 1.05, bloom: [0, 0, 1], moving: 0,
    melee: { reach: 2.4, arc: 0.35, cleave: 4, stun: 0.6, knock: 4, brute: 0.5 } },
  { id: 'axe', name: 'Big Chop', dmg: 170, rate: 0.85, mag: 1, reserve: Infinity, spread: 0, pellets: 1, range: 2.6, reload: 0, auto: true, slot: 'melee', tier: 2, pierce: 2, recoil: 0, shake: 0.28, falloff: [3, 3, 1], move: 0.97, bloom: [0, 0, 1], moving: 0,
    melee: { reach: 2.6, arc: 0.5, cleave: 2, stun: 1.2, knock: 6, brute: 0.6 } },
  // Throwables (G). The blast def is the lob; `thrown` says what the landing does.
  { id: 'firebomb', name: 'Hot Sauce', dmg: 0, rate: 0.8, mag: 1, reserve: 0, spread: 0, pellets: 1, range: 24, reload: 0, auto: false, slot: 'throw', tier: 2, pierce: 1, recoil: 0, shake: 0.1, falloff: [24, 24, 1], move: 1, bloom: [0, 0, 1], moving: 0,
    thrown: 'fire', blast: { dmg: 0, radius: 0, edge: 1, speed: 17, grav: 14, fuse: 3, arm: 0 } },
  { id: 'rattle', name: 'Rattle Bomb', dmg: 0, rate: 0.8, mag: 1, reserve: 0, spread: 0, pellets: 1, range: 24, reload: 0, auto: false, slot: 'throw', tier: 2, pierce: 1, recoil: 0, shake: 0.1, falloff: [24, 24, 1], move: 1, bloom: [0, 0, 1], moving: 0,
    thrown: 'lure', blast: { dmg: 280, radius: 5.5, edge: 0.4, speed: 17, grav: 14, fuse: 3, arm: 0 } },
];
/** Most throwables a survivor carries at once, of any mix of kinds. */
export const THROW_MAX = 3;
/** Weapon indices of the throwables, in the order the wire and the HUD list them. */
export const THROWABLES: readonly number[] = WEAPONS.flatMap((w, i) => (w.slot === 'throw' ? [i] : []));
/** Carried throwables as one number for PlayerSnap: 3 bits per kind, in THROWABLES order. `count(wi)`: how many of weapon `wi`. */
export const packThrowables = (count: (wi: number) => number): number => THROWABLES.reduce((v, wi, k) => v + Math.min(7, Math.max(0, count(wi) | 0)) * 8 ** k, 0);
/** The counts packed by packThrowables, in THROWABLES order. */
export const unpackThrowables = (v: number): number[] => THROWABLES.map((_, k) => Math.floor((v || 0) / 8 ** k) % 8);
export const weaponIndex = (id: WeaponId): number => WEAPONS.findIndex((w) => w.id === id);
/** Headshot multiplier by zombie type: commons die to one solid headshot, specials and the Brute reward it less. */
export const headMult = (type: number): number => (isCommon(type) ? 3 : type === ZT.BRUTE ? 1.25 : 1.5);
/** Damage multiplier at `dist` m for weapon `w` (WeaponDef.falloff); 0 past its range. */
export const falloffAt = (w: WeaponDef, dist: number): number => {
  if (dist > w.range) return 0;
  const [near, far, floor] = w.falloff;
  return dist <= near ? 1 : dist >= far ? floor : 1 - (1 - floor) * ((dist - near) / (far - near));
};
/**
 * Damage one shot deals a zombie of `type` at `dist` m that it hit with `body` and `head`
 * bullets/pellets, after falloff (server and the offline range).
 */
export const shotDamage = (w: WeaponDef, type: number, body: number, head: number, dist: number): number =>
  w.melee ? meleeDamage(w, type) : w.dmg * (body + head * headMult(type)) * falloffAt(w, dist);
/** Damage one melee swing deals a zombie of `type` (no headshots, no falloff). */
export const meleeDamage = (w: WeaponDef, type: number): number => w.dmg * (type === ZT.BRUTE ? w.melee?.brute ?? 1 : 1);
/** Launcher blast power: a shell that landed within `arm` m of where it was fired only half-arms. */
export const blastPower = (B: BlastDef, flown: number): number => (flown < B.arm ? 0.4 : 1);
export const blastRadius = (B: BlastDef, power: number): number => B.radius * (power < 1 ? 0.6 : 1);
/** Blast damage to a zombie whose body edge is `d` m from the centre (0 outside the radius). */
export const blastDamage = (B: BlastDef, power: number, d: number): number => {
  const R = blastRadius(B, power);
  return d > R ? 0 : B.dmg * power * (1 - (1 - B.edge) * (d / R));
};

// Zombie archetypes. `scale` multiplies the base chibi model (≈1.45 m tall).
export const ZTYPES: ZombieDef[] = [
  { id: 'walker', hp: 50, speed: 4.7, dmg: 6, range: 1.15, cd: 0.9, scale: 1, radius: 0.38, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
  { id: 'leaper', hp: 120, speed: 5.6, dmg: 10, range: 1.2, cd: 0.8, scale: 1.05, radius: 0.38, leapDmg: 20, boomDmg: 0, boomRadius: 0 },
  { id: 'puffer', hp: 90, speed: 3.3, dmg: 0, range: 1.7, cd: 1, scale: 1.3, radius: 0.55, leapDmg: 0, boomDmg: 14, boomRadius: 4.6 },
  { id: 'brute', hp: 2200, speed: 5.3, dmg: 26, range: 2.0, cd: 1.3, scale: 2.1, radius: 0.8, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
  // Sleep-Charger: winds up, then bull-rushes in a straight line (see CHARGER). `dmg` is its plain swat.
  { id: 'charger', hp: 420, speed: 4.3, dmg: 10, range: 1.35, cd: 1.1, scale: 1.3, radius: 0.5, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
  // Drooler: hangs back and lobs goo that pools on the floor (see DROOLER). Fragile; a feeble slap up close.
  { id: 'drooler', hp: 100, speed: 3.9, dmg: 4, range: 1.15, cd: 1.2, scale: 1.05, radius: 0.4, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
  // Alarm Clock: keeps away; rings when it sees you and calls a mini-horde unless killed (see ALARM).
  { id: 'alarm', hp: 60, speed: 4.8, dmg: 0, range: 1, cd: 1, scale: 0.9, radius: 0.36, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
  // Snatcher: lassoes a survivor from range with its scarf and reels them in (see SNATCHER). `dmg` is its slap.
  { id: 'snatcher', hp: 170, speed: 4.2, dmg: 5, range: 1.2, cd: 1.1, scale: 1.2, radius: 0.4, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
  // Piggyback: small and quick; pounces onto a survivor's back and steers them away from the team (see PIGGY).
  { id: 'piggyback', hp: 130, speed: 6.1, dmg: 6, range: 1.1, cd: 0.8, scale: 0.8, radius: 0.34, leapDmg: 8, boomDmg: 0, boomRadius: 0 },
  // Weeper: sits sobbing and wants to be left alone. Wake her and she flattens whoever did it (see WEEPER).
  { id: 'weeper', hp: 900, speed: 7.6, dmg: 70, range: 1.4, cd: 0.7, scale: 1.1, radius: 0.4, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
  // Uncommon commons. Tinpot: pots and trays strapped on, bullets barely scratch it from the front (see armoredFront).
  { id: 'tinpot', hp: 60, speed: 4.4, dmg: 7, range: 1.15, cd: 0.9, scale: 1.05, radius: 0.4, leapDmg: 0, boomDmg: 0, boomRadius: 0, common: true },
  // Raincoat: fireproof (FIRE does nothing to it), a little tougher.
  { id: 'raincoat', hp: 70, speed: 4.7, dmg: 6, range: 1.15, cd: 0.9, scale: 1, radius: 0.38, leapDmg: 0, boomDmg: 0, boomRadius: 0, common: true },
];
ZTYPES[0].common = true;
export const ZT = { WALKER: 0, LEAPER: 1, PUFFER: 2, BRUTE: 3, CHARGER: 4, DROOLER: 5, ALARM: 6, SNATCHER: 7, PIGGYBACK: 8, WEEPER: 9, TINPOT: 10, RAINCOAT: 11 } as const;
/** Commons: walkers and their uncommon variants (hordes, ambient, wanderers). Everything else is a special or the Brute. */
export function isCommon(type: number): boolean { return !!ZTYPES[type]?.common; }
/** Share of a bullet's damage that gets through a Tinpot's front armour (see armoredFront). */
export const TINPOT_FRONT = 0.25;
/**
 * A Tinpot's pots stop most of a bullet that hits its front (it deals TINPOT_FRONT of its damage and goes no further): true if a shot from (sx, sz) at a Tinpot at (zx, zz)
 * facing yaw `ry` in state `st` hits the armour. Staggered (shoved, blasted) it is open from every side;
 * melee, blasts and fire always get through.
 */
export function armoredFront(type: number, st: number, ry: number, zx: number, zz: number, sx: number, sz: number): boolean {
  if (type !== ZT.TINPOT || st === ZSTATE.STAGGER) return false;
  const dx = sx - zx, dz = sz - zz, d = Math.hypot(dx, dz) || 1;
  return (-Math.sin(ry) * dx - Math.cos(ry) * dz) / d > 0.25;
}

// WINDUP: leaper crouch / charger head-down scrape / drooler rearing back to spit.
// CHARGE: charger's straight-line rush. PIN: charger pounding a survivor it slammed into a wall, a Snatcher reeling one in,
// or a Piggyback riding one. RING: alarm clock going off.
export const ZSTATE = { IDLE: 0, RUN: 1, ATTACK: 2, STAGGER: 3, WINDUP: 4, LEAP: 5, CHARGE: 6, PIN: 7, RING: 8 } as const;

/** Sleep-Charger tuning (metres, seconds, hp). */
export const CHARGER = {
  minRange: 5, maxRange: 20, windup: 0.95, speed: 14, maxTime: 1.5, cooldown: 7,
  hitDmg: 15, knock: 15, wallStun: 2.2, skidStun: 0.6,
  /** A survivor hit with a wall this close behind them is pinned instead of knocked back. */
  pinWallDist: 3, pinDps: 8, pinMax: 6, soloPinBreak: 2.5,
  /** Damage teammates must deal to a pinning Charger to knock it off its victim. */ pinBreakDmg: 180,
  /** A teammate's shove counts this much toward pinBreakDmg (it no longer frees the victim outright). */ shovePin: 60,
};
/** Drooler tuning. Puddles hurt every `tick` seconds after `delay`. */
export const DROOLER = {
  minRange: 7, maxRange: 24, keepAway: 9, windup: 0.75, cooldown: 7.5, globSpeed: 12,
  puddleR: 3, puddleLife: 6, deathR: 1.8, deathLife: 3.5, delay: 0.5, dps: 10, tick: 0.5, maxPuddles: 5,
};
/** Alarm Clock tuning. */
export const ALARM = { ringRange: 28, ringTime: 3, keepAway: 13, cooldown: 25, flee: 6, minChapterTime: 120 };
/** Snatcher tuning. The lasso needs line of sight for the whole `windup`; then the victim is reeled in. */
export const SNATCHER = {
  minRange: 5, maxRange: 20, windup: 0.9, cooldown: 12, keepAway: 10,
  /** Reel speed (m/s), damage per `tick` s while reeling and once the victim is within `chokeDist` m. */
  pull: 3.4, tick: 0.5, dragDmg: 2, chokeDmg: 5, chokeDist: 2.2,
  holdMax: 9, soloBreak: 3.5,
};
/** Piggyback tuning. It leaps like a Leaper (`leapMin`..`leapMax` m); landing on a survivor it rides them. */
export const PIGGY = {
  leapMin: 3.5, leapMax: 10, leapCd: 6, windup: 0.5,
  /** Speed it steers its victim at (m/s), and damage per `tick` s while riding. */
  steer: 2.7, tick: 0.5, dmg: 3, holdMax: 10, soloBreak: 3.5,
};
/**
 * Weeper tuning. She sits still; a standing survivor within `near` m in her sight raises her anger
 * (per second: 1 at `near` m up to `closeMul` right beside her), which settles at `calm`/s otherwise.
 * At `warn` she growls and starts to rise; at 1, or on any damage, she goes for whoever did it and
 * keeps at them until they drop, then runs off. One per attempt at most (server: DIRECTOR.weeper).
 */
export const WEEPER = { near: 6, closeMul: 2.5, warn: 0.35, wake: 3.5, calm: 0.5, fleeTime: 12 };
/** Fire patch from a firebomb: radius (m), seconds it burns, damage per second to zombies and (unscaled) to survivors, tick. */
export const FIRE = { r: 3.6, life: 9, dps: 90, ff: 9, tick: 0.25, max: 3 };
/**
 * Rattle Bomb: for `time` s after it lands every common within `tiles` path tiles drops what it is
 * doing and crowds the rattle (sleepers within `wake` m wake up to join in); then it goes off (its `blast`).
 */
export const LURE = { time: 5, tiles: 14, wake: 16 };
/** Pillow Vest: armour points a vest gives, and the share of each bite/hit it soaks up while any is left (not goo, fire or bleeding). */
export const ARMOR = { max: 50, absorb: 0.5 };
/**
 * When each infected type joins the campaign, as a campaign position: chapter index + fraction of
 * that chapter's route walked (1.5 = halfway through chapter 2). Chapter 1 opens with walkers only
 * and meets one new threat at a time; a room that starts on a later chapter has everything before it.
 * `slots`: most specials alive at once before a position ([position, cap], first match wins).
 * `brute`: no roaming Brute before this.
 */
export const INTRO = {
  at: { 1: 0.15, 2: 0.3, 5: 0.5, 4: 0.85, 6: 1.1, 10: 1.15, 9: 1.2, 7: 1.35, 11: 1.6, 8: 2 } as Record<number, number>,
  slots: [[0.3, 1], [0.7, 2]] as readonly (readonly [number, number])[],
  brute: 0.45,
};
/** True once infected `type` is part of the campaign at position `pos` (types without an entry always are). */
export const introduced = (type: number, pos: number): boolean => pos >= (INTRO.at[type] ?? 0);
export const PSTATE = { ALIVE: 0, DOWN: 1, DEAD: 2 } as const;

// Hit volumes for a scale-1 zombie (client hitscan + server sanity).
export const ZHIT = { headY: 1.06, headR: 0.42, bodyY: 0.5, bodyR: 0.36 };

export const SURVIVORS: SurvivorLook[] = [
  { name: 'Mochi', shirt: 0xff5d73, hair: 0x4a2c2a, style: 'cap' },
  { name: 'Pip', shirt: 0x39c5bb, hair: 0xffd166, style: 'spiky' },
  { name: 'Nori', shirt: 0xb18cff, hair: 0x2b2d5b, style: 'buns' },
  { name: 'Taro', shirt: 0xffa94d, hair: 0xe8e8f0, style: 'bob' },
];

/**
 * Room difficulty, picked when a room is created (quick play and code joins are always 'normal').
 * The wire carries the id ('j' create path, the 'w' welcome and GET /api/rooms); the director's
 * multipliers per id live server-side in room.ts DIFFICULTY.
 */
export const DIFFICULTIES = [
  { id: 'easy', label: 'Easy', hint: 'Smaller hordes, softer bites' },
  { id: 'normal', label: 'Normal', hint: 'The intended outbreak' },
  { id: 'hard', label: 'Hard', hint: 'Bigger hordes, shorter breathers' },
  { id: 'nightmare', label: 'Nightmare', hint: 'No naps. Bring friends.' },
] as const;
export type DifficultyId = (typeof DIFFICULTIES)[number]['id'];
/**
 * Survivor-side rules per difficulty (shared so the client can word its messages). The director's
 * zombie-side multipliers live server-side in room.ts DIFFICULTY.
 *  - `respawn`: seconds until a dead survivor is rescued beside a teammate; Infinity = only when the team
 *    reaches the next safe room (any difficulty also rescues the dead there).
 *  - `downs`: the down that kills (3 = the third time you go down you die); Infinity = never.
 *    Using a medkit, a rescue or reaching a safe room clears the count.
 *  - `heal`: fraction of missing health a medkit restores (at least `healMin`).
 *  - `selfRevives`: solo only, times per attempt you can get back up on your own.
 */
export const SURVIVOR_RULES: Record<DifficultyId, { respawn: number; downs: number; heal: number; selfRevives: number }> = {
  easy: { respawn: 15, downs: Infinity, heal: 0.9, selfRevives: 2 },
  normal: { respawn: 30, downs: 3, heal: 0.8, selfRevives: 1 },
  hard: { respawn: 45, downs: 3, heal: 0.7, selfRevives: 1 },
  nightmare: { respawn: Infinity, downs: 2, heal: 0.6, selfRevives: 1 },
};
export const HEAL_MIN = 20;
/** A client-supplied difficulty (an id, or its index in DIFFICULTIES) as an id; anything else is 'normal'. */
export function parseDifficulty(v: unknown): DifficultyId {
  if (typeof v === 'string') return DIFFICULTIES.find((d) => d.id === v)?.id ?? 'normal';
  if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < DIFFICULTIES.length) return DIFFICULTIES[v as number].id;
  return 'normal';
}
/** Display label for a difficulty id (unknown or missing: Normal). */
export const difficultyLabel = (id: unknown): string => DIFFICULTIES.find((d) => d.id === id)?.label ?? 'Normal';
