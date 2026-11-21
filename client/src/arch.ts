// Architecture: wall faces (interior trim, exterior shopfronts, windows,
// cornices), door frames at floor changes, and ceilings. Built per chunk as
// three merged meshes (toon, flat/unlit, ink strokes) plus one ceiling mesh.
import { TILE, CEIL_H } from '../../shared/constants';
import { F, WALL, isIndoor, hash2 } from '../../shared/level';
import { meshEntity, toonMat, ceilMat, flatMat, inkLineMat, canvasTexture, rgb, type V3 } from './gfx';
import { type Ctx, newGeo, beam, quad, aabb, mul, mix3 } from './worldkit';
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
const NEON = [0xff7ac8, 0x5ff0e0, 0xffd45e, 0x9d8cff, 0xff8a6a];
const SHOP_LIGHT = [0xffe2a0, 0xffc98a, 0xa8f0e8, 0xffb8dc];
const WINDOW_LIT = [0xffd98a, 0xff9e6d, 0xffe9b8];
const WINDOW_DARK = 0x2a2452;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const WHITE: V3 = [1, 1, 1];

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
  const { def, W, H, theme, floorOf, isWall, night } = ctx;
  // Under a bright sky, lit glass and neon fall back towards unlit colours.
  const dim = (c: V3, k = 0.65): V3 => mix3(mix3(c, rgb(0x4a4470), k), c, night);

  // Rooms: connected indoor cells of one floor type share a wall colour.
  const room = new Int32Array(W * H).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (room[i] >= 0 || !isIndoor(def.floor[i])) continue;
    room[i] = i; stack.push(i);
    while (stack.length) {
      const c = stack.pop()!, cx = c % W, cz = (c / W) | 0;
      for (const [ox, oz] of DIRS) {
        const nx = cx + ox, nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const n = nz * W + nx;
        if (room[n] < 0 && def.floor[n] === def.floor[i]) { room[n] = i; stack.push(n); }
      }
    }
  }
  const interiorPalette = theme.buildings.map((c) => mix3(rgb(c), rgb(0xa9bccb), 0.55));
  const roomColor = (x: number, z: number): V3 => {
    const f = floorOf(x, z), id = room[z * W + x], pal = ROOM_WALL[f];
    const k = hash2(id % 9973, (id / 9973) | 0);
    return pal ? rgb(pal[Math.floor(k * pal.length)]) : interiorPalette[Math.floor(k * interiorPalette.length)];
  };
  const faceHeight = (x: number, z: number, dx: number, dz: number): number => {
    if (x < 0 || z < 0 || x >= W || z >= H || !isWall(x, z)) return 0;
    const nf = floorOf(x + dx, z + dz);
    if (nf === F.NONE) return 0;
    return isIndoor(nf) ? CEIL_H : def.wallH[z * W + x];
  };

  const ceilTex = canvasTexture(ceilingTexture(), true, true);
  ctx.textures.push(ceilTex);

  ctx.chunks((cx0, cz0, cx1, cz1) => {
    const walls = newGeo(), flat = newGeo(), ink = newGeo(), ceil = newGeo();
    for (let z = cz0; z < cz1; z++) for (let x = cx0; x < cx1; x++) {
      const here = floorOf(x, z);
      if (here !== F.NONE) { openCell(x, z, here); continue; }
      const kind = def.wallKind[z * W + x];
      for (let di = 0; di < 4; di++) {
        const [dx, dz] = DIRS[di];
        const h = faceHeight(x, z, dx, dz);
        if (!h) continue;
        const nf = floorOf(x + dx, z + dz);
        const tx = -dz, tz = dx, n: V3 = [dx, 0, dz];
        const mx = (x + 0.5 + dx * 0.5) * T, mz = (z + 0.5 + dz * 0.5) * T;
        // Face-local frame: u along the wall (-1..1 m), y up, o out of the wall.
        const P = (u: number, y: number, o: number) => [mx + tx * u + dx * o, y, mz + tz * u + dz * o];
        const rect = (c: V3, u0: number, u1: number, y0: number, y1: number, o = 0, c2: V3 = c) => quad(walls, c, n, [...P(u1, y0, o), ...P(u0, y0, o), ...P(u0, y1, o), ...P(u1, y1, o)], c2);
        const lit = (c: V3, u0: number, u1: number, y0: number, y1: number, o = 0.03) => quad(flat, c, null, [...P(u1, y0, o), ...P(u0, y0, o), ...P(u0, y1, o), ...P(u1, y1, o)]);
        const lbox = (c: V3, u0: number, u1: number, y0: number, y1: number, o0: number, o1: number) => { const a = P(u0, y0, o0), b = P(u1, y1, o1); aabb(walls, c, a[0], a[1], a[2], b[0], b[1], b[2]); };
        const line = (u0: number, y0: number, u1: number, y1: number, o = 0.02, t = 0.016) => { const a = P(u0, y0, o), b = P(u1, y1, o); beam(ink, a[0], a[1], a[2], b[0], b[1], b[2], t); };
        const frame = (u0: number, u1: number, y0: number, y1: number, o = 0.035, t = 0.018) => { line(u0, y0, u1, y0, o, t); line(u1, y0, u1, y1, o, t); line(u1, y1, u0, y1, o, t); line(u0, y1, u0, y0, o, t); };
        const y0 = nf === F.WATER ? -0.4 : 0;
        const hL = faceHeight(x - tx, z - tz, dx, dz), hR = faceHeight(x + tx, z + tz, dx, dz);
        if (hL !== h) line(-1, y0, -1, h, 0, 0.022);
        if (hR !== h) line(1, y0, 1, h, 0, 0.022);
        line(-1, 0.02, 1, 0.02, 0, 0.022);

        if (isIndoor(nf)) {
          // ---- interior: skirting, darker dado with panel seams, rail, wall, shadowed crown.
          const c = roomColor(x + dx, z + dz), safe = nf === F.SAFE;
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
        if (kind !== WALL.BUILDING) {
          rect(mul(c, 0.72), -1, 1, y0, h, 0, c);
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
        const street = nf === F.ASPHALT || nf === F.SIDEWALK;
        const bx = Math.floor(x / 3), bz = Math.floor(z / 3), along = (x * Math.abs(tx) + z * Math.abs(tz)) % 3;
        const shopK = hash2(bx * 3 + di, bz * 5 + 7), shop = street && h >= 6.5 && shopK < 0.6;
        const accent = rgb(NEON[Math.floor(hash2(bx + 5, bz + di * 3) * NEON.length)]);
        rect(mul(c, 0.5), -1, 1, y0, 0.35);
        rect(mul(c, 0.72), -1, 1, 0.35, h, 0, c);
        line(-1, 0.35, 1, 0.35, 0.012, 0.01);
        if (h >= 2.5) {
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
            if (shopK < 0.42 && along === 0 && night > 0.3) glows.push({ x: P(0, 1.6, 0.3)[0], y: 1.6, z: P(0, 1.6, 0.3)[2], size: 1.7, color: 0xffe2a0, k: 0.35 });
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
        } else if (h >= 4 && along === 1 && hash2(bx * 5 + di, bz * 3 + 1) < 0.35 && nf !== F.WATER) {
          // Plain back door with a little lamp-lit step.
          lit(rgb(0x2b2444), -0.5, 0.5, 0.05, 2.2); frame(-0.5, 0.5, 0.05, 2.2);
          lit(mul(accent, 0.9), 0.22, 0.34, 1.0, 1.12, 0.04);
          lbox(mul(c, 0.5), -0.65, 0.65, 0, 0.12, 0, 0.3);
          firstRow = 4.1;
        }

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

    function openCell(x: number, z: number, f: number): void {
      const indoor = isIndoor(f);
      if (indoor) {
        const c = mix3(rgb(CEILING[f] ?? 0xbcb8d4), rgb(theme.fog), f === F.INTERIOR ? 0.12 : 0.04);
        const b = ceil.pos.length / 3, x0 = x * T, x1 = x0 + T, z0 = z * T, z1 = z0 + T;
        ceil.pos.push(x0, CEIL_H, z0, x1, CEIL_H, z0, x1, CEIL_H, z1, x0, CEIL_H, z1);
        ceil.uv.push(x, z, x + 1, z, x + 1, z + 1, x, z + 1);
        for (let i = 0; i < 4; i++) { ceil.nor.push(0, -1, 0); ceil.col.push(c[0], c[1], c[2]); }
        ceil.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        // Structural beams: concrete every 4 tiles in plain interiors, timber every 3 in wooden rooms.
        if (f === F.INTERIOR && x % 4 === 0) aabb(walls, mul(c, 0.72), x0 - 0.16, CEIL_H - 0.3, z0, x0 + 0.16, CEIL_H, z1);
        if (f === F.WOOD && z % 3 === 0) aabb(walls, rgb(0x8a5f3f), x0, CEIL_H - 0.22, z0 - 0.1, x1, CEIL_H, z0 + 0.1);
      }
      if (f === F.WATER) return;
      // Door frames and headers where the floor type changes (room thresholds, building entrances).
      for (const [ox, oz] of [[1, 0], [0, 1]]) {
        const g = floorOf(x + ox, z + oz);
        if (g === F.NONE || g === F.WATER || g === f || !(indoor || isIndoor(g))) continue;
        const entrance = indoor !== isIndoor(g);
        const ix = indoor ? x : x + ox, iz = indoor ? z : z + oz; // the indoor side
        const wallC = (() => { const c = room[iz * W + ix] >= 0 ? rgbRoom(ix, iz) : rgb(0x8f8aa8); return c; })();
        const col = entrance ? mix3(rgb(theme.buildings[Math.floor(hash2(Math.floor(ix / 3) + 91, Math.floor(iz / 3) + 17) * theme.buildings.length)]), WHITE, 0.2) : mul(mix3(wallC, WHITE, 0.25), 0.8);
        const ex = (x + ox) * T, ez = (z + oz) * T; // edge origin
        const th = 0.15, ylo = entrance ? CEIL_H - 0.55 : CEIL_H - 0.4, yhi = entrance ? CEIL_H + 0.95 : CEIL_H;
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
          if (!(isWall(x + sx, z + sz) || isWall(x + ox + sx, z + oz + sz))) continue;
          const q = side < 0 ? a0 : a1, q0 = side < 0 ? q : q - 0.14, q1 = side < 0 ? q + 0.14 : q;
          if (ox) aabb(walls, col, ex - th, 0, q0, ex + th, ylo, q1); else aabb(walls, col, q0, 0, ez - th, q1, ylo, ez + th);
          const qi = side < 0 ? q1 + 0.005 : q0 - 0.005;
          for (const s of [-e, e]) { if (ox) beam(ink, ex + s, 0, qi, ex + s, ylo, qi, 0.014); else beam(ink, qi, 0, ez + s, qi, ylo, ez + s, 0.014); }
        }
      }
    }
    function rgbRoom(x: number, z: number): V3 { return roomColor(x, z); }

    if (walls.idx.length) ctx.add(meshEntity(ctx.mesh(walls), toonMat));
    if (flat.idx.length) ctx.add(meshEntity(ctx.mesh(flat), flatMat));
    if (ink.idx.length) ctx.add(meshEntity(ctx.mesh(ink), inkLineMat));
    if (ceil.idx.length) { const e = ctx.add(meshEntity(ctx.mesh(ceil), ceilMat)); e.render!.meshInstances[0].setParameter('uTex', ceilTex); }
  });
}
