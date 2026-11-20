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
  healAmount: 60,
  useRange: 2.7,
  bleedRate: 3.2, // hp per second while downed
  respawnTime: 25,
  shoveCd: 0.7,
  shoveRange: 2.4,
};

export interface WeaponDef {
  id: 'pistol' | 'smg' | 'shotgun' | 'rifle'; name: string; dmg: number; rate: number; mag: number; reserve: number;
  spread: number; pellets: number; range: number; reload: number; auto: boolean;
}
export interface ZombieDef {
  id: 'walker' | 'leaper' | 'puffer' | 'brute'; hp: number; speed: number; dmg: number; range: number; cd: number;
  scale: number; radius: number; leapDmg: number; boomDmg: number; boomRadius: number;
}
export interface SurvivorLook { name: string; shirt: number; hair: number; style: 'cap' | 'spiky' | 'buns' | 'bob' }

// Index 0 is the sidearm with infinite reserve ammo.
export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: 'Pea Shooter', dmg: 26, rate: 0.17, mag: 15, reserve: Infinity, spread: 0.010, pellets: 1, range: 70, reload: 1.2, auto: false },
  { id: 'smg', name: 'Buzz Blaster', dmg: 17, rate: 0.068, mag: 50, reserve: 450, spread: 0.028, pellets: 1, range: 60, reload: 1.9, auto: true },
  { id: 'shotgun', name: 'Boomstick', dmg: 15, rate: 0.72, mag: 8, reserve: 72, spread: 0.075, pellets: 9, range: 26, reload: 2.3, auto: false },
  { id: 'rifle', name: 'Long Bonker', dmg: 36, rate: 0.105, mag: 30, reserve: 270, spread: 0.014, pellets: 1, range: 90, reload: 2.1, auto: true },
];
export const HEAD_MULT = 2;

// Zombie archetypes. `scale` multiplies the base chibi model (≈1.45 m tall).
export const ZTYPES: ZombieDef[] = [
  { id: 'walker', hp: 50, speed: 4.7, dmg: 6, range: 1.15, cd: 0.9, scale: 1, radius: 0.38, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
  { id: 'leaper', hp: 170, speed: 5.6, dmg: 10, range: 1.2, cd: 0.8, scale: 1.05, radius: 0.38, leapDmg: 20, boomDmg: 0, boomRadius: 0 },
  { id: 'puffer', hp: 90, speed: 3.3, dmg: 0, range: 1.7, cd: 1, scale: 1.3, radius: 0.55, leapDmg: 0, boomDmg: 14, boomRadius: 4.6 },
  { id: 'brute', hp: 2200, speed: 5.3, dmg: 26, range: 2.0, cd: 1.3, scale: 2.1, radius: 0.8, leapDmg: 0, boomDmg: 0, boomRadius: 0 },
];
export const ZT = { WALKER: 0, LEAPER: 1, PUFFER: 2, BRUTE: 3 } as const;

export const ZSTATE = { IDLE: 0, RUN: 1, ATTACK: 2, STAGGER: 3, WINDUP: 4, LEAP: 5 } as const;
export const PSTATE = { ALIVE: 0, DOWN: 1, DEAD: 2 } as const;

// Hit volumes for a scale-1 zombie (client hitscan + server sanity).
export const ZHIT = { headY: 1.06, headR: 0.42, bodyY: 0.5, bodyR: 0.36 };

export const SURVIVORS: SurvivorLook[] = [
  { name: 'Mochi', shirt: 0xff5d73, hair: 0x4a2c2a, style: 'cap' },
  { name: 'Pip', shirt: 0x39c5bb, hair: 0xffd166, style: 'spiky' },
  { name: 'Nori', shirt: 0xb18cff, hair: 0x2b2d5b, style: 'buns' },
  { name: 'Taro', shirt: 0xffa94d, hair: 0xe8e8f0, style: 'bob' },
];
