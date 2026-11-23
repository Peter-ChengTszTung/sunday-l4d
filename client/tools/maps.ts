// Internal tool: top-down view of every chapter's layout and quest, with the validator's report.
// It is the "Maps" tab of the guide (guide.ts loads this module into guide.html's #mapview).
// Dev server: http://localhost:3000/tools/guide.html#maps
import { CHAPTERS, getLevel } from '../../shared/chapters';
import { F, FLOOR_NAMES, WALL, ALL_OPEN, RAMP_DX, RAMP_DZ, cellOf, type Level, type Step } from '../../shared/level';
import { validateChapter, type ChapterReport } from '../../shared/validate';
import { TILE, STOREY } from '../../shared/constants';
import { wandererRegions, type Regions } from '../../shared/regions';
import { t } from '../src/i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const cv = $<HTMLCanvasElement>('cv'), g = cv.getContext('2d')!;
const tip = $('tip');
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const FLOOR_COL: Record<number, string> = {
  [F.ASPHALT]: '#5a5d84', [F.SIDEWALK]: '#9a97bd', [F.GRASS]: '#5aae7a', [F.INTERIOR]: '#9d8fa5', [F.SAFE]: '#e6b67a',
  [F.DIRT]: '#a47e5e', [F.CONCRETE]: '#8b8a9c', [F.TILES]: '#c9d3dc', [F.WOOD]: '#b07f52', [F.WATER]: '#3f78b8',
};
const WALL_COL: Record<number, string> = { [WALL.BUILDING]: '#2a2140', [WALL.ROCK]: '#3d3236', [WALL.HEDGE]: '#1f3d2a', [WALL.FENCE]: '#3a3d4f' };
const PICK_COL: Record<string, string> = { medkit: '#ff6b8a', ammo: '#a9e34b', obj: '#ffd43b', item: '#ff922b', armor: '#b9a4ff', firebomb: '#ff7a3a', rattle: '#ff7a3a', plaster: '#63e6be', vitamins: '#63e6be', cocoa: '#63e6be' };
/** Any other pickup kind is a weapon. */
const WEAPON_COL = '#74c0fc';
const PICK_LETTER: Record<string, string> = { medkit: '+', ammo: 'a', smg: 'S', shotgun: 'G', rifle: 'R', autoshotgun: 'D', sniper: 'K', launcher: 'L', magnum: 'M', bat: 'b', machete: 'm', axe: 'x', firebomb: 'F', rattle: 'R', armor: 'V', obj: '!', item: '★', plaster: 'p', vitamins: 'v', cocoa: 'c' };
const KIND_COL: Record<string, string> = { reach: '#74c0fc', gather: '#7ddc6a', use: '#ffd43b', collect: '#ff922b', holdout: '#ff5d8f' };

const LAYERS = { grid: false, props: true, loot: true, lamps: true, paint: true, quest: true, route: true, heat: false, items: true, regions: false };
type LayerKey = keyof typeof LAYERS;

let chIndex = Math.max(0, Number(new URLSearchParams(location.search).get('ch') ?? 0) || 0);
let L: Level, report: ChapterReport, sel = -1, progress: Int16Array, routes: number[][] = [];
let scale = 6, ox = 0, oy = 0;
/** The storey on show (0 = ground). Things on other storeys are hidden or drawn faint. */
let lv = 0;
/** Storey of something standing at floor height y. */
const lvOfY = (y: number | undefined): number => Math.max(0, Math.min(L.levels - 1, Math.round((y ?? 0) / STOREY)));
/** Colour of a node as a map tile: floor, wall, or (for open air) null. */
function tileColor(n: number, heat: boolean, maxP: number): string | null {
  const def = L.def, f = def.floor[n];
  if (f === F.NONE) return def.air[n] ? null : WALL_COL[def.wallKind[n]] ?? '#2a2140';
  if (heat && progress[n] < 32767 && f !== F.WATER) return `hsl(${240 - (progress[n] / maxP) * 240} 70% 55%)`;
  return FLOOR_COL[f] ?? '#888';
}
const tileCv = document.createElement('canvas');
let tileKey = '';

// ---------------------------------------------------------- wanderer regions
// The server's spatial partition for dormant wanderers (shared/regions.ts): each region is stocked
// once per attempt with ~`weight` sleepers. Drawn as a tinted overlay with borders and labels.
let regs: Regions;
const regCv = document.createElement('canvas');
let regBorders = new Path2D();
let regLabels: { x: number; z: number; id: number; weight: number }[] = [];
const regionHue = (id: number) => (id * 137.508) % 360; // golden angle: neighbours rarely share a hue
function buildRegions(): void {
  regs = wandererRegions(L);
  drawRegions();
}
/** The regions of the storey on show (regions are per node, so each storey has its own). */
function drawRegions(): void {
  const { W, H } = L, o = lv * L.WH;
  regCv.width = W; regCv.height = H;
  const rg = regCv.getContext('2d')!;
  rg.clearRect(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    const id = regs.regionOf[o + i];
    if (id < 0) continue;
    // Density 0 cells (no wanderers) are dark; others tinted by region, brighter where denser.
    const m = regs.mult[o + i];
    rg.fillStyle = m <= 0 ? 'rgba(10,6,20,0.7)' : `hsla(${regionHue(id)} 85% ${m > 1 ? 62 : 55}% / ${m > 1 ? 0.7 : 0.5})`;
    rg.fillRect(i % W, (i / W) | 0, 1, 1);
  }
  // Borders: a unit edge wherever two neighbouring cells differ in region (and at least one is in one).
  regBorders = new Path2D();
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const a = regs.regionOf[o + z * W + x];
    if (x + 1 < W) { const b = regs.regionOf[o + z * W + x + 1]; if (a !== b && (a >= 0 || b >= 0)) { regBorders.moveTo(x + 1, z); regBorders.lineTo(x + 1, z + 1); } }
    if (z + 1 < H) { const b = regs.regionOf[o + (z + 1) * W + x]; if (a !== b && (a >= 0 || b >= 0)) { regBorders.moveTo(x, z + 1); regBorders.lineTo(x + 1, z + 1); } }
  }
  // Label each region at its cell nearest the centroid (centroids of L-shapes can fall outside).
  regLabels = [];
  regs.list.forEach((r, id) => {
    const cells = r.cells.filter((c) => L.lvOf(c) === lv);
    if (!cells.length) return;
    let sx = 0, sz = 0;
    for (const c of cells) { sx += L.nodeX(c); sz += L.nodeZ(c); }
    const cx = sx / cells.length, cz = sz / cells.length;
    let best = cells[0], bd = Infinity;
    for (const c of cells) { const d = (L.nodeX(c) - cx) ** 2 + (L.nodeZ(c) - cz) ** 2; if (d < bd) { bd = d; best = c; } }
    regLabels.push({ x: L.nodeX(best) + 0.5, z: L.nodeZ(best) + 0.5, id, weight: r.weight });
  });
}

// ------------------------------------------------------------------ routing
// Routes run over the walk graph, so they are lists of nodes and climb stairs and ladders.
/** Nodes that complete a step (area cells / use neighbours / item cells / holdout spot). */
function targetCells(s: Step, open: number): number[] {
  const out: number[] = [];
  if (s.area) { for (let z = s.area.z0; z <= s.area.z1; z++) for (let x = s.area.x0; x <= s.area.x1; x++) if (L.inBounds(x, z)) out.push(L.node(x, z, s.area.lv ?? 0)); }
  else {
    const tx = cellOf(s.at.x), tz = cellOf(s.at.z), k = lvOfY(s.at.y);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (L.inBounds(tx + dx, tz + dz)) out.push(L.node(tx + dx, tz + dz, k));
  }
  return out.filter((c) => !L.blocked(c, open));
}
/** Shortest path (node list) from `from` to any of `to`. */
function path(from: number, to: number[], open: number): number[] {
  if (!to.length) return [];
  const d = L.distanceField(to, open), out = [from];
  let c = from;
  if (d[c] >= 32767) return [];
  while (d[c] > 0 && out.length < 5000) {
    let best = c;
    for (let k = 0; k < 4; k++) { const n = L.adj[c * 4 + k]; if (n >= 0 && d[n] < d[best]) best = n; }
    if (best === c) break;
    c = best; out.push(c);
  }
  return out;
}
function computeRoutes(): void {
  const def = L.def;
  routes = [];
  let pos = L.node(cellOf(def.spawns[0].x), cellOf(def.spawns[0].z), lvOfY(def.spawns[0].y));
  def.steps.forEach((s, i) => {
    const open = L.doorsAfter(i);
    let r: number[] = [];
    if (s.kind === 'collect') {
      const items = def.pickups.filter((p) => p.kind === 'item' && p.group === s.group).map((p) => L.node(cellOf(p.x), cellOf(p.z), lvOfY(p.y)));
      while (items.length) {
        const d = L.distanceField([pos], open);
        items.sort((a, b) => d[a] - d[b]);
        const seg = path(pos, [items.shift()!], open);
        if (!seg.length) break;
        r = r.concat(seg); pos = seg[seg.length - 1];
      }
    } else {
      r = path(pos, targetCells(s, open), open);
      if (r.length) pos = r[r.length - 1];
    }
    routes.push(r);
  });
}

// ------------------------------------------------------------------ drawing
function draw(): void {
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#140f20'; g.fillRect(0, 0, w, h);
  g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  const def = L.def, { W, H } = L, open = sel >= 0 ? L.doorsAfter(sel) : 0;
  const px = 1 / scale; // one screen pixel in tile units
  // Tiles
  let maxP = 1;
  if (LAYERS.heat) for (let i = 0; i < L.N; i++) if (progress[i] < 32767) maxP = Math.max(maxP, progress[i]);
  // Tiles: one pixel per tile in an offscreen bitmap, scaled up without smoothing (no seams).
  const key = `${chIndex}|${LAYERS.heat}|${lv}`;
  if (tileKey !== key) {
    tileKey = key;
    tileCv.width = W; tileCv.height = H;
    const tg = tileCv.getContext('2d')!;
    tg.clearRect(0, 0, W, H);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      // Open air shows whatever is below it, dimmed, so an upper storey keeps its bearings.
      let k = lv, c = tileColor(lv * L.WH + z * W + x, LAYERS.heat, maxP);
      while (c === null && k > 0) c = tileColor(--k * L.WH + z * W + x, false, maxP);
      tg.globalAlpha = 1; tg.fillStyle = '#140f20'; tg.fillRect(x, z, 1, 1);
      tg.globalAlpha = k === lv ? 1 : 0.4; tg.fillStyle = c ?? '#140f20'; tg.fillRect(x, z, 1, 1);
    }
    tg.globalAlpha = 1;
  }
  g.imageSmoothingEnabled = false;
  g.drawImage(tileCv, 0, 0);
  if (LAYERS.regions) {
    g.drawImage(regCv, 0, 0);
    g.strokeStyle = 'rgba(10,6,20,0.85)'; g.lineWidth = 1.5 * px; g.stroke(regBorders);
    // Designer density overrides (b.density): dashed outline with the multiplier.
    g.setLineDash([6 * px, 4 * px]); g.lineWidth = 2 * px;
    for (const d of def.density) {
      g.strokeStyle = d.mult <= 0 ? '#ff8080' : '#ffffff';
      g.strokeRect(d.x0, d.z0, d.x1 - d.x0 + 1, d.z1 - d.z0 + 1);
      g.fillStyle = g.strokeStyle; g.font = `bold ${Math.max(0.7, 12 * px)}px sans-serif`;
      g.fillText(`×${d.mult}`, d.x0 + 0.2, d.z0 + Math.max(0.9, 14 * px));
    }
    g.setLineDash([]);
    if (scale >= 4) {
      g.font = `bold ${Math.max(0.55, 10 * px)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 3 * px; g.strokeStyle = 'rgba(10,6,20,0.9)'; g.fillStyle = '#fff';
      for (const r of regLabels) {
        const t = scale >= 8 ? `R${r.id} ~${r.weight.toFixed(1)}` : `${r.id}`;
        g.strokeText(t, r.x, r.z); g.fillText(t, r.x, r.z);
      }
      g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    }
  }
  if (LAYERS.grid && scale >= 6) {
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = px;
    g.beginPath();
    for (let x = 0; x <= W; x++) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let z = 0; z <= H; z++) { g.moveTo(0, z); g.lineTo(W, z); }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = `${10 * px}px monospace`;
    for (let x = 0; x < W; x += 10) g.fillText(String(x), x + 0.1, 0.8);
    for (let z = 0; z < H; z += 10) g.fillText(String(z), 0.1, z + 0.8);
  }
  // Stairs and ladders: solid with an arrow pointing up the climb on their own storey; on the storey
  // above, a dashed outline of the hole they come up through.
  for (const r of def.ramps) {
    if (r.lv !== lv && r.lv !== lv - 1) continue;
    const here = r.lv === lv, w = r.x1 - r.x0 + 1, h = r.z1 - r.z0 + 1, dx = RAMP_DX[r.dir], dz = RAMP_DZ[r.dir], col = r.ladder ? '#ffb84a' : '#e8e6f2';
    g.lineWidth = 2 * px; g.strokeStyle = col;
    if (here) {
      g.fillStyle = r.ladder ? 'rgba(255,184,74,0.45)' : 'rgba(232,230,242,0.4)'; g.fillRect(r.x0, r.z0, w, h);
      // Treads (or rungs) across the climb.
      g.beginPath();
      const n = (dx ? w : h) * (r.ladder ? 4 : 3);
      for (let i = 1; i < n; i++) { const q = i / n; if (dx) { g.moveTo(r.x0 + q * w, r.z0 + 0.1); g.lineTo(r.x0 + q * w, r.z0 + h - 0.1); } else { g.moveTo(r.x0 + 0.1, r.z0 + q * h); g.lineTo(r.x0 + w - 0.1, r.z0 + q * h); } }
      g.lineWidth = px; g.stroke(); g.lineWidth = 2 * px;
    } else g.setLineDash([4 * px, 3 * px]);
    g.strokeRect(r.x0, r.z0, w, h); g.setLineDash([]);
    // Arrow from the low end to the high end.
    const cx = r.x0 + w / 2, cz = r.z0 + h / 2, half = (dx ? w : h) / 2 - 0.15, ax = cx - dx * half, az = cz - dz * half, bx = cx + dx * half, bz = cz + dz * half;
    g.strokeStyle = g.fillStyle = here ? '#1a1226' : col; g.lineWidth = (here ? 3 : 2) * px;
    g.beginPath(); g.moveTo(ax, az); g.lineTo(bx, bz); g.stroke();
    g.beginPath(); g.moveTo(bx + dx * 0.1, bz + dz * 0.1); g.lineTo(bx - dx * 0.4 - dz * 0.3, bz - dz * 0.4 + dx * 0.3); g.lineTo(bx - dx * 0.4 + dz * 0.3, bz - dz * 0.4 - dx * 0.3); g.closePath(); g.fill();
  }
  // Doors
  for (const d of def.doors) {
    if ((d.lv ?? 0) !== lv) continue;
    const isOpen = !!(open & (1 << d.id));
    g.fillStyle = isOpen ? 'rgba(125,220,106,0.55)' : d.kind === 'barricade' ? '#8a5a35' : d.kind === 'fence' ? '#6f7390' : d.kind === 'bridge' ? '#9aa0b8' : d.kind === 'boom' ? '#c8324b' : d.kind === 'lift' ? '#c6ccd8' : '#ffd43b';
    g.fillRect(d.x0, d.z0, d.x1 - d.x0 + 1, d.z1 - d.z0 + 1);
    g.strokeStyle = '#000'; g.lineWidth = 2 * px; g.strokeRect(d.x0, d.z0, d.x1 - d.x0 + 1, d.z1 - d.z0 + 1);
    if (scale >= 4) { g.fillStyle = '#000'; g.font = `bold ${Math.max(0.6, 11 * px)}px sans-serif`; g.fillText(`D${d.id}`, d.x0 + 0.1, d.z0 + 0.75); }
  }
  // Paint: labels + arrows
  if (LAYERS.paint) {
    for (const a of def.arrows) {
      if (lvOfY(a.y) !== lv) continue;
      g.save(); g.translate(a.x, a.z); g.rotate(-a.rot); // rot is a yaw (PI/2 points +X); canvas rotation turns the other way
      g.fillStyle = 'rgba(255,231,163,0.9)'; g.beginPath(); g.moveTo(0, 0.8); g.lineTo(-0.55, 0.05); g.lineTo(-0.22, 0.05); g.lineTo(-0.22, -0.75); g.lineTo(0.22, -0.75); g.lineTo(0.22, 0.05); g.lineTo(0.55, 0.05); g.closePath(); g.fill();
      g.restore();
    }
    for (const l of def.labels) {
      if (lvOfY(l.y) !== lv) continue;
      g.save(); g.translate(l.x, l.z);
      g.font = `900 ${l.size / 40}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 0.15; g.strokeStyle = '#1a1226'; g.strokeText(t(l.text), 0, 0); g.fillStyle = l.color; g.fillText(t(l.text), 0, 0);
      g.restore();
    }
  }
  // Props
  if (LAYERS.props) for (const p of def.props) {
    if ((p.lv ?? 0) !== lv) continue;
    const obj = ['gen', 'radio', 'lever', 'terminal', 'valve', 'battery', 'beacon'].includes(p.type);
    g.fillStyle = obj ? '#ffd43b' : p.type === 'tree' || p.type === 'pine' || p.type === 'bush' ? '#2f7a45' : p.color !== undefined ? hex(p.color) : '#c8924e';
    g.globalAlpha = 0.9; g.fillRect(p.x + 0.08, p.z + 0.08, p.w - 0.16, p.d - 0.16); g.globalAlpha = 1;
    g.strokeStyle = '#1a1226'; g.lineWidth = 1.5 * px; g.strokeRect(p.x + 0.08, p.z + 0.08, p.w - 0.16, p.d - 0.16);
    if (scale >= 9) { g.fillStyle = '#1a1226'; g.font = `${8 * px}px sans-serif`; g.fillText(p.type, p.x + 0.15, p.z + 0.55, p.w - 0.2); }
  }
  if (LAYERS.lamps) { g.fillStyle = '#fff3b0'; for (const l of def.lamps) { if (lvOfY(l.y) !== lv) continue; g.beginPath(); g.arc(l.x / TILE, l.z / TILE, 0.22, 0, 7); g.fill(); } }
  // Pickups + notes
  const stepItems = sel >= 0 && def.steps[sel].kind === 'collect' ? def.steps[sel].group : null;
  for (const p of def.pickups) {
    if (lvOfY(p.y) !== lv || (p.kind === 'item' ? !LAYERS.items : p.kind === 'obj' ? !LAYERS.quest : !LAYERS.loot)) continue;
    const x = p.x / TILE, z = p.z / TILE, dim = p.kind === 'item' && stepItems && p.group !== stepItems;
    g.globalAlpha = dim ? 0.35 : 1;
    g.fillStyle = PICK_COL[p.kind] ?? WEAPON_COL; g.beginPath(); g.arc(x, z, 0.36, 0, 7); g.fill();
    g.strokeStyle = '#1a1226'; g.lineWidth = 1.5 * px; g.stroke();
    g.fillStyle = '#1a1226'; g.font = `bold 0.5px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(PICK_LETTER[p.kind] ?? '?', x, z + 0.02);
    g.globalAlpha = 1;
  }
  for (const n of def.notes) {
    if (lvOfY(n.y) !== lv) continue;
    const x = n.x / TILE, z = n.z / TILE;
    g.fillStyle = '#fff6e0'; g.fillRect(x - 0.3, z - 0.36, 0.6, 0.72); g.strokeStyle = '#1a1226'; g.lineWidth = 1.5 * px; g.strokeRect(x - 0.3, z - 0.36, 0.6, 0.72);
    g.fillStyle = '#1a1226'; g.font = 'bold 0.45px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('✎', x, z);
  }
  // Spawns
  g.fillStyle = '#39c5bb';
  for (const s of def.spawns) if (lvOfY(s.y) === lv) { g.beginPath(); g.arc(s.x / TILE, s.z / TILE, 0.25, 0, 7); g.fill(); }
  for (const pts of Object.values(def.checkpointSpawns)) for (const s of pts) if (lvOfY(s.y) === lv) { g.beginPath(); g.arc(s.x / TILE, s.z / TILE, 0.18, 0, 7); g.fill(); }
  // Route
  if (LAYERS.route) routes.forEach((r, i) => {
    if (r.length < 2) return;
    const on = sel < 0 || i === sel;
    g.strokeStyle = on ? (sel < 0 ? 'rgba(255,212,59,0.75)' : '#ffd43b') : 'rgba(255,255,255,0.13)';
    g.lineWidth = (on && sel >= 0 ? 4 : 2) * px; g.setLineDash(on && sel >= 0 ? [] : [6 * px, 4 * px]);
    // The stretch on this storey at full strength, the rest of the route (other storeys) faint.
    for (const mine of [false, true]) {
      g.globalAlpha = mine ? 1 : 0.22;
      g.beginPath();
      for (let k = 1; k < r.length; k++) {
        if ((L.lvOf(r[k - 1]) === lv || L.lvOf(r[k]) === lv) !== mine) continue;
        g.moveTo(L.nodeX(r[k - 1]) + 0.5, L.nodeZ(r[k - 1]) + 0.5); g.lineTo(L.nodeX(r[k]) + 0.5, L.nodeZ(r[k]) + 0.5);
      }
      g.stroke();
    }
    g.globalAlpha = 1; g.setLineDash([]);
  });
  // Quest areas + markers
  if (LAYERS.quest) def.steps.forEach((s, i) => {
    const on = sel < 0 || i === sel, col = KIND_COL[s.kind];
    // Steps on another storey stay on the map as ghosts, marked with the storey they are on.
    const sl = s.area ? s.area.lv ?? 0 : lvOfY(s.at.y), here = sl === lv;
    g.globalAlpha = (on ? 1 : 0.35) * (here ? 1 : 0.3);
    if (s.area && here) {
      const a = s.area;
      g.fillStyle = col + '30'; g.fillRect(a.x0, a.z0, a.x1 - a.x0 + 1, a.z1 - a.z0 + 1);
      g.strokeStyle = col; g.lineWidth = 2 * px; g.setLineDash([5 * px, 3 * px]); g.strokeRect(a.x0, a.z0, a.x1 - a.x0 + 1, a.z1 - a.z0 + 1); g.setLineDash([]);
    }
    const x = s.at.x / TILE, z = s.at.z / TILE, r = Math.max(0.55, 9 * px);
    g.fillStyle = col; g.beginPath(); g.arc(x, z, r, 0, 7); g.fill();
    g.strokeStyle = s.checkpoint ? '#ffffff' : '#1a1226'; g.lineWidth = (s.checkpoint ? 3 : 1.5) * px; g.stroke();
    g.fillStyle = '#1a1226'; g.font = `bold ${r * 1.1}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, z + r * 0.05);
    if (!here) { g.fillStyle = '#fff'; g.font = `bold ${r * 0.8}px sans-serif`; g.fillText(`${sl > lv ? '▲' : '▼'}${sl}`, x + r * 1.5, z - r * 0.7); }
    g.globalAlpha = 1;
  });
  g.textAlign = 'start'; g.textBaseline = 'alphabetic';
}

// --------------------------------------------------------------------- side
function renderSide(): void {
  const def = L.def, s = report.stats;
  const radio = (st: Step) => st.radio.map(([who, line]) => `<div><b>${esc(t(who))}:</b> ${esc(t(line))}</div>`).join('');
  const flags = (st: Step) => [st.checkpoint && `✔ ${t('checkpoint')}`, st.horde && t('horde'), st.brute && t('BRUTE'), st.hold && t('hold {s}s', { s: st.hold }), st.opens.length && t('opens {doors}', { doors: `D${st.opens.join(', D')}` })].filter(Boolean).join(' · ');
  const many = def.density.length ? ` · ${t('{n} density overrides', { n: def.density.length })}` : '';
  $('side').innerHTML = `
    <h2>${chIndex + 1}. ${esc(t(def.title))}</h2><div class="sub">${esc(t(def.subtitle))}</div>
    <div class="intro">${esc(t(def.intro))}</div>
    <h3>${esc(t('Stats'))}</h3>
    <div class="stats">
      <b>${esc(t('Size'))}</b><span>${esc(t('{n} tiles ({w}×{h} m), {walk} walkable', { n: s.size, w: L.W * TILE, h: L.H * TILE, walk: s.walkable }))}</span>
      <b>${esc(t('Critical path'))}</b><span>${s.pathMetres} m</span>
      <b>${esc(t('Holdouts'))}</b><span>${s.holdSeconds} s</span>
      <b>${esc(t('Est. play time'))}</b><span><b style="color:${s.estMinutes[1] >= 30 && s.estMinutes[0] <= 60 ? 'var(--green)' : 'var(--pink)'}">${esc(t('{a}–{b} min', { a: s.estMinutes[0], b: s.estMinutes[1] }))}</b> ${esc(t('(target 30–60)'))}</span>
      <b>${esc(t('Steps'))}</b><span>${esc(t('{n} · {cp} checkpoints · {doors} doors', { n: def.steps.length, cp: s.checkpoints, doors: s.doors }))}</span>
      <b>${esc(t('Pickups'))}</b><span>${Object.entries(s.pickups).map(([k, v]) => `${esc(t(`pickup: ${k}`).replace(/^pickup: /, ''))} ${v}`).join(', ')}</span>
      <b>${esc(t('Props / lamps'))}</b><span>${def.props.length} / ${def.lamps.length}</span>
      <b>${esc(t('Wanderers'))}</b><span>${esc(t('{n} regions, ~{k} sleepers if all stocked', { n: s.wanderers.regions, k: s.wanderers.budget }))}${esc(many)}</span>
    </div>
    <div class="issues">${report.errors.map((e) => `<div class="err">✖ ${esc(e)}</div>`).join('')}${report.warnings.map((e) => `<div class="warn">⚠ ${esc(e)}</div>`).join('')}${!report.errors.length && !report.warnings.length ? `<div style="color:var(--green)">✔ ${esc(t('No issues'))}</div>` : ''}</div>
    <h3>${esc(t('Quest ({n} steps) — click to focus', { n: def.steps.length }))}</h3>
    <ol>${def.steps.map((st, i) => `
      <li class="step ${i === sel ? 'sel' : ''}" data-i="${i}">
        <div class="hd"><span class="n">${i + 1}</span><span class="k" style="background:${KIND_COL[st.kind]};color:#1a1226">${esc(t(`step: ${st.kind}`).replace(/^step: /, ''))}</span><span>${esc(t(st.objective))}${st.kind === 'collect' ? ` (${st.count})` : ''}</span><span class="m">${report.steps[i]?.pathTiles >= 0 ? report.steps[i].pathTiles * TILE + ' m' : '✖'}</span></div>
        <div class="flags">${flags(st)}</div>
        <div class="radio">${radio(st)}<a href="/?room=MAP${chIndex + 1}${i}&ch=${chIndex}&step=${i}&name=Tester" target="_blank">▶ ${esc(t('play from this step (dev server)'))}</a></div>
      </li>`).join('')}</ol>
    <h3>${esc(t('Lore notes ({n})', { n: def.notes.length }))}</h3>
    <div class="notes">${def.notes.map((n) => `<div><b>✎ ${esc(t(n.title))}</b> <span style="color:var(--dim)">@ ${cellOf(n.x)},${cellOf(n.z)}${L.levels > 1 ? ` · ${storeyName(lvOfY(n.y))}` : ''}</span><br>${esc(t(n.text))}</div>`).join('')}</div>
    <h3>${esc(t('Theme'))}</h3>
    <div>${[...def.theme.sky, def.theme.fog, ...def.theme.buildings].map((c) => `<span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${hex(c)};margin-right:3px"></span>`).join('')}</div>`;
  for (const li of $('side').querySelectorAll<HTMLElement>('li.step')) li.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName === 'A') return;
    const i = Number(li.dataset.i);
    sel = sel === i ? -1 : i;
    if (sel >= 0) { const st = L.def.steps[sel]; setStorey(st.area ? st.area.lv ?? 0 : lvOfY(st.at.y)); }
    renderSide(); draw();
    if (sel >= 0) { const at = L.def.steps[sel].at; centerOn(at.x / TILE, at.z / TILE); }
  });
}

// ---------------------------------------------------------------- controls
function fit(): void {
  const w = cv.clientWidth, h = cv.clientHeight;
  scale = Math.max(1, Math.min(w / L.W, h / L.H) * 0.96);
  ox = (w - L.W * scale) / 2; oy = (h - L.H * scale) / 2;
  draw();
}
function centerOn(x: number, z: number): void {
  const w = cv.clientWidth, h = cv.clientHeight;
  const sx = x * scale + ox, sz = z * scale + oy;
  if (sx > 40 && sx < w - 40 && sz > 40 && sz < h - 40) return;
  ox = w / 2 - x * scale; oy = h / 2 - z * scale; draw();
}
let firstLv = Number(new URLSearchParams(location.search).get('lv') ?? -1);
const storeyName = (k: number): string => (k === 0 ? 'G' : `${k}F`);
/** Storey selector (only on maps that have more than one), next to the chapter tabs. */
function renderTabs(): void {
  const storeys = L.levels > 1 ? ` <span style="margin-left:14px;opacity:.7">▤</span> ${Array.from({ length: L.levels }, (_, k) => `<button class="${k === lv ? 'on' : ''}" data-lv="${k}" title="${k * STOREY} m">${storeyName(k)}</button>`).join(' ')}` : '';
  $('chtabs').innerHTML = CHAPTERS.map((c, k) => `<button class="${k === chIndex ? 'on' : ''}" data-ch="${k}">${k + 1}. ${esc(t(c.title))}</button>`).join(' ') + storeys;
  for (const b of $('chtabs').querySelectorAll<HTMLButtonElement>('button[data-ch]')) b.onclick = () => load(Number(b.dataset.ch));
  for (const b of $('chtabs').querySelectorAll<HTMLButtonElement>('button[data-lv]')) b.onclick = () => { setStorey(Number(b.dataset.lv)); draw(); };
}
function setStorey(k: number): void {
  if (k === lv) return;
  lv = k;
  drawRegions(); renderTabs();
}
function load(i: number): void {
  chIndex = i;
  history.replaceState(null, '', `?ch=${i}${location.hash}`);
  L = getLevel(i);
  tileKey = '';
  report = validateChapter(L);
  progress = L.distanceField([L.node(L.def.startCell.x, L.def.startCell.z, L.def.startCell.lv ?? 0)], ALL_OPEN);
  sel = -1;
  // `?lv=N` opens on that storey (first load only); otherwise the one the team starts on.
  lv = firstLv >= 0 && firstLv < L.levels ? firstLv : L.def.startCell.lv ?? 0;
  firstLv = -1;
  computeRoutes();
  buildRegions();
  renderTabs();
  renderSide(); fit();
}

$('layers').innerHTML = (Object.keys(LAYERS) as LayerKey[]).map((k) => `<label><input type="checkbox" data-l="${k}" ${LAYERS[k] ? 'checked' : ''}/>${esc(t(`layer: ${k}`).replace(/^layer: /, ''))}</label>`).join(' ');
for (const inp of $('layers').querySelectorAll<HTMLInputElement>('input')) inp.onchange = () => { LAYERS[inp.dataset.l as LayerKey] = inp.checked; draw(); };
$('fit').onclick = fit;
$('legend').innerHTML = [
  ...Object.entries(KIND_COL).map(([k, c]) => `<span style="--c:${c}">${esc(t(`step: ${k}`).replace(/^step: /, ''))}</span>`),
  ...Object.entries({ medkit: '#ff6b8a', 'small medical item': '#63e6be', ammo: '#a9e34b', weapon: '#74c0fc', armour: '#b9a4ff', throwable: '#ff7a3a', 'quest item': '#ff922b', 'closed door': '#ffd43b', 'open door': '#7ddc6a', spawn: '#39c5bb', note: '#fff6e0' }).map(([k, c]) => `<span style="--c:${c}">${esc(t(`legend: ${k}`).replace(/^legend: /, ''))}</span>`),
].join('');

let drag: { x: number; y: number } | null = null;
cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.classList.add('drag'); });
addEventListener('mouseup', () => { drag = null; cv.classList.remove('drag'); });
cv.addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  if (drag) { ox += e.clientX - drag.x; oy += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; draw(); }
  const tx = Math.floor((e.clientX - r.left - ox) / scale), tz = Math.floor((e.clientY - r.top - oy) / scale);
  if (!L.inBounds(tx, tz)) { tip.style.display = 'none'; return; }
  const def = L.def, i = L.node(tx, tz, lv);
  // A wall's height is kept on the node that starts its stack (auto walls above it carry 0).
  let base = i;
  while (base >= L.WH && def.floor[base] === F.NONE && !def.air[base] && def.wallH[base] === 0) base -= L.WH;
  const what = def.air[i] ? 'air' : `${FLOOR_NAMES[def.floor[i]]}${def.floor[i] === F.NONE ? ` (${['building', 'rock', 'hedge', 'fence'][def.wallKind[i]]} ${def.wallH[base].toFixed(1)} m)` : ''}`;
  const lines = [`${t('tile')} ${tx}, ${tz}${L.levels > 1 ? ` · ${storeyName(lv)} (${(lv * STOREY).toFixed(1)} m)` : ''}   (${tx * TILE}–${tx * TILE + TILE} m, ${tz * TILE} m)`, `${t('floor')}: ${what}`];
  if (def.ramp[i]) lines.push(`${def.ladder[i] ? 'ladder' : 'stairs'} ${['', '+x', '-x', '+z', '-z'][def.ramp[i]]}: ${(lv * STOREY + def.rampLo[i]).toFixed(1)}–${(lv * STOREY + def.rampHi[i]).toFixed(1)} m`);
  if (progress[i] < 32767) lines.push(t('progress from start: {n} tiles', { n: progress[i] }));
  const rid = regs.regionOf[i];
  if (rid >= 0) {
    const r = regs.list[rid];
    lines.push(t('wander region R{id}: {cells} cells, ~{n} sleepers', { id: rid, cells: r.cells.length, n: r.weight.toFixed(1) }) + (regs.mult[i] !== 1 ? `, ×${regs.mult[i]}` : ''));
  }
  const prop = def.props.find((p) => (p.lv ?? 0) === lv && tx >= p.x && tx < p.x + p.w && tz >= p.z && tz < p.z + p.d);
  if (prop) lines.push(`${t('prop')}: ${prop.type} ${prop.w}x${prop.d}`);
  if (def.doorCell[i] >= 0) { const d = def.doors[def.doorCell[i]]; lines.push(t('door D{id} ({kind}) {label}, opened by step {n}', { id: d.id, kind: d.kind, label: d.label ? t(d.label) : '', n: def.steps.findIndex((s) => s.opens.includes(d.id)) + 1 || '—' })); }
  for (const p of def.pickups) if (lvOfY(p.y) === lv && cellOf(p.x) === tx && cellOf(p.z) === tz) lines.push(`${t('pickup')} #${p.id}: ${t(`pickup: ${p.kind}`).replace(/^pickup: /, '')}${p.look ? ' ' + p.look : ''}${p.label ? ` "${t(p.label)}"` : ''}${p.group ? ` [${p.group}]` : ''}`);
  for (const n of def.notes) if (lvOfY(n.y) === lv && cellOf(n.x) === tx && cellOf(n.z) === tz) lines.push(`${t('note')}: ${t(n.title)}`);
  def.steps.forEach((s, k) => { if (s.area && (s.area.lv ?? 0) === lv && tx >= s.area.x0 && tx <= s.area.x1 && tz >= s.area.z0 && tz <= s.area.z1) lines.push(t('step {n} area ({kind})', { n: k + 1, kind: t(`step: ${s.kind}`).replace(/^step: /, '') })); });
  tip.textContent = lines.join('\n');
  tip.style.display = 'block';
  tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - 300)}px`; tip.style.top = `${e.clientY - r.top + 14}px`;
});
cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const k = Math.exp(-e.deltaY * 0.0015), ns = Math.max(1, Math.min(60, scale * k));
  ox = mx - ((mx - ox) * ns) / scale; oy = my - ((my - oy) * ns) / scale; scale = ns;
  draw();
}, { passive: false });
addEventListener('resize', draw);
load(Math.min(chIndex, CHAPTERS.length - 1));

/** The Maps tab was opened: the canvas has a size now, so fit the chapter to it. */
export function showMaps(): void { fit(); }
