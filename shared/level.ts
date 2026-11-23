// Chapter maps and their quests. Grid based, shared by the server (AI,
// collision, quest logic), the client (rendering, movement, hitscan) and the
// map viewer tool. A chapter file describes its layout with `LevelBuilder` and
// exports a `ChapterDef`; `Level` wraps a built chapter with the collision and
// pathing helpers.
//
// Storeys. A chapter has `levels` stacked grids of W x H cells (storey 0 is the
// ground). Storey k's floor is at k * STOREY metres. Every per-cell array holds
// all storeys back to back, so a *node* index is `k * W * H + z * W + x`, and
// storey 0's nodes are the plain `z * W + x` cell indices.
//
// An upper-storey cell is one of:
//   - floor  : carved by the author (walkable unless a prop/water), with a slab under it;
//   - wall   : filled by the author (an upper-storey wall standing on whatever is below), or
//              "auto": the continuation of a taller building column below it (wallH 0);
//   - air    : open sky / a drop, never walkable, see-through (rendered as a railing edge).
// Untouched upper cells become auto walls over buildings taller than the storey and air elsewhere.
//
// Stairs and ladders are ramps: cells on storey k whose floor rises along a direction from
// storey k to k+1 (stairs over several cells, a ladder over one, climbed slowly). The cells above a
// ramp are air (the stairwell hole). Walking off a ramp's high end steps onto storey k+1.
import { TILE, STOREY, STEP_UP, CEIL_H, WEAPONS, type WeaponId } from './constants';

/** Floor types. NONE is solid building/rock (or, upstairs, air); WATER is solid but see-through. */
export const F = {
  NONE: 0, ASPHALT: 1, SIDEWALK: 2, GRASS: 3, INTERIOR: 4, SAFE: 5, DIRT: 6, CONCRETE: 7, TILES: 8, WOOD: 9, WATER: 10,
} as const;
export const FLOOR_NAMES = ['none', 'asphalt', 'sidewalk', 'grass', 'interior', 'safe', 'dirt', 'concrete', 'tiles', 'wood', 'water'];
/** Indoor floors get a ceiling (CEIL_H) and interior-coloured walls. */
export const isIndoor = (f: number): boolean => f === F.INTERIOR || f === F.SAFE || f === F.TILES || f === F.WOOD;

/** What an uncarved (solid) cell looks like from outside. */
export const WALL = { BUILDING: 0, ROCK: 1, HEDGE: 2, FENCE: 3 } as const;
export type WallKind = (typeof WALL)[keyof typeof WALL];

/** Ramp directions (the way the floor rises): +x, -x, +z, -z. 0 = flat. */
export const RAMP = { NONE: 0, PX: 1, NX: 2, PZ: 3, NZ: 4 } as const;
export type RampDir = '+x' | '-x' | '+z' | '-z';
const RAMP_OF: Record<RampDir, number> = { '+x': RAMP.PX, '-x': RAMP.NX, '+z': RAMP.PZ, '-z': RAMP.NZ };
/** Unit step per ramp code (index = RAMP value). */
export const RAMP_DX = [0, 1, -1, 0, 0], RAMP_DZ = [0, 0, 0, 1, -1];

export type PropType =
  | 'car' | 'van' | 'bus' | 'truck' | 'container' | 'barrier' | 'dumpster' | 'crate' | 'pallet' | 'barrel'
  | 'tree' | 'pine' | 'bush' | 'rock' | 'fountain' | 'bench' | 'shelf' | 'desk' | 'bed' | 'counter' | 'pillar'
  | 'gen' | 'radio' | 'lever' | 'terminal' | 'valve' | 'battery' | 'beacon'
  /** Storage tank: upright cylinder on a square footprint, a tanker car on a long one. */
  | 'tank';
/** Objective machines: rendered as a prop with a use point on top. */
export type ObjLook = 'gen' | 'radio' | 'lever' | 'terminal' | 'valve' | 'battery' | 'beacon';
/** Collectible quest items. */
export type ItemLook = 'fuel' | 'fuse' | 'keycard' | 'medicine' | 'part' | 'tape';
/** Weapon pickups use the weapon id (every weapon except the starting pistol can be found): guns, close-in weapons and throwables. */
export type GunKind = Exclude<WeaponId, 'pistol'>;
/** Small medical items (shared/constants.ts MEDS, all but the medkit). */
export type SmallMed = 'plaster' | 'vitamins' | 'cocoa';
export type LootKind = GunKind | 'ammo' | 'medkit' | 'armor' | SmallMed;
export type PickupKind = LootKind | 'obj' | 'item';

/** A point on the map in metres. `y` is the floor height it stands on (absent = 0, the ground). */
export interface Vec2 { x: number; z: number; y?: number }
/** A position with an explicit floor height (metres). */
export interface Pos3 { x: number; y: number; z: number }
/** Inclusive tile rectangle; `lv` is its storey (absent = 0). */
export interface Rect { x0: number; z0: number; x1: number; z1: number; lv?: number }
/** `lv`: storey (absent = 0). */
export interface Prop { type: PropType; x: number; z: number; w: number; d: number; color?: number; rot?: number; lv?: number }
export interface Pickup {
  id: number; kind: PickupKind; x: number; z: number;
  /** Floor height it lies on (metres). */ y: number;
  /** Never thinned by the server's per-attempt loot roll (the supply cache at a holdout). */ keep?: boolean;
  /** obj/item: model to show. */ look?: ObjLook | ItemLook;
  /** obj: the use prompt ("Start the generator"). item: its name ("fuel can"). */ label?: string;
  /** item: collect-step group key. */ group?: string;
}
export interface Door extends Rect { id: number; /** `bridge`: a drawbridge leaf standing up across an upstairs deck; it folds down flat when opened. `boom`: a striped checkpoint barrier. */
  kind: 'shutter' | 'barricade' | 'fence' | 'bridge' | 'boom'; label?: string; lv: number }
export interface Note { id: number; x: number; z: number; y: number; title: string; text: string }
export interface Label { text: string; x: number; z: number; size: number; color: string; rot: number; /** Floor height (m). */ y: number }
export interface Arrow { x: number; z: number; rot: number; /** Floor height (m). */ y: number }
/** A stair flight or ladder, for rendering: tile rect on storey `lv`, rising along `dir` to storey lv+1. */
export interface Ramp extends Rect { lv: number; dir: number; ladder: boolean }
export type RadioLine = [speaker: string, line: string];

export type StepKind = 'reach' | 'gather' | 'use' | 'collect' | 'holdout';
export type HoldStageKind = 'wave' | 'breather' | 'specials' | 'brute' | 'final';
/**
 * One stage of a staged holdout (server/room.ts, DIRECTOR.holdout). Stages run in order; their
 * `secs` must add up to the step's `hold` (HOLDOUT_SCALE scales both). Per kind:
 * - wave: queues a horde (the first stage's horde is the step's `horde` flag), walker trickle.
 * - breather: no new spawns (queued horde members still arrive).
 * - specials: a coordinated special push (they lurk, then strike together), light trickle.
 * - brute: a Brute (unless one is already up), light trickle.
 * - final: big horde from two sides, a special push plus refills, heavy trickle.
 */
export interface HoldStage {
  kind: HoldStageKind;
  /** Duration in seconds (unscaled). */ secs: number;
  /** Horde size as a fraction of a full horde (12 + 4 per survivor); overrides the kind's default. */ horde?: number;
  /** Also bring the horde from a second side (default: only `final`). */ flank?: boolean;
  /** Specials in the push at the stage start; overrides the kind's team-scaled default. */ specials?: number;
  /** Feed line shown to everyone when the stage begins (the game's existing 'msg' event). */ msg?: string;
}
export interface Step {
  kind: StepKind;
  /** HUD text. Collect steps get " 2/4" appended. */ objective: string;
  /** Lines played when the step begins. */ radio: RadioLine[];
  /** reach/gather: the trigger area (its `lv` is the storey). */ area?: Rect;
  /** use: pickup id of the objective machine. */ target?: number;
  /** collect: item group key, and how many there are. */ group?: string; count?: number;
  /** holdout: duration; use: optional holdout after the machine is used. */ hold?: number;
  /** Optional authored stages for the holdout (else the server generates a default curve from `hold`). */ holdScript?: HoldStage[];
  /** Door ids opened when the step completes. */ opens: number[];
  /** Door ids closed when the step completes (seal a safe room behind the team). */ closes: number[];
  /** Completing this step saves a checkpoint (the team restarts here after a wipe). */ checkpoint: boolean;
  /** Spawn a horde / a Brute when the step begins (a `use` step with `hold`: its horde comes when the machine is used). */ horde: boolean; brute: boolean;
  /** Where the HUD waypoint points (metres; `y` = floor height). */ at: Vec2;
}

export interface Theme {
  /** Sky gradient horizon → mid → top. */ sky: [number, number, number];
  fog: number; fogNear: number; fogFar: number;
  buildings: number[];
  /** Optional floor colour overrides keyed by F value. */ floors?: Partial<Record<number, number>>;
}

export interface ChapterDef {
  id: string; title: string; subtitle: string; intro: string;
  W: number; H: number;
  /** Number of storeys (1 = flat map). Every per-cell array below has levels * W * H entries (node order). */
  levels: number;
  floor: Uint8Array; solid: Uint8Array; opaque: Uint8Array; propCell: Uint8Array;
  /**
   * Absolute top of the wall (metres) on wall nodes. Storey 0: the building height (clamped to the
   * floor above when a roof/upper storey is carved on top). Upper storeys: an authored wall's top, or
   * 0 on an auto wall (part of the column below; draw nothing).
   */
  wallH: Float32Array; wallKind: Uint8Array;
  /** 1 on upper-storey air nodes (open, not walkable, see-through). Always 0 on storey 0. */ air: Uint8Array;
  /** Ramp direction per node (RAMP), 0 = flat; `ladder` 1 where the ramp is a ladder. */ ramp: Uint8Array; ladder: Uint8Array;
  /** Floor height at a ramp node's low and high edge, relative to its storey's floor. */ rampLo: Float32Array; rampHi: Float32Array;
  /** Stair flights and ladders (for rendering). */ ramps: Ramp[];
  /** Door id per node, -1 where there is none. */ doorCell: Int8Array;
  props: Prop[]; pickups: Pickup[]; lamps: Vec2[]; arrows: Arrow[];
  labels: Label[]; doors: Door[]; notes: Note[]; steps: Step[];
  spawns: Vec2[]; startCell: { x: number; z: number; lv: number };
  /** Per step index: where the team respawns if it wipes after that checkpoint. */ checkpointSpawns: Record<number, Vec2[]>;
  /** Wanderer density multipliers over tile rects (later rects win; 0 = no dormant walkers). See `LevelBuilder.density`. */
  density: DensityRect[];
  theme: Theme;
}
export interface DensityRect extends Rect { mult: number }

export function hash2(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const PROP_OPAQUE: Partial<Record<PropType, boolean>> = { barrier: false, bench: false, bush: false, pallet: false, valve: false, lever: false };

export const DEFAULT_THEME: Theme = {
  sky: [0xfc9ea3, 0x8f61bd, 0x2b2661], fog: 0x7a4f8e, fogNear: 24, fogFar: 105,
  buildings: [0x8e6fa8, 0x5f8fa8, 0xc77b6b, 0x6f7fb8, 0xb58a5f, 0x7f6f9a, 0x5fa39a, 0xa86f8e],
};

/** Step options as written in chapter files. `at` defaults to the area/target centre; its third value is the storey. */
export interface StepOpts {
  objective: string; radio?: RadioLine[]; area?: Rect; target?: number; group?: string; hold?: number; holdScript?: HoldStage[];
  opens?: number[]; closes?: number[]; checkpoint?: boolean; horde?: boolean; brute?: boolean; at?: [number, number] | [number, number, number];
}

/**
 * Authoring kit. All coordinates are tile coordinates; rectangles are
 * inclusive (`carve(2, 3, 5, 3, …)` opens 4 tiles). Calls author the current
 * storey, set with `level(k)` (default 0, the ground).
 */
export class LevelBuilder {
  readonly floor: Uint8Array; readonly solid: Uint8Array; readonly opaque: Uint8Array; readonly propCell: Uint8Array;
  readonly wallH: Float32Array; readonly wallKind: Uint8Array; readonly doorCell: Int8Array;
  readonly air: Uint8Array; readonly ramp: Uint8Array; readonly ladderCell: Uint8Array; readonly rampLo: Float32Array; readonly rampHi: Float32Array;
  /** Upper-storey nodes the author touched (carve/fill/door/stairs); the rest become auto wall or air. */
  private readonly touched: Uint8Array;
  readonly ramps: Ramp[] = [];
  readonly props: Prop[] = []; readonly pickups: Pickup[] = []; readonly lamps: Vec2[] = [];
  readonly arrows: Arrow[] = []; readonly labels: Label[] = [];
  readonly doors: Door[] = []; readonly notes: Note[] = []; readonly steps: Step[] = [];
  readonly checkpointSpawns: Record<number, Vec2[]> = {};
  readonly densityRects: DensityRect[] = [];
  spawns: Vec2[] = []; startCell = { x: 0, z: 0, lv: 0 };
  theme: Theme = DEFAULT_THEME;
  /** Storey being authored. */
  private lv = 0;
  private readonly WH: number;

  constructor(readonly W: number, readonly H: number, readonly levels = 1) {
    if (!(levels >= 1 && levels <= 4)) throw new Error('levels must be 1..4');
    const WH = W * H, n = WH * levels;
    this.WH = WH;
    this.floor = new Uint8Array(n); this.solid = new Uint8Array(n).fill(1); this.opaque = new Uint8Array(n).fill(1);
    this.propCell = new Uint8Array(n); this.wallKind = new Uint8Array(n); this.doorCell = new Int8Array(n).fill(-1);
    this.wallH = new Float32Array(n); this.air = new Uint8Array(n); this.touched = new Uint8Array(n);
    this.ramp = new Uint8Array(n); this.ladderCell = new Uint8Array(n); this.rampLo = new Float32Array(n); this.rampHi = new Float32Array(n);
    // Default skyline: blocky 3x3 chunks so it reads as buildings.
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) this.wallH[z * W + x] = 7 + Math.floor(hash2(Math.floor(x / 3), Math.floor(z / 3)) * 4) * 2.2;
  }

  /** Author storey `k` from now on (0 = ground). */
  level(k: number): this {
    if (!(Number.isInteger(k) && k >= 0 && k < this.levels)) throw new Error(`storey ${k} does not exist (this map has ${this.levels}; pass levels to new LevelBuilder)`);
    this.lv = k; return this;
  }
  /** The storey being authored. */
  get storey(): number { return this.lv; }
  /** Floor height of the storey being authored (metres). */
  private get baseY(): number { return this.lv * STOREY; }

  private idx(x: number, z: number, lv = this.lv): number {
    if (x < 0 || z < 0 || x >= this.W || z >= this.H) throw new Error(`tile ${x},${z} is outside the ${this.W}x${this.H} map`);
    return lv * this.WH + z * this.W + x;
  }
  private rect(x0: number, z0: number, x1: number, z1: number, fn: (i: number, x: number, z: number) => void, lv = this.lv): void {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) fn(this.idx(x, z, lv), x, z);
  }

  /** Open walkable floor. WATER stays solid (you can see and shoot across it). Upstairs this lays a floor slab. */
  carve(x0: number, z0: number, x1: number, z1: number, type: number): this {
    this.rect(x0, z0, x1, z1, (i) => {
      this.floor[i] = type;
      const water = type === F.WATER;
      this.solid[i] = water ? 1 : 0; this.opaque[i] = 0; this.propCell[i] = 0; this.air[i] = 0; this.touched[i] = 1;
      this.ramp[i] = 0; this.ladderCell[i] = 0;
    });
    return this;
  }
  /** Re-paint floor that is already carved (keeps props/solidity). */
  paint(x0: number, z0: number, x1: number, z1: number, type: number): this {
    this.rect(x0, z0, x1, z1, (i) => { if (this.floor[i] !== F.NONE) this.floor[i] = type; });
    return this;
  }
  /** Fill back in (make solid wall) — for pillars or reshaping a carved area. Upstairs: a wall one storey tall. */
  fill(x0: number, z0: number, x1: number, z1: number): this {
    this.rect(x0, z0, x1, z1, (i) => {
      this.floor[i] = F.NONE; this.solid[i] = 1; this.opaque[i] = 1; this.propCell[i] = 0; this.air[i] = 0; this.touched[i] = 1;
      this.ramp[i] = 0; this.ladderCell[i] = 0;
      if (this.lv > 0) this.wallH[i] = this.baseY + STOREY;
    });
    return this;
  }
  /**
   * Upstairs only: make cells open air again (a drop, a gap between rooftops, a light well). Air is
   * never walkable; where it borders floor the renderer draws a railing.
   */
  open(x0: number, z0: number, x1: number, z1: number): this {
    if (this.lv === 0) throw new Error('open() is for upper storeys (the ground has no air)');
    this.rect(x0, z0, x1, z1, (i) => {
      this.floor[i] = F.NONE; this.solid[i] = 1; this.opaque[i] = 0; this.propCell[i] = 0; this.air[i] = 1; this.touched[i] = 1;
      this.ramp[i] = 0; this.ladderCell[i] = 0;
    });
    return this;
  }
  /** Style of the solid cells in a rect: building, rock cliff, hedge/treeline or fence; optional height in metres above this storey's floor. */
  walls(x0: number, z0: number, x1: number, z1: number, kind: WallKind, height?: number): this {
    this.rect(x0, z0, x1, z1, (i) => { this.wallKind[i] = kind; if (height !== undefined) this.wallH[i] = this.baseY + height; });
    return this;
  }

  /**
   * A stair flight on this storey over a tile rect, rising along `dir` to the next storey up. The
   * flight's length along `dir` is how many cells it takes to climb (3+ reads as stairs; 2 is steep).
   * The cells above become the stairwell hole (air). The cell past the high end on the storey above
   * must be floor (the landing), and the cell before the low end on this storey should be floor too.
   */
  stairs(x0: number, z0: number, x1: number, z1: number, dir: RampDir, type: number = F.CONCRETE): this {
    return this.flight(x0, z0, x1, z1, dir, type, false);
  }
  /**
   * A ladder on tile (x,z) of this storey, climbing along `dir` (towards the wall it leans on) to the
   * next storey up; the tile past it in `dir` on the storey above is where you step off (usually the
   * roof of the wall it leans on). Climbing is slow (LADDER_SPEED). Zombies climb too.
   */
  ladder(x: number, z: number, dir: RampDir, type?: number): this {
    const t = type ?? (this.floor[this.idx(x, z)] || F.CONCRETE);
    return this.flight(x, z, x, z, dir, t, true);
  }
  private flight(x0: number, z0: number, x1: number, z1: number, dir: RampDir, type: number, ladder: boolean): this {
    if (this.lv + 1 >= this.levels) throw new Error(`stairs/ladder on storey ${this.lv} need a storey above (levels = ${this.levels})`);
    const code = RAMP_OF[dir];
    if (!code) throw new Error(`bad ramp direction ${dir}`);
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    const along = code <= 2 ? bx - ax + 1 : bz - az + 1;
    this.carve(ax, az, bx, bz, type);
    this.rect(ax, az, bx, bz, (i, x, z) => {
      // Index of this cell from the low end of the flight.
      const k = code === RAMP.PX ? x - ax : code === RAMP.NX ? bx - x : code === RAMP.PZ ? z - az : bz - z;
      this.ramp[i] = code; this.ladderCell[i] = ladder ? 1 : 0;
      this.rampLo[i] = (k / along) * STOREY; this.rampHi[i] = ((k + 1) / along) * STOREY;
    });
    this.ramps.push({ x0: ax, z0: az, x1: bx, z1: bz, lv: this.lv, dir: code, ladder });
    return this;
  }

  prop(type: PropType, x: number, z: number, w = 1, d = 1, extra: { color?: number; rot?: number } = {}): this {
    const opaque = PROP_OPAQUE[type] ?? true;
    this.rect(x, z, x + w - 1, z + d - 1, (i) => { this.solid[i] = 1; this.propCell[i] = 1; if (opaque) this.opaque[i] = 1; });
    this.props.push({ type, x, z, w, d, ...extra, ...(this.lv ? { lv: this.lv } : {}) });
    return this;
  }

  /** Loot: weapons, ammo, medkits. Returns the pickup id. */
  pick(kind: LootKind, x: number, z: number): number {
    this.idx(x, z);
    this.pickups.push({ id: this.pickups.length, kind, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE, y: this.baseY });
    return this.pickups.length - 1;
  }
  /** An objective machine on tile (x,z) (solid). `label` is the use prompt. Returns the pickup id for a `use` step. */
  obj(look: ObjLook, x: number, z: number, label: string): number {
    this.prop(look, x, z);
    this.pickups.push({ id: this.pickups.length, kind: 'obj', look, label, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE, y: this.baseY });
    return this.pickups.length - 1;
  }
  /** A collectible for the `collect` step with the same group. Only visible while that step is active. */
  item(look: ItemLook, group: string, x: number, z: number, label: string): number {
    this.idx(x, z);
    this.pickups.push({ id: this.pickups.length, kind: 'item', look, group, label, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE, y: this.baseY });
    return this.pickups.length - 1;
  }
  /** Readable lore scrap (client side only). */
  note(x: number, z: number, title: string, text: string): this {
    this.idx(x, z);
    this.notes.push({ id: this.notes.length, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE, y: this.baseY, title, text });
    return this;
  }
  /** A closed door/barricade over a tile rect of this storey; opened by a step's `opens`. Returns the door id. */
  door(x0: number, z0: number, x1: number, z1: number, kind: Door['kind'] = 'shutter', label?: string): number {
    const id = this.doors.length;
    if (id >= 30) throw new Error('at most 30 doors per chapter');
    this.carve(x0, z0, x1, z1, this.floor[this.idx(x0, z0)] || F.INTERIOR);
    this.rect(x0, z0, x1, z1, (i) => { this.doorCell[i] = id; });
    this.doors.push({ id, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), kind, label, lv: this.lv });
    return id;
  }

  /** Lamp post at tile coordinates (fractional allowed), on this storey. */
  lamp(x: number, z: number): this { this.lamps.push({ x: x * TILE, z: z * TILE, y: this.baseY }); return this; }
  /** Painted floor arrow, rot 0 points +Z, PI/2 points +X, -PI/2 points -X, PI points -Z. */
  arrow(x: number, z: number, rot: number): this { this.arrows.push({ x, z, rot, y: this.baseY }); return this; }
  /** Painted floor text, centred on (x,z) in tiles, reading while walking +Z unless `rot` given. */
  label(text: string, x: number, z: number, size = 30, color = '#fff1c9', rot = Math.PI): this {
    this.labels.push({ text, x, z, size, color, rot, y: this.baseY }); return this;
  }

  /**
   * Scale how many dormant wanderers the director places in a tile rect (default 1; 0 = none, e.g.
   * inside a set-piece arena; 2 = a crowded street). Applies to every storey of those tiles. Later
   * calls override earlier ones where they overlap. Safe rooms never get any.
   */
  density(x0: number, z0: number, x1: number, z1: number, mult: number): this {
    this.idx(x0, z0, 0); this.idx(x1, z1, 0);
    if (!(mult >= 0) || mult > 8) throw new Error(`density multiplier ${mult} at ${x0},${z0} must be in 0..8`);
    this.densityRects.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), mult });
    return this;
  }

  /** Start safe room spawn points (tiles), on this storey. */
  start(points: [number, number][]): this {
    this.spawns = points.map(([x, z]) => ({ x: x * TILE, z: z * TILE, y: this.baseY }));
    this.startCell = { x: Math.floor(points[0][0]), z: Math.floor(points[0][1]), lv: this.lv };
    return this;
  }

  private stepAt(o: StepOpts): Vec2 {
    if (o.at) return { x: o.at[0] * TILE, z: o.at[1] * TILE, y: (o.at[2] ?? o.area?.lv ?? 0) * STOREY };
    if (o.area) return { x: ((o.area.x0 + o.area.x1 + 1) / 2) * TILE, z: ((o.area.z0 + o.area.z1 + 1) / 2) * TILE, y: (o.area.lv ?? 0) * STOREY };
    if (o.target !== undefined) { const p = this.pickups[o.target]; return { x: p.x, z: p.z, y: p.y }; }
    return { x: 0, z: 0, y: 0 };
  }
  private addStep(kind: StepKind, o: StepOpts, extra: Partial<Step> = {}): number {
    if (o.area?.lv !== undefined && !(o.area.lv >= 0 && o.area.lv < this.levels)) throw new Error(`step "${o.objective}": area storey ${o.area.lv} does not exist`);
    this.steps.push({
      kind, objective: o.objective, radio: o.radio ?? [], area: o.area, target: o.target, group: o.group, hold: o.hold, holdScript: o.holdScript,
      opens: o.opens ?? [], closes: o.closes ?? [], checkpoint: !!o.checkpoint, horde: !!o.horde, brute: !!o.brute, at: this.stepAt(o), ...extra,
    });
    return this.steps.length - 1;
  }
  /** Any standing survivor enters `area` (on storey `area.lv`). */
  reach(area: Rect, o: Omit<StepOpts, 'area'>): number { return this.addStep('reach', { ...o, area }); }
  /** Every standing survivor is inside `area`. With `checkpoint`, the team respawns in `area` after a wipe. */
  gather(area: Rect, o: Omit<StepOpts, 'area'>): number {
    const i = this.addStep('gather', { ...o, area });
    if (o.checkpoint) {
      const pts: Vec2[] = [];
      const cx = (area.x0 + area.x1 + 1) / 2, cz = (area.z0 + area.z1 + 1) / 2, y = (area.lv ?? 0) * STOREY;
      for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) pts.push({ x: (cx + dx) * TILE, z: (cz + dz) * TILE, y });
      this.checkpointSpawns[i] = pts;
    }
    return i;
  }
  /** Press E on the objective machine `target` (from `obj`). Optional `hold` seconds of holdout afterwards. */
  use(target: number, o: Omit<StepOpts, 'target'>): number { return this.addStep('use', { ...o, target }); }
  /** Pick up every `item` of `group`. The waypoint shows the nearest remaining one. */
  collect(group: string, o: Omit<StepOpts, 'group'>): number {
    const items = this.pickups.filter((p) => p.kind === 'item' && p.group === group);
    const count = items.length;
    if (!count) throw new Error(`collect step "${group}" has no items — place items before the step`);
    const at = o.at ?? [items.reduce((a, p) => a + p.x, 0) / count / TILE, items.reduce((a, p) => a + p.z, 0) / count / TILE, Math.round(items.reduce((a, p) => a + p.y, 0) / count / STOREY)] as [number, number, number];
    return this.addStep('collect', { ...o, group, at }, { count });
  }
  /** Survive `hold` seconds. `at` is where the team should make its stand (third value: storey). */
  holdout(hold: number, o: Omit<StepOpts, 'hold'>): number { return this.addStep('holdout', { ...o, hold }); }

  /**
   * Small medical items, left where survivors already look: on a free tile beside every other ammo pile
   * (ammo piles line the route), in a fixed rotation of kinds. Appended after everything authored, so
   * existing pickup ids do not move. Chapters that place their own small meds near a pile keep theirs.
   */
  /**
   * Every holdout (a `use` step with `hold`, or a `holdout` step) gets a supply cache at its stand: an
   * ammo pile and a plaster on the nearest free floor to the machine (walked to, so never through a
   * wall). They are `keep`: the server's loot roll never thins them, so the stash is always there.
   */
  private stockHolds(): void {
    const { W, H, WH } = this;
    const used = new Set<number>();
    const nodeOf = (p: { x: number; z: number; y?: number }) => Math.round((p.y ?? 0) / STOREY) * WH + Math.floor(p.z / TILE) * W + Math.floor(p.x / TILE);
    for (const p of this.pickups) used.add(nodeOf(p));
    for (const n of this.notes) used.add(nodeOf(n));
    const keep = this.lv;
    for (const s of this.steps) {
      if (!s.hold) continue;
      const lv = Math.round((s.at.y ?? 0) / STOREY), o = lv * WH;
      const sx = Math.floor(s.at.x / TILE), sz = Math.floor(s.at.z / TILE);
      const open = (x: number, z: number) => {
        if (x < 0 || z < 0 || x >= W || z >= H) return false;
        const i = o + z * W + x;
        return !this.solid[i] && !this.propCell[i] && this.floor[i] !== F.NONE && this.floor[i] !== F.WATER && this.doorCell[i] < 0 && !this.ramp[i];
      };
      // Breadth-first out from the machine (a solid tile itself, so it seeds its open neighbours).
      const seen = new Set<number>([sz * W + sx]), queue: [number, number, number][] = [[sx, sz, 0]], spots: [number, number][] = [];
      for (let q = 0; q < queue.length && spots.length < 2; q++) {
        const [x, z, d] = queue[q];
        if (d > 0 && !used.has(o + z * W + x)) spots.push([x, z]);
        if (d >= 4) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz, c = nz * W + nx;
          if (seen.has(c) || !open(nx, nz)) continue;
          seen.add(c); queue.push([nx, nz, d + 1]);
        }
      }
      if (spots.length < 2) throw new Error(`holdout "${s.objective}": no free floor within 4 tiles for its supply cache`);
      this.lv = lv;
      spots.forEach(([x, z], k) => {
        used.add(o + z * W + x);
        this.pickups[this.pick(k === 0 ? 'ammo' : 'plaster', x, z)].keep = true;
      });
    }
    this.lv = keep;
  }

  private scatterMeds(): void {
    const ROTA: SmallMed[] = ['plaster', 'vitamins', 'plaster', 'cocoa', 'plaster', 'vitamins'];
    const small = new Set<string>(ROTA);
    const used = new Set<number>();
    const nodeOf = (p: { x: number; z: number; y: number }) => Math.round(p.y / STOREY) * this.WH + Math.floor(p.z / TILE) * this.W + Math.floor(p.x / TILE);
    for (const p of this.pickups) used.add(nodeOf(p));
    for (const n of this.notes) used.add(nodeOf(n));
    const authored = this.pickups.filter((p) => small.has(p.kind));
    const piles = this.pickups.filter((p) => p.kind === 'ammo');
    let n = 0;
    const keep = this.lv;
    piles.forEach((p, k) => {
      if (k % 2) return;
      if (authored.some((a) => Math.abs(a.y - p.y) < 1 && Math.hypot(a.x - p.x, a.z - p.z) < 4 * TILE)) return;
      const px = Math.floor(p.x / TILE), pz = Math.floor(p.z / TILE), lv = Math.round(p.y / STOREY), o = lv * this.WH;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const x = px + dx, z = pz + dz;
        if (x < 0 || z < 0 || x >= this.W || z >= this.H) continue;
        const i = o + z * this.W + x;
        // Free flat floor only, and never across a wall corner from the pile (a diagonal needs both sides open).
        if (this.solid[i] || this.floor[i] === F.NONE || this.doorCell[i] >= 0 || this.ramp[i] || used.has(i)) continue;
        if (dx && dz && (this.solid[o + pz * this.W + x] || this.solid[o + z * this.W + px])) continue;
        used.add(i);
        this.lv = lv;
        this.pick(ROTA[n++ % ROTA.length], x, z);
        return;
      }
    });
    this.lv = keep;
  }

  /** Upper storeys: untouched nodes become auto walls (over taller buildings) or air; wall tops clamp under floors above. */
  private finishStoreys(): void {
    const { W, H, WH, levels } = this;
    if (levels === 1) return;
    // Column top of the wall stack each node belongs to (absolute metres), 0 where not a wall.
    const top = new Float32Array(WH * levels);
    for (let c = 0; c < WH; c++) if (this.floor[c] === F.NONE) top[c] = this.wallH[c];
    for (let k = 1; k < levels; k++) {
      for (let c = 0; c < WH; c++) {
        const i = k * WH + c, below = i - WH;
        if (this.touched[i]) {
          if (this.floor[i] === F.NONE && !this.air[i]) top[i] = this.wallH[i]; // authored wall
          continue;
        }
        if (top[below] > k * STOREY + 0.01) {
          this.floor[i] = F.NONE; this.solid[i] = 1; this.opaque[i] = 1; this.air[i] = 0;
          this.wallH[i] = 0; this.wallKind[i] = this.wallKind[below]; top[i] = top[below];
        } else {
          this.floor[i] = F.NONE; this.solid[i] = 1; this.opaque[i] = 0; this.air[i] = 1;
        }
      }
    }
    // Lintels: an untouched storey-1 cell over a doorway (a door, or indoor floor) that spans at most
    // 3 tiles between two taller wall columns gets wall over it, so the facade has no hole above the door.
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const c = z * W + x, i = WH + c;
      if (this.touched[i] || !this.air[i] || this.floor[c] === F.NONE) continue;
      if (!(this.doorCell[c] >= 0 || isIndoor(this.floor[c]))) continue;
      const tallAt = (xx: number, zz: number) => xx >= 0 && zz >= 0 && xx < W && zz < H && this.floor[zz * W + xx] === F.NONE && top[zz * W + xx] > STOREY + 0.01;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        let a = -1, b = -1;
        for (let s = 1; s <= 3 && a < 0; s++) { if (tallAt(x - dx * s, z - dz * s)) a = s; else if (this.floor[(z - dz * s) * W + x - dx * s] === F.NONE || x - dx * s < 0 || z - dz * s < 0) break; }
        for (let s = 1; s <= 3 && b < 0; s++) { if (tallAt(x + dx * s, z + dz * s)) b = s; else if (x + dx * s >= W || z + dz * s >= H || this.floor[(z + dz * s) * W + x + dx * s] === F.NONE) break; }
        if (a < 0 || b < 0 || a + b - 1 > 3) continue;
        const t = Math.min(top[(z - dz * a) * W + x - dx * a], top[(z + dz * b) * W + x + dx * b]);
        this.floor[i] = F.NONE; this.solid[i] = 1; this.opaque[i] = 1; this.air[i] = 0;
        this.wallH[i] = t; this.wallKind[i] = this.wallKind[(z - dz * a) * W + x - dx * a]; top[i] = t;
        break;
      }
    }
    // Higher storeys over a lintel continue it as auto wall.
    for (let k = 2; k < levels; k++) for (let c = 0; c < WH; c++) {
      const i = k * WH + c, below = i - WH;
      if (this.touched[i] || !this.air[i] || !(top[below] > k * STOREY + 0.01) || this.floor[below] !== F.NONE || this.air[below]) continue;
      this.floor[i] = F.NONE; this.solid[i] = 1; this.opaque[i] = 1; this.air[i] = 0; this.wallH[i] = 0; this.wallKind[i] = this.wallKind[below]; top[i] = top[below];
    }
    // Stairwell holes: whatever was carved above a ramp is air.
    for (let i = 0; i < WH * (levels - 1); i++) {
      if (!this.ramp[i]) continue;
      const u = i + WH;
      this.floor[u] = F.NONE; this.solid[u] = 1; this.opaque[u] = 0; this.air[u] = 1; this.propCell[u] = 0; this.ramp[u] = 0;
    }
    // A wall stack ends under the first storey that is not part of it: clamp its base wall's height there.
    for (let c = 0; c < WH; c++) {
      let base = -1;
      for (let k = 0; k < levels; k++) {
        const i = k * WH + c;
        const wall = this.floor[i] === F.NONE && !this.air[i];
        if (wall && (k === 0 || this.wallH[i] > 0)) { base = i; continue; } // a wall that draws itself starts a stack
        if (wall) continue; // auto wall: part of the stack below
        if (base >= 0 && this.floor[i] !== F.NONE) this.wallH[base] = Math.min(this.wallH[base], k * STOREY);
        base = -1;
      }
    }
    void H;
  }

  done(meta: { id: string; title: string; subtitle: string; intro: string; theme?: Theme }): ChapterDef {
    if (!this.spawns.length) throw new Error(`${meta.id}: call start() with spawn points`);
    if (!this.steps.length) throw new Error(`${meta.id}: a chapter needs quest steps`);
    this.finishStoreys();
    this.stockHolds();
    this.scatterMeds();
    return {
      ...meta, theme: meta.theme ?? this.theme, W: this.W, H: this.H, levels: this.levels,
      floor: this.floor, solid: this.solid, opaque: this.opaque, propCell: this.propCell, wallH: this.wallH, wallKind: this.wallKind,
      air: this.air, ramp: this.ramp, ladder: this.ladderCell, rampLo: this.rampLo, rampHi: this.rampHi, ramps: this.ramps,
      doorCell: this.doorCell, props: this.props, pickups: this.pickups, lamps: this.lamps, arrows: this.arrows, labels: this.labels,
      doors: this.doors, notes: this.notes, steps: this.steps, spawns: this.spawns, startCell: this.startCell, checkpointSpawns: this.checkpointSpawns,
      density: this.densityRects,
    };
  }
}

export const cellOf = (v: number): number => Math.floor(v / TILE);
/** Door bitmask with every door open. */
export const ALL_OPEN = 0x7fffffff;
/** Neighbour order in `Level.adj`: +x, -x, +z, -z. */
const NEI = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Max solid intervals per cell column (ground + 3 per storey). */
const MAXI = 13;
const INF_Y = 1e9;

/**
 * A built chapter plus collision, pathing and line of sight. `open` arguments are door bitmasks.
 * Positions are metres; `y` is always the floor height a thing stands on (a jump adds on top).
 * Graph nodes are `lv * W * H + z * W + x` (see the file header).
 */
export class Level {
  readonly W: number; readonly H: number;
  /** Cells per storey, number of storeys, total nodes. */
  readonly WH: number; readonly levels: number; readonly N: number;
  /**
   * Walk graph: 4 neighbours per node (+x, -x, +z, -z), -1 where you can't step. Ignores doors
   * (`blocked` checks those). Crosses storeys at the ends of stairs and ladders.
   */
  readonly adj: Int32Array;
  /** Per cell column: solid y-intervals [a, b] that block sight and bullets (doors excluded). */
  private readonly colN: Uint8Array; private readonly col: Float32Array;

  constructor(readonly def: ChapterDef) {
    this.W = def.W; this.H = def.H; this.WH = def.W * def.H; this.levels = def.levels ?? 1; this.N = this.WH * this.levels;
    this.adj = new Int32Array(this.N * 4).fill(-1);
    this.colN = new Uint8Array(this.WH); this.col = new Float32Array(this.WH * MAXI * 2);
    this.buildGraph();
    this.buildColumns();
  }

  inBounds(tx: number, tz: number): boolean { return tx >= 0 && tz >= 0 && tx < this.W && tz < this.H; }
  /** Node index of tile (tx,tz) on storey lv. */
  node(tx: number, tz: number, lv = 0): number { return lv * this.WH + tz * this.W + tx; }
  lvOf(n: number): number { return (n / this.WH) | 0; }
  /** Storey-0 cell index of a node (z * W + x). */
  cellOfNode(n: number): number { return n % this.WH; }
  nodeX(n: number): number { return (n % this.WH) % this.W; }
  nodeZ(n: number): number { return ((n % this.WH) / this.W) | 0; }
  /** Centre of a node in metres (y = its floor height at the centre). */
  centre(n: number): Pos3 {
    const x = (this.nodeX(n) + 0.5) * TILE, z = (this.nodeZ(n) + 0.5) * TILE;
    return { x, z, y: this.heightAt(n, x, z) };
  }
  /** Storey whose floor is nearest below height y (for things with no node, e.g. inside a wall). */
  storeyOf(y: number): number { return Math.max(0, Math.min(this.levels - 1, Math.floor((y + 1) / STOREY))); }

  /** Static walkability (walls, air, water, props; ignores doors). */
  walkable(n: number): boolean { return n >= 0 && n < this.N && this.def.solid[n] === 0; }
  /** Can't stand here right now: not walkable, or a closed door. */
  blocked(n: number, open: number): boolean {
    if (n < 0 || n >= this.N || this.def.solid[n] === 1) return true;
    const d = this.def.doorCell[n];
    return d >= 0 && !(open & (1 << d));
  }
  /** Tile (tx,tz) on storey lv is out of bounds, solid or a closed door. */
  solidAt(tx: number, tz: number, open: number, lv = 0): boolean {
    return !this.inBounds(tx, tz) || this.blocked(this.node(tx, tz, lv), open);
  }
  isLadder(n: number): boolean { return this.def.ladder[n] === 1; }

  /** Floor height of node n at point (px, pz), with the point clamped into the node's cell. */
  heightAt(n: number, px: number, pz: number): number {
    const base = this.lvOf(n) * STOREY, r = this.def.ramp[n];
    if (!r) return base;
    const tx = this.nodeX(n), tz = this.nodeZ(n);
    let t: number;
    if (r <= 2) t = Math.min(1, Math.max(0, px / TILE - tx)); else t = Math.min(1, Math.max(0, pz / TILE - tz));
    if (r === RAMP.NX || r === RAMP.NZ) t = 1 - t;
    return base + this.def.rampLo[n] + (this.def.rampHi[n] - this.def.rampLo[n]) * t;
  }

  /**
   * The node a thing at (x, z) standing at height ~y is on: the walkable surface in that cell nearest
   * y (preferring one at or below). Falls back to the storey of y when the cell has no floor.
   */
  nodeAt(x: number, y: number, z: number): number {
    const tx = Math.min(this.W - 1, Math.max(0, cellOf(x))), tz = Math.min(this.H - 1, Math.max(0, cellOf(z)));
    const c = tz * this.W + tx;
    if (this.levels === 1) return c;
    let best = -1, bs = Infinity;
    for (let k = 0; k < this.levels; k++) {
      const n = k * this.WH + c;
      if (this.def.solid[n] === 1 && this.def.doorCell[n] < 0) continue;
      const h = this.heightAt(n, x, z);
      const s = y >= h - STEP_UP ? y - h : 100 + h - y;
      if (s < bs) { bs = s; best = n; }
    }
    // Nothing walkable near y (e.g. a machine on a prop upstairs, over open floor below): its own storey.
    return best >= 0 && bs <= 2.5 ? best : this.storeyOf(y) * this.WH + c;
  }
  /** Floor height under a thing at (x, z) standing at ~y. */
  groundY(x: number, y: number, z: number): number {
    const n = this.nodeAt(x, y, z);
    return this.def.solid[n] === 1 && this.def.doorCell[n] < 0 ? y : this.heightAt(n, x, z);
  }
  /** Speed multiplier for walking here (slow on ladders). */
  speedAt(x: number, y: number, z: number, ladderSpeed: number): number { return this.levels > 1 && this.isLadder(this.nodeAt(x, y, z)) ? ladderSpeed : 1; }
  floorAt(x: number, y: number, z: number): number {
    const tx = cellOf(x), tz = cellOf(z);
    return this.inBounds(tx, tz) ? this.def.floor[this.nodeAt(x, y, z)] : F.NONE;
  }
  /** Inside tile rect r (on its storey). */
  inRect(x: number, y: number, z: number, r: Rect): boolean {
    const tx = cellOf(x), tz = cellOf(z);
    if (!(tx >= r.x0 && tx <= r.x1 && tz >= r.z0 && tz <= r.z1)) return false;
    return this.levels === 1 || this.lvOf(this.nodeAt(x, y, z)) === (r.lv ?? 0);
  }
  private safeRoomCache?: number[][];
  /**
   * Pickup ids in each safe room: [0] the start room (reachable from the first spawn with every door
   * shut), then each checkpoint's gather area in step order. A pickup belongs to the first room that holds it.
   */
  safeRooms(): number[][] {
    if (this.safeRoomCache) return this.safeRoomCache;
    const def = this.def, s0 = def.spawns[0], start = this.distanceField([this.nodeAt(s0.x, s0.y ?? 0, s0.z)], 0);
    const tests: ((p: Pickup) => boolean)[] = [(p) => start[this.nodeAt(p.x, p.y, p.z)] < 32767];
    for (const s of def.steps) if (s.checkpoint && s.area) { const a = s.area; tests.push((p) => this.inRect(p.x, p.y, p.z, a)); }
    const seen = new Set<number>();
    return (this.safeRoomCache = tests.map((f) => def.pickups.filter((p) => !seen.has(p.id) && f(p)).map((p) => (seen.add(p.id), p.id))));
  }
  private stackCache?: Set<number>;
  /** Safe-room weapons (guns, melee, throwables) are stacks, as in L4D: each survivor can take one from each. */
  stacks(): Set<number> {
    if (this.stackCache) return this.stackCache;
    const weapon = new Set<string>(WEAPONS.map((w) => w.id));
    return (this.stackCache = new Set(this.safeRooms().flat().filter((id) => weapon.has(this.def.pickups[id].kind))));
  }

  /** Height of a surface in tile (tx,tz) a walker at height y can step onto at point (px,pz), or NaN. */
  private stepOnto(tx: number, tz: number, y: number, px: number, pz: number, open: number, from = -1, yw = y): number {
    if (!this.inBounds(tx, tz)) return NaN;
    const c = tz * this.W + tx;
    for (let k = 0; k < this.levels; k++) {
      const n = k * this.WH + c;
      if (this.blocked(n, open)) continue;
      const h = this.heightAt(n, px, pz);
      if (Math.abs(h - y) <= STEP_UP && (from < 0 || !this.sideStep(from, n, yw, h))) return h;
    }
    return NaN;
  }
  /**
   * Stepping from node a into a different tile's node b across a ramp's side (not along it): only
   * alongside the same flight, or at the flight's bottom tile, as in the walk graph. Stops walkers
   * slipping off the top of a flight onto the floor beside it.
   */
  private sideStep(a: number, b: number, ya = NaN, yb = NaN): boolean {
    if (Math.abs(ya - yb) <= 0.25) return false; // flush (the corner at a flight's very top): fine
    const d = this.def, ra = d.ramp[a], rb = d.ramp[b];
    if (!ra && !rb) return false;
    if ((a % this.WH) === (b % this.WH)) return false;
    const ax = this.nodeX(a), az = this.nodeZ(a), bx = this.nodeX(b), bz = this.nodeZ(b);
    if (ax !== bx && az !== bz) return false; // diagonal: the side-by-side probes the box also makes decide
    const along = (r: number) => (bx - ax === RAMP_DX[r] || bx - ax === -RAMP_DX[r]) && bz === az && RAMP_DX[r] !== 0
      || (bz - az === RAMP_DZ[r] || bz - az === -RAMP_DZ[r]) && bx === ax && RAMP_DZ[r] !== 0;
    if (ra && rb && ra === rb && this.lvOf(a) === this.lvOf(b) && Math.abs(d.rampLo[a] - d.rampLo[b]) < 0.01 && !along(ra)) return false; // wide flight
    const lowEdge = (n: number) => this.lvOf(n) * STOREY + d.rampLo[n];
    const flat = (n: number) => this.lvOf(n) * STOREY;
    if (ra && !along(ra) && Math.abs(lowEdge(a) - (rb ? lowEdge(b) : flat(b))) > STEP_UP) return true;
    if (rb && !along(rb) && Math.abs(lowEdge(b) - (ra ? lowEdge(a) : flat(a))) > STEP_UP) return true;
    return false;
  }
  /**
   * `from`: the node the walker stands on before this move (moveSlide passes it). When the move takes its
   * centre into another tile, that step must not cross a ramp's side (see sideStep).
   */
  boxBlocked(x: number, y: number, z: number, r: number, open: number, from = -1): boolean {
    const x0 = cellOf(x - r), x1 = cellOf(x + r), z0 = cellOf(z - r), z1 = cellOf(z + r);
    // The surface under the walker's centre, extended to each probe point: on a ladder the floor keeps
    // rising to the tile edge, so the roof beyond is compared with the ladder's top, not the feet.
    let own = -1;
    if (this.levels > 1) {
      const n = this.nodeAt(x, y, z);
      if (!this.blocked(n, open) && Math.abs(this.heightAt(n, x, z) - y) <= STEP_UP) own = n;
    }
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
      // Height probed at the walker's centre clamped into the tile: a ramp is only entered where its floor is near your feet.
      const px = Math.min((tx + 1) * TILE, Math.max(tx * TILE, x)), pz = Math.min((tz + 1) * TILE, Math.max(tz * TILE, z));
      const ref = own >= 0 ? this.heightAt(own, px, pz) : y;
      const centre = from >= 0 && tx === cellOf(x) && tz === cellOf(z) && (from % this.WH) !== tz * this.W + tx;
      if (Number.isNaN(this.stepOnto(tx, tz, ref, px, pz, open, centre ? from : -1, y))) return true;
    }
    return false;
  }
  /** Axis-separated slide; `pos.y` is the floor height it stands on and follows stairs. Mutates and returns `pos`. */
  moveSlide<T extends Pos3>(pos: T, dx: number, dz: number, r: number, open: number): T {
    const multi = this.levels > 1;
    const from = () => { if (!multi) return -1; const n = this.nodeAt(pos.x, pos.y, pos.z); return this.blocked(n, open) ? -1 : n; };
    if (dx !== 0 && !this.boxBlocked(pos.x + dx, pos.y, pos.z, r, open, from())) pos.x += dx;
    if (dz !== 0 && !this.boxBlocked(pos.x, pos.y, pos.z + dz, r, open, from())) pos.z += dz;
    if (this.levels > 1) {
      const h = this.stepOnto(cellOf(pos.x), cellOf(pos.z), pos.y, pos.x, pos.z, open);
      if (!Number.isNaN(h)) pos.y = h;
    }
    return pos;
  }

  /**
   * First solid thing along a 3D ray from (ox,oy,oz) in unit direction (dx,dy,dz): walls, tall props,
   * closed doors, floor slabs, indoor ceilings and the ground. Distance, or maxDist if clear.
   */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, open: number): number {
    let tx = cellOf(ox), tz = cellOf(oz);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const ddx = dx !== 0 ? Math.abs(TILE / dx) : Infinity, ddz = dz !== 0 ? Math.abs(TILE / dz) : Infinity;
    let tmx = dx !== 0 ? ((dx > 0 ? (tx + 1) * TILE - ox : ox - tx * TILE) / Math.abs(dx)) : Infinity;
    let tmz = dz !== 0 ? ((dz > 0 ? (tz + 1) * TILE - oz : oz - tz * TILE) / Math.abs(dz)) : Infinity;
    let tIn = 0;
    for (;;) {
      if (!this.inBounds(tx, tz)) return tIn;
      const tOut = Math.min(tmx, tmz, maxDist);
      const hit = this.cellHit(tx, tz, ox, oy, oz, dx, dy, dz, tIn, tOut, open);
      if (hit >= 0) return hit;
      if (tOut >= maxDist) return maxDist;
      if (tmx < tmz) { tmx += ddx; tx += sx; } else { tmz += ddz; tz += sz; }
      tIn = tOut;
    }
  }
  /** Earliest t in [t0, t1] where the ray's height is inside a solid interval of tile (tx,tz), or -1. */
  private cellHit(tx: number, tz: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, t0: number, t1: number, open: number): number {
    const c = tz * this.W + tx, n = this.colN[c], o = c * MAXI * 2;
    let best = -1;
    const test = (a: number, b: number) => {
      let s: number, e: number;
      if (dy === 0) { if (oy < a || oy > b) return; s = t0; e = t1; }
      else { const ta = (a - oy) / dy, tb = (b - oy) / dy; s = Math.max(t0, Math.min(ta, tb)); e = Math.min(t1, Math.max(ta, tb)); }
      if (s <= e && (best < 0 || s < best)) best = s;
    };
    // Intervals are half-open at the top, so a point lying exactly on a floor is not inside it.
    for (let k = 0; k < n; k++) test(this.col[o + k * 2], this.col[o + k * 2 + 1] - 1e-4);
    for (let k = 0; k < this.levels; k++) {
      const d = this.def.doorCell[k * this.WH + c];
      if (d >= 0 && !(open & (1 << d))) test(k * STOREY, (k + 1) * STOREY);
    }
    // Stair flights and ladders are solid under their sloping floor: the ray's height minus the
    // ramp's is linear across the tile, so it dips under where that goes negative.
    if (this.levels > 1) {
      for (let k = 0; k < this.levels - 1; k++) {
        const nd = k * this.WH + c;
        if (!this.def.ramp[nd]) continue;
        const gap = (t: number) => oy + dy * t - this.heightAt(nd, ox + dx * t, oz + dz * t);
        const base = k * STOREY, g0 = gap(t0), g1 = gap(t1);
        // Only the solid wedge between the storey's floor and the ramp surface.
        const y0 = oy + dy * t0, y1 = oy + dy * t1;
        if (Math.max(y0, y1) < base) continue;
        let t = -1;
        if (g0 < -1e-3 && y0 >= base) t = t0;
        else if (g0 >= -1e-3 && g1 < -1e-3) t = t0 + (t1 - t0) * (g0 / (g0 - g1));
        if (t >= 0 && (best < 0 || t < best)) best = t;
      }
    }
    return best;
  }
  /** Clear line between two points (metres, any heights). */
  hasLOS(ax: number, ay: number, az: number, bx: number, by: number, bz: number, open: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 0.001) return true;
    return this.ray(ax, ay, az, dx / d, dy / d, dz / d, d, open) >= d - 0.001;
  }
  /** Eye-to-eye sight between two things standing at floor heights a.y and b.y (eyes `eye` m up). */
  sees(a: Pos3, b: Pos3, open: number, eye = 1.2): boolean { return this.hasLOS(a.x, a.y + eye, a.z, b.x, b.y + eye, b.z, open); }

  /** BFS distance (tiles) over the walk graph from source nodes; 32767 = unreachable. `out` must have N entries. */
  distanceField(sources: number[], open: number, out?: Int16Array): Int16Array {
    const N = this.N, adj = this.adj;
    const dist = out || new Int16Array(N);
    dist.fill(32767);
    const queue = new Int32Array(N);
    let head = 0, tail = 0;
    for (const s of sources) if (s >= 0 && s < N && dist[s] !== 0) { dist[s] = 0; queue[tail++] = s; }
    while (head < tail) {
      const c = queue[head++], d = dist[c] + 1;
      for (let k = 0; k < 4; k++) {
        const m = adj[c * 4 + k];
        if (m < 0 || dist[m] <= d || this.blocked(m, open)) continue;
        dist[m] = d; queue[tail++] = m;
      }
    }
    return dist;
  }
  /**
   * Nodes one step from n in 8 directions (diagonals only when both orthogonal routes are open and
   * agree), skipping closed doors. Writes into `out` and returns the count.
   */
  neighbors8(n: number, open: number, out: number[]): number {
    const adj = this.adj;
    let k = 0;
    for (let i = 0; i < 4; i++) { const m = adj[n * 4 + i]; if (m >= 0 && !this.blocked(m, open)) out[k++] = m; }
    for (const [a, b] of [[0, 2], [0, 3], [1, 2], [1, 3]]) {
      const ma = adj[n * 4 + a], mb = adj[n * 4 + b];
      if (ma < 0 || mb < 0 || this.blocked(ma, open) || this.blocked(mb, open)) continue;
      const d1 = adj[ma * 4 + b], d2 = adj[mb * 4 + a];
      if (d1 >= 0 && d1 === d2 && !this.blocked(d1, open)) out[k++] = d1;
    }
    return k;
  }
  /** Door mask after steps [0, upTo) have completed. */
  doorsAfter(upTo: number): number {
    let m = 0;
    for (let i = 0; i < upTo && i < this.def.steps.length; i++) {
      for (const d of this.def.steps[i].opens) m |= 1 << d;
      for (const d of this.def.steps[i].closes) m &= ~(1 << d);
    }
    return m;
  }

  // ------------------------------------------------------------ construction
  /** Floor height range [lo, hi] along the edge of node n facing neighbour direction k (absolute metres). */
  private edge(n: number, k: number): [number, number] {
    const base = this.lvOf(n) * STOREY, r = this.def.ramp[n];
    if (!r) return [base, base];
    const lo = base + this.def.rampLo[n], hi = base + this.def.rampHi[n];
    // k: 0 +x, 1 -x, 2 +z, 3 -z. Ramp r rises toward RAMP_DX/DZ[r].
    const [ex, ez] = NEI[k];
    if (ex === RAMP_DX[r] && ez === RAMP_DZ[r]) return [hi, hi];
    if (ex === -RAMP_DX[r] && ez === -RAMP_DZ[r]) return [lo, lo];
    return [NaN, NaN]; // a side edge
  }
  private buildGraph(): void {
    const { W, H, WH, levels, def, adj } = this;
    for (let k = 0; k < levels; k++) for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const n = k * WH + z * W + x;
      if (def.solid[n] === 1) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + NEI[d][0], nz = z + NEI[d][1];
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const [alo, ahi] = this.edge(n, d);
        let best = -1, bd = Infinity;
        for (let j = Math.max(0, k - 1); j <= Math.min(levels - 1, k + 1); j++) {
          const m = j * WH + nz * W + nx;
          if (def.solid[m] === 1) continue;
          const [blo, bhi] = this.edge(m, d ^ 1);
          let gap: number;
          if (Number.isNaN(alo) || Number.isNaN(blo)) {
            // Side by side on a ramp: only alongside the same flight (wide stairs).
            if (!(Number.isNaN(alo) && Number.isNaN(blo) && def.ramp[n] === def.ramp[m] && Math.abs(def.rampLo[n] - def.rampLo[m]) < 0.01 && j === k)) continue;
            gap = 0;
          } else gap = Math.max(0, blo - ahi, alo - bhi);
          if (gap <= STEP_UP && gap < bd) { bd = gap; best = m; }
        }
        adj[n * 4 + d] = best;
      }
    }
  }
  private buildColumns(): void {
    const { W, H, WH, levels, def } = this;
    const slab = (n: number) => def.floor[n] !== F.NONE; // an upper-storey floor (holes and air have none)
    for (let c = 0; c < WH; c++) {
      const o = c * MAXI * 2;
      let m = 0;
      const add = (a: number, b: number) => { if (m < MAXI) { this.col[o + m * 2] = a; this.col[o + m * 2 + 1] = b; m++; } };
      add(-INF_Y, 0); // the ground
      for (let k = 0; k < levels; k++) {
        const n = k * WH + c, base = k * STOREY;
        if (k > 0 && slab(n)) add(base - 0.12, base);
        const wall = def.floor[n] === F.NONE && !def.air[n];
        if (wall && (k === 0 || def.wallH[n] > 0)) {
          // A wall stack: up to the floor above it if one was carved there, else as tall as the sky.
          // Walls stacked on top (auto or authored) are part of the same stack.
          let top = INF_Y, stackTop = def.wallH[n];
          for (let j = k + 1; j < levels; j++) {
            const u = j * WH + c;
            if (def.floor[u] === F.NONE && !def.air[u]) { stackTop = Math.max(stackTop, def.wallH[u]); continue; }
            if (slab(u)) top = j * STOREY; // a roof or upper storey built on it
            // Under open air a building-height wall stops at its own top, so you can see over a low roof
            // from higher up; fences and hedges (under 3 m) stay sky-high as on flat maps.
            else if (stackTop >= 3) top = stackTop;
            break;
          }
          add(base, top);
        } else if (!wall && def.propCell[n] && def.opaque[n]) add(base, base + 2.4);
        // Indoor ceiling with nothing built on top: a roof at CEIL_H.
        if (isIndoor(def.floor[n]) && !def.ramp[n] && (k === levels - 1 || !slab(n + WH))) add(base + CEIL_H, base + CEIL_H + 0.3);
      }
      this.colN[c] = m;
    }
    void H;
  }
}
