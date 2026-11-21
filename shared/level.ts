// Chapter maps and their quests. Grid based, shared by the server (AI,
// collision, quest logic), the client (rendering, movement, hitscan) and the
// map viewer tool. A chapter file describes its layout with `LevelBuilder` and
// exports a `ChapterDef`; `Level` wraps a built chapter with the collision and
// pathing helpers.
import { TILE, type WeaponId } from './constants';

/** Floor types. NONE is solid building/rock; WATER is solid but see-through. */
export const F = {
  NONE: 0, ASPHALT: 1, SIDEWALK: 2, GRASS: 3, INTERIOR: 4, SAFE: 5, DIRT: 6, CONCRETE: 7, TILES: 8, WOOD: 9, WATER: 10,
} as const;
export const FLOOR_NAMES = ['none', 'asphalt', 'sidewalk', 'grass', 'interior', 'safe', 'dirt', 'concrete', 'tiles', 'wood', 'water'];
/** Indoor floors get a ceiling (CEIL_H) and interior-coloured walls. */
export const isIndoor = (f: number): boolean => f === F.INTERIOR || f === F.SAFE || f === F.TILES || f === F.WOOD;

/** What an uncarved (solid) cell looks like from outside. */
export const WALL = { BUILDING: 0, ROCK: 1, HEDGE: 2, FENCE: 3 } as const;
export type WallKind = (typeof WALL)[keyof typeof WALL];

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
/** Weapon pickups use the weapon id (every weapon except the starting pistol can be found). */
export type GunKind = Exclude<WeaponId, 'pistol'>;
export type LootKind = GunKind | 'ammo' | 'medkit';
export type PickupKind = LootKind | 'obj' | 'item';

export interface Vec2 { x: number; z: number }
/** Inclusive tile rectangle. */
export interface Rect { x0: number; z0: number; x1: number; z1: number }
export interface Prop { type: PropType; x: number; z: number; w: number; d: number; color?: number; rot?: number }
export interface Pickup {
  id: number; kind: PickupKind; x: number; z: number;
  /** obj/item: model to show. */ look?: ObjLook | ItemLook;
  /** obj: the use prompt ("Start the generator"). item: its name ("fuel can"). */ label?: string;
  /** item: collect-step group key. */ group?: string;
}
export interface Door extends Rect { id: number; kind: 'shutter' | 'barricade' | 'fence'; label?: string }
export interface Note { id: number; x: number; z: number; title: string; text: string }
export interface Label { text: string; x: number; z: number; size: number; color: string; rot: number }
export type RadioLine = [speaker: string, line: string];

export type StepKind = 'reach' | 'gather' | 'use' | 'collect' | 'holdout';
export interface Step {
  kind: StepKind;
  /** HUD text. Collect steps get " 2/4" appended. */ objective: string;
  /** Lines played when the step begins. */ radio: RadioLine[];
  /** reach/gather: the trigger area. */ area?: Rect;
  /** use: pickup id of the objective machine. */ target?: number;
  /** collect: item group key, and how many there are. */ group?: string; count?: number;
  /** holdout: duration; use: optional holdout after the machine is used. */ hold?: number;
  /** Door ids opened when the step completes. */ opens: number[];
  /** Door ids closed when the step completes (seal a safe room behind the team). */ closes: number[];
  /** Completing this step saves a checkpoint (the team restarts here after a wipe). */ checkpoint: boolean;
  /** Spawn a horde / a Brute when the step begins (a `use` step with `hold`: its horde comes when the machine is used). */ horde: boolean; brute: boolean;
  /** Where the HUD waypoint points (metres). */ at: Vec2;
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
  floor: Uint8Array; solid: Uint8Array; opaque: Uint8Array; propCell: Uint8Array;
  wallH: Float32Array; wallKind: Uint8Array;
  /** Door id per cell, -1 where there is none. */ doorCell: Int8Array;
  props: Prop[]; pickups: Pickup[]; lamps: Vec2[]; arrows: { x: number; z: number; rot: number }[];
  labels: Label[]; doors: Door[]; notes: Note[]; steps: Step[];
  spawns: Vec2[]; startCell: { x: number; z: number };
  /** Per step index: where the team respawns if it wipes after that checkpoint. */ checkpointSpawns: Record<number, Vec2[]>;
  theme: Theme;
}

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

/** Step options as written in chapter files. `at` defaults to the area/target centre. */
export interface StepOpts {
  objective: string; radio?: RadioLine[]; area?: Rect; target?: number; group?: string; hold?: number;
  opens?: number[]; closes?: number[]; checkpoint?: boolean; horde?: boolean; brute?: boolean; at?: [number, number];
}

/**
 * Authoring kit. All coordinates are tile coordinates; rectangles are
 * inclusive (`carve(2, 3, 5, 3, …)` opens 4 tiles).
 */
export class LevelBuilder {
  readonly floor: Uint8Array; readonly solid: Uint8Array; readonly opaque: Uint8Array; readonly propCell: Uint8Array;
  readonly wallH: Float32Array; readonly wallKind: Uint8Array; readonly doorCell: Int8Array;
  readonly props: Prop[] = []; readonly pickups: Pickup[] = []; readonly lamps: Vec2[] = [];
  readonly arrows: { x: number; z: number; rot: number }[] = []; readonly labels: Label[] = [];
  readonly doors: Door[] = []; readonly notes: Note[] = []; readonly steps: Step[] = [];
  readonly checkpointSpawns: Record<number, Vec2[]> = {};
  spawns: Vec2[] = []; startCell = { x: 0, z: 0 };
  theme: Theme = DEFAULT_THEME;

  constructor(readonly W: number, readonly H: number) {
    const n = W * H;
    this.floor = new Uint8Array(n); this.solid = new Uint8Array(n).fill(1); this.opaque = new Uint8Array(n).fill(1);
    this.propCell = new Uint8Array(n); this.wallKind = new Uint8Array(n); this.doorCell = new Int8Array(n).fill(-1);
    this.wallH = new Float32Array(n);
    // Default skyline: blocky 3x3 chunks so it reads as buildings.
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) this.wallH[z * W + x] = 7 + Math.floor(hash2(Math.floor(x / 3), Math.floor(z / 3)) * 4) * 2.2;
  }

  private idx(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.W || z >= this.H) throw new Error(`tile ${x},${z} is outside the ${this.W}x${this.H} map`);
    return z * this.W + x;
  }
  private rect(x0: number, z0: number, x1: number, z1: number, fn: (i: number, x: number, z: number) => void): void {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) fn(this.idx(x, z), x, z);
  }

  /** Open walkable floor. WATER stays solid (you can see and shoot across it). */
  carve(x0: number, z0: number, x1: number, z1: number, type: number): this {
    this.rect(x0, z0, x1, z1, (i) => {
      this.floor[i] = type;
      const water = type === F.WATER;
      this.solid[i] = water ? 1 : 0; this.opaque[i] = 0; this.propCell[i] = 0;
    });
    return this;
  }
  /** Re-paint floor that is already carved (keeps props/solidity). */
  paint(x0: number, z0: number, x1: number, z1: number, type: number): this {
    this.rect(x0, z0, x1, z1, (i) => { if (this.floor[i] !== F.NONE) this.floor[i] = type; });
    return this;
  }
  /** Fill back in (make solid wall) — for pillars or reshaping a carved area. */
  fill(x0: number, z0: number, x1: number, z1: number): this {
    this.rect(x0, z0, x1, z1, (i) => { this.floor[i] = F.NONE; this.solid[i] = 1; this.opaque[i] = 1; this.propCell[i] = 0; });
    return this;
  }
  /** Style of the solid cells in a rect: building, rock cliff, hedge/treeline or fence; optional height in metres. */
  walls(x0: number, z0: number, x1: number, z1: number, kind: WallKind, height?: number): this {
    this.rect(x0, z0, x1, z1, (i) => { this.wallKind[i] = kind; if (height !== undefined) this.wallH[i] = height; });
    return this;
  }

  prop(type: PropType, x: number, z: number, w = 1, d = 1, extra: { color?: number; rot?: number } = {}): this {
    const opaque = PROP_OPAQUE[type] ?? true;
    this.rect(x, z, x + w - 1, z + d - 1, (i) => { this.solid[i] = 1; this.propCell[i] = 1; if (opaque) this.opaque[i] = 1; });
    this.props.push({ type, x, z, w, d, ...extra });
    return this;
  }

  /** Loot: weapons, ammo, medkits. Returns the pickup id. */
  pick(kind: LootKind, x: number, z: number): number {
    this.idx(x, z);
    this.pickups.push({ id: this.pickups.length, kind, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE });
    return this.pickups.length - 1;
  }
  /** An objective machine on tile (x,z) (solid). `label` is the use prompt. Returns the pickup id for a `use` step. */
  obj(look: ObjLook, x: number, z: number, label: string): number {
    this.prop(look, x, z);
    this.pickups.push({ id: this.pickups.length, kind: 'obj', look, label, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE });
    return this.pickups.length - 1;
  }
  /** A collectible for the `collect` step with the same group. Only visible while that step is active. */
  item(look: ItemLook, group: string, x: number, z: number, label: string): number {
    this.idx(x, z);
    this.pickups.push({ id: this.pickups.length, kind: 'item', look, group, label, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE });
    return this.pickups.length - 1;
  }
  /** Readable lore scrap (client side only). */
  note(x: number, z: number, title: string, text: string): this {
    this.idx(x, z);
    this.notes.push({ id: this.notes.length, x: (x + 0.5) * TILE, z: (z + 0.5) * TILE, title, text });
    return this;
  }
  /** A closed door/barricade over a tile rect; opened by a step's `opens`. Returns the door id. */
  door(x0: number, z0: number, x1: number, z1: number, kind: Door['kind'] = 'shutter', label?: string): number {
    const id = this.doors.length;
    if (id >= 30) throw new Error('at most 30 doors per chapter');
    this.carve(x0, z0, x1, z1, this.floor[this.idx(x0, z0)] || F.INTERIOR);
    this.rect(x0, z0, x1, z1, (i) => { this.doorCell[i] = id; });
    this.doors.push({ id, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), kind, label });
    return id;
  }

  /** Lamp post at tile coordinates (fractional allowed). */
  lamp(x: number, z: number): this { this.lamps.push({ x: x * TILE, z: z * TILE }); return this; }
  /** Painted floor arrow, rot 0 points +Z, PI/2 points +X, -PI/2 points -X, PI points -Z. */
  arrow(x: number, z: number, rot: number): this { this.arrows.push({ x, z, rot }); return this; }
  /** Painted floor text, centred on (x,z) in tiles, reading while walking +Z unless `rot` given. */
  label(text: string, x: number, z: number, size = 30, color = '#fff1c9', rot = Math.PI): this {
    this.labels.push({ text, x, z, size, color, rot }); return this;
  }

  /** Start safe room spawn points (tiles). */
  start(points: [number, number][]): this {
    this.spawns = points.map(([x, z]) => ({ x: x * TILE, z: z * TILE }));
    this.startCell = { x: Math.floor(points[0][0]), z: Math.floor(points[0][1]) };
    return this;
  }

  private stepAt(o: StepOpts): Vec2 {
    if (o.at) return { x: o.at[0] * TILE, z: o.at[1] * TILE };
    if (o.area) return { x: ((o.area.x0 + o.area.x1 + 1) / 2) * TILE, z: ((o.area.z0 + o.area.z1 + 1) / 2) * TILE };
    if (o.target !== undefined) { const p = this.pickups[o.target]; return { x: p.x, z: p.z }; }
    return { x: 0, z: 0 };
  }
  private addStep(kind: StepKind, o: StepOpts, extra: Partial<Step> = {}): number {
    this.steps.push({
      kind, objective: o.objective, radio: o.radio ?? [], area: o.area, target: o.target, group: o.group, hold: o.hold,
      opens: o.opens ?? [], closes: o.closes ?? [], checkpoint: !!o.checkpoint, horde: !!o.horde, brute: !!o.brute, at: this.stepAt(o), ...extra,
    });
    return this.steps.length - 1;
  }
  /** Any standing survivor enters `area`. */
  reach(area: Rect, o: Omit<StepOpts, 'area'>): number { return this.addStep('reach', { ...o, area }); }
  /** Every standing survivor is inside `area`. With `checkpoint`, the team respawns in `area` after a wipe. */
  gather(area: Rect, o: Omit<StepOpts, 'area'>): number {
    const i = this.addStep('gather', { ...o, area });
    if (o.checkpoint) {
      const pts: Vec2[] = [];
      const cx = (area.x0 + area.x1 + 1) / 2, cz = (area.z0 + area.z1 + 1) / 2;
      for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) pts.push({ x: (cx + dx) * TILE, z: (cz + dz) * TILE });
      this.checkpointSpawns[i] = pts;
    }
    return i;
  }
  /** Press E on the objective machine `target` (from `obj`). Optional `hold` seconds of holdout afterwards. */
  use(target: number, o: Omit<StepOpts, 'target'>): number { return this.addStep('use', { ...o, target }); }
  /** Pick up every `item` of `group`. The waypoint shows the nearest remaining one. */
  collect(group: string, o: Omit<StepOpts, 'group'>): number {
    const count = this.pickups.filter((p) => p.kind === 'item' && p.group === group).length;
    if (!count) throw new Error(`collect step "${group}" has no items — place items before the step`);
    const items = this.pickups.filter((p) => p.kind === 'item' && p.group === group);
    const at = o.at ?? [items.reduce((a, p) => a + p.x, 0) / count / TILE, items.reduce((a, p) => a + p.z, 0) / count / TILE];
    return this.addStep('collect', { ...o, group, at }, { count });
  }
  /** Survive `hold` seconds. `at` is where the team should make its stand. */
  holdout(hold: number, o: Omit<StepOpts, 'hold'>): number { return this.addStep('holdout', { ...o, hold }); }

  done(meta: { id: string; title: string; subtitle: string; intro: string; theme?: Theme }): ChapterDef {
    if (!this.spawns.length) throw new Error(`${meta.id}: call start() with spawn points`);
    if (!this.steps.length) throw new Error(`${meta.id}: a chapter needs quest steps`);
    return {
      ...meta, theme: meta.theme ?? this.theme, W: this.W, H: this.H,
      floor: this.floor, solid: this.solid, opaque: this.opaque, propCell: this.propCell, wallH: this.wallH, wallKind: this.wallKind,
      doorCell: this.doorCell, props: this.props, pickups: this.pickups, lamps: this.lamps, arrows: this.arrows, labels: this.labels,
      doors: this.doors, notes: this.notes, steps: this.steps, spawns: this.spawns, startCell: this.startCell, checkpointSpawns: this.checkpointSpawns,
    };
  }
}

export const cellOf = (v: number): number => Math.floor(v / TILE);
const NEI = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Door bitmask with every door open. */
export const ALL_OPEN = 0x7fffffff;

/** A built chapter plus collision/pathing. `open` arguments are door bitmasks. */
export class Level {
  readonly W: number; readonly H: number;
  constructor(readonly def: ChapterDef) { this.W = def.W; this.H = def.H; }

  inBounds(tx: number, tz: number): boolean { return tx >= 0 && tz >= 0 && tx < this.W && tz < this.H; }

  solidAt(tx: number, tz: number, open: number): boolean {
    if (!this.inBounds(tx, tz)) return true;
    const i = tz * this.W + tx, d = this.def.doorCell[i];
    return this.def.solid[i] === 1 || (d >= 0 && !(open & (1 << d)));
  }
  /** Blocks bullets and sight (walls, tall props, closed doors; not water or low props). */
  opaqueAt(tx: number, tz: number, open: number): boolean {
    if (!this.inBounds(tx, tz)) return true;
    const i = tz * this.W + tx, d = this.def.doorCell[i];
    return this.def.opaque[i] === 1 || (d >= 0 && !(open & (1 << d)));
  }
  floorAt(x: number, z: number): number {
    const tx = cellOf(x), tz = cellOf(z);
    return this.inBounds(tx, tz) ? this.def.floor[tz * this.W + tx] : F.NONE;
  }
  inRect(x: number, z: number, r: Rect): boolean {
    const tx = cellOf(x), tz = cellOf(z);
    return tx >= r.x0 && tx <= r.x1 && tz >= r.z0 && tz <= r.z1;
  }

  boxBlocked(x: number, z: number, r: number, open: number): boolean {
    const x0 = cellOf(x - r), x1 = cellOf(x + r), z0 = cellOf(z - r), z1 = cellOf(z + r);
    for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) if (this.solidAt(tx, tz, open)) return true;
    return false;
  }
  /** Axis-separated slide. Mutates and returns `pos`. */
  moveSlide<T extends Vec2>(pos: T, dx: number, dz: number, r: number, open: number): T {
    if (dx !== 0 && !this.boxBlocked(pos.x + dx, pos.z, r, open)) pos.x += dx;
    if (dz !== 0 && !this.boxBlocked(pos.x, pos.z + dz, r, open)) pos.z += dz;
    return pos;
  }
  /** 2D DDA. (dx, dz) normalised. Distance to the first opaque tile, or maxDist. */
  rayGrid(ox: number, oz: number, dx: number, dz: number, maxDist: number, open: number): number {
    let tx = cellOf(ox), tz = cellOf(oz);
    if (this.opaqueAt(tx, tz, open)) return 0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const ddx = dx !== 0 ? Math.abs(TILE / dx) : Infinity, ddz = dz !== 0 ? Math.abs(TILE / dz) : Infinity;
    let tmx = dx !== 0 ? ((dx > 0 ? (tx + 1) * TILE - ox : ox - tx * TILE) / Math.abs(dx)) : Infinity;
    let tmz = dz !== 0 ? ((dz > 0 ? (tz + 1) * TILE - oz : oz - tz * TILE) / Math.abs(dz)) : Infinity;
    let t = 0;
    while (t < maxDist) {
      if (tmx < tmz) { t = tmx; tmx += ddx; tx += sx; } else { t = tmz; tmz += ddz; tz += sz; }
      if (t >= maxDist) break;
      if (this.opaqueAt(tx, tz, open)) return t;
    }
    return maxDist;
  }
  hasLOS(ax: number, az: number, bx: number, bz: number, open: number): boolean {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 0.001) return true;
    return this.rayGrid(ax, az, dx / d, dz / d, d, open) >= d - 0.001;
  }
  /** BFS distance (tiles) from source cell indices; 32767 = unreachable. */
  distanceField(sources: number[], open: number, out?: Int16Array): Int16Array {
    const { W, H } = this;
    const dist = out || new Int16Array(W * H);
    dist.fill(32767);
    const queue = new Int32Array(W * H);
    let head = 0, tail = 0;
    for (const s of sources) if (dist[s] !== 0) { dist[s] = 0; queue[tail++] = s; }
    while (head < tail) {
      const c = queue[head++];
      const cx = c % W, cz = (c / W) | 0, d = dist[c] + 1;
      for (const [ox, oz] of NEI) {
        const nx = cx + ox, nz = cz + oz;
        if (this.solidAt(nx, nz, open)) continue;
        const n = nz * W + nx;
        if (dist[n] > d) { dist[n] = d; queue[tail++] = n; }
      }
    }
    return dist;
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
}
