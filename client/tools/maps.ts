// Internal tool: top-down view of every chapter's layout and quest, with the
// validator's report. Dev server: http://localhost:3000/tools/maps.html
import { CHAPTERS, getLevel } from '../../shared/chapters';
import { F, FLOOR_NAMES, WALL, ALL_OPEN, cellOf, type Level, type Step } from '../../shared/level';
import { validateChapter, type ChapterReport } from '../../shared/validate';
import { TILE } from '../../shared/constants';
import { wandererRegions, type Regions } from '../../shared/regions';

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
const PICK_COL: Record<string, string> = { medkit: '#ff6b8a', ammo: '#a9e34b', smg: '#74c0fc', shotgun: '#74c0fc', rifle: '#74c0fc', obj: '#ffd43b', item: '#ff922b' };
const PICK_LETTER: Record<string, string> = { medkit: '+', ammo: 'a', smg: 'S', shotgun: 'G', rifle: 'R', obj: '!', item: '★' };
const KIND_COL: Record<string, string> = { reach: '#74c0fc', gather: '#7ddc6a', use: '#ffd43b', collect: '#ff922b', holdout: '#ff5d8f' };

const LAYERS = { grid: false, props: true, loot: true, lamps: true, paint: true, quest: true, route: true, heat: false, items: true, regions: false };
type LayerKey = keyof typeof LAYERS;

let chIndex = Math.max(0, Number(new URLSearchParams(location.search).get('ch') ?? 0) || 0);
let L: Level, report: ChapterReport, sel = -1, progress: Int16Array, routes: number[][] = [];
let scale = 6, ox = 0, oy = 0;
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
  const { W, H } = L;
  regs = wandererRegions(L);
  regCv.width = W; regCv.height = H;
  const rg = regCv.getContext('2d')!;
  rg.clearRect(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    const id = regs.regionOf[i];
    if (id < 0) continue;
    // Density 0 cells (no wanderers) are dark; others tinted by region, brighter where denser.
    const m = regs.mult[i];
    rg.fillStyle = m <= 0 ? 'rgba(10,6,20,0.7)' : `hsla(${regionHue(id)} 85% ${m > 1 ? 62 : 55}% / ${m > 1 ? 0.7 : 0.5})`;
    rg.fillRect(i % W, (i / W) | 0, 1, 1);
  }
  // Borders: a unit edge wherever two neighbouring cells differ in region (and at least one is in one).
  regBorders = new Path2D();
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const a = regs.regionOf[z * W + x];
    if (x + 1 < W) { const b = regs.regionOf[z * W + x + 1]; if (a !== b && (a >= 0 || b >= 0)) { regBorders.moveTo(x + 1, z); regBorders.lineTo(x + 1, z + 1); } }
    if (z + 1 < H) { const b = regs.regionOf[(z + 1) * W + x]; if (a !== b && (a >= 0 || b >= 0)) { regBorders.moveTo(x, z + 1); regBorders.lineTo(x + 1, z + 1); } }
  }
  // Label each region at its cell nearest the centroid (centroids of L-shapes can fall outside).
  regLabels = regs.list.map((r, id) => {
    let sx = 0, sz = 0;
    for (const c of r.cells) { sx += c % W; sz += (c / W) | 0; }
    const cx = sx / r.cells.length, cz = sz / r.cells.length;
    let best = r.cells[0], bd = Infinity;
    for (const c of r.cells) { const d = (c % W - cx) ** 2 + (((c / W) | 0) - cz) ** 2; if (d < bd) { bd = d; best = c; } }
    return { x: (best % W) + 0.5, z: ((best / W) | 0) + 0.5, id, weight: r.weight };
  });
}

// ------------------------------------------------------------------ routing
function walkable(c: number, open: number): boolean { return !L.solidAt(c % L.W, (c / L.W) | 0, open); }
/** Cells that complete a step (area cells / use neighbours / item cells / holdout spot). */
function targetCells(s: Step, open: number): number[] {
  const W = L.W, out: number[] = [];
  if (s.area) { for (let z = s.area.z0; z <= s.area.z1; z++) for (let x = s.area.x0; x <= s.area.x1; x++) if (L.inBounds(x, z)) out.push(z * W + x); }
  else {
    const tx = cellOf(s.at.x), tz = cellOf(s.at.z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (L.inBounds(tx + dx, tz + dz)) out.push((tz + dz) * W + tx + dx);
  }
  return out.filter((c) => walkable(c, open));
}
/** Shortest path (cell list) from `from` to any of `to`. */
function path(from: number, to: number[], open: number): number[] {
  if (!to.length) return [];
  const d = L.distanceField(to, open), W = L.W, out = [from];
  let c = from;
  if (d[c] >= 32767) return [];
  while (d[c] > 0 && out.length < 5000) {
    const x = c % W, z = (c / W) | 0;
    let best = c;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!L.inBounds(x + dx, z + dz)) continue;
      const n = (z + dz) * W + x + dx;
      if (d[n] < d[best]) best = n;
    }
    if (best === c) break;
    c = best; out.push(c);
  }
  return out;
}
function computeRoutes(): void {
  const def = L.def, W = L.W;
  routes = [];
  let pos = cellOf(def.spawns[0].z) * W + cellOf(def.spawns[0].x);
  def.steps.forEach((s, i) => {
    const open = L.doorsAfter(i);
    let r: number[] = [];
    if (s.kind === 'collect') {
      const items = def.pickups.filter((p) => p.kind === 'item' && p.group === s.group).map((p) => cellOf(p.z) * W + cellOf(p.x));
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
  if (LAYERS.heat) for (let i = 0; i < W * H; i++) if (progress[i] < 32767) maxP = Math.max(maxP, progress[i]);
  // Tiles: one pixel per tile in an offscreen bitmap, scaled up without smoothing (no seams).
  const key = `${chIndex}|${LAYERS.heat}`;
  if (tileKey !== key) {
    tileKey = key;
    tileCv.width = W; tileCv.height = H;
    const tg = tileCv.getContext('2d')!;
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = z * W + x, f = def.floor[i];
      if (f === F.NONE) tg.fillStyle = WALL_COL[def.wallKind[i]] ?? '#2a2140';
      else if (LAYERS.heat && progress[i] < 32767 && f !== F.WATER) tg.fillStyle = `hsl(${240 - (progress[i] / maxP) * 240} 70% 55%)`;
      else tg.fillStyle = FLOOR_COL[f] ?? '#888';
      tg.fillRect(x, z, 1, 1);
    }
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
  // Doors
  for (const d of def.doors) {
    const isOpen = !!(open & (1 << d.id));
    g.fillStyle = isOpen ? 'rgba(125,220,106,0.55)' : d.kind === 'barricade' ? '#8a5a35' : d.kind === 'fence' ? '#6f7390' : '#ffd43b';
    g.fillRect(d.x0, d.z0, d.x1 - d.x0 + 1, d.z1 - d.z0 + 1);
    g.strokeStyle = '#000'; g.lineWidth = 2 * px; g.strokeRect(d.x0, d.z0, d.x1 - d.x0 + 1, d.z1 - d.z0 + 1);
    if (scale >= 4) { g.fillStyle = '#000'; g.font = `bold ${Math.max(0.6, 11 * px)}px sans-serif`; g.fillText(`D${d.id}`, d.x0 + 0.1, d.z0 + 0.75); }
  }
  // Paint: labels + arrows
  if (LAYERS.paint) {
    for (const a of def.arrows) {
      g.save(); g.translate(a.x, a.z); g.rotate(a.rot);
      g.fillStyle = 'rgba(255,231,163,0.9)'; g.beginPath(); g.moveTo(0, 0.8); g.lineTo(-0.55, 0.05); g.lineTo(-0.22, 0.05); g.lineTo(-0.22, -0.75); g.lineTo(0.22, -0.75); g.lineTo(0.22, 0.05); g.lineTo(0.55, 0.05); g.closePath(); g.fill();
      g.restore();
    }
    for (const l of def.labels) {
      g.save(); g.translate(l.x, l.z);
      g.font = `900 ${l.size / 40}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 0.15; g.strokeStyle = '#1a1226'; g.strokeText(l.text, 0, 0); g.fillStyle = l.color; g.fillText(l.text, 0, 0);
      g.restore();
    }
  }
  // Props
  if (LAYERS.props) for (const p of def.props) {
    const obj = ['gen', 'radio', 'lever', 'terminal', 'valve', 'battery', 'beacon'].includes(p.type);
    g.fillStyle = obj ? '#ffd43b' : p.type === 'tree' || p.type === 'pine' || p.type === 'bush' ? '#2f7a45' : p.color !== undefined ? hex(p.color) : '#c8924e';
    g.globalAlpha = 0.9; g.fillRect(p.x + 0.08, p.z + 0.08, p.w - 0.16, p.d - 0.16); g.globalAlpha = 1;
    g.strokeStyle = '#1a1226'; g.lineWidth = 1.5 * px; g.strokeRect(p.x + 0.08, p.z + 0.08, p.w - 0.16, p.d - 0.16);
    if (scale >= 9) { g.fillStyle = '#1a1226'; g.font = `${8 * px}px sans-serif`; g.fillText(p.type, p.x + 0.15, p.z + 0.55, p.w - 0.2); }
  }
  if (LAYERS.lamps) { g.fillStyle = '#fff3b0'; for (const l of def.lamps) { g.beginPath(); g.arc(l.x / TILE, l.z / TILE, 0.22, 0, 7); g.fill(); } }
  // Pickups + notes
  const stepItems = sel >= 0 && def.steps[sel].kind === 'collect' ? def.steps[sel].group : null;
  for (const p of def.pickups) {
    if (p.kind === 'item' ? !LAYERS.items : p.kind === 'obj' ? !LAYERS.quest : !LAYERS.loot) continue;
    const x = p.x / TILE, z = p.z / TILE, dim = p.kind === 'item' && stepItems && p.group !== stepItems;
    g.globalAlpha = dim ? 0.35 : 1;
    g.fillStyle = PICK_COL[p.kind]; g.beginPath(); g.arc(x, z, 0.36, 0, 7); g.fill();
    g.strokeStyle = '#1a1226'; g.lineWidth = 1.5 * px; g.stroke();
    g.fillStyle = '#1a1226'; g.font = `bold 0.5px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(PICK_LETTER[p.kind], x, z + 0.02);
    g.globalAlpha = 1;
  }
  for (const n of def.notes) {
    const x = n.x / TILE, z = n.z / TILE;
    g.fillStyle = '#fff6e0'; g.fillRect(x - 0.3, z - 0.36, 0.6, 0.72); g.strokeStyle = '#1a1226'; g.lineWidth = 1.5 * px; g.strokeRect(x - 0.3, z - 0.36, 0.6, 0.72);
    g.fillStyle = '#1a1226'; g.font = 'bold 0.45px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('✎', x, z);
  }
  // Spawns
  g.fillStyle = '#39c5bb';
  for (const s of def.spawns) { g.beginPath(); g.arc(s.x / TILE, s.z / TILE, 0.25, 0, 7); g.fill(); }
  for (const pts of Object.values(def.checkpointSpawns)) for (const s of pts) { g.beginPath(); g.arc(s.x / TILE, s.z / TILE, 0.18, 0, 7); g.fill(); }
  // Route
  if (LAYERS.route) routes.forEach((r, i) => {
    if (r.length < 2) return;
    const on = sel < 0 || i === sel;
    g.strokeStyle = on ? (sel < 0 ? 'rgba(255,212,59,0.75)' : '#ffd43b') : 'rgba(255,255,255,0.13)';
    g.lineWidth = (on && sel >= 0 ? 4 : 2) * px; g.setLineDash(on && sel >= 0 ? [] : [6 * px, 4 * px]);
    g.beginPath();
    r.forEach((c, k) => { const x = (c % W) + 0.5, z = ((c / W) | 0) + 0.5; if (k) g.lineTo(x, z); else g.moveTo(x, z); });
    g.stroke(); g.setLineDash([]);
  });
  // Quest areas + markers
  if (LAYERS.quest) def.steps.forEach((s, i) => {
    const on = sel < 0 || i === sel, col = KIND_COL[s.kind];
    g.globalAlpha = on ? 1 : 0.35;
    if (s.area) {
      const a = s.area;
      g.fillStyle = col + '30'; g.fillRect(a.x0, a.z0, a.x1 - a.x0 + 1, a.z1 - a.z0 + 1);
      g.strokeStyle = col; g.lineWidth = 2 * px; g.setLineDash([5 * px, 3 * px]); g.strokeRect(a.x0, a.z0, a.x1 - a.x0 + 1, a.z1 - a.z0 + 1); g.setLineDash([]);
    }
    const x = s.at.x / TILE, z = s.at.z / TILE, r = Math.max(0.55, 9 * px);
    g.fillStyle = col; g.beginPath(); g.arc(x, z, r, 0, 7); g.fill();
    g.strokeStyle = s.checkpoint ? '#ffffff' : '#1a1226'; g.lineWidth = (s.checkpoint ? 3 : 1.5) * px; g.stroke();
    g.fillStyle = '#1a1226'; g.font = `bold ${r * 1.1}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, z + r * 0.05);
    g.globalAlpha = 1;
  });
  g.textAlign = 'start'; g.textBaseline = 'alphabetic';
}

// --------------------------------------------------------------------- side
function renderSide(): void {
  const def = L.def, s = report.stats;
  const radio = (st: Step) => st.radio.map(([who, line]) => `<div><b>${esc(who)}:</b> ${esc(line)}</div>`).join('');
  const flags = (st: Step) => [st.checkpoint && '✔ checkpoint', st.horde && 'horde', st.brute && 'BRUTE', st.hold && `hold ${st.hold}s`, st.opens.length && `opens D${st.opens.join(', D')}`].filter(Boolean).join(' · ');
  $('side').innerHTML = `
    <h2>${chIndex + 1}. ${esc(def.title)}</h2><div class="sub">${esc(def.subtitle)}</div>
    <div class="intro">${esc(def.intro)}</div>
    <h3>Stats</h3>
    <div class="stats">
      <b>Size</b><span>${s.size} tiles (${L.W * TILE}×${L.H * TILE} m), ${s.walkable} walkable</span>
      <b>Critical path</b><span>${s.pathMetres} m</span>
      <b>Holdouts</b><span>${s.holdSeconds} s</span>
      <b>Est. play time</b><span><b style="color:${s.estMinutes[1] >= 30 && s.estMinutes[0] <= 60 ? 'var(--green)' : 'var(--pink)'}">${s.estMinutes[0]}–${s.estMinutes[1]} min</b> (target 30–60)</span>
      <b>Steps</b><span>${def.steps.length} · ${s.checkpoints} checkpoints · ${s.doors} doors</span>
      <b>Pickups</b><span>${Object.entries(s.pickups).map(([k, v]) => `${k} ${v}`).join(', ')}</span>
      <b>Props / lamps</b><span>${def.props.length} / ${def.lamps.length}</span>
      <b>Wanderers</b><span>${s.wanderers.regions} regions, ~${s.wanderers.budget} sleepers if all stocked${def.density.length ? ` · ${def.density.length} density override${def.density.length > 1 ? 's' : ''}` : ''} (layer: regions)</span>
    </div>
    <div class="issues">${report.errors.map((e) => `<div class="err">✖ ${esc(e)}</div>`).join('')}${report.warnings.map((e) => `<div class="warn">⚠ ${esc(e)}</div>`).join('')}${!report.errors.length && !report.warnings.length ? '<div style="color:var(--green)">✔ No issues</div>' : ''}</div>
    <h3>Quest (${def.steps.length} steps) — click to focus</h3>
    <ol>${def.steps.map((st, i) => `
      <li class="step ${i === sel ? 'sel' : ''}" data-i="${i}">
        <div class="hd"><span class="n">${i + 1}</span><span class="k" style="background:${KIND_COL[st.kind]};color:#1a1226">${st.kind}</span><span>${esc(st.objective)}${st.kind === 'collect' ? ` (${st.count})` : ''}</span><span class="m">${report.steps[i]?.pathTiles >= 0 ? report.steps[i].pathTiles * TILE + ' m' : '✖'}</span></div>
        <div class="flags">${flags(st)}</div>
        <div class="radio">${radio(st)}<a href="/?room=MAP${chIndex + 1}${i}&ch=${chIndex}&step=${i}&name=Tester" target="_blank">▶ play from this step (dev server)</a></div>
      </li>`).join('')}</ol>
    <h3>Lore notes (${def.notes.length})</h3>
    <div class="notes">${def.notes.map((n) => `<div><b>✎ ${esc(n.title)}</b> <span style="color:var(--dim)">@ ${cellOf(n.x)},${cellOf(n.z)}</span><br>${esc(n.text)}</div>`).join('')}</div>
    <h3>Theme</h3>
    <div>${[...def.theme.sky, def.theme.fog, ...def.theme.buildings].map((c) => `<span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${hex(c)};margin-right:3px"></span>`).join('')}</div>`;
  for (const li of $('side').querySelectorAll<HTMLElement>('li.step')) li.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).tagName === 'A') return;
    const i = Number(li.dataset.i);
    sel = sel === i ? -1 : i;
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
function load(i: number): void {
  chIndex = i;
  history.replaceState(null, '', `?ch=${i}`);
  L = getLevel(i);
  tileKey = '';
  report = validateChapter(L);
  progress = L.distanceField([L.def.startCell.z * L.W + L.def.startCell.x], ALL_OPEN);
  sel = -1;
  computeRoutes();
  buildRegions();
  $('tabs').innerHTML = CHAPTERS.map((c, k) => `<button class="${k === i ? 'on' : ''}" data-ch="${k}">${k + 1}. ${esc(c.title)}</button>`).join(' ');
  for (const b of $('tabs').querySelectorAll<HTMLButtonElement>('button')) b.onclick = () => load(Number(b.dataset.ch));
  renderSide(); fit();
}

$('layers').innerHTML = (Object.keys(LAYERS) as LayerKey[]).map((k) => `<label><input type="checkbox" data-l="${k}" ${LAYERS[k] ? 'checked' : ''}/>${k}</label>`).join(' ');
for (const inp of $('layers').querySelectorAll<HTMLInputElement>('input')) inp.onchange = () => { LAYERS[inp.dataset.l as LayerKey] = inp.checked; draw(); };
$('fit').onclick = fit;
$('legend').innerHTML = [
  ...Object.entries(KIND_COL).map(([k, c]) => `<span style="--c:${c}">${k} step</span>`),
  ...Object.entries({ medkit: '#ff6b8a', ammo: '#a9e34b', weapon: '#74c0fc', 'quest item': '#ff922b', 'closed door': '#ffd43b', 'open door': '#7ddc6a', spawn: '#39c5bb', note: '#fff6e0' }).map(([k, c]) => `<span style="--c:${c}">${k}</span>`),
].join('');

let drag: { x: number; y: number } | null = null;
cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.classList.add('drag'); });
addEventListener('mouseup', () => { drag = null; cv.classList.remove('drag'); });
cv.addEventListener('mousemove', (e) => {
  const r = cv.getBoundingClientRect();
  if (drag) { ox += e.clientX - drag.x; oy += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; draw(); }
  const tx = Math.floor((e.clientX - r.left - ox) / scale), tz = Math.floor((e.clientY - r.top - oy) / scale);
  if (!L.inBounds(tx, tz)) { tip.style.display = 'none'; return; }
  const def = L.def, i = tz * L.W + tx;
  const lines = [`tile ${tx}, ${tz}   (${tx * TILE}–${tx * TILE + TILE} m, ${tz * TILE} m)`, `floor: ${FLOOR_NAMES[def.floor[i]]}${def.floor[i] === F.NONE ? ` (${['building', 'rock', 'hedge', 'fence'][def.wallKind[i]]} ${def.wallH[i].toFixed(1)} m)` : ''}`];
  if (progress[i] < 32767) lines.push(`progress from start: ${progress[i]} tiles`);
  const rid = regs.regionOf[i];
  if (rid >= 0) {
    const r = regs.list[rid];
    lines.push(`wander region R${rid}: ${r.cells.length} cells, ~${r.weight.toFixed(1)} sleepers${regs.mult[i] !== 1 ? `, density ×${regs.mult[i]}` : ''}`);
  }
  const prop = def.props.find((p) => tx >= p.x && tx < p.x + p.w && tz >= p.z && tz < p.z + p.d);
  if (prop) lines.push(`prop: ${prop.type} ${prop.w}x${prop.d}`);
  if (def.doorCell[i] >= 0) { const d = def.doors[def.doorCell[i]]; lines.push(`door D${d.id} (${d.kind})${d.label ? ' ' + d.label : ''}, opened by step ${def.steps.findIndex((s) => s.opens.includes(d.id)) + 1 || '—'}`); }
  for (const p of def.pickups) if (cellOf(p.x) === tx && cellOf(p.z) === tz) lines.push(`pickup #${p.id}: ${p.kind}${p.look ? ' ' + p.look : ''}${p.label ? ` "${p.label}"` : ''}${p.group ? ` [${p.group}]` : ''}`);
  for (const n of def.notes) if (cellOf(n.x) === tx && cellOf(n.z) === tz) lines.push(`note: ${n.title}`);
  def.steps.forEach((s, k) => { if (s.area && tx >= s.area.x0 && tx <= s.area.x1 && tz >= s.area.z0 && tz <= s.area.z1) lines.push(`step ${k + 1} area (${s.kind})`); });
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
