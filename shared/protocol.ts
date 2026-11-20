// Wire protocol (JSON over WebSocket). Tuples keep snapshots compact.

// [id, x, y, z, yaw, pitch, hp, state, weapon, medkits, reviveFrac, anim, respawnIn]
export type PlayerSnap = [number, number, number, number, number, number, number, number, number, number, number, number, number];
// [id, type, x, z, yaw, state]
export type ZombieSnap = [number, number, number, number, number, number];

export type GameEvent =
  | ['reset']
  | ['tp', pid: number, x: number, z: number, yaw: number]
  | ['msg', text: string]
  | ['heal', pid: number]
  | ['shot', pid: number, weapon: number, ex: number, ey: number, ez: number]
  | ['shove', pid: number]
  | ['pk', pickupId: number]
  | ['got', pid: number, pickupId: number]
  | ['holdstart', pid: number]
  | ['gate']
  | ['zdie', zid: number, x: number, z: number, type: number, head: number, killer: number]
  | ['boom', x: number, z: number]
  | ['goo', pid: number]
  | ['hurt', pid: number, dmg: number, sx: number, sz: number]
  | ['down', pid: number]
  | ['dead', pid: number]
  | ['revived', pid: number, by: number]
  | ['kb', pid: number, vx: number, vz: number]
  | ['horde']
  | ['brute']
  | ['end', won: number, kills: number, seconds: number, board?: [number, number][]];

export interface RosterEntry { id: number; name: string; look: number }

export type ServerMsg =
  | { t: 'w'; id: number; room: string; taken: number[]; gate: number; x: number; z: number }
  | { t: 'ro'; players: RosterEntry[] }
  | { t: 'err'; msg: string }
  | { t: 's'; st: 'play' | 'won' | 'lost'; g: number; ho: number; p: PlayerSnap[]; z: ZombieSnap[]; ev: GameEvent[] };

export type ClientMsg =
  | { t: 'j'; name: string; room: string }
  | { t: 'p'; x: number; y: number; z: number; ry: number; rx: number; w: number; a: number }
  | { t: 'f'; w: number; h: [number, number, number][]; e: [number, number, number] }
  | { t: 'v' }
  | { t: 'u'; id: number }
  | { t: 'h' }
  | { t: 'r'; id: number };
