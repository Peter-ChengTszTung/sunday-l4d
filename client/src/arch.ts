// Architecture: wall faces (interior trim, exterior shopfronts, windows,
// cornices), door frames at floor changes, and ceilings. Built per chunk as
// three merged meshes (toon, flat/unlit, ink strokes) plus one ceiling mesh.
//
// Storeys: a wall column shows a face wherever the space beside it is open at that height, so each
// (cell, direction) yields a list of `Piece`s: one per storey band, with outdoor bands that have
// nothing between them joined into one tall facade. On a flat map that is exactly one piece per
// face, from the ground to the wall's top (or the ceiling indoors), as it always was. Maps with
// storeys also get the taller wall's face above a lower neighbour, flat roofs on wall tops that
// can be looked down on, and a roof over rooms with nothing built on them.
import { TILE, CEIL_H, STOREY } from '../../shared/constants';
import { F, WALL, isIndoor, hash2 } from '../../shared/level';
import { meshEntity, toonMat, ceilMat, flatMat, inkLineMat, canvasTexture, rgb, type V3 } from './gfx';
import { type Ctx, newGeo, beam, quad, sideQuad, aabb, mul, mix3, ROOF_T } from './worldkit';
import type { GlowSpot } from './atmo';

const T = TILE;
const SAFE_WALL = 0xe0884f;
const WALL_COLOR: Record<number, number[]> = { [WALL.ROCK]: [0x7d6f73, 0x8a7a72, 0x6f6578], [WALL.HEDGE]: [0x3f8f5a, 0x4a9a62, 0x37804f], [WALL.FENCE]: [0x8f93a8, 0x9a9db0] };
// Room wall colours by floor type; INTERIOR rooms borrow the chapter's building palette.
const ROOM_WALL: Record<number, number[]> = {
  [F.TILES]: [0xbfe3d6, 0xd9ece6, 0xa9d6cf, 0xcfe0ea],
  [F.WOOD]: [0xd9a877, 0xc98f6a, 0xe0b98a, 0xc7a07c],
  [F.SAFE]: [SAFE_WALL],
};
const CEILING: Record<number, number> = { [F.TILES]: 0xe6eef2, [F.WOOD]: 0xd8c4a4, [F.SAFE]: 0xf0dcb4, [F.INTERIOR]: 0xbcb8d4 };
/** Roofing felt: the flat roofs you can look down on. */
const ROOF_C = 0x4a4662;
const NEON = [0xff7ac8, 0x5ff0e0, 0xffd45e, 0x9d8cff, 0xff8a6a];
const SHOP_LIGHT = [0xffe2a0, 0xffc98a, 0xa8f0e8, 0xffb8dc];
const WINDOW_LIT = [0xffd98a, 0xff9e6d, 0xffe9b8];
const WINDOW_DARK = 0x2a2452;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WHITE: V3 = [1, 1, 1];
/** One visible stretch of a wall face: absolute y0..y1, and what it looks out on. */
interface Piece {
  y0: number; y1: number;
  /** Look of the open cell it faces (NONE: open air, or the top of a lower wall). */ nf: number;
  indoor: boolean;
  /** It stands on a floor (not hanging over air or a lower roof). */ ground: boolean;
  /** Its top is the top of the wall (a roofline), not the underside of something. */ roof: boolean;
  /** The wall's node at the piece's base. */ n: number;
}
const NO_PIECES: Piece[] = [];

/** A 2 m ceiling tile: four acoustic panels with a thin grid, drawn once and repeated. */
function ceilingTexture(): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    g.fillStyle = (i + j) % 2 ? '#f1eff6' : '#fbfaff'; g.fillRect(i * 64, j * 64, 64, 64);
    g.fillStyle = 'rgba(60,50,90,0.10)';
    for (let k = 0; k < 14; k++) g.fillRect(i * 64 + 5 + hash2(k + i * 31, j * 17 + 3) * 54, j * 64 + 5 + hash2(k * 7 + j, i * 5 + 11) * 54, 2, 2);
  }
  g.strokeStyle = 'rgba(40,30,70,0.26)'; g.lineWidth = 2;
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 128); g.moveTo(0, i * 64); g.lineTo(128, i * 64); g.stroke(); }
  return cv;
}

export function buildArchitecture(ctx: Ctx, glows: GlowSpot[]): void {
  const { def, W, H, theme, night } = ctx;
  const { levels, WH, wall, look, top: segTop, base: segBase } = ctx.S, N = WH * levels, multi = levels > 1;
  const inb = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;
  /** Wall (or off the map) at tile (x,z) of storey k. */
  const wallAt = (x: number, z: number, k: number) => !inb(x, z) || wall[k * WH + z * W + x] === 1;
  // The highest an eye gets (top storey, mid-jump): wall tops above this are never seen from above.
  const eyeMax = (levels - 1) * STOREY + 2.6;
  // Under a bright sky, lit glass and neon fall back towards unlit colours.
  const dim = (c: V3, k = 0.65): V3 => mix3(mix3(c, rgb(0x4a4470), k), c, night);

  // Rooms: connected indoor cells of one floor type share a wall colour.
  const room = new Int32Array(N).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < N; i++) {
    if (room[i] >= 0 || !isIndoor(look[i])) continue;
    room[i] = i; stack.push(i);
    const o = i - (i % WH);
    while (stack.length) {
      const c = stack.pop()! - o, cx = c % W, cz = (c / W) | 0;
      for (const [ox, oz] of DIRS) {
        const nx = cx + ox, nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const n = o + nz * W + nx;
        if (room[n] < 0 && look[n] === look[i]) { room[n] = i; stack.push(n); }
      }
    }
  }
  const interiorPalette = theme.buildings.map((c) => mix3(rgb(c), rgb(0xa9bccb), 0.55));
  /** Wall colour of the room node `n` is in. */
  const roomColor = (n: number): V3 => {
    const f = look[n], id = room[n], pal = ROOM_WALL[f];
    const k = hash2(id % 9973, (id / 9973) | 0);
    return pal ? rgb(pal[Math.floor(k * pal.length)]) : interiorPalette[Math.floor(k * interiorPalette.length)];
  };
  /** The visible stretches of the wall column at (x,z) on its side facing DIRS[di], bottom to top. */
  const pieceCache = new Map<number, Piece[]>();
  const pieces = (x: number, z: number, di: number): Piece[] => {
    if (!inb(x, z)) return NO_PIECES;
    const c = z * W + x, key = c * 4 + di;
    let out = pieceCache.get(key);
    if (out) return out;
    const bx = x + DIRS[di][0], bz = z + DIRS[di][1];
    if (!inb(bx, bz)) { pieceCache.set(key, NO_PIECES); return NO_PIECES; }
    out = [];
    const cb = bz * W + bx;
    for (let k = 0; k < levels; k++) {
      const nA = k * WH + c;
      if (!wall[nA]) continue;
      const yb = k * STOREY, aTop = k === levels - 1 ? segTop[nA] : Math.min(segTop[nA], yb + STOREY), nB = k * WH + cb;
      let p: Piece;
      if (wall[nB]) {
        // Wall against wall: only the taller one's face above the lower one's top (maps with storeys).
        if (!multi || segTop[nB] >= aTop - 0.05) continue;
        p = { y0: Math.max(segTop[nB], yb), y1: aTop, nf: F.NONE, indoor: false, ground: false, roof: false, n: nA };
      } else {
        const f = look[nB];
        if (isIndoor(f)) p = { y0: yb, y1: yb + CEIL_H, nf: f, indoor: true, ground: true, roof: false, n: nA };
        else if (aTop > yb) p = { y0: yb, y1: aTop, nf: f, indoor: false, ground: def.floor[nB] !== F.NONE, roof: false, n: nA };
        else continue;
      }
      // Open air straight above an outdoor stretch of the same wall: one tall facade.
      const last = out[out.length - 1];
      if (last && !last.indoor && !p.indoor && !p.ground && p.y0 === yb && Math.abs(last.y1 - yb) < 0.01 && segBase[last.n] === segBase[nA]) last.y1 = p.y1;
      else out.push(p);
    }
    for (const p of out) p.roof = p.y1 >= segTop[p.n] - 0.01;
    pieceCache.set(key, out);
    return out;
  };
  /** Height of the neighbouring face stretch that starts at the same level (0 = none): where runs end, edges get inked. */
  const sideHeight = (x: number, z: number, di: number, y0: number): number => {
    for (const p of pieces(x, z, di)) if (Math.abs(p.y0 - y0) < 0.01) return p.y1 - y0;
    return 0;
  };

  /** An indoor node (not a stair) whose ceiling is a roof: there is a storey above, and nothing of it stands here. */
  const roofed = (nd: number): boolean => {
    if (!multi || nd + WH >= N || !isIndoor(look[nd]) || def.ramp[nd] || wall[nd]) return false;
    const up = nd + WH;
    return def.floor[up] === F.NONE && !wall[up] && !isIndoor(look[up]);
  };

  const ceilTex = canvasTexture(ceilingTexture, true, true);
  ctx.textures.push(ceilTex);

  ctx.chunks((cx0, cz0, cx1, cz1) => {
    const walls = newGeo(), flat = newGeo(), ink = newGeo(), ceil = newGeo();
    for (let z = cz0; z < cz1; z++) for (let x = cx0; x < cx1; x++) {
      const c = z * W + x;
      let anyWall = false;
      for (let k = 0; k < levels; k++) {
        const nd = k * WH + c;
        if (wall[nd]) anyWall = true; else if (look[nd] !== F.NONE) openCell(x, z, k, nd);
      }
      if (!anyWall) continue;
      if (multi) roofTops(x, z);
      for (let di = 0; di < 4; di++) for (const piece of pieces(x, z, di)) {
        const [dx, dz] = DIRS[di];
        const yb = piece.y0, h = piece.y1 - yb, nf = piece.nf, kind = def.wallKind[piece.n], ground = piece.ground;
        const tx = -dz, tz = dx, n: V3 = [dx, 0, dz];
        const mx = (x + 0.5 + dx * 0.5) * T, mz = (z + 0.5 + dz * 0.5) * T;
        // Face-local frame: u along the wall (-1..1 m), y up from the stretch's base, o out of the wall.
        const P = (u: number, y: number, o: number) => [mx + tx * u + dx * o, yb + y, mz + tz * u + dz * o];
        const rect = (c: V3, u0: number, u1: number, y0: number, y1: number, o = 0, c2: V3 = c) => quad(walls, c, n, [...P(u1, y0, o), ...P(u0, y0, o), ...P(u0, y1, o), ...P(u1, y1, o)], c2);
        const lit = (c: V3, u0: number, u1: number, y0: number, y1: number, o = 0.03) => quad(flat, c, null, [...P(u1, y0, o), ...P(u0, y0, o), ...P(u0, y1, o), ...P(u1, y1, o)]);
        const lbox = (c: V3, u0: number, u1: number, y0: number, y1: number, o0: number, o1: number) => { const a = P(u0, y0, o0), b = P(u1, y1, o1); aabb(walls, c, a[0], a[1], a[2], b[0], b[1], b[2]); };
        const line = (u0: number, y0: number, u1: number, y1: number, o = 0.02, t = 0.016) => { const a = P(u0, y0, o), b = P(u1, y1, o); beam(ink, a[0], a[1], a[2], b[0], b[1], b[2], t); };
        const frame = (u0: number, u1: number, y0: number, y1: number, o = 0.035, t = 0.018) => { line(u0, y0, u1, y0, o, t); line(u1, y0, u1, y1, o, t); line(u1, y1, u0, y1, o, t); line(u0, y1, u0, y0, o, t); };
        const y0 = nf === F.WATER ? -0.4 : 0;
        const hL = sideHeight(x - tx, z - tz, di, yb), hR = sideHeight(x + tx, z + tz, di, yb);
        if (hL !== h) line(-1, y0, -1, h, 0, 0.022);
        if (hR !== h) line(1, y0, 1, h, 0, 0.022);
        line(-1, 0.02, 1, 0.02, 0, 0.022);

        if (piece.indoor) {
          // ---- interior: skirting, darker dado with panel seams, rail, wall, shadowed crown.
          const c = roomColor(Math.round(yb / STOREY) * WH + (z + dz) * W + x + dx), safe = nf === F.SAFE;
          const trim = safe ? rgb(0xfff1c9) : mix3(c, WHITE, 0.5), skirt = mul(mix3(c, rgb(0x2a2440), 0.6), 0.9);
          lbox(skirt, -1, 1, 0, 0.2, 0, 0.045);
          rect(mul(c, 0.66), -1, 1, 0.2, 1.1, 0, mul(c, 0.74));
          rect(trim, -1, 1, 1.1, 1.26);
          rect(mul(c, 0.9), -1, 1, 1.26, h - 0.4, 0, c);
          rect(mul(c, 0.7), -1, 1, h - 0.4, h);
          line(-1, 0.2, 1, 0.2, 0.05, 0.012); line(-1, 1.1, 1, 1.1, 0.012, 0.01); line(-1, 1.26, 1, 1.26, 0.012, 0.01);
          line(-1, h - 0.4, 1, h - 0.4, 0.012, 0.01); line(-1, h, 1, h, 0, 0.022);
          line(-1, 0.2, -1, 1.1, 0.012, 0.009);
          if (nf === F.TILES) line(-1, 1.26, -1, h - 0.4, 0.012, 0.006); // tiled wards: seams run full height
          continue;
        }

        const block = hash2(Math.floor(x / 3) + 91, Math.floor(z / 3) + 17);
        const outside = kind === WALL.BUILDING ? theme.buildings : WALL_COLOR[kind];
        const c = rgb(outside[Math.floor(block * outside.length)]);
        // Walls shade from dark at the ground to full colour at the top; a stretch that starts higher up picks the gradient up where it is.
        const shade0 = yb > 0 ? 0.72 + 0.28 * Math.min(1, yb / piece.y1) : 0.72;
        if (kind !== WALL.BUILDING) {
          rect(mul(c, shade0), -1, 1, y0, h, 0, c);
          line(-1, h, 1, h, 0, 0.022);
          if (kind === WALL.FENCE) {
            // Chain-link suggested with a few horizontal ink strokes and a post per tile.
            for (let y = 0.4; y < h - 0.2; y += 0.8) line(-1, y, 1, y, 0.03, 0.012);
            line(-1, 0, -1, h, 0.03, 0.03);
          } else if (kind === WALL.HEDGE) {
            rect(mul(c, 1.18), -1, 1, h - 0.5, h, 0.012);
            if (hash2(x * 3 + di, z * 7) < 0.5) rect(mul(c, 0.82), -0.7 + hash2(x, z + di) * 0.8, 0.1 + hash2(x + di, z) * 0.8, 0.5, 1.5 + hash2(z, x) * (h - 2.4), 0.012);
          } else {
            // Rock: two strata bands so cliffs are not a flat gradient.
            const s1 = h * (0.3 + hash2(Math.floor(x / 2), Math.floor(z / 2)) * 0.15), s2 = h * 0.68;
            rect(mul(c, 0.62), -1, 1, s1, s1 + 0.3, 0.012); rect(mul(c, 1.12), -1, 1, s2, s2 + 0.22, 0.012);
          }
          continue;
        }

        // ---- building exterior.
        const street = ground && (nf === F.ASPHALT || nf === F.SIDEWALK);
        const bx = Math.floor(x / 3), bz = Math.floor(z / 3), along = (x * Math.abs(tx) + z * Math.abs(tz)) % 3;
        const shopK = hash2(bx * 3 + di, bz * 5 + 7), shop = street && h >= 6.5 && shopK < 0.6;
        const accent = rgb(NEON[Math.floor(hash2(bx + 5, bz + di * 3) * NEON.length)]);
        if (ground) {
          rect(mul(c, 0.5), -1, 1, y0, 0.35);
          rect(mul(c, 0.72), -1, 1, 0.35, h, 0, c);
          line(-1, 0.35, 1, 0.35, 0.012, 0.01);
        } else rect(mul(c, shade0), -1, 1, 0, h, 0, c);
        if (!piece.roof) { /* the top meets a floor above: no roofline */ } else if (h >= 2.5) {
          // Cornice: a lighter lip along the roofline, mitred past the ends of the run.
          const top = mix3(c, WHITE, 0.3);
          lbox(top, hL !== h ? -1.14 : -1, hR !== h ? 1.14 : 1, h - 0.42, h, 0, 0.14);
          rect(mul(c, 0.6), -1, 1, h - 0.72, h - 0.6, 0.012);
          line(-1, h, 1, h, 0.14, 0.022); line(-1, h - 0.42, 1, h - 0.42, 0.14, 0.014);
        } else line(-1, h, 1, h, 0, 0.022);
        if (hR !== 0 && hash2(bx * 7 + 1, bz * 3 + di) < 0.55 && Math.floor((x + tx) / 3) + Math.floor((z + tz) / 3) !== bx + bz && h > 4) {
          lbox(mul(c, 0.42), 0.9, 1.0, 0, h - 0.42, 0, 0.1); // drainpipe where two buildings meet
        }

        let firstRow = 2.7;
        if (shop) {
          firstRow = 4.1;
          const glass = shopK < 0.42 ? dim(rgb(SHOP_LIGHT[Math.floor(hash2(bx, bz + di) * SHOP_LIGHT.length)])) : rgb(0x3a3466);
          if (along === 1 && hash2(bx + di, bz) < 0.5) {
            // Shop door with a lit transom.
            lit(rgb(0x241d3d), -0.55, 0.55, 0.05, 2.25); lit(glass, -0.55, 0.55, 2.3, 2.6);
            lit(mul(glass, 0.8), -0.4, 0.4, 1.1, 2.05, 0.04);
            frame(-0.55, 0.55, 0.05, 2.6); line(-0.55, 2.27, 0.55, 2.27, 0.035, 0.014);
          } else {
            lit(glass, -0.82, 0.82, 0.6, 2.5); lit(mul(glass, 0.82), -0.82, 0.82, 0.6, 0.95, 0.035);
            frame(-0.82, 0.82, 0.6, 2.5); line(0, 0.6, 0, 2.5, 0.035, 0.012);
            lbox(mix3(c, WHITE, 0.25), -0.9, 0.9, 0.5, 0.6, 0, 0.09);
            if (shopK < 0.42 && along === 0 && night > 0.3) glows.push({ x: P(0, 1.6, 0.3)[0], y: yb + 1.6, z: P(0, 1.6, 0.3)[2], size: 1.7, color: 0xffe2a0, k: 0.35 });
          }
          // Fascia band, then a striped awning on most shops.
          rect(mul(c, 0.45), -1, 1, 3.0, 3.55, 0.012);
          line(-1, 3.55, 1, 3.55, 0.02, 0.012);
          if (shopK < 0.45) {
            const out = 0.85, ya = 3.0, yb = 2.68, up: V3 = [dx * 0.35, 0.94, dz * 0.35];
            for (let sIdx = 0; sIdx < 2; sIdx++) {
              const u0 = sIdx - 1, u1 = sIdx, col = sIdx ? rgb(0xfff1e0) : accent;
              quad(walls, col, up, [...P(u1, yb, out), ...P(u0, yb, out), ...P(u0, ya, 0.02), ...P(u1, ya, 0.02)]);
              quad(walls, mul(col, 0.7), [0, -1, 0], [...P(u0, yb, out), ...P(u1, yb, out), ...P(u1, ya, 0.02), ...P(u0, ya, 0.02)]);
              rect(mul(col, 0.9), u0, u1, yb - 0.2, yb, out);
            }
            line(-1, yb - 0.2, 1, yb - 0.2, out, 0.016); line(-1, yb, 1, yb, out, 0.012);
            if (hL !== h || Math.floor((x - tx) / 3) + Math.floor((z - tz) / 3) !== bx + bz) line(-1, ya, -1, yb, out / 2, 0.012);
          }
          if (along === 1) {
            // Small neon sign: a few glowing "letter" bars on a dark board.
            const col = dim(rgb(NEON[Math.floor(hash2(bx * 3 + di, bz + 9) * NEON.length)]), 0.45);
            lit(rgb(0x1d1733), -0.78, 0.78, 3.08, 3.48, 0.05);
            for (let i = 0, u = -0.66; i < 5 && u < 0.6; i++) { const wd = 0.14 + hash2(bx + i, bz * 3 + di) * 0.2; lit(col, u, Math.min(0.68, u + wd), 3.15, 3.41, 0.07); u += wd + 0.07; }
            const gp = P(0, 3.28, 0.25);
            glows.push({ x: gp[0], y: gp[1], z: gp[2], size: 1.5, color: NEON[Math.floor(hash2(bx * 3 + di, bz + 9) * NEON.length)], k: 0.6 });
          }
        } else if (ground && h >= 4 && along === 1 && hash2(bx * 5 + di, bz * 3 + 1) < 0.35 && nf !== F.WATER) {
          // Plain back door with a little lamp-lit step.
          lit(rgb(0x2b2444), -0.5, 0.5, 0.05, 2.2); frame(-0.5, 0.5, 0.05, 2.2);
          lit(mul(accent, 0.9), 0.22, 0.34, 1.0, 1.12, 0.04);
          lbox(mul(c, 0.5), -0.65, 0.65, 0, 0.12, 0, 0.3);
          firstRow = 4.1;
        }

        // Above the ground, window rows keep to the building's own grid so neighbouring stretches line up.
        if (yb > 0) { let gy = 2.7 + 2.3 * Math.ceil((yb + 0.7 - 2.7) / 2.3) - yb; while (gy < firstRow - 0.01) gy += 2.3; firstRow = gy; }
        // Upper windows: one of three styles per building, a few of them lit.
        const style = Math.floor(hash2(bx + 31, bz + 57) * 3), wh = style === 2 ? 1.5 : 1.2;
        const sill = mix3(c, WHITE, 0.3);
        for (let y = firstRow, row = 0; y + wh < h - 0.75; y += 2.3, row++) {
          const panes = style === 1 ? [[-0.78, -0.12], [0.12, 0.78]] : style === 2 ? [[-0.4, 0.4]] : [[-0.52, 0.52]];
          for (let pi = 0; pi < panes.length; pi++) {
            const [u0, u1] = panes[pi];
            const on = hash2(x * 7 + di * 3 + row * 11 + pi * 5, z * 13 + row) < 0.2 * night;
            lit(rgb(on ? WINDOW_LIT[Math.floor(hash2(x + row, z + pi) * WINDOW_LIT.length)] : WINDOW_DARK), u0, u1, y, y + wh);
            if (!on) lit(rgb(0x3d3670), u0, u1, y + wh * 0.55, y + wh, 0.034); // a paler reflection band keeps dark panes from reading as holes
            frame(u0, u1, y, y + wh);
            if (style !== 1) line(u0, y + wh * 0.55, u1, y + wh * 0.55, 0.035, 0.01);
          }
          lbox(sill, panes[0][0] - 0.08, panes[panes.length - 1][1] + 0.08, y - 0.1, y, 0, 0.08);
          if (row > 0 && hash2(x * 5 + row, z * 3 + di) < 0.05) {
            lbox(rgb(0xc9c6d6), -0.4, 0.4, y - 0.62, y - 0.14, 0, 0.36); // AC unit
            lit(rgb(0x4a4666), -0.3, 0.3, y - 0.54, y - 0.22, 0.37);
          }
        }
      }
    }

    /** An open node: its ceiling (and, with storeys, the roof over that), and door frames towards +x / +z. */
    function openCell(x: number, z: number, k: number, nd: number): void {
      const f = look[nd], yb = k * STOREY, yc = yb + CEIL_H, ramp = def.ramp[nd] !== 0;
      const indoor = isIndoor(f);
      // Stairs and ladders have the hole above them instead of a ceiling.
      if (indoor && !ramp) {
        const c = mix3(rgb(CEILING[f] ?? 0xbcb8d4), rgb(theme.fog), f === F.INTERIOR ? 0.12 : 0.04);
        const b = ceil.pos.length / 3, x0 = x * T, x1 = x0 + T, z0 = z * T, z1 = z0 + T;
        ceil.pos.push(x0, yc, z0, x1, yc, z0, x1, yc, z1, x0, yc, z1);
        ceil.uv.push(x, z, x + 1, z, x + 1, z + 1, x, z + 1);
        for (let i = 0; i < 4; i++) { ceil.nor.push(0, -1, 0); ceil.col.push(c[0], c[1], c[2]); }
        ceil.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        // Structural beams: concrete every 4 tiles in plain interiors, timber every 3 in wooden rooms.
        if (f === F.INTERIOR && x % 4 === 0) aabb(walls, mul(c, 0.72), x0 - 0.16, yc - 0.3, z0, x0 + 0.16, yc, z1);
        if (f === F.WOOD && z % 3 === 0) aabb(walls, rgb(0x8a5f3f), x0, yc - 0.22, z0 - 0.1, x1, yc, z0 + 0.1);
        // A roof slab over rooms with nothing built on them, for whoever is a storey higher.
        if (roofed(nd)) {
          const yr = yc + ROOF_T, rc = rgb(ROOF_C);
          quad(walls, rc, [0, 1, 0], [x0, yr, z0, x0, yr, z1, x1, yr, z1, x1, yr, z0]);
          for (let di = 0; di < 4; di++) {
            const [dx, dz] = DIRS[di], ax = x + dx, az = z + dz;
            if (!inb(ax, az)) continue;
            const m = k * WH + az * W + ax;
            if (roofed(m) || (wall[m] && segTop[m] >= yr - 0.01)) continue;
            sideQuad(walls, mul(rc, 0.8), x, z, di, yc, yr);
          }
        }
      }
      if (def.floor[nd] === F.NONE || f === F.WATER || ramp) return;
      // Door frames and headers where the floor type changes (room thresholds, building entrances).
      for (const [ox, oz] of [[1, 0], [0, 1]]) {
        if (!inb(x + ox, z + oz)) continue;
        const md = nd + oz * W + ox, g = def.floor[md] === F.NONE || def.ramp[md] ? F.NONE : look[md];
        if (g === F.NONE || g === F.WATER || g === f || !(indoor || isIndoor(g))) continue;
        const entrance = indoor !== isIndoor(g);
        const ix = indoor ? x : x + ox, iz = indoor ? z : z + oz; // the indoor side
        const wallC = (() => { const ni = k * WH + iz * W + ix; return room[ni] >= 0 ? roomColor(ni) : rgb(0x8f8aa8); })();
        const col = entrance ? mix3(rgb(theme.buildings[Math.floor(hash2(Math.floor(ix / 3) + 91, Math.floor(iz / 3) + 17) * theme.buildings.length)]), WHITE, 0.2) : mul(mix3(wallC, WHITE, 0.25), 0.8);
        const ex = (x + ox) * T, ez = (z + oz) * T; // edge origin
        // An entrance's header stands proud of the ceiling line, unless a floor is laid over either side of it.
        const floored = multi && k + 1 < levels && (def.floor[nd + WH] !== F.NONE || def.floor[md + WH] !== F.NONE);
        const th = 0.15, ylo = yb + (entrance ? CEIL_H - 0.55 : CEIL_H - 0.4), yhi = yb + (entrance && !floored ? CEIL_H + 0.95 : CEIL_H);
        const a0 = ox ? z * T : x * T, a1 = a0 + T; // extent along the edge
        const bx0 = ox ? ex - th : a0, bx1 = ox ? ex + th : a1, bz0 = ox ? a0 : ez - th, bz1 = ox ? a1 : ez + th;
        aabb(walls, col, bx0, ylo, bz0, bx1, yhi, bz1);
        const e = th + 0.005;
        for (const s of [-e, e]) {
          if (ox) { beam(ink, ex + s, ylo, a0, ex + s, ylo, a1, 0.014); if (entrance) beam(ink, ex + s, yhi, a0, ex + s, yhi, a1, 0.02); }
          else { beam(ink, a0, ylo, ez + s, a1, ylo, ez + s, 0.014); if (entrance) beam(ink, a0, yhi, ez + s, a1, yhi, ez + s, 0.02); }
        }
        // Jambs where the opening ends at a wall.
        for (const side of [-1, 1]) {
          const sx = ox ? 0 : side, sz = ox ? side : 0;
          if (!(wallAt(x + sx, z + sz, k) || wallAt(x + ox + sx, z + oz + sz, k))) continue;
          const q = side < 0 ? a0 : a1, q0 = side < 0 ? q : q - 0.14, q1 = side < 0 ? q + 0.14 : q;
          if (ox) aabb(walls, col, ex - th, yb, q0, ex + th, ylo, q1); else aabb(walls, col, q0, yb, ez - th, q1, ylo, ez + th);
          const qi = side < 0 ? q1 + 0.005 : q0 - 0.005;
          for (const s of [-e, e]) { if (ox) beam(ink, ex + s, yb, qi, ex + s, ylo, qi, 0.014); else beam(ink, qi, yb, ez + s, qi, ylo, ez + s, 0.014); }
        }
      }
    }
    /** Flat roofs on the wall stacks of column (x,z) that end in open air low enough to be looked down on. */
    function roofTops(x: number, z: number): void {
      const c = z * W + x;
      for (let k = 0; k < levels; k++) {
        const nd = k * WH + c;
        if (!wall[nd] || (k + 1 < levels && wall[nd + WH] && segBase[nd + WH] === segBase[nd])) continue; // not the top of its stack
        const t = segTop[nd];
        if (t > eyeMax || (k + 1 < levels && !def.air[nd + WH] && t >= (k + 1) * STOREY - 0.01)) continue; // out of sight, or something stands on it
        const kind = def.wallKind[nd], x0 = x * T, z0 = z * T;
        const pal = kind === WALL.BUILDING ? theme.buildings : WALL_COLOR[kind];
        const col = rgb(pal[Math.floor(hash2(Math.floor(x / 3) + 91, Math.floor(z / 3) + 17) * pal.length)]);
        quad(walls, kind === WALL.BUILDING ? mix3(col, rgb(ROOF_C), 0.7) : mul(col, 1.08), [0, 1, 0], [x0, t, z0, x0, t, z0 + T, x0 + T, t, z0 + T, x0 + T, t, z0]);
      }
    }

    if (walls.idx.length) ctx.add(meshEntity(ctx.mesh(walls), toonMat));
    if (flat.idx.length) ctx.add(meshEntity(ctx.mesh(flat), flatMat));
    if (ink.idx.length) ctx.add(meshEntity(ctx.mesh(ink), inkLineMat));
    if (ceil.idx.length) { const e = ctx.add(meshEntity(ctx.mesh(ceil), ceilMat)); e.render!.meshInstances[0].setParameter('uTex', ceilTex); }
  });
}
