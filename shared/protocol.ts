// Wire protocol (JSON over WebSocket). Tuples keep snapshots compact.

// [id, x, y, z, yaw, pitch, hp, state, weapon, meds (counts per kind, see constants.ts packMeds: a lone medkit is 1), reviveFrac, anim, respawnIn, armor, throwables (counts per kind, see constants.ts packThrowables)]
export type PlayerSnap = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
// [id, type, x, z, yaw, state]
export type ZombieSnap = [number, number, number, number, number, number];

export type GameEvent =
  // Fresh start or checkpoint restart: chapter, active step, door mask, taken pickup ids, keep gear (1 = checkpoint restart).
  | ['reset', chapter: number, step: number, doors: number, taken: number[], keepGear: number]
  | ['tp', pid: number, x: number, z: number, yaw: number]
  | ['msg', text: string]
  // `pid` used medical item `med` (index into MEDS).
  | ['heal', pid: number, med: number]
  | ['shot', pid: number, weapon: number, ex: number, ey: number, ez: number]
  | ['shove', pid: number]
  | ['pk', pickupId: number]
  // `pid` picked up `pickupId`. Ammo piles send only this (no 'pk'): a pile is spent for that survivor alone.
  | ['got', pid: number, pickupId: number]
  // Loot held back by thinning comes back (a survivor joined): show these pickups again.
  | ['loot', pickupIds: number[]]
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
  // `pid` is one down from death (SURVIVOR_RULES.downs) until a medkit, rescue or safe room.
  | ['last', pid: number]
  | ['kb', pid: number, vx: number, vz: number]
  // A horde is coming; (x, z): where its main body spawns from (absent if it trickles in from all over).
  | ['horde', x?: number, z?: number]
  | ['brute']
  | ['end', won: number, kills: number, seconds: number, board?: [number, number][], nextChapter?: number]
  // --- Charger / Drooler / Alarm Clock (zombie states CHARGE, PIN, RING travel in ZombieSnap).
  // A charging Charger hit a wall and stunned itself.
  | ['slam', zid: number, x: number, z: number]
  // Survivor `pid` is held at (x, z) by zombie `zid`: pinned to a wall by a Charger, lassoed by a Snatcher or ridden by a
  // Piggyback. Until 'unpin' the server owns their position (the victim follows their own PlayerSnap).
  | ['pin', pid: number, zid: number, x: number, z: number]
  | ['unpin', pid: number]
  // A goo glob in flight from (x0, z0) to (x1, z1), landing after `flight` seconds (the server simulates the same arc).
  | ['spit', zid: number, x0: number, z0: number, x1: number, z1: number, flight: number]
  // A goo puddle of radius r appeared; it lasts `life` seconds.
  | ['puddle', id: number, x: number, z: number, r: number, life: number]
  // Puddle damage (a quiet 'hurt': no knock/slow on the client).
  | ['sizzle', pid: number, dmg: number]
  // An Alarm Clock started ringing (kill it within ALARM.ringTime)…
  | ['ring', zid: number]
  // …and this one rang out: a mini-horde is coming.
  | ['alarm', zid: number, x: number, z: number]
  // --- Weapons. A launcher grenade from survivor `pid` went off at (x, y, z); power 1 = armed, < 1 = half-armed close-range pop.
  // (pid 0: a Rattle Bomb going off; nobody predicted it, so every client shows it.)
  | ['blast', pid: number, x: number, y: number, z: number, power: number]
  // --- Throwables. A fire patch of radius r burns at (x, z) for `life` seconds.
  | ['fire', id: number, x: number, z: number, r: number, life: number]
  // A Rattle Bomb landed at (x, z): it rattles for `secs` seconds, then 'blast'.
  | ['lure', x: number, z: number, secs: number]
  // A bullet bounced off Tinpot `zid`'s front.
  | ['clang', zid: number]
  // Survivor `pid`'s armour soaked up part of a hit.
  | ['armor', pid: number]
  // The Weeper `zid` is stirring (stage 1) or awake and after survivor `pid` (stage 2).
  | ['weeper', zid: number, stage: number, pid: number];

/** GET /api/rooms entry (listed rooms only). */
/** `diff`: DifficultyId (shared/constants.ts DIFFICULTIES); absent = 'normal'. */
export interface RoomInfo { code: string; ch: number; title: string; step: number; steps: number; objective: string; players: string[]; max: number; state: string; diff?: string }

export interface RosterEntry { id: number; name: string; look: number }

export type ServerMsg =
  // diff: the room's DifficultyId (absent = 'normal').
  | { t: 'w'; id: number; room: string; ch: number; step: number; taken: number[]; doors: number; x: number; z: number; debug: number; diff?: string }
  | { t: 'ro'; players: RosterEntry[] }
  | { t: 'err'; msg: string }
  // g = open door mask, ho = holdout seconds left (-1 none), q = active step, qc = collected items for a collect step.
  | { t: 's'; st: 'play' | 'won' | 'lost'; g: number; ho: number; q: number; qc: number; p: PlayerSnap[]; z: ZombieSnap[]; ev: GameEvent[] };

export type ClientMsg =
  // room '' = quick play; create = open a new room on chapter `ch` starting at checkpoint step `cp` (-1 = chapter start).
  // diff (create only): a DifficultyId or its index in DIFFICULTIES; missing/unknown = 'normal'. Ignored when joining.
  | { t: 'j'; name: string; room: string; ch?: number; create?: boolean; cp?: number; priv?: boolean; diff?: string | number }
  | { t: 'p'; x: number; y: number; z: number; ry: number; rx: number; w: number; a: number }
  // n: grenade sequence number (launcher only), echoed by the matching 'g' impact claim.
  | { t: 'f'; w: number; h: [number, number, number][]; e: [number, number, number]; n?: number }
  | { t: 'v' }
  | { t: 'u'; id: number }
  // Use a medical item: `k` = index into MEDS (absent = the medkit).
  | { t: 'h'; k?: number }
  | { t: 'r'; id: number }
  // Dev-server only: jump to a quest step (teleports the team there).
  | { t: 'dbg'; step: number }
  // Launcher grenade impact claim for the oldest grenade this player fired ('f' with a blast weapon).
  // The server checks range and line of sight from where it was fired, then applies the blast.
  | { t: 'g'; x: number; y: number; z: number; n?: number };
