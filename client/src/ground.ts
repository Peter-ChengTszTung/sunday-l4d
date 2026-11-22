// The ground: one painted texture per chunk (paving, grout, baked contact
// shadows, puddles, litter, floor signage), plus the geometry that sits on it:
// curbs, lane dashes, sunken animated water and its banks.
import * as pc from 'playcanvas';
import { TILE } from '../../shared/constants';
import { F, isIndoor, hash2, type PropType } from '../../shared/level';
import { type Geo } from './geo';
import { Batch, meshEntity, toonTexMat, canvasTexture, freeTexture, whiteTex, pixelAngle, rgb, type V3 } from './gfx';
import { type Ctx, CHUNK, newGeo, quad, aabb, mul, mix3, css } from './worldkit';
import { t } from './i18n';

const T = TILE;
const PX = 32; // ground texture pixels per tile (6 cm texels)
const WATER_Y = -0.24;
const FLOOR_BASE: Record<number, number> = {
  [F.ASPHALT]: 0x5a5d84, [F.SIDEWALK]: 0x9a97bd, [F.GRASS]: 0x5aae7a, [F.INTERIOR]: 0x9d8fa5, [F.SAFE]: 0xe6b67a,
  [F.DIRT]: 0xa47e5e, [F.CONCRETE]: 0x8b8a9c, [F.TILES]: 0xc9d3dc, [F.WOOD]: 0xb07f52, [F.WATER]: 0x3f78b8,
};
const ROUND: Partial<Record<PropType, number>> = { tree: 0.3, pine: 0.3, bush: 0.5, rock: 0.55, barrel: 0.5, fountain: 1, tank: 0.5, valve: 0.3, beacon: 0.35 };
const INKC = 'rgba(26,18,38,';
// Chunk textures are streamed: painted when a chunk comes within the fog distance plus LOAD metres of the
// camera, and freed once it is DROP metres beyond it (the gap is hysteresis, so pacing a boundary is free).
const LOAD = 12, DROP = 30;
// Slack on the camera-to-chunk distance: metres, and screen pixels (see `update`; half a pixel is the true bound).
const SLACK_M = 1, SLACK_PX = 0.75;

interface Chunk { mi: pc.MeshInstance; x0: number; z0: number; x1: number; z1: number; tex: pc.Texture | null; paint: () => HTMLCanvasElement }
export interface Ground {
  /** Loads / frees chunk textures around the camera. Call every frame before rendering. */
  update(camX: number, camY: number, camZ: number): void;
  dispose(): void;
}

const waterVS = /* glsl */ `
  attribute vec3 aPosition; attribute vec4 aColor;
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection;
  varying vec3 vW; varying float vShore;
  void main(void) { vec4 w = matrix_model * vec4(aPosition, 1.0); vW = w.xyz; vShore = aColor.r; gl_Position = matrix_viewProjection * w; }`;
const waterFS = /* glsl */ `
  varying vec3 vW; varying float vShore;
  uniform vec3 uTint; uniform vec3 uSkyTint; uniform vec3 uBandTint; uniform float uTime;
  uniform vec3 uAmbHi; uniform vec3 uSunCol; uniform vec3 uLampWarm; uniform vec3 uLampCool; uniform sampler2D uLightMap; uniform vec2 uLightScale;
  uniform vec3 uFogCol; uniform vec2 uFogRange; uniform vec3 view_position;
  void main(void) {
    vec2 p = vW.xz;
    // Three crossing swells, quantised into flat bands that drift.
    float w = sin(p.x * 0.9 + uTime * 0.7) + sin(p.y * 1.2 - uTime * 0.55) + sin((p.x + p.y) * 0.6 + uTime * 0.4);
    float b = floor((w / 6.0 + 0.5) * 4.0) / 3.0;
    vec3 c = mix(uTint * 0.72, uBandTint, clamp(b, 0.0, 1.0) * 0.55);
    // Thin glints riding a fourth, warped wave.
    float gl = sin(p.x * 2.3 - uTime * 0.9 + sin(p.y * 1.1 + uTime * 0.35) * 1.6) * sin(p.y * 0.7 + uTime * 0.2);
    c = mix(c, uSkyTint * 0.6 + 0.5, step(0.93, gl) * 0.75);
    // Foam line lapping at the banks.
    c = mix(c, vec3(0.86, 0.94, 0.97), step(0.8 + 0.09 * sin(uTime * 1.3 + (p.x + p.y) * 1.7), vShore) * 0.7);
    vec3 lm = texture2D(uLightMap, p * uLightScale).rgb;
    vec3 light = uAmbHi + uSunCol * 0.9 + uLampWarm * step(0.3, lm.g) * 1.2 + uLampCool * step(0.3, lm.b);
    c *= light;
    float f = clamp((distance(vW, view_position) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
    gl_FragColor = vec4(mix(c, uFogCol, f), 1.0);
  }`;

export function buildGround(ctx: Ctx, batchFor: (x: number, z: number) => Batch): Ground {
  const { def, W, H, theme, floorOf } = ctx;
  const floorBase = (f: number): V3 => rgb(theme.floors?.[f] ?? FLOOR_BASE[f] ?? 0x9d8fa5);
  const rainy = (theme.floors?.[F.ASPHALT] ?? 0x5a5d84) < 0x404060; // dark wet asphalt: more puddles
  let hasWater = false;
  for (let i = 0; i < def.floor.length && !hasWater; i++) hasWater = def.floor[i] === F.WATER;
  const skyTint = rgb(theme.sky[0]);

  const waterMat = ctx.mat(new pc.ShaderMaterial({ uniqueName: 'Water', attributes: { aPosition: pc.SEMANTIC_POSITION, aColor: pc.SEMANTIC_COLOR }, vertexGLSL: waterVS, fragmentGLSL: waterFS }));
  waterMat.setParameter('uTint', floorBase(F.WATER)); waterMat.setParameter('uSkyTint', skyTint); waterMat.setParameter('uBandTint', mix3(floorBase(F.WATER), mix3(rgb(theme.sky[1]), rgb(theme.fog), 0.5), 0.5));
  waterMat.update();

  /** Paints the ground of one chunk (tile rect). Deterministic, so a chunk can be repainted at any time. */
  const paintChunk = (cx0: number, cz0: number, cx1: number, cz1: number): HTMLCanvasElement => {
    const cw = cx1 - cx0, chh = cz1 - cz0;
    const cv = document.createElement('canvas');
    cv.width = cw * PX; cv.height = chh * PX;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#1a1730'; g.fillRect(0, 0, cv.width, cv.height);
    g.translate(-cx0 * PX, -cz0 * PX);
    const s = PX / 40; // signage strokes were authored for 40 px tiles
    const hl = (x0: number, y: number, x1: number) => g.fillRect(x0, y, x1 - x0, 1);
    const vl = (x: number, y0: number, y1: number) => g.fillRect(x, y0, 1, y1 - y0);
    // Draw a margin of neighbouring tiles too, so decals and shadows that straddle a chunk edge match up.
    for (let z = cz0 - 1; z <= cz1; z++) for (let x = cx0 - 1; x <= cx1; x++) {
      const f = floorOf(x, z);
      if (f === F.NONE) continue;
      const r = hash2(x, z), px = x * PX, pz = z * PX, base = floorBase(f);
      const flatTone = f === F.ASPHALT || f === F.GRASS || f === F.DIRT || f === F.WATER;
      g.fillStyle = css(mul(base, flatTone ? 0.985 + r * 0.03 : 0.96 + r * 0.08));
      g.fillRect(px, pz, PX, PX);
      const H2 = PX / 2, Q = PX / 4;
      if (f === F.SIDEWALK) {
        // Running-bond pavers, 1 m x 0.5 m, with hairline joints.
        for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) {
          const k = hash2(x * 2 + i + j * 31, z * 4 + j);
          if (k < 0.3) { g.fillStyle = css(mul(base, k < 0.15 ? 1.07 : 0.93)); g.fillRect(px + ((i * H2 + (j % 2) * Q) % PX), pz + j * 8, H2, 8); if ((j % 2) && i === 1) g.fillRect(px, pz + j * 8, Q, 8); }
        }
        g.fillStyle = INKC + '0.24)';
        for (let j = 0; j < 4; j++) { hl(px, pz + j * 8, px + PX); vl(px + (j % 2 ? Q : 0), pz + j * 8, pz + j * 8 + 8); vl(px + (j % 2 ? Q : 0) + H2, pz + j * 8, pz + j * 8 + 8); }
      } else if (f === F.TILES) {
        // 1 m tiles: pale grout, faint checker, the odd chipped one.
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          const k = hash2(x * 2 + i, z * 2 + j);
          g.fillStyle = css(mul(base, (x * 2 + i + z * 2 + j) % 2 ? 1.035 : 0.975)); g.fillRect(px + i * H2, pz + j * H2, H2, H2);
          if (k < 0.06) { g.fillStyle = css(mul(base, 0.86)); g.fillRect(px + i * H2 + 1, pz + j * H2 + 1, H2 - 1, H2 - 1); }
        }
        g.fillStyle = INKC + '0.2)'; hl(px, pz, px + PX); hl(px, pz + H2, px + PX); vl(px, pz, pz + PX); vl(px + H2, pz, pz + PX);
        g.fillStyle = 'rgba(255,255,255,0.3)'; hl(px + 1, pz + 1, px + PX); hl(px + 1, pz + H2 + 1, px + PX);
      } else if (f === F.GRASS) {
        g.fillStyle = css(mul(base, 0.96 + hash2(x >> 1, z >> 1) * 0.1)); g.fillRect(px, pz, PX, PX);
        for (let i = 0; i < 7; i++) {
          const a = hash2(x * 3 + i, z * 5 + i), b = hash2(x + i * 7, z * 2 + i);
          g.fillStyle = css(mul(base, i % 3 ? 1.22 : 0.8)); g.fillRect(px + a * (PX - 2), pz + b * (PX - 5), 1.5, 3 + (i % 3) * 1.5);
        }
        if (r < 0.1) { g.fillStyle = r < 0.05 ? '#fff1c9' : '#ffb3d1'; g.fillRect(px + r * 200, pz + 9 + r * 90, 2, 2); }
      } else if (f === F.DIRT) {
        for (let i = 0; i < 5; i++) {
          const a = hash2(x * 5 + i, z * 3 + i), b = hash2(x + i * 3, z * 7 + i);
          g.fillStyle = css(mul(base, i % 2 ? 0.82 : 1.12)); g.beginPath(); g.ellipse(px + a * PX, pz + b * PX, 1 + (i % 3), 1 + (i % 2), a * 6, 0, 7); g.fill();
        }
      } else if (f === F.WOOD) {
        // Four planks per tile with staggered butt joints.
        for (let j = 0; j < 4; j++) {
          const k = hash2(x * 3 + (j % 2), z * 4 + j);
          g.fillStyle = css(mul(base, 0.92 + hash2(x >> 1, z * 4 + j) * 0.16)); g.fillRect(px, pz + j * 8, PX, 8);
          g.fillStyle = INKC + '0.26)'; hl(px, pz + j * 8, px + PX);
          if ((x + j) % 2 === 0) vl(px + Math.floor(k * (PX - 2)), pz + j * 8, pz + j * 8 + 8);
          g.fillStyle = INKC + '0.08)'; hl(px + k * 10, pz + j * 8 + 4, px + k * 10 + 12);
        }
      } else if (f === F.INTERIOR) {
        // Lino: fine fleck and one seam per tile.
        for (let i = 0; i < 9; i++) { const a = hash2(x * 7 + i, z * 3 + i), b = hash2(x + i * 5, z * 11 + i); g.fillStyle = i % 2 ? 'rgba(255,255,255,0.10)' : INKC + '0.10)'; g.fillRect(px + a * (PX - 2), pz + b * (PX - 2), 2, 2); }
        g.fillStyle = INKC + '0.14)'; hl(px, pz, px + PX); vl(px, pz, pz + PX);
      } else if (f === F.CONCRETE) {
        for (let i = 0; i < 6; i++) { const a = hash2(x * 7 + i, z * 3 + i), b = hash2(x + i * 5, z * 11 + i); g.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : INKC + '0.10)'; g.fillRect(px + a * (PX - 2), pz + b * (PX - 2), 2, 1); }
        g.fillStyle = INKC + '0.22)'; if (z % 2 === 0) hl(px, pz, px + PX); if (x % 2 === 0) vl(px, pz, pz + PX);
        if (r < 0.1) { g.fillStyle = INKC + '0.10)'; g.beginPath(); g.ellipse(px + H2, pz + H2, 11 * s, 7 * s, r * 60, 0, 7); g.fill(); }
      } else if (f === F.SAFE) {
        g.fillStyle = INKC + '0.2)'; hl(px, pz, px + PX); hl(px, pz + H2, px + PX); vl(px + ((z % 2) ? Q : Q * 3), pz, pz + H2); vl(px + ((z % 2) ? Q * 3 : Q), pz + H2, pz + PX);
      } else if (f === F.ASPHALT) {
        for (let i = 0; i < 6; i++) { const a = hash2(x * 7 + i, z * 3 + i), b = hash2(x + i * 5, z * 11 + i); g.fillStyle = i % 2 ? 'rgba(255,255,255,0.07)' : INKC + '0.16)'; g.fillRect(px + a * (PX - 1), pz + b * (PX - 1), 1, 1); }
        if (r < 0.07) {
          g.strokeStyle = INKC + '0.4)'; g.lineWidth = 1; g.beginPath();
          g.moveTo(px + 5 * s, pz + 7 * s); g.lineTo(px + 17 * s, pz + 16 * s); g.lineTo(px + 13 * s, pz + 27 * s); g.lineTo(px + 24 * s, pz + 38 * s); g.moveTo(px + 17 * s, pz + 16 * s); g.lineTo(px + 30 * s, pz + 12 * s); g.stroke();
        } else if (r > 0.985) {
          // Manhole cover.
          g.fillStyle = INKC + '0.5)'; g.beginPath(); g.arc(px + H2, pz + H2, 8, 0, 7); g.fill();
          g.fillStyle = css(mul(base, 1.25)); g.beginPath(); g.arc(px + H2, pz + H2, 6.5, 0, 7); g.fill();
          g.fillStyle = INKC + '0.4)'; hl(px + H2 - 5, pz + H2 - 2, px + H2 + 5); hl(px + H2 - 5, pz + H2 + 2, px + H2 + 5);
        } else if (r > 0.93 && r < 0.95) { g.fillStyle = css(mul(base, 0.84)); g.fillRect(px + 4, pz + 6, 20, 14); } // tar patch
      } else if (f === F.WATER) {
        g.fillStyle = css(mul(base, 0.5)); g.fillRect(px, pz, PX, PX);
      }
    }
    // Baked contact shadow: two flat steps of darkening along walls (and water banks from the wet side).
    for (let z = cz0 - 1; z <= cz1; z++) for (let x = cx0 - 1; x <= cx1; x++) {
      const f = floorOf(x, z);
      if (f === F.NONE || f === F.WATER) continue;
      const px = x * PX, pz = z * PX, a = Math.round(PX * 0.11), b = Math.round(PX * 0.27);
      for (const [w, alpha] of [[b, 0.13], [a, 0.17]] as const) {
        g.fillStyle = `rgba(20,12,44,${alpha})`;
        const l = floorOf(x - 1, z) === F.NONE, rr = floorOf(x + 1, z) === F.NONE, u = floorOf(x, z - 1) === F.NONE, d = floorOf(x, z + 1) === F.NONE;
        if (l) g.fillRect(px, pz, w, PX);
        if (rr) g.fillRect(px + PX - w, pz, w, PX);
        if (u) g.fillRect(px + (l ? w : 0), pz, PX - (l ? w : 0) - (rr ? w : 0), w);
        if (d) g.fillRect(px + (l ? w : 0), pz + PX - w, PX - (l ? w : 0) - (rr ? w : 0), w);
        // Outer corners: a wall touching only diagonally still leaves a small shadow.
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          if (floorOf(x + ox, z + oz) !== F.NONE || floorOf(x + ox, z) === F.NONE || floorOf(x, z + oz) === F.NONE) continue;
          g.fillRect(ox < 0 ? px : px + PX - w, oz < 0 ? pz : pz + PX - w, w, w);
        }
      }
    }
    for (const p of def.props) {
      if (p.x + p.w < cx0 - 1 || p.z + p.d < cz0 - 1 || p.x > cx1 + 1 || p.z > cz1 + 1) continue;
      const round = ROUND[p.type];
      for (const [grow, alpha] of [[0.16, 0.12], [0.05, 0.18]] as const) {
        g.fillStyle = `rgba(20,12,44,${alpha})`;
        if (round !== undefined) { g.beginPath(); g.ellipse((p.x + p.w / 2) * PX, (p.z + p.d / 2) * PX, (p.w / 2 * round + grow + 0.1) * PX, (p.d / 2 * round + grow + 0.1) * PX, 0, 0, 7); g.fill(); }
        else {
          const inset = p.type === 'bench' || p.type === 'desk' || p.type === 'bed' ? 0.12 : 0.02;
          g.fillRect((p.x + inset - grow) * PX, (p.z + inset - grow) * PX, (p.w - inset * 2 + grow * 2) * PX, (p.d - inset * 2 + grow * 2) * PX);
        }
      }
    }
    // Decals: puddles, scattered paper, drain stains. Deterministic per tile.
    for (let z = cz0 - 1; z <= cz1; z++) for (let x = cx0 - 1; x <= cx1; x++) {
      const f = floorOf(x, z);
      if (f === F.NONE || f === F.WATER || def.propCell[z * W + x] || def.doorCell[z * W + x] >= 0) continue;
      const r = hash2(x * 13 + 5, z * 17 + 3), q = hash2(x * 3 + 11, z * 5 + 29), px = x * PX, pz = z * PX;
      const outdoor = !isIndoor(f);
      if (outdoor && (f === F.ASPHALT || f === F.CONCRETE || f === F.DIRT || f === F.SIDEWALK) && r < (rainy ? 0.07 : 0.03) * (f === F.SIDEWALK ? 0.25 : 1)) {
        // A shallow puddle: a thin dark rim, then flat bands of reflected sky getting lighter inwards, and a glint.
        const cx = px + PX * (0.35 + q * 0.3), cz = pz + PX * (0.35 + r * 4 % 0.3), rx = PX * (0.26 + q * 0.2), rz = PX * (0.16 + q * 0.1), rot = q * 6;
        const blob = (k: number) => { g.beginPath(); g.ellipse(cx, cz, rx * k, rz * k, rot, 0, 7); g.ellipse(cx + rx * 0.5, cz + rz * 0.45, rx * 0.55 * k, rz * 0.65 * k, rot + 1, 0, 7); g.fill(); };
        const wet = mix3(floorBase(f), skyTint, 0.3);
        g.fillStyle = 'rgba(14,10,40,0.3)'; blob(1.08);
        g.fillStyle = css(mul(wet, 1.0)); blob(1);
        g.fillStyle = css(mix3(wet, skyTint, 0.35)); blob(0.68);
        g.fillStyle = css(mix3(mix3(wet, skyTint, 0.6), [1, 1, 1], 0.2)); g.beginPath(); g.ellipse(cx - rx * 0.1, cz - rz * 0.1, rx * 0.34, rz * 0.3, rot, 0, 7); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1;
        g.beginPath(); g.ellipse(cx, cz, rx * 0.5, rz * 0.44, rot, 3.5, 4.6); g.stroke();
      } else if (f !== F.GRASS && f !== F.DIRT && q < (outdoor ? 0.035 : 0.022)) {
        // A dropped sheet of paper (or two).
        for (let i = 0; i < (r < 0.4 ? 2 : 1); i++) {
          g.save(); g.translate(px + PX * (0.25 + hash2(x + i, z * 3) * 0.5), pz + PX * (0.25 + hash2(x * 3, z + i) * 0.5)); g.rotate(r * 6 + i * 1.3);
          g.fillStyle = INKC + '0.55)'; g.fillRect(-3, -4, 6, 8); g.fillStyle = i ? '#f4ecd8' : '#fffaf0'; g.fillRect(-2.5, -3.5, 5, 7);
          g.fillStyle = INKC + '0.35)'; g.fillRect(-1.5, -2, 3, 0.7); g.fillRect(-1.5, 0, 3, 0.7);
          g.restore();
        }
      } else if (isIndoor(f) && f !== F.SAFE && r > 0.975) {
        g.fillStyle = INKC + '0.08)'; g.beginPath(); g.ellipse(px + PX / 2, pz + PX / 2, PX * 0.42, PX * 0.28, q * 6, 0, 7); g.fill(); // scuffed patch
      }
    }
    // Hazard stripes under every door.
    for (const d of def.doors) for (let z = d.z0; z <= d.z1; z++) for (let x = d.x0; x <= d.x1; x++) for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#1a1226' : '#ffd43b';
      g.fillRect(x * PX + (i * PX) / 4, z * PX, PX / 4, PX);
    }
    const glyph = (x: number, z: number, rot: number, draw: () => void) => { g.save(); g.translate(x * PX, z * PX); g.rotate(rot); g.scale(s, s); draw(); g.restore(); };
    // Arrow rot is a yaw (tip at (sin rot, cos rot), so PI/2 points +X); canvas rotation turns the other way.
    for (const a of def.arrows) glyph(a.x, a.z, -a.rot, () => {
      g.fillStyle = 'rgba(255,231,163,0.9)'; g.strokeStyle = '#1a1226'; g.lineWidth = 3; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(0, 32); g.lineTo(-22, 2); g.lineTo(-9, 2); g.lineTo(-9, -30); g.lineTo(9, -30); g.lineTo(9, 2); g.lineTo(22, 2); g.closePath();
      g.stroke(); g.fill();
    });
    for (const l of def.labels) glyph(l.x, l.z, l.rot, () => {
      const text = t(l.text);
      g.font = `900 ${l.size}px ui-rounded, "Arial Rounded MT Bold", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 5; g.strokeStyle = '#1a1226'; g.lineJoin = 'round'; g.strokeText(text, 0, 0); g.fillStyle = l.color; g.fillText(text, 0, 0);
    });
    return cv;
  };

  const chunks: Chunk[] = [];
  ctx.chunks((cx0, cz0, cx1, cz1) => {
    let any = false;
    for (let z = cz0; z < cz1 && !any; z++) for (let x = cx0; x < cx1; x++) if (floorOf(x, z) !== F.NONE) { any = true; break; }
    if (!any) return;
    const cw = cx1 - cx0, chh = cz1 - cz0;

    // Ground mesh. Maps with water use one quad per dry cell so the water can sit below the banks.
    const geo: Geo = newGeo(), water = newGeo();
    const x0 = cx0 * T, x1 = cx1 * T, z0 = cz0 * T, z1 = cz1 * T;
    if (!hasWater) {
      geo.pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x1, 0, z0); geo.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      geo.uv.push(0, 0, 0, 1, 1, 1, 1, 0); geo.idx.push(0, 1, 2, 0, 2, 3);
    } else {
      const shore = (x: number, z: number) => { // 1 when this grid corner touches dry land or a wall
        for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (floorOf(x + ox, z + oz) !== F.WATER) return 1;
        return 0;
      };
      for (let z = cz0; z < cz1; z++) for (let x = cx0; x < cx1; x++) {
        const f = floorOf(x, z);
        if (f === F.NONE) continue;
        const ax = x * T, az = z * T, bx = ax + T, bz = az + T;
        if (f === F.WATER) {
          const b = water.pos.length / 3;
          water.pos.push(ax, WATER_Y, az, ax, WATER_Y, bz, bx, WATER_Y, bz, bx, WATER_Y, az);
          for (const [cx, cz] of [[x, z], [x, z + 1], [x + 1, z + 1], [x + 1, z]]) { const k = shore(cx, cz); water.col.push(k, k, k); }
          water.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
          continue;
        }
        const b = geo.pos.length / 3, u0 = (x - cx0) / cw, u1 = (x + 1 - cx0) / cw, v0 = (z - cz0) / chh, v1 = (z + 1 - cz0) / chh;
        geo.pos.push(ax, 0, az, ax, 0, bz, bx, 0, bz, bx, 0, az); geo.nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        geo.uv.push(u0, v0, u0, v1, u1, v1, u1, v0); geo.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    if (geo.idx.length) {
      const mi = ctx.add(meshEntity(ctx.mesh(geo), toonTexMat)).render!.meshInstances[0];
      mi.setParameter('uTex', whiteTex);
      chunks.push({ mi, x0, z0, x1, z1, tex: null, paint: () => paintChunk(cx0, cz0, cx1, cz1) });
    }
    if (water.idx.length) ctx.add(meshEntity(ctx.mesh(water), waterMat));
  });

  // ------------------------------------------------- curbs, banks, lane dashes
  // Runs of edge cells are merged into long boxes; each goes to the prop batch of its chunk.
  const curbC = (f: number) => mul(mix3(floorBase(f), [1, 1, 1], 0.28), 1.02);
  const strip = (c: V3, xa: number, ya: number, za: number, xb: number, yb: number, zb: number, hull: boolean) => {
    const solid = newGeo(); aabb(solid, c, xa, ya, za, xb, yb, zb);
    let h: Geo | undefined;
    if (hull) { h = newGeo(); const t = 0.02; aabb(h, [1, 1, 1], Math.min(xa, xb) - t, ya === 0 ? 0.004 : ya, Math.min(za, zb) - t, Math.max(xa, xb) + t, yb + t, Math.max(za, zb) + t, true); }
    batchFor((xa + xb) / 2, (za + zb) / 2).raw(solid, h);
  };
  const CW = 0.2, CH = 0.11;
  /** kind of edge between cell `a` (this side) and `b` (other side): 1 = curb on a, 2 = bank on a, 0 = none */
  const edgeKind = (a: number, b: number) => (a === F.SIDEWALK && b === F.ASPHALT ? 1 : a !== F.WATER && a !== F.NONE && b === F.WATER ? 2 : 0);
  for (const horiz of [true, false]) {
    const N = horiz ? H : W, M = horiz ? W : H;
    for (let j = 0; j < N; j++) for (const side of [-1, 1]) {
      let start = -1, kind = 0;
      for (let i = 0; i <= M; i++) {
        const a = i < M ? (horiz ? floorOf(i, j) : floorOf(j, i)) : F.NONE, b = i < M ? (horiz ? floorOf(i, j + side) : floorOf(j + side, i)) : F.NONE;
        const k = i < M ? edgeKind(a, b) : 0, brk = i % CHUNK === 0;
        if (start >= 0 && (k !== kind || brk)) {
          const e = (side > 0 ? j + 1 : j) * T, lo = start * T, hi = i * T;
          if (kind === 1) {
            const n0 = side > 0 ? e - CW : e, n1 = side > 0 ? e : e + CW;
            if (horiz) strip(curbC(F.SIDEWALK), lo, 0, n0, hi, CH, n1, true); else strip(curbC(F.SIDEWALK), n0, 0, lo, n1, CH, hi, true);
          } else {
            // Bank: a stone lip on the dry side and a wall down to the water.
            const n0 = side > 0 ? e - 0.16 : e - 0.03, n1 = side > 0 ? e + 0.03 : e + 0.16, c: V3 = mul(rgb(0x8f8aa6), 0.9);
            if (horiz) strip(c, lo, WATER_Y - 0.1, n0, hi, 0.07, n1, true); else strip(c, n0, WATER_Y - 0.1, lo, n1, 0.07, hi, true);
          }
          start = -1;
        }
        if (k && start < 0) { start = i; kind = k; }
      }
    }
  }
  // Lane dashes down the middle of long, narrow asphalt runs.
  const run = (x: number, z: number, dx: number, dz: number) => { let n = 0; while (n < 40 && floorOf(x + dx * (n + 1), z + dz * (n + 1)) === F.ASPHALT) n++; return n; };
  const paint = rgb(0xe9e2c4);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (floorOf(x, z) !== F.ASPHALT) continue;
    const u = run(x, z, 0, -1), d = run(x, z, 0, 1), l = run(x, z, -1, 0), r = run(x, z, 1, 0), wV = u + d + 1, wH = l + r + 1;
    if (!(wH >= wV * 3 && x % 2 === 0) && !(wV >= wH * 3 && z % 2 === 0)) continue;
    const g = newGeo();
    if (wV >= 2 && wV <= 7 && wH >= wV * 3 && wH >= 10 && u === Math.floor(wV / 2) && x % 2 === 0 && l >= 1 && r >= 1) {
      const zc = (z - u + wV / 2) * T, xa = x * T + 0.2;
      quad(g, paint, [0, 1, 0], [xa, 0.014, zc - 0.07, xa, 0.014, zc + 0.07, xa + 1.6, 0.014, zc + 0.07, xa + 1.6, 0.014, zc - 0.07]);
    } else if (wH >= 2 && wH <= 7 && wV >= wH * 3 && wV >= 10 && l === Math.floor(wH / 2) && z % 2 === 0 && u >= 1 && d >= 1) {
      const xc = (x - l + wH / 2) * T, za = z * T + 0.2;
      quad(g, paint, [0, 1, 0], [xc - 0.07, 0.014, za, xc - 0.07, 0.014, za + 1.6, xc + 0.07, 0.014, za + 1.6, xc + 0.07, 0.014, za]);
    }
    if (g.idx.length) batchFor((x + 0.5) * T, (z + 0.5) * T).raw(g);
  }

  // A fragment at or beyond the fog distance comes out as flat fog colour whatever its texture holds, so
  // only the chunks around the camera need one. Anything that can show is painted at once (a chunk takes a
  // few milliseconds); chunks in the approach band are painted one per frame.
  const far = theme.fogFar;
  return {
    update(camX, camY, camZ) {
      // With MSAA, a pixel the chunk only partly covers is shaded at the pixel centre, which can lie just
      // off the chunk: on the ground up to half a pixel nearer the camera, and at a grazing angle a pixel
      // spans metres. So measure to where a ray SLACK_PX pixels below the chunk's nearest point lands.
      const h = Math.max(camY, 0.05), px = pixelAngle() * SLACK_PX;
      let spare = 1;
      for (const c of chunks) {
        const rho = Math.hypot(Math.max(c.x0 - camX, camX - c.x1, 0), Math.max(c.z0 - camZ, camZ - c.z1, 0)) - SLACK_M;
        const a = Math.atan2(h, Math.max(rho, 0)) + px;
        const d = rho <= 0 || a >= 1.5 ? 0 : Math.hypot(h / Math.tan(a), h);
        if (c.tex) {
          if (d > far + DROP) { freeTexture(c.tex); c.tex = null; c.mi.setParameter('uTex', whiteTex); }
        } else if (d < far || (d < far + LOAD && spare-- > 0)) {
          c.tex = canvasTexture(c.paint);
          c.mi.setParameter('uTex', c.tex);
        }
      }
    },
    dispose() {
      for (const c of chunks) if (c.tex) freeTexture(c.tex);
      chunks.length = 0;
    },
  };
}
