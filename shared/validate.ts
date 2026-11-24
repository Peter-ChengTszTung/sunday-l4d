// Static checks + stats for a chapter, shared by scripts/check-chapters.ts and
// the map viewer. Walks the quest in order with each step's door state and
// verifies every objective is reachable from where the team stands.
import { TILE, STOREY, WEAPONS, PLAYER } from './constants';
import { F, ALL_OPEN, RAMP_DX, RAMP_DZ, cellOf, type Level, type Rect, type Step, type Vec2 } from './level';
import { wandererRegions } from './regions';

export interface StepReport { index: number; kind: string; objective: string; pathTiles: number; reachable: boolean; note?: string }
export interface ChapterReport {
  id: string; errors: string[]; warnings: string[]; steps: StepReport[];
  stats: { size: string; walkable: number; pathMetres: number; holdSeconds: number; estMinutes: [number, number]; checkpoints: number; doors: number; pickups: Record<string, number>; notes: number;
    /** Dormant-wanderer regions and their total expected sleepers (whole map, if every region were populated). */ wanderers: { regions: number; budget: number } };
}

const INF = 32767;
/** Minimum loot in each start/checkpoint safe room: weapons there are stacks (Level.stacks), so this is the choice on offer. */
export const MIN_ROOM_GUNS = 4, MIN_ROOM_AMMO = 2;
/** A Big Hold On's mounted gun must be within this many path tiles of the step's stand (`at`). */
export const BIG_MOUNT_TILES = 10;

const STAGE_KINDS = new Set(['wave', 'breather', 'specials', 'brute', 'final']);

/** An authored `holdScript` (shared/level.ts HoldStage): known kinds, positive durations adding up to `hold`. */
function checkHoldScript(s: Step, where: string, errors: string[], warnings: string[]): void {
  const sc = s.holdScript;
  if (!sc) return;
  const hold = s.hold ?? (s.kind === 'holdout' ? 60 : 0);
  if (!hold || (s.kind !== 'holdout' && s.kind !== 'use')) { errors.push(`${where}: holdScript needs a holdout (a holdout step, or a use step with hold)`); return; }
  if (!sc.length) { errors.push(`${where}: holdScript is empty`); return; }
  let sum = 0;
  sc.forEach((g, k) => {
    const at = `${where} holdScript[${k}] (${g.kind})`;
    if (!STAGE_KINDS.has(g.kind)) errors.push(`${at}: unknown stage kind`);
    if (!(g.secs > 0)) errors.push(`${at}: secs must be > 0`);
    sum += g.secs > 0 ? g.secs : 0;
    if (g.horde !== undefined && !(g.horde >= 0 && g.horde <= 3)) errors.push(`${at}: horde must be 0..3 (fraction of a full horde)`);
    if (g.specials !== undefined && !(Number.isInteger(g.specials) && g.specials >= 0 && g.specials <= 4)) errors.push(`${at}: specials must be an integer 0..4`);
    if (g.kind === 'breather' && (g.horde || g.specials || g.flank)) errors.push(`${at}: a breather spawns nothing (drop horde/specials/flank)`);
    if (g.kind === 'brute' && s.brute) warnings.push(`${at}: the step already brings a Brute (brute: true); this stage only adds a trickle while it is up`);
    if (g.msg !== undefined && g.msg.length > 48) warnings.push(`${at}: msg longer than 48 chars`);
  });
  if (Math.abs(sum - hold) > 0.5) errors.push(`${where}: holdScript stages add up to ${sum} s but hold is ${hold} s`);
  // The client skips its own horde roar on a `horde: true` lever step, trusting the server's opening
  // 'horde' event, which only fires if the first stage brings a horde ('wave'/'final' do by default).
  const g0 = sc[0];
  if (s.horde && !(g0.horde !== undefined ? g0.horde > 0 : g0.kind === 'wave' || g0.kind === 'final'))
    errors.push(`${where}: step has horde: true, so holdScript[0] must bring a horde (a 'wave'/'final' stage, or horde > 0)`);
  if (sc[sc.length - 1].kind !== 'final') warnings.push(`${where}: holdScript should end with a 'final' stage (the climax)`);
}

export function validateChapter(L: Level): ChapterReport {
  const def = L.def, { W, H, N } = L;
  const errors: string[] = [], warnings: string[] = [];
  const steps: StepReport[] = [];
  /** Node of a point: its tile on the storey of its floor height. */
  const cell = (v: Vec2) => L.node(cellOf(v.x), cellOf(v.z), L.storeyOf(v.y ?? 0));
  const name = (i: number) => `step ${i + 1} (${def.steps[i].kind} "${def.steps[i].objective}")`;
  /** Nodes of a tile rect on its storey. */
  const rectNodes = (r: Rect, open: number): number[] => {
    const out: number[] = [];
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) if (L.inBounds(x, z) && !L.solidAt(x, z, open, r.lv ?? 0)) out.push(L.node(x, z, r.lv ?? 0));
    return out;
  };
  const tile = (c: number) => `${L.nodeX(c)},${L.nodeZ(c)}${L.lvOf(c) ? ` (storey ${L.lvOf(c)})` : ''}`;

  // Nodes from which a survivor can press E on a machine: its tile and 8 neighbours on its storey.
  const useCells = (x: number, z: number, y: number): number[] => {
    const tx = cellOf(x), tz = cellOf(z), lv = L.storeyOf(y), out: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (L.inBounds(tx + dx, tz + dz)) out.push(L.node(tx + dx, tz + dz, lv));
    return out;
  };
  const best = (dist: Int16Array, cells: number[]) => cells.reduce((m, c) => Math.min(m, dist[c]), INF);

  let pos = cell(def.spawns[0]);
  if (L.blocked(pos, 0)) errors.push('first spawn point is inside a wall');
  let pathTiles = 0, holdSeconds = 0;
  for (let i = 0; i < def.steps.length; i++) {
    const s = def.steps[i], open = L.doorsAfter(i);
    const dist = L.distanceField([pos], open);
    let d = INF, next = pos, note: string | undefined;
    if (s.kind === 'reach' || s.kind === 'gather') {
      if (!s.area) { errors.push(`${name(i)} has no area`); continue; }
      const cells = rectNodes(s.area, open);
      if (!cells.length) errors.push(`${name(i)}: area has no walkable tiles`);
      d = best(dist, cells);
      next = cells.find((c) => dist[c] === d) ?? pos;
      if (s.kind === 'gather' && s.checkpoint && cells.some((c) => def.floor[c] !== F.SAFE)) warnings.push(`${name(i)}: checkpoint area is not all SAFE floor (director keeps spawning there)`);
      if (s.kind === 'gather' && cells.length < 6) warnings.push(`${name(i)}: gather area is small (${cells.length} tiles) for 4 players`);
    } else if (s.kind === 'use') {
      const p = s.target !== undefined ? def.pickups[s.target] : undefined;
      if (!p || p.kind !== 'obj') { errors.push(`${name(i)}: target is not an obj pickup`); continue; }
      const cells = useCells(p.x, p.z, p.y).filter((c) => !L.blocked(c, open));
      d = best(dist, cells);
      next = cells.find((c) => dist[c] === d) ?? pos;
      if (s.hold) holdSeconds += s.hold;
    } else if (s.kind === 'collect') {
      const items = def.pickups.filter((p) => p.kind === 'item' && p.group === s.group);
      // Greedy tour through the items.
      let here = pos, tour = 0;
      const left = [...items];
      while (left.length) {
        const dd = L.distanceField([here], open);
        let bi = -1, bd = INF;
        left.forEach((p, k) => { const v = dd[cell(p)]; if (v < bd) { bd = v; bi = k; } });
        if (bi < 0) { errors.push(`${name(i)}: ${left.length} item(s) unreachable, e.g. tile ${tile(cell(left[0]))}`); tour = INF; break; }
        tour += bd; here = cell(left[bi]); left.splice(bi, 1);
      }
      d = tour; next = here;
      note = `${items.length} items`;
    } else if (s.kind === 'holdout') {
      d = dist[cell(s.at)];
      next = cell(s.at);
      holdSeconds += s.hold ?? 0;
    }
    const reachable = d < INF;
    if (!reachable && s.kind !== 'collect') errors.push(`${name(i)} is unreachable from where the previous step ended (doors open: ${open.toString(2)})`);
    if (s.at && !L.inBounds(cellOf(s.at.x), cellOf(s.at.z))) errors.push(`${name(i)}: waypoint outside the map`);
    if (s.area && (s.area.lv ?? 0) >= L.levels) errors.push(`${name(i)}: area storey ${s.area.lv} does not exist`);
    steps.push({ index: i, kind: s.kind, objective: s.objective, pathTiles: reachable ? d : -1, reachable, note });
    if (reachable) pathTiles += d;
    pos = next;
    if (s.checkpoint && !def.checkpointSpawns[i]) warnings.push(`${name(i)} is a checkpoint but not a gather step (team respawns at chapter start)`);
    if (s.objective.length > 40) warnings.push(`${name(i)}: objective longer than 40 chars`);
    checkHoldScript(s, name(i), errors, warnings);
  }
  if (def.steps[def.steps.length - 1]?.kind !== 'gather') warnings.push('last step should be a gather (the exit)');

  // Safe rooms must be sealed: from inside, with the doors as they are once the room is in use,
  // no non-SAFE floor may be reachable (so zombies cannot walk in).
  const leak = (cells: number[], open: number): number => {
    const d = L.distanceField(cells, open);
    for (let c = 0; c < N; c++) if (d[c] < INF && def.floor[c] !== F.SAFE && def.doorCell[c] < 0) return c;
    return -1;
  };
  {
    const c = leak([cell(def.spawns[0])], 0);
    if (c >= 0) errors.push(`start safe room is not sealed before step 1 completes: reaches non-safe tile ${tile(c)}`);
  }
  def.steps.forEach((s, i) => {
    if (s.kind !== 'gather' || !s.checkpoint || !s.area) return;
    const cells = rectNodes(s.area, ALL_OPEN);
    for (const id of s.closes) {
      const d = def.doors[id];
      if (d && (d.lv ?? 0) === (s.area.lv ?? 0) && d.x0 <= s.area.x1 && d.x1 >= s.area.x0 && d.z0 <= s.area.z1 && d.z1 >= s.area.z0) errors.push(`${name(i)}: door ${id} it closes overlaps its own area`);
    }
    if (!cells.length) return;
    const c = leak(cells, L.doorsAfter(i + 1));
    if (c >= 0) errors.push(`${name(i)}: safe room is not sealed after the team gathers (reaches non-safe tile ${tile(c)}); close the entry door with \`closes\` and keep the exit shut until a later step`);
  });

  // Everything reachable with all doors open.
  const all = L.distanceField([cell(def.spawns[0])], ALL_OPEN);
  let walkable = 0, pockets = 0;
  for (let i = 0; i < N; i++) if (!def.solid[i] || def.doorCell[i] >= 0) { walkable++; if (all[i] >= INF) pockets++; }
  if (pockets) warnings.push(`${pockets} walkable tile(s) can never be reached`);
  for (const p of def.pickups) {
    if (p.kind === 'obj') continue;
    if (all[cell(p)] >= INF) errors.push(`${p.kind} pickup #${p.id} at tile ${tile(cell(p))} is unreachable or inside a prop`);
  }
  for (const n of def.notes) if (all[cell(n)] >= INF) errors.push(`note "${n.title}" at tile ${tile(cell(n))} is unreachable`);
  for (const sp of def.spawns) if (L.blocked(cell(sp), 0)) errors.push(`spawn at ${sp.x},${sp.z} is solid`);
  for (const [k, pts] of Object.entries(def.checkpointSpawns)) for (const sp of pts) if (L.blocked(cell(sp), ALL_OPEN)) errors.push(`checkpoint spawn for step ${+k + 1} is solid`);

  // Stairs and ladders: both ends must lead somewhere, and the flight must be reachable.
  for (const r of def.ramps) {
    const dx = RAMP_DX[r.dir], dz = RAMP_DZ[r.dir], what = `${r.ladder ? 'ladder' : 'stairs'} at ${r.x0},${r.z0}${r.lv ? ` (storey ${r.lv})` : ''}`;
    // Tiles just past the high end (on the storey above) and before the low end (on this storey).
    const hiX = dx > 0 ? r.x1 + 1 : dx < 0 ? r.x0 - 1 : -1, hiZ = dz > 0 ? r.z1 + 1 : dz < 0 ? r.z0 - 1 : -1;
    const loX = dx > 0 ? r.x0 - 1 : dx < 0 ? r.x1 + 1 : -1, loZ = dz > 0 ? r.z0 - 1 : dz < 0 ? r.z1 + 1 : -1;
    let top = 0, bottom = 0;
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      const tx = dx ? hiX : x, tz = dz ? hiZ : z, bx = dx ? loX : x, bz = dz ? loZ : z;
      const n = L.node(x, z, r.lv);
      if (L.inBounds(tx, tz) && L.adj.slice(n * 4, n * 4 + 4).includes(L.node(tx, tz, r.lv + 1))) top++;
      if (L.inBounds(bx, bz) && !L.solidAt(bx, bz, ALL_OPEN, r.lv)) bottom++;
    }
    if (!top) errors.push(`${what}: nothing to step onto at the top (carve floor on storey ${r.lv + 1} just past its high end)`);
    // Walk it for real: a Brute-sized body (and a survivor) up every lane, centred and on each seam.
    if (top && bottom) {
      const across = dx ? [r.z0, r.z1] : [r.x0, r.x1], len = dx ? r.x1 - r.x0 + 1 : r.z1 - r.z0 + 1;
      const lanes: number[] = [];
      for (let a = across[0]; a <= across[1]; a++) { lanes.push((a + 0.5) * TILE); if (a < across[1]) lanes.push((a + 1) * TILE); }
      for (const rad of [0.8, PLAYER.radius]) for (const lane of lanes) {
        const clamp = (v: number, lo: number, hi: number) => Math.min(hi - rad - 0.01, Math.max(lo + rad + 0.01, v));
        const lo = across[0] * TILE, hi = (across[1] + 1) * TILE;
        const startA = dx ? (dx > 0 ? r.x0 * TILE - TILE * 0.5 : (r.x1 + 1) * TILE + TILE * 0.5) : clamp(lane, lo, hi);
        const startB = dz ? (dz > 0 ? r.z0 * TILE - TILE * 0.5 : (r.z1 + 1) * TILE + TILE * 0.5) : clamp(lane, lo, hi);
        const w = { x: dx ? startA : clamp(lane, lo, hi), z: dz ? startB : clamp(lane, lo, hi), y: r.lv * STOREY };
        if (L.solidAt(cellOf(w.x), cellOf(w.z), ALL_OPEN, r.lv)) continue; // lane starts against a wall
        for (let i = 0; i < (len + 2) * 20; i++) L.moveSlide(w, dx * 0.1, dz * 0.1, rad, ALL_OPEN);
        if (w.y < (r.lv + 1) * STOREY - 0.01) { errors.push(`${what}: a walker of radius ${rad} m on lane ${(lane / TILE).toFixed(1)} gets stuck at height ${w.y.toFixed(2)}`); break; }
      }
    }
    if (!bottom) warnings.push(`${what}: no floor before its low end`);
    if (all[L.node(r.x0, r.z0, r.lv)] >= INF) warnings.push(`${what} can never be reached`);
  }
  // Upper storeys: count walkable floor per storey (a storey with none is a mistake).
  for (let k = 1; k < L.levels; k++) {
    let n = 0;
    for (let c = 0; c < W * H; c++) if (!def.solid[k * W * H + c]) n++;
    if (!n) warnings.push(`storey ${k} has no walkable floor`);
  }
  void STOREY;
  // Every safe room offers a choice of guns (each spot is a stack: one per survivor) and ammo.
  const PRIMARY = new Set(WEAPONS.filter((w) => w.slot === 'primary').map((w) => w.id as string));
  const stock = (inRoom: (c: number) => boolean, where: string) => {
    let guns = 0, ammo = 0;
    for (const p of def.pickups) {
      if (!inRoom(cell(p))) continue;
      if (PRIMARY.has(p.kind)) guns++; else if (p.kind === 'ammo') ammo++;
    }
    if (guns < MIN_ROOM_GUNS || ammo < MIN_ROOM_AMMO) errors.push(`${where} stocks ${guns} primary guns and ${ammo} ammo piles; it needs at least ${MIN_ROOM_GUNS} guns and ${MIN_ROOM_AMMO} ammo`);
  };
  {
    const room = L.distanceField([cell(def.spawns[0])], 0);
    stock((c) => room[c] < INF, 'start safe room');
  }
  def.steps.forEach((s, i) => {
    if (s.kind !== 'gather' || !s.checkpoint || !s.area) return;
    const a = s.area;
    stock((c) => { const x = L.nodeX(c), z = L.nodeZ(c); return L.lvOf(c) === (a.lv ?? 0) && x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1; }, `${name(i)} safe room`);
  });

  // Mounted guns: reachable, and every Big Hold On has one at its stand (within BIG_MOUNT_TILES path tiles of the waypoint).
  const mountCell = (m: (typeof def.mounts)[number]) => L.node(cellOf(m.x), cellOf(m.z), L.storeyOf(m.y));
  for (const m of def.mounts ?? []) if (all[mountCell(m)] >= INF) errors.push(`mount #${m.id} (${m.kind}) at tile ${tile(mountCell(m))} is unreachable`);
  def.steps.forEach((s, i) => {
    if (!s.big) return;
    if (!s.hold) { errors.push(`${name(i)}: big is only for holdouts (a holdout step, or a use step with hold)`); return; }
    if (s.hold < 120) warnings.push(`${name(i)}: a Big Hold On should last at least 120 s (has ${s.hold})`);
    // A use step's stand is its machine (a solid tile): search from the tiles round it, as the reachability check does.
    const open = L.doorsAfter(i), from = s.kind === 'use' ? useCells(s.at.x, s.at.z, s.at.y ?? 0).filter((c) => !L.blocked(c, open)) : [cell(s.at)];
    const near = L.distanceField(from, open);
    const has = (def.mounts ?? []).some((m) => near[mountCell(m)] <= BIG_MOUNT_TILES);
    if (!has) errors.push(`${name(i)}: a Big Hold On needs a mounted gun (LevelBuilder.mount) within ${BIG_MOUNT_TILES} path tiles of its stand`);
  });
  // Holdout spawn zones: only on holdouts, and each must hold floor the flood can walk to the stand from.
  def.steps.forEach((s, i) => {
    if (!s.from) return;
    if (!s.hold && s.kind !== 'holdout') { errors.push(`${name(i)}: from is only for holdouts`); return; }
    const open = L.doorsAfter(i), stand = s.kind === 'use' ? useCells(s.at.x, s.at.z, s.at.y ?? 0).filter((c) => !L.blocked(c, open)) : [cell(s.at)];
    const d = L.distanceField(stand, open);
    s.from.forEach((r, k) => { if (!rectNodes(r, open).some((c) => d[c] < INF)) errors.push(`${name(i)}: spawn zone ${k + 1} (${r.x0},${r.z0}-${r.x1},${r.z1}) has no floor that reaches the stand`); });
  });
  if (!def.steps.some((s) => s.big)) warnings.push('no Big Hold On step (big: true) in this chapter');

  const usedDoors = new Set(def.steps.flatMap((s) => s.opens));
  // A lift may stay shut for good (a faulted car is set dressing); any other door that never opens is a mistake.
  for (const d of def.doors) if (!usedDoors.has(d.id) && d.kind !== 'lift') warnings.push(`door ${d.id} at ${d.x0},${d.z0} is never opened`);

  // Wanderer regions (server populates each once per attempt).
  const reg = wandererRegions(L);
  def.density.forEach((r, k) => {
    let n = 0;
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) for (let k = 0; k < L.levels; k++) n += reg.spawnable[L.node(x, z, k)];
    if (!n) warnings.push(`density rect #${k + 1} (${r.x0},${r.z0})-(${r.x1},${r.z1}) covers no spawnable floor`);
  });
  const wanderers = { regions: reg.list.length, budget: Math.round(reg.list.reduce((a, r) => a + r.weight, 0)) };

  const pickups: Record<string, number> = {};
  for (const p of def.pickups) pickups[p.kind] = (pickups[p.kind] ?? 0) + 1;
  const pathMetres = pathTiles * TILE;
  // Rough pacing model: careful co-op advance (fighting, looting, regrouping) runs 0.9–1.6 m/s,
  // plus holdouts and ~20–40 s of reading/regrouping per step.
  const n = def.steps.length;
  const estMinutes: [number, number] = [
    Math.round((pathMetres / 1.6 + holdSeconds + n * 20) / 60),
    Math.round((pathMetres / 0.9 + holdSeconds * 1.2 + n * 40) / 60),
  ];
  return {
    id: def.id, errors, warnings, steps,
    stats: { size: `${W}x${H}${L.levels > 1 ? `x${L.levels}` : ''}`, walkable, pathMetres, holdSeconds, estMinutes, checkpoints: def.steps.filter((s) => s.checkpoint).length, doors: def.doors.length, pickups, notes: def.notes.length, wanderers },
  };
}
