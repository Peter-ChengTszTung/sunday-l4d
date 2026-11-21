// Wire protocol (JSON over WebSocket). Tuples keep snapshots compact.

// [id, x, y, z, yaw, pitch, hp, state, weapon, medkits, reviveFrac, anim, respawnIn]
export type PlayerSnap = [number, number, number, number, number, number, number, number, number, number, number, number, number];
// [id, type, x, z, yaw, state]
export type ZombieSnap = [number, number, number, number, number, number];

export type GameEvent =
  // Fresh start or checkpoint restart: chapter, active step, door mask, taken pickup ids, keep gear (1 = checkpoint restart).
  | ['reset', chapter: number, step: number, doors: number, taken: number[], keepGear: number]
  | ['tp', pid: number, x: number, z: number, yaw: number]
  | ['msg', text: string]
  | ['heal', pid: number]
  | ['shot', pid: number, weapon: number, ex: number, ey: number, ez: number]
  | ['shove', pid: number]
  | ['pk', pickupId: number]
  | ['got', pid: number, pickupId: number]
  | ['use', pid: number, pickupId: number]
  | ['door', doorId: number, open: number]
  | ['step', index: number]
  | ['item', pid: number, pickupId: number, have: number, need: number]
  | ['checkpoint']
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
  | ['end', won: number, kills: number, seconds: number, board?: [number, number][], nextChapter?: number];

/** GET /api/rooms entry (listed rooms only). */
export interface RoomInfo { code: string; ch: number; title: string; step: number; steps: number; objective: string; players: string[]; max: number; state: string }

export interface RosterEntry { id: number; name: string; look: number }

export type ServerMsg =
  | { t: 'w'; id: number; room: string; ch: number; step: number; taken: number[]; doors: number; x: number; z: number; debug: number }
  | { t: 'ro'; players: RosterEntry[] }
  | { t: 'err'; msg: string }
  // g = open door mask, ho = holdout seconds left (-1 none), q = active step, qc = collected items for a collect step.
  | { t: 's'; st: 'play' | 'won' | 'lost'; g: number; ho: number; q: number; qc: number; p: PlayerSnap[]; z: ZombieSnap[]; ev: GameEvent[] };

export type ClientMsg =
  // room '' = quick play; create = open a new room on chapter `ch` starting at checkpoint step `cp` (-1 = chapter start).
  | { t: 'j'; name: string; room: string; ch?: number; create?: boolean; cp?: number; priv?: boolean }
  | { t: 'p'; x: number; y: number; z: number; ry: number; rx: number; w: number; a: number }
  | { t: 'f'; w: number; h: [number, number, number][]; e: [number, number, number] }
  | { t: 'v' }
  | { t: 'u'; id: number }
  | { t: 'h' }
  | { t: 'r'; id: number }
  // Dev-server only: jump to a quest step (teleports the team there).
  | { t: 'dbg'; step: number };
