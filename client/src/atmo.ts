// Light and air: the baked world light map, per-theme light colours, the sky
// dome with its haze and skyline, additive glow sprites and weather particles.
import * as pc from 'playcanvas';
import { TILE, STOREY, PLAYER } from '../../shared/constants';
import { F, WALL, isIndoor, hash2 } from '../../shared/level';
import { type Geo, sphere, ring, make, merge } from './geo';
import { device, meshEntity, makeUnlit, makeGlow, rgb, setFog, setAtmosphere, setLightMap, setTime, type V3 } from './gfx';
import { type Ctx, newGeo, quad, mix3, mul, lampIndoor, storeyOfY } from './worldkit';

const T = TILE;
const LM = 4; // light map texels per tile
const SKY_K = 1.7; // sky dome scale: the skyline ring must sit beyond the far side of the biggest map
/** Chapters with rain. (The level data has no weather flag; the campaign brief does.) */
const RAINY: Record<string, boolean> = { ch1: true };

// --------------------------------------------------------------- light map
/**
 * One low-res top-down texture the toon shader samples by world XZ:
 * r = open sky (moonlight reaches), g = warm street lamps, b = cool ceiling
 * fixtures. Lamp light is ray-checked against walls, so it never leaks into
 * the next room, and every lamp on the map lights the scene at a fixed cost.
 */
function bakeLightMap(ctx: Ctx): pc.Texture {
  const { W, H, def } = ctx, { levels, WH, wall, look } = ctx.S, w = W * LM, h = H * LM, n = w * h;
  const px = T / LM, data = new Uint8Array(n * levels * 4);
  // Maps with storeys bake one layer per storey, side by side along u (the shader picks by height).
  const layers: { sky: Float32Array; warm: Float32Array; cool: Float32Array; open: Uint8Array; down: Uint8Array }[] = [];
  /** Something is built over this node (a floor slab or a wall), so the sky does not reach it. */
  const covered = (nd: number): boolean => { for (let u = nd + WH; u < WH * levels; u += WH) if (def.floor[u] !== F.NONE || wall[u]) return true; return false; };
  for (let lv = 0; lv < levels; lv++) {
    const sky = new Float32Array(n), warm = new Float32Array(n), cool = new Float32Array(n), open = new Uint8Array(n), down = new Uint8Array(n);
    /** 1 = floor, 2 = open air (lit from the storey below). */
    const kind = new Uint8Array(WH);
    layers.push({ sky, warm, cool, open, down });
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const nd = lv * WH + z * W + x, f = look[nd];
      if (wall[nd]) continue;
      const v = isIndoor(f) || (levels > 1 && covered(nd)) ? 0 : 1;
      kind[z * W + x] = f === F.NONE ? 2 : 1;
      for (let j = 0; j < LM; j++) for (let i = 0; i < LM; i++) { const k = (z * LM + j) * w + x * LM + i; sky[k] = v; open[k] = 1; }
    }
    const wallAt = (tx: number, tz: number) => ctx.isWall(tx, tz, lv);
    for (const l of def.lamps) {
      if (storeyOfY(l.y, levels) !== lv) continue;
      const indoor = lampIndoor(ctx, l), R = indoor ? 9.5 : 11, ch = indoor ? cool : warm;
      const lcx = Math.floor(l.x / T), lcz = Math.floor(l.z / T), los = !wallAt(lcx, lcz);
      const x0 = Math.max(0, Math.floor((l.x - R) / px)), x1 = Math.min(w - 1, Math.ceil((l.x + R) / px));
      const z0 = Math.max(0, Math.floor((l.z - R) / px)), z1 = Math.min(h - 1, Math.ceil((l.z + R) / px));
      for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
        const k = tz * w + tx;
        if (!open[k]) continue;
        const wx = (tx + 0.5) * px, wz = (tz + 0.5) * px, d = Math.hypot(wx - l.x, wz - l.z);
        if (d >= R) continue;
        if (los) {
          const steps = Math.ceil(d / (T * 0.4));
          let hit = false;
          for (let s = 1; s < steps && !hit; s++) { const q = s / steps; hit = wallAt(Math.floor((l.x + (wx - l.x) * q) / T), Math.floor((l.z + (wz - l.z) * q) / T)); }
          if (hit) continue;
        }
        const a = 1 - d / R;
        ch[k] = 1 - (1 - ch[k]) * (1 - a);
      }
    }
    // Open air takes the lamp light of the outdoor floor below it (a street lamp lights the whole facade
    // above it), and remembers how far down that floor is so the light fades with height as on a flat map.
    if (lv > 0) {
      const below = layers[lv - 1];
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
        if (kind[z * W + x] !== 2) continue;
        const nb = (lv - 1) * WH + z * W + x, lit = !wall[nb] && !isIndoor(look[nb]);
        for (let j = 0; j < LM; j++) for (let i = 0; i < LM; i++) {
          const k = (z * LM + j) * w + x * LM + i;
          warm[k] = lit ? below.warm[k] : 0; cool[k] = lit ? below.cool[k] : 0; down[k] = lit ? Math.min(3, below.down[k] + 1) : 0;
        }
      }
    }
    // Spread values into wall texels so bilinear sampling at a wall's foot does not pull in black.
    for (let pass = 0; pass < 3; pass++) {
      const set: number[] = [];
      for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
        const k = z * w + x;
        if (open[k]) continue;
        let c = 0, s = 0, a = 0, b = 0, dn = 0;
        if (x > 0 && open[k - 1]) { c++; s += sky[k - 1]; a += warm[k - 1]; b += cool[k - 1]; dn = Math.max(dn, down[k - 1]); }
        if (x < w - 1 && open[k + 1]) { c++; s += sky[k + 1]; a += warm[k + 1]; b += cool[k + 1]; dn = Math.max(dn, down[k + 1]); }
        if (z > 0 && open[k - w]) { c++; s += sky[k - w]; a += warm[k - w]; b += cool[k - w]; dn = Math.max(dn, down[k - w]); }
        if (z < h - 1 && open[k + w]) { c++; s += sky[k + w]; a += warm[k + w]; b += cool[k + w]; dn = Math.max(dn, down[k + w]); }
        if (c) { sky[k] = s / c; warm[k] = a / c; cool[k] = b / c; down[k] = dn; set.push(k); }
      }
      for (const k of set) open[k] = 1;
    }
    // Wall tops you can look down on (maps with storeys) are under the open sky.
    if (levels > 1) for (let k = 0; k < n; k++) if (!open[k]) sky[k] = 1;
    // 3x3 blur on the lamp channels softens the ray-check staircase before the shader bands it.
    const blur = (src: Float32Array, x: number, z: number) => {
      let s = 0, c = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const xx = x + i, zz = z + j; if (xx < 0 || zz < 0 || xx >= w || zz >= h) continue; const wt = i === 0 && j === 0 ? 2 : 1; s += src[zz * w + xx] * wt; c += wt; }
      return s / c;
    };
    const tw = w * levels;
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const k = z * w + x, o = (z * tw + lv * w + x) * 4;
      data[o] = Math.round(sky[k] * 255); data[o + 1] = Math.round(blur(warm, x, z) * 255); data[o + 2] = Math.round(blur(cool, x, z) * 255); data[o + 3] = 255 - down[k] * 85;
    }
  }
  return new pc.Texture(device, {
    width: w * levels, height: h, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE, levels: [data],
  });
}

// --------------------------------------------------------------------- sky
const disc = (dir: pc.Vec3, dist: number, size: number): Geo => {
  const n = dir.clone().normalize(), u = new pc.Vec3().cross(pc.Vec3.UP, n).normalize(), v = new pc.Vec3().cross(n, u);
  const g = make(ring(0, size, 28));
  for (let i = 0; i < g.pos.length; i += 3) {
    const x = g.pos[i], z = g.pos[i + 2];
    g.pos[i] = n.x * dist + u.x * x + v.x * z; g.pos[i + 1] = n.y * dist + u.y * x + v.y * z; g.pos[i + 2] = n.z * dist + u.z * x + v.z * z;
  }
  return g;
};

/** Distant silhouettes on a ring that follows the camera: towers in town, rolling hills in the country. */
function skyline(ctx: Ctx, near: V3, far: V3, lit: V3): Geo {
  const g = newGeo(), R = 250 * SKY_K, Y = SKY_K;
  let rural = 0, total = 0;
  for (let i = 0; i < ctx.W * ctx.H; i++) if (ctx.def.floor[i] === F.NONE) { total++; if (ctx.def.wallKind[i] === WALL.ROCK || ctx.def.wallKind[i] === WALL.HEDGE) rural++; }
  const hills = rural > total * 0.5;
  const at = (a: number, r: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
  const panel = (c: V3, a0: number, a1: number, r: number, y0: number, y1a: number, y1b = y1a) =>
    quad(g, c, null, [...at(a0, r, y0 * Y), ...at(a1, r, y0 * Y), ...at(a1, r, y1b * Y), ...at(a0, r, y1a * Y)]);
  const seed = ctx.W * 31 + ctx.H;
  // Far layer: a low wavy ridge (hills) in the lighter tone.
  const N = 120, ridge = (i: number, amp: number, base: number, s: number) =>
    base + amp * (0.5 + 0.5 * Math.sin(i * 0.21 + s)) + amp * 0.5 * (0.5 + 0.5 * Math.sin(i * 0.53 + s * 2.3)) + amp * 0.25 * Math.sin(i * 1.3 + s);
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    panel(far, a0, a1, R + 20, -30, ridge(i, hills ? 34 : 16, hills ? 16 : 10, seed), ridge((i + 1) % N, hills ? 34 : 16, hills ? 16 : 10, seed));
  }
  if (hills) {
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      panel(near, a0, a1, R, -30, ridge(i, 16, 6, seed + 9), ridge((i + 1) % N, 16, 6, seed + 9));
    }
    return g;
  }
  // Near layer: blocky towers with a few lit windows and the odd roof detail.
  const B = 150;
  for (let i = 0; i < B;) {
    const wdt = 1 + Math.floor(hash2(i + seed, 5) * 3), r1 = hash2(i + seed, 11), r2 = hash2(i + seed, 23);
    const a0 = (i / B) * Math.PI * 2, a1 = (Math.min(B, i + wdt) / B) * Math.PI * 2;
    const hgt = r1 < 0.12 ? 0 : 14 + r1 * r1 * 62;
    if (hgt) {
      panel(near, a0, a1, R, -30, hgt);
      if (r2 < 0.3) panel(near, a0 + (a1 - a0) * 0.3, a0 + (a1 - a0) * 0.7, R, hgt, hgt + 5); // rooftop block
      else if (r2 < 0.45) panel(near, a0 + (a1 - a0) * 0.48, a0 + (a1 - a0) * 0.52, R, hgt, hgt + 13); // antenna
      const cols = wdt * 2, rows = Math.floor(hgt / 7);
      for (let cy = 1; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        if (hash2(i * 13 + cx + seed, cy * 7) > 0.16) continue;
        const u0 = a0 + ((cx + 0.3) / cols) * (a1 - a0), u1 = a0 + ((cx + 0.7) / cols) * (a1 - a0);
        panel(lit, u0, u1, R - 2, cy * 7, cy * 7 + 3);
      }
    }
    i += wdt;
  }
  return g;
}

function buildSky(ctx: Ctx, fog: V3): pc.Entity {
  const night = ctx.night;
  const cols = ctx.theme.sky, sky = new pc.Entity('sky');
  const mat = ctx.mat(new pc.ShaderMaterial({
    uniqueName: 'Sky', attributes: { aPosition: pc.SEMANTIC_POSITION },
    vertexGLSL: /* glsl */ `attribute vec3 aPosition; uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; varying vec3 vDir;
      void main(void) { vDir = normalize(aPosition); gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0); }`,
    fragmentGLSL: /* glsl */ `varying vec3 vDir; uniform vec3 uHorizon; uniform vec3 uMid; uniform vec3 uTop; uniform vec3 uHaze;
      void main(void) {
        float h = clamp(normalize(vDir).y, -0.1, 1.0);
        // Hard bands keep the sky in the same cel language as everything else.
        float b = floor(smoothstep(-0.02, 0.75, h) * 7.0) / 7.0;
        vec3 c = b < 0.45 ? mix(uHorizon, uMid, b / 0.45) : mix(uMid, uTop, (b - 0.45) / 0.55);
        // The bottom of the sky is the fog colour, so fogged-out streets melt into it instead of ending in a dark edge.
        float hz = floor(clamp(h / 0.2, 0.0, 1.0) * 4.0) / 4.0;
        gl_FragColor = vec4(mix(uHaze, c, hz), 1.0);
      }`,
  }));
  mat.cull = pc.CULLFACE_NONE; mat.depthWrite = false;
  mat.setParameter('uHorizon', rgb(cols[0])); mat.setParameter('uMid', rgb(cols[1])); mat.setParameter('uTop', rgb(cols[2])); mat.setParameter('uHaze', fog);
  mat.update();
  const parts: pc.Entity[] = [];
  parts.push(meshEntity(ctx.mesh(make(sphere(24, 16), undefined, new pc.Mat4().setScale(300 * SKY_K, 300 * SKY_K, 300 * SKY_K))), mat));
  const h0 = rgb(cols[0]);
  parts.push(meshEntity(ctx.mesh(skyline(ctx, mul(mix3(fog, rgb(cols[1]), 0.25), 0.8), mix3(fog, h0, 0.22), mix3(mul(mix3(fog, rgb(cols[1]), 0.25), 0.8), mix3(rgb(0xffd98a), h0, 0.2), night))), ctx.mat(makeUnlit({ fog: false, cull: 'none' }))));

  const moonDir = new pc.Vec3(-90, 150, 230);
  const flatSky = (g: Geo, color: number, alpha = 1) => parts.push(meshEntity(ctx.mesh(g), ctx.mat(makeUnlit({ color, fog: false, cull: 'none', alpha, blend: 'normal' }))));
  flatSky(disc(moonDir, 288 * SKY_K, 31 * SKY_K), 0xffd9c2, 0.25 * night);
  flatSky(disc(moonDir, 285 * SKY_K, 22 * SKY_K), 0xfff6d6, 0.35 + 0.65 * night); // a pale day moon at dawn
  const stars: Geo[] = [];
  for (let i = 0; i < 260; i++) {
    const a = hash2(i, 7) * Math.PI * 2, e = 0.3 + hash2(i, 31) * 1.15;
    stars.push(disc(new pc.Vec3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)), 290 * SKY_K, (0.35 + hash2(i, 3) * 0.4) * SKY_K));
  }
  if (night > 0.05) flatSky(merge(stars), 0xfff6d6, night);
  for (const p of parts) { sky.addChild(p); for (const mi of p.render!.meshInstances) mi.cull = false; }
  return sky;
}

// ------------------------------------------------------------------- glows
export interface GlowSpot { x: number; y: number; z: number; size: number; color: number; k?: number }
function glowGeo(spots: GlowSpot[]): Geo {
  const g = newGeo();
  for (const s of spots) {
    const b = g.pos.length / 3, c = mul(rgb(s.color), s.k ?? 1);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.pos.push(s.x, s.y, s.z); g.nor.push(u, v, s.size); g.col.push(c[0], c[1], c[2]); }
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return g;
}

// ----------------------------------------------------------------- weather
const weatherVS = /* glsl */ `
  attribute vec3 aPosition; attribute vec3 aNormal;
  uniform mat4 matrix_view; uniform mat4 matrix_projection; uniform vec3 view_position;
  uniform vec3 uBox; uniform vec3 uVel; uniform vec3 uSize; uniform float uTime;
  uniform sampler2D uLightMap; uniform vec2 uLightScale; uniform vec3 uLightLv; uniform float uCover;
  varying float vFade; varying vec2 vQ;
  void main(void) {
    // Particles live in a box that wraps around the camera, so a few hundred cover the whole map.
    vec3 p = aPosition * uBox + uVel * uTime;
    p.xz += sin(uTime * 0.7 + aNormal.z * 6.283) * uSize.z;
    vec3 rel = mod(p - view_position, uBox) - 0.5 * uBox;
    vFade = (1.0 - smoothstep(0.32, 0.5, length(rel.xz) / uBox.x)) * smoothstep(0.7, 2.2, length(rel));
    vQ = aNormal.xy;
    // Rain (uCover = 1) only falls where the sky is open: the light map's red channel is "open sky" per
    // storey, so a drop under a slab, a skybridge or a roof fades out, wherever the camera stands.
    vec3 wp = view_position + rel;
    float lv = floor(max(wp.y, 0.0) / uLightLv.y);
    vec2 lp = wp.xz * uLightScale;
    lp.x = clamp(lp.x, uLightLv.z, 1.0 / uLightLv.x - uLightLv.z) + min(lv, uLightLv.x - 1.0) / uLightLv.x;
    float sky = max(step(uLightLv.x, lv), smoothstep(0.3, 0.6, texture2D(uLightMap, lp).r));
    vFade *= mix(1.0, sky, uCover);
    vec4 v = matrix_view * vec4(wp, 1.0);
    vec3 up = uSize.y > uSize.x * 2.0 ? normalize((matrix_view * vec4(uVel, 0.0)).xyz) : vec3(0.0, 1.0, 0.0);
    v.xyz += vec3(up.y, -up.x, 0.0) * aNormal.x * uSize.x + up * aNormal.y * uSize.y;
    gl_Position = matrix_projection * v;
  }`;
const weatherFS = /* glsl */ `
  varying float vFade; varying vec2 vQ; uniform vec3 uTint; uniform float uAlpha;
  void main(void) { gl_FragColor = vec4(uTint, uAlpha * vFade * (1.0 - smoothstep(0.55, 1.0, length(vQ)))); }`;

/** `cover`: 1 hides particles that are under something (rain); 0 leaves them alone (indoor dust). */
function particles(ctx: Ctx, count: number, box: V3, vel: V3, size: V3, color: number, cover = 0): pc.Entity {
  const g = newGeo();
  for (let i = 0; i < count; i++) {
    const b = g.pos.length / 3, x = hash2(i, 101), y = hash2(i, 211), z = hash2(i, 307), ph = hash2(i, 401);
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { g.pos.push(x, y, z); g.nor.push(u, v, ph); }
    g.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const m = ctx.mat(new pc.ShaderMaterial({ uniqueName: 'Weather', attributes: { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL }, vertexGLSL: weatherVS, fragmentGLSL: weatherFS }));
  m.setParameter('uBox', box); m.setParameter('uVel', vel); m.setParameter('uSize', size); m.setParameter('uTint', rgb(color)); m.setParameter('uAlpha', 0); m.setParameter('uCover', cover);
  m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.cull = pc.CULLFACE_NONE;
  m.update();
  const e = meshEntity(ctx.mesh(g), m);
  for (const mi of e.render!.meshInstances) mi.cull = false;
  return e;
}

// ------------------------------------------------------------------ public
export interface Atmo { update(t: number, dt: number, camX: number, camY: number, camZ: number): void; dispose(): void }

export function buildAtmosphere(ctx: Ctx, glows: GlowSpot[]): Atmo {
  const { theme } = ctx, fog = rgb(theme.fog), s0 = rgb(theme.sky[0]), s1 = rgb(theme.sky[1]);
  // Tint the hemisphere light with the sky and the bounce light with the fog, keeping overall brightness.
  const tint = (base: V3, c: V3, k: number): V3 => {
    const mx = Math.max(c[0], c[1], c[2], 0.001), m: V3 = [1 + (c[0] / mx - 1) * k, 1 + (c[1] / mx - 1) * k, 1 + (c[2] / mx - 1) * k], avg = (m[0] + m[1] + m[2]) / 3;
    return [(base[0] * m[0]) / avg, (base[1] * m[1]) / avg, (base[2] * m[2]) / avg];
  };
  setFog(theme.fog, theme.fogNear, theme.fogFar);
  const day = 1 - ctx.night, up = (c: V3, k: number): V3 => [c[0] * (1 + k * day), c[1] * (1 + k * day), c[2] * (1 + k * day)];
  setAtmosphere(up(tint([0.4, 0.34, 0.5], fog, 0.4), 0.15), up(tint([0.56, 0.58, 0.72], mix3(s1, s0, 0.35), 0.4), 0.12), up(tint([0.4, 0.34, 0.3], s0, 0.25), 0.45), tint([1, 1, 1], mix3(fog, s0, 0.5), 0.1), 0.25 + 0.75 * ctx.night);

  const light = bakeLightMap(ctx);
  ctx.textures.push(light);
  setLightMap(light, ctx.W * T, ctx.H * T, ctx.S.levels, STOREY);

  const sky = buildSky(ctx, fog);
  ctx.root.addChild(sky);
  if (glows.length) {
    const e = ctx.add(meshEntity(ctx.mesh(glowGeo(glows)), ctx.mat(makeGlow(0.55 * (0.2 + 0.8 * ctx.night)))));
    for (const mi of e.render!.meshInstances) mi.cull = false;
  }
  const rain = RAINY[ctx.def.id] ? ctx.add(particles(ctx, 700, [26, 16, 26], [1.2, -19, 0.6], [0.011, 0.3, 0], 0xcfc8ff, 1)) : null;
  const dust = ctx.add(particles(ctx, 110, [11, 5, 11], [0.04, 0.05, 0.03], [0.011, 0.011, 0.35], 0xfff3d6));
  let inside = 0;
  return {
    update(t, dt, camX, camY, camZ) {
      setTime(t);
      sky.setPosition(camX, camY, camZ);
      // The storey the camera's owner stands on decides indoors or out (rain stops, dust motes show).
      const f = ctx.S.levels > 1 ? ctx.S.look[ctx.L.nodeAt(camX, camY - PLAYER.eye, camZ)] : ctx.floorOf(Math.floor(camX / T), Math.floor(camZ / T));
      inside += ((isIndoor(f) ? 1 : 0) - inside) * Math.min(1, dt * 4);
      if (rain) { rain.enabled = inside < 0.98; rain.render!.meshInstances[0].setParameter('uAlpha', 0.34 * (1 - inside)); }
      dust.enabled = inside > 0.02;
      dust.render!.meshInstances[0].setParameter('uAlpha', 0.34 * inside);
    },
    dispose() { setLightMap(null); },
  };
}
