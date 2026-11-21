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

export type WeaponId = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'autoshotgun' | 'sniper' | 'launcher' | 'magnum';
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
  /** Which slot it occupies: the sidearm slot keeps infinite reserve. */ slot: 'primary' | 'sidearm';
  /** 1 = basic loot, 2 = later, rarer finds. */ tier: 0 | 1 | 2;
  /** Zombies one bullet can pass through (stops at a Brute). */ pierce: number;
  /** View kick (radians of pitch) and camera trauma per shot. */ recoil: number; shake: number;
  blast?: BlastDef;
}
export interface ZombieDef {
  id: 'walker' | 'leaper' | 'puffer' | 'brute' | 'charger' | 'drooler' | 'alarm'; hp: number; speed: number; dmg: number; range: number; cd: number;
  scale: number; radius: number; leapDmg: number; boomDmg: number; boomRadius: number;
}
export interface SurvivorLook { name: string; shirt: number; hair: number; style: 'cap' | 'spiky' | 'buns' | 'bob' }

// Index 0 is the starting sidearm with infinite reserve ammo. Indices go over the wire
// (shots, snapshots), so only ever append.
export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: 'Pea Shooter', dmg: 26, rate: 0.17, mag: 15, reserve: Infinity, spread: 0.010, pellets: 1, range: 70, reload: 1.2, auto: false, slot: 'sidearm', tier: 0, pierce: 1, recoil: 0.025, shake: 0.07 },
  { id: 'smg', name: 'Buzz Blaster', dmg: 20, rate: 0.068, mag: 50, reserve: 450, spread: 0.028, pellets: 1, range: 60, reload: 1.4, auto: true, slot: 'primary', tier: 1, pierce: 1, recoil: 0.02, shake: 0.07 },
  { id: 'shotgun', name: 'Boomstick', dmg: 15, rate: 0.72, mag: 8, reserve: 72, spread: 0.075, pellets: 9, range: 26, reload: 2.3, auto: false, slot: 'primary', tier: 1, pierce: 1, recoil: 0.07, shake: 0.3 },
  { id: 'rifle', name: 'Long Bonker', dmg: 36, rate: 0.105, mag: 30, reserve: 270, spread: 0.014, pellets: 1, range: 90, reload: 2.1, auto: true, slot: 'primary', tier: 1, pierce: 1, recoil: 0.03, shake: 0.07 },
  // Tier 2: rarer, later finds with a clear job each.
  { id: 'autoshotgun', name: 'Rumble Drum', dmg: 14, rate: 0.26, mag: 10, reserve: 90, spread: 0.09, pellets: 9, range: 24, reload: 2.4, auto: true, slot: 'primary', tier: 2, pierce: 1, recoil: 0.05, shake: 0.22 },
  { id: 'sniper', name: 'Kebabber', dmg: 90, rate: 0.42, mag: 8, reserve: 64, spread: 0.002, pellets: 1, range: 120, reload: 2.8, auto: false, slot: 'primary', tier: 2, pierce: 4, recoil: 0.09, shake: 0.2 },
  { id: 'launcher', name: 'Bloop Tube', dmg: 0, rate: 0.75, mag: 3, reserve: 12, spread: 0.004, pellets: 1, range: 110, reload: 3.2, auto: false, slot: 'primary', tier: 2, pierce: 1, recoil: 0.1, shake: 0.35,
    blast: { dmg: 240, radius: 4.5, edge: 0.35, speed: 38, grav: 6, fuse: 3, arm: 3 } },
  { id: 'magnum', name: 'Thunder Pea', dmg: 60, rate: 0.32, mag: 8, reserve: Infinity, spread: 0.006, pellets: 1, range: 80, reload: 1.6, auto: false, slot: 'sidearm', tier: 2, pierce: 2, recoil: 0.07, shake: 0.15 },
];
export const weaponIndex = (id: WeaponId): number => WEAPONS.findIndex((w) => w.id === id);
/** Headshot multiplier by zombie type: commons die to one solid headshot, specials and the Brute reward it less. */
export const headMult = (type: number): number => (type === ZT.WALKER ? 3 : type === ZT.BRUTE ? 1.25 : 1.5);

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
];
export const ZT = { WALKER: 0, LEAPER: 1, PUFFER: 2, BRUTE: 3, CHARGER: 4, DROOLER: 5, ALARM: 6 } as const;

// WINDUP: leaper crouch / charger head-down scrape / drooler rearing back to spit.
// CHARGE: charger's straight-line rush. PIN: charger pounding a survivor it slammed into a wall. RING: alarm clock going off.
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
