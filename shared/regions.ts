// Wanderer regions: a fixed spatial partition of a chapter's spawnable floor.
// The server populates each region with dormant walkers once per attempt (the
// first time the team comes near it), so cleared streets stay cleared. Shared
// so the map checker can report region counts and budgets.
import { F, ALL_OPEN, type Level } from './level';

const INF = 32767;

/**
 * Tunables. `density`: default sleepers per spawnable cell (x the chapter's `b.density` multiplier),
 * so a fresh 32-tile stretch of a typical street holds about as many as the old restocking belt kept
 * there (~34). Regions: cells in the same `seg`-tile progress bucket and the same `chunk`x`chunk`
 * tile block, split into 4-connected pieces; pieces under `minCells` merge into the neighbour they
 * touch most. Spatial (progress from the start with every door open, not the quest route), so an
 * area the quest doubles back through is the same region both times.
 */
export const WANDER = { density: 0.042, seg: 14, chunk: 16, minCells: 12 } as const;

export interface Regions {
  /** BFS distance from the start with every door open. */ progress: Int16Array;
  /** 1 on cells where the director may spawn (walkable, reachable, not safe floor or a door). */ spawnable: Uint8Array;
  /** Spawnable cell indices. */ open: number[];
  /** Density multiplier per cell (1 unless a `density` rect says otherwise). */ mult: Float32Array;
  /** Region id per cell, -1 off the spawnable floor. */ regionOf: Int16Array;
  /** Per region: its spawnable cells, and its expected sleeper count (sum of density x mult). */
  list: { cells: number[]; weight: number }[];
}

export function wandererRegions(L: Level): Regions {
  const { W, H } = L, def = L.def, N = W * H;
  const progress = L.distanceField([def.startCell.z * W + def.startCell.x], ALL_OPEN);
  const spawnable = new Uint8Array(N), open: number[] = [];
  for (let i = 0; i < N; i++) {
    if (def.solid[i] || def.floor[i] === F.SAFE || def.doorCell[i] >= 0 || progress[i] >= INF) continue;
    spawnable[i] = 1; open.push(i);
  }
  const mult = new Float32Array(N).fill(1);
  for (const r of def.density) for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) mult[z * W + x] = r.mult;

  // Pieces: flood fill over cells sharing a progress bucket and a chunk.
  const key = (c: number) => Math.floor(progress[c] / WANDER.seg) * 1e6 + Math.floor((c % W) / WANDER.chunk) * 1e3 + Math.floor(c / W / WANDER.chunk);
  const label = new Int32Array(N).fill(-1), pieces: number[][] = [];
  const stack: number[] = [];
  for (const s of open) {
    if (label[s] >= 0) continue;
    const id = pieces.length, k = key(s), cells: number[] = [];
    label[s] = id; stack.push(s);
    while (stack.length) {
      const c = stack.pop()!; cells.push(c);
      const cx = c % W;
      for (const n of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (n < 0 || n >= N || !spawnable[n] || label[n] >= 0 || key(n) !== k) continue;
        label[n] = id; stack.push(n);
      }
    }
    pieces.push(cells);
  }
  // Merge small pieces (smallest first) into the neighbour they share the most edges with.
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const size = pieces.map((p) => p.length);
  const order = pieces.map((_, i) => i).sort((a, b) => size[a] - size[b]);
  for (const p of order) {
    const r = find(p);
    if (size[r] >= WANDER.minCells) continue;
    const touch = new Map<number, number>();
    for (const c of pieces[p]) {
      const cx = c % W;
      for (const n of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (n < 0 || n >= N || !spawnable[n]) continue;
        const o = find(label[n]);
        if (o !== r) touch.set(o, (touch.get(o) ?? 0) + 1);
      }
    }
    let best = -1, bn = 0;
    for (const [o, k] of touch) if (k > bn) { bn = k; best = o; }
    if (best < 0) continue; // an isolated pocket stays its own (tiny) region
    parent[r] = best; size[best] += size[r];
  }
  const regionOf = new Int16Array(N).fill(-1), ids = new Map<number, number>(), list: Regions['list'] = [];
  for (const c of open) {
    const r = find(label[c]);
    let id = ids.get(r);
    if (id === undefined) { id = list.length; ids.set(r, id); list.push({ cells: [], weight: 0 }); }
    regionOf[c] = id;
    list[id].cells.push(c);
    list[id].weight += WANDER.density * mult[c];
  }
  return { progress, spawnable, open, mult, regionOf, list };
}
