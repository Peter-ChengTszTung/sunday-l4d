// PlayCanvas application + the cel-shading material set. PlayCanvas has no
// built-in toon material, so lighting, banding, fog and ink are done in a few
// small custom shaders (GLSL, WebGL2). Colours are authored and lit in sRGB.
import * as pc from 'playcanvas';
import { type Geo, box, make, merge, inflateBox, inflateSmooth, toMesh, quatXYZ, unionHull, trimHulls, trs } from './geo';

export const INK = 0x1a1226;
const canvas = document.getElementById('game') as HTMLCanvasElement;
export const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: 'high-performance' } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
window.addEventListener('resize', () => app.resizeCanvas());
// Longest step any update sees (after a hitch or a background tab), so nothing tunnels or overshoots.
app.maxDeltaTime = 0.05;
export const device = app.graphicsDevice;

export const WORLD = app.scene.layers.getLayerByName('World')!.id;
const vmLayer = new pc.Layer({ name: 'Viewmodel' });
app.scene.layers.push(vmLayer);
/** Layer for the first-person weapon, drawn by its own camera over the world. */
export const VM = vmLayer.id;

/** The largest angle one screen pixel subtends for any active camera (radians). */
export function pixelAngle(): number {
  let a = 0;
  for (const c of app.systems.camera!.cameras) a = Math.max(a, (2 * Math.tan((c.fov * Math.PI) / 360)) / Math.max(1, device.height));
  return a;
}

export const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

// ------------------------------------------------------------------ shaders
const ATTR = { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL, aColor: pc.SEMANTIC_COLOR };
const ATTR_UV = { ...ATTR, aUv: pc.SEMANTIC_TEXCOORD0 };
const FOG = /* glsl */ `
  uniform vec3 uFogCol; uniform vec2 uFogRange; uniform float uFogOn; uniform vec3 view_position;
  vec3 fogged(vec3 c, vec3 w) { float f = clamp((distance(w, view_position) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0); return mix(c, uFogCol, f * uFogOn); }`;

// Rigid "part skinning" for characters merged into one mesh (see chibi.ts): the
// vertex colour alpha holds a part index, and uParts holds each part's affine
// transform as three row vec4s. Normals use the cofactor matrix (the inverse
// transpose up to scale), so squashed parts light exactly as separate entities did.
export const CHIBI_PARTS = 6;
const PARTS = /* glsl */ `
  uniform vec4 uParts[${CHIBI_PARTS * 3}];
  int partIndex() { return int(aColor.a * 255.0 + 0.5) * 3; }
  vec3 partPos(int i, vec3 p) { vec4 q = vec4(p, 1.0); return vec3(dot(uParts[i], q), dot(uParts[i + 1], q), dot(uParts[i + 2], q)); }
  vec3 partNormal(int i, vec3 n) {
    vec3 a = vec3(uParts[i].x, uParts[i + 1].x, uParts[i + 2].x), b = vec3(uParts[i].y, uParts[i + 1].y, uParts[i + 2].y), c = vec3(uParts[i].z, uParts[i + 1].z, uParts[i + 2].z);
    return cross(b, c) * n.x + cross(c, a) * n.y + cross(a, b) * n.z;
  }`;
// `ink`: vertices whose colour alpha is 0 are an ink hull baked into the same mesh (see toonInkMat).
const toonVS = (uv: boolean, parts = false, ink = false) => /* glsl */ `
  attribute vec3 aPosition; attribute vec3 aNormal; attribute vec4 aColor; ${uv ? 'attribute vec2 aUv; varying vec2 vUv;' : ''}
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; uniform mat3 matrix_normal;
  varying vec3 vN; varying vec3 vW; varying vec3 vC; ${ink ? 'varying float vInk;' : ''}
  ${parts ? PARTS : ''}
  void main(void) {
    ${parts ? 'int pi = partIndex(); vec3 p = partPos(pi, aPosition), nrm = partNormal(pi, aNormal);' : 'vec3 p = aPosition, nrm = aNormal;'}
    vec4 w = matrix_model * vec4(p, 1.0);
    vW = w.xyz; vN = normalize(matrix_normal * nrm); vC = aColor.rgb; ${uv ? 'vUv = aUv;' : ''} ${ink ? 'vInk = 1.0 - aColor.a;' : ''}
    gl_Position = matrix_viewProjection * w;
  }`;
const toonFS = (uv: boolean, ink = false) => /* glsl */ `
  varying vec3 vN; varying vec3 vW; varying vec3 vC; ${uv ? 'varying vec2 vUv; uniform sampler2D uTex;' : ''} ${ink ? 'varying float vInk; uniform vec3 uInk;' : ''}
  uniform vec3 uTint; uniform vec3 uSunDir; uniform vec3 uTorchPos; uniform vec3 uTorchDir; uniform float uTorchOn; uniform float uTorchUse;
  uniform vec3 uAmbLo; uniform vec3 uAmbHi; uniform vec3 uSunCol; uniform vec3 uGrade; uniform vec3 uLampWarm; uniform vec3 uLampCool;
  // World light map (see atmo.ts): r = open sky, g = warm street lamps, b = cool ceiling fixtures.
  // With storeys the map holds one copy per storey side by side along u (uLightLv: storeys, storey
  // height, half a texel in u); alpha says how many storeys down the lit floor is (1 = this one).
  uniform sampler2D uLightMap; uniform vec2 uLightScale; uniform vec3 uLightLv;
  uniform float uCeil; uniform vec3 uCeilLight;
  ${FOG}
  // Four hard steps: the whole "cel" look lives in this function.
  float band(float x) { return x < 0.25 ? 0.37 : x < 0.5 ? 0.65 : x < 0.75 ? 0.9 : 1.0; }
  // A step with a sliver of anti-aliasing, for light edges that cross big flat surfaces.
  float edge(float e, float w, float x) { return smoothstep(e - w, e + w, x); }
  float lampBand(float x) { return 0.26 * edge(0.07, 0.015, x) + 0.32 * edge(0.33, 0.015, x) + 0.42 * edge(0.62, 0.015, x); }
  void main(void) {
    ${ink ? 'if (vInk > 0.5) { gl_FragColor = vec4(fogged(vC * uInk, vW), 1.0); return; }' : ''}
    vec3 n = normalize(vN);
    vec3 base = vC * uTint${uv ? ' * texture2D(uTex, vUv).rgb' : ''};
    // A floor reads its own storey, a ceiling the storey it hangs over.
    float lv = min(floor(max(vW.y + n.y * 0.1 + 0.01, 0.0) / uLightLv.y), uLightLv.x - 1.0);
    vec2 lp = (vW.xz + n.xz * 0.3) * uLightScale;
    lp.x = clamp(lp.x, uLightLv.z, 1.0 / uLightLv.x - uLightLv.z) + lv / uLightLv.x;
    vec4 lt = texture2D(uLightMap, lp);
    vec3 lm = mix(vec3(1.0, 0.0, 0.0), lt.rgb, uTorchUse);
    // Height above the floor the lamps stand on (street lamps fade up a facade, whatever storey that is).
    float ly = vW.y - (lv - (1.0 - lt.a) * 3.0) * uLightLv.y;
    vec3 light = mix(uAmbLo, uAmbHi, n.y * 0.5 + 0.5);
    // Moonlight only reaches where the sky does; indoors it is a weak fill so shapes still read.
    light += uSunCol * band(dot(n, uSunDir) * 0.5 + 0.5) * mix(0.42, 1.0, lm.r);
    float facing = 0.8 + 0.2 * n.y;
    vec3 lamps = uLampWarm * lampBand(lm.g * (1.0 - smoothstep(3.4, 6.5, ly))) + uLampCool * lampBand(lm.b);
    lamps *= 1.0 - uCeil;
    light += lamps * facing;
    // Ceilings take one flat neutral light (no floor-style pools), plus a tight halo right at each fixture.
    light = mix(light, uCeilLight + uLampCool * 0.5 * edge(0.86, 0.025, lm.b), uCeil);
    // Flashlight: a tight cone of three flat rings with slightly softened edges.
    vec3 toFrag = vW - uTorchPos; float d = length(toFrag); toFrag /= max(d, 0.001);
    float cone = dot(toFrag, uTorchDir);
    float ringv = 0.2 * edge(0.930, 0.004, cone) + 0.32 * edge(0.957, 0.003, cone) + 0.48 * edge(0.978, 0.002, cone);
    float reach = 1.0 - 0.3 * smoothstep(8.0, 10.0, d) - 0.35 * smoothstep(16.0, 19.0, d) - 0.35 * smoothstep(25.0, 30.0, d);
    light += vec3(0.36, 0.33, 0.22) * ringv * reach * step(0.05, dot(n, -toFrag)) * uTorchOn * uTorchUse;
    // A little of the lamp colour is added outright so warm pools still show on dark, cool asphalt.
    vec3 c = (base * light + lamps * 0.09) * uGrade;
    // Soft shoulder instead of a hard clip, so pastel floors keep their hue under several lights.
    float m = max(c.r, max(c.g, c.b));
    c *= m > 0.92 ? (0.92 + (m - 0.92) * 0.3) / m : 1.0;
    gl_FragColor = vec4(fogged(c, vW), 1.0);
  }`;

const unlitVS = (uv: boolean) => /* glsl */ `
  attribute vec3 aPosition; attribute vec4 aColor; ${uv ? 'attribute vec2 aUv; varying vec2 vUv;' : ''}
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection;
  varying vec3 vW; varying vec3 vC;
  void main(void) { vec4 w = matrix_model * vec4(aPosition, 1.0); vW = w.xyz; vC = aColor.rgb; ${uv ? 'vUv = aUv;' : ''} gl_Position = matrix_viewProjection * w; }`;
const unlitFS = (uv: boolean) => /* glsl */ `
  varying vec3 vW; varying vec3 vC; ${uv ? 'varying vec2 vUv; uniform sampler2D uTex;' : ''}
  uniform vec3 uTint; uniform float uAlpha;
  ${FOG}
  void main(void) {
    ${uv ? 'vec4 t = texture2D(uTex, vUv); if (t.a < 0.02) discard;' : 'vec4 t = vec4(1.0);'}
    gl_FragColor = vec4(fogged(vC * uTint * t.rgb, vW), uAlpha * t.a);
  }`;

const outlineVS = (parts = false) => /* glsl */ `
  attribute vec3 aPosition; attribute vec3 aNormal; ${parts ? 'attribute vec4 aColor;' : ''}
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; uniform float uThickness;
  varying vec3 vW;
  ${parts ? PARTS : ''}
  void main(void) {
    vec3 p = aPosition + normalize(aNormal) * uThickness;
    ${parts ? 'p = partPos(partIndex(), p);' : ''}
    vec4 w = matrix_model * vec4(p, 1.0); vW = w.xyz; gl_Position = matrix_viewProjection * w;
  }`;
const outlineFS = /* glsl */ `
  varying vec3 vW; uniform vec3 uTint;
  ${FOG}
  void main(void) { gl_FragColor = vec4(fogged(uTint, vW), 1.0); }`;

// Camera-facing additive halo. aNormal = (corner.x, corner.y, radius in metres).
const glowVS = /* glsl */ `
  attribute vec3 aPosition; attribute vec3 aNormal; attribute vec4 aColor;
  uniform mat4 matrix_model; uniform mat4 matrix_view; uniform mat4 matrix_projection;
  varying vec2 vQ; varying vec3 vC; varying vec3 vW;
  void main(void) {
    vec4 w = matrix_model * vec4(aPosition, 1.0); vW = w.xyz;
    vec4 v = matrix_view * w; v.xy += aNormal.xy * aNormal.z;
    vQ = aNormal.xy; vC = aColor.rgb; gl_Position = matrix_projection * v;
  }`;
const glowFS = /* glsl */ `
  varying vec2 vQ; varying vec3 vC; varying vec3 vW; uniform float uAlpha;
  uniform vec2 uFogRange; uniform vec3 view_position;
  void main(void) {
    float r = clamp(length(vQ), 0.0, 1.0), k = 1.0 - r;
    float f = clamp((distance(vW, view_position) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
    // Soft falloff plus one faint flat ring, so it still reads as drawn rather than blurred.
    float a = k * k * 0.6 + 0.1 * step(r, 0.45);
    gl_FragColor = vec4(vC * a * uAlpha * (1.0 - 0.8 * f), 1.0);
  }`;
export function makeGlow(alpha = 1): pc.ShaderMaterial {
  const m = new pc.ShaderMaterial({ uniqueName: 'Glow', attributes: ATTR, vertexGLSL: glowVS, fragmentGLSL: glowFS });
  m.setParameter('uAlpha', alpha);
  m.blendType = pc.BLEND_ADDITIVE; m.depthWrite = false; m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

export interface ToonOpts { fog?: boolean; torch?: boolean; tex?: pc.Texture }
export function makeToon(o: ToonOpts = {}): pc.ShaderMaterial {
  const uv = !!o.tex;
  const m = new pc.ShaderMaterial({ uniqueName: uv ? 'ToonTex' : 'Toon', attributes: uv ? ATTR_UV : ATTR, vertexGLSL: toonVS(uv), fragmentGLSL: toonFS(uv) });
  m.setParameter('uTint', [1, 1, 1]);
  m.setParameter('uFogOn', o.fog === false ? 0 : 1);
  m.setParameter('uTorchUse', o.torch === false ? 0 : 1);
  m.setParameter('uCeil', 0);
  if (o.tex) m.setParameter('uTex', o.tex);
  m.update();
  return m;
}

export interface UnlitOpts { color?: number; alpha?: number; blend?: 'normal' | 'add'; fog?: boolean; depthTest?: boolean; depthWrite?: boolean; cull?: 'back' | 'front' | 'none'; tex?: pc.Texture }
export function makeUnlit(o: UnlitOpts = {}): pc.ShaderMaterial {
  const uv = !!o.tex;
  const attributes: Record<string, string> = { aPosition: pc.SEMANTIC_POSITION, aColor: pc.SEMANTIC_COLOR };
  if (uv) attributes.aUv = pc.SEMANTIC_TEXCOORD0;
  const m = new pc.ShaderMaterial({ uniqueName: uv ? 'UnlitTex' : 'Unlit', attributes, vertexGLSL: unlitVS(uv), fragmentGLSL: unlitFS(uv) });
  m.setParameter('uTint', rgb(o.color ?? 0xffffff));
  m.setParameter('uAlpha', o.alpha ?? 1);
  m.setParameter('uFogOn', o.fog === false ? 0 : 1);
  if (o.tex) m.setParameter('uTex', o.tex);
  if (o.blend) { m.blendType = o.blend === 'add' ? pc.BLEND_ADDITIVE : pc.BLEND_NORMAL; m.depthWrite = false; }
  if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;
  if (o.depthTest === false) m.depthTest = false;
  m.cull = o.cull === 'none' ? pc.CULLFACE_NONE : o.cull === 'front' ? pc.CULLFACE_FRONT : pc.CULLFACE_BACK;
  m.update();
  return m;
}

/** Inverted hull pushed out along normals: the classic cartoon ink line. */
export function makeOutline(thickness: number, fog = true, parts = false): pc.ShaderMaterial {
  const attributes: Record<string, string> = { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL };
  if (parts) attributes.aColor = pc.SEMANTIC_COLOR;
  const m = new pc.ShaderMaterial({ uniqueName: parts ? 'OutlineParts' : 'Outline', attributes, vertexGLSL: outlineVS(parts), fragmentGLSL: outlineFS });
  m.setParameter('uTint', rgb(INK));
  m.setParameter('uThickness', thickness);
  m.setParameter('uFogOn', fog ? 1 : 0);
  m.cull = pc.CULLFACE_FRONT;
  m.update();
  return m;
}

export const toonMat = makeToon();
/**
 * Toon material for small models that carry their ink hull in the same mesh, so each is one draw: hull
 * vertices have colour alpha 0, are wound inside-out, and come out as flat fogged ink exactly like `inkBack`.
 * (Opaque draws are ordered by material creation, newest first, and that order settles depth ties where a
 * teammate's hand meets the gun: this is created straight after `toonMat` so guns still draw after characters.)
 */
export const toonInkMat = new pc.ShaderMaterial({ uniqueName: 'ToonInk', attributes: ATTR, vertexGLSL: toonVS(false, false, true), fragmentGLSL: toonFS(false, true) });
toonInkMat.setParameter('uTint', [1, 1, 1]); toonInkMat.setParameter('uFogOn', 1); toonInkMat.setParameter('uTorchUse', 1); toonInkMat.setParameter('uCeil', 0); toonInkMat.setParameter('uInk', rgb(INK)); toonInkMat.update();
export const toonVM = makeToon({ fog: false, torch: false });
export const outlineMat = makeOutline(0.022);
/** Character materials: one merged mesh per chibi, limbs posed per instance via `uParts` (see chibi.ts). */
export const toonPartsMat = new pc.ShaderMaterial({ uniqueName: 'ToonParts', attributes: ATTR, vertexGLSL: toonVS(false, true), fragmentGLSL: toonFS(false) });
toonPartsMat.setParameter('uTint', [1, 1, 1]); toonPartsMat.setParameter('uFogOn', 1); toonPartsMat.setParameter('uTorchUse', 1); toonPartsMat.setParameter('uCeil', 0); toonPartsMat.update();
export const outlinePartsMat = makeOutline(0.022, true, true);
/** Shared textured toon material: set `uTex` per mesh instance. */
export const toonTexMat = new pc.ShaderMaterial({ uniqueName: 'ToonTex', attributes: ATTR_UV, vertexGLSL: toonVS(true), fragmentGLSL: toonFS(true) });
toonTexMat.setParameter('uTint', [1, 1, 1]); toonTexMat.setParameter('uFogOn', 1); toonTexMat.setParameter('uTorchUse', 1); toonTexMat.setParameter('uCeil', 0); toonTexMat.update();
/** Textured toon material for ceilings: flat lit, ignores the lamp pools of the light map. Set `uTex` per mesh instance. */
export const ceilMat = new pc.ShaderMaterial({ uniqueName: 'ToonTex', attributes: ATTR_UV, vertexGLSL: toonVS(true), fragmentGLSL: toonFS(true) });
ceilMat.setParameter('uTint', [1, 1, 1]); ceilMat.setParameter('uFogOn', 1); ceilMat.setParameter('uTorchUse', 1); ceilMat.setParameter('uCeil', 1); ceilMat.update();
/** Shared flat (unlit, fogged) vertex-colour material and the double-sided ink used for beam strokes. */
export const flatMat = makeUnlit({});
export const inkLineMat = makeUnlit({ color: INK, cull: 'none' });
/** Back-face ink for hulls whose geometry is already inflated. */
export const inkBack = makeUnlit({ color: INK, cull: 'front' });
export const inkBackVM = makeUnlit({ color: INK, cull: 'front', fog: false });

// Scene-wide lighting/fog uniforms shared by every shader above.
const scope = device.scope;
const sun = new pc.Vec3(-0.4, 1, 0.9).normalize();
scope.resolve('uSunDir').setValue([sun.x, sun.y, sun.z]);
scope.resolve('uFogCol').setValue(rgb(0x7a4f8e));
scope.resolve('uFogRange').setValue([24, 105]);
// Set every frame: keep the scope ids and reuse the value arrays.
const sTime = scope.resolve('uTime'), sTorchOn = scope.resolve('uTorchOn'), sTorchPos = scope.resolve('uTorchPos'), sTorchDir = scope.resolve('uTorchDir');
const torchPos = new Float32Array([0, -100, 0]), torchDir = new Float32Array([0, 0, -1]);
sTorchPos.setValue(torchPos);
sTorchDir.setValue(torchDir);
sTorchOn.setValue(0);
scope.resolve('uAmbLo').setValue([0.4, 0.34, 0.5]);
scope.resolve('uAmbHi').setValue([0.56, 0.58, 0.72]);
scope.resolve('uSunCol').setValue([0.4, 0.34, 0.3]);
scope.resolve('uGrade').setValue([1, 1, 1]);
scope.resolve('uLampWarm').setValue([0.64, 0.45, 0.22]);
scope.resolve('uLampCool').setValue([0.36, 0.44, 0.5]);
sTime.setValue(0);
scope.resolve('uCeilLight').setValue([0.56, 0.56, 0.58]);
// Until a world bakes its own, a 1x1 "open sky, no lamps" light map.
const blankLight = new pc.Texture(device, { width: 1, height: 1, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST, levels: [new Uint8Array([255, 0, 0, 255])] });
/**
 * World light map covering `w` x `h` metres from the origin; null restores the blank one. With
 * `levels` > 1 the texture holds that many storeys side by side along u, each `storey` m tall.
 */
export function setLightMap(tex: pc.Texture | null, w = 1, h = 1, levels = 1, storey = 4.2): void {
  scope.resolve('uLightMap').setValue(tex ?? blankLight);
  scope.resolve('uLightScale').setValue([1 / (w * levels), 1 / h]);
  scope.resolve('uLightLv').setValue([levels, storey, 0.5 / (tex ?? blankLight).width]);
}
setLightMap(null);
/** Per-chapter fog. */
export function setFog(color: number, near: number, far: number): void {
  scope.resolve('uFogCol').setValue(rgb(color));
  scope.resolve('uFogRange').setValue([near, far]);
}
export type V3 = [number, number, number];
/** Per-chapter light colours: hemisphere ambient (ground, sky), moonlight and a final colour grade. */
export function setAtmosphere(ambLo: V3, ambHi: V3, sunCol: V3, grade: V3, lampK = 1): void {
  scope.resolve('uAmbLo').setValue(ambLo); scope.resolve('uAmbHi').setValue(ambHi);
  scope.resolve('uSunCol').setValue(sunCol); scope.resolve('uGrade').setValue(grade);
  // Ceilings: near-neutral, with only a hint of the sky tint, so mint wards do not go lilac.
  const l = (ambLo[0] + ambLo[1] + ambLo[2] + ambHi[0] + ambHi[1] + ambHi[2]) / 6 + 0.1;
  scope.resolve('uCeilLight').setValue([l + (ambHi[0] - l) * 0.15, l + (ambHi[1] - l) * 0.15, l + (ambHi[2] - l) * 0.15]);
  // Lamps fade as the sky brightens (dawn chapters).
  scope.resolve('uLampWarm').setValue([0.64 * lampK, 0.45 * lampK, 0.22 * lampK]);
  scope.resolve('uLampCool').setValue([0.36 * lampK, 0.44 * lampK, 0.5 * lampK]);
}
export function setTime(t: number): void { sTime.setValue(t % 3600); }
export function setTorch(on: boolean, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
  sTorchOn.setValue(on ? 1 : 0);
  torchPos[0] = x; torchPos[1] = y; torchPos[2] = z; sTorchPos.setValue(torchPos);
  torchDir[0] = dx; torchDir[1] = dy; torchDir[2] = dz; sTorchDir.setValue(torchDir);
}

// ----------------------------------------------------------------- entities
/** Entity drawing `mesh` once per material (e.g. toon pass + ink hull). */
export function meshEntity(mesh: pc.Mesh | pc.Mesh[], mats: pc.Material | pc.Material[], layer = WORLD, name?: string): pc.Entity {
  const e = new pc.Entity(name);
  const ms = Array.isArray(mats) ? mats : [mats];
  const meshInstances = ms.map((m, i) => new pc.MeshInstance(Array.isArray(mesh) ? mesh[i] : mesh, m));
  e.addComponent('render', { meshInstances, castShadows: false, receiveShadows: false, layers: [layer] });
  return e;
}
export const instances = (e: pc.Entity): readonly pc.MeshInstance[] => e.render?.meshInstances ?? [];
const tints = new Map<number, readonly number[]>();
/** `rgb(color)` as a shared array for uniform values: one per colour in use, never to be modified. */
export function tintOf(color: number): number[] {
  let t = tints.get(color);
  if (!t) { t = rgb(color); tints.set(color, t); }
  return t as number[];
}
export function setTint(e: pc.Entity, color: number): void { const t = tintOf(color); for (const mi of instances(e)) mi.setParameter('uTint', t); }

const _q = new pc.Quat();
/** Local rotation from radians, applied as Rx·Ry·Rz. */
export function setRot(e: pc.GraphNode, rx: number, ry: number, rz: number): void { e.setLocalRotation(quatXYZ(rx, ry, rz, _q)); }

/** Paints a texture's pixels. Must be repeatable: it runs again if the WebGL context is restored. */
export type Painter = () => HTMLCanvasElement;
const painters = new Map<pc.Texture, Painter>();
function paintInto(t: pc.Texture, paint: Painter): void {
  const cv = paint();
  t.setSource(cv); // uploads straight away (and builds the mip chain)
  // The GPU copy is all we need. The engine only releases bitmaps/images, so drop the canvas's backing store by hand.
  cv.width = cv.height = 0;
}
// A restored context has lost every texture, and the source canvases are gone: paint them again.
device.on('devicerestored', () => { for (const [t, paint] of painters) paintInto(t, paint); });

/**
 * Texture from a 2D canvas. Pass a painter function rather than a canvas where possible: the canvas is then
 * released as soon as it is uploaded, and repainted after a context loss. Free these with `freeTexture`.
 */
export function canvasTexture(src: HTMLCanvasElement | Painter, mipmaps = true, repeat = false): pc.Texture {
  const cv = typeof src === 'function' ? src() : src;
  const t = new pc.Texture(device, {
    width: cv.width, height: cv.height, format: pc.PIXELFORMAT_RGBA8, mipmaps,
    minFilter: mipmaps ? pc.FILTER_LINEAR_MIPMAP_LINEAR : pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
    addressU: repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE, addressV: repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE, anisotropy: device.maxAnisotropy,
  });
  t.setSource(cv);
  if (typeof src === 'function') { cv.width = cv.height = 0; painters.set(t, src); }
  return t;
}
/** Destroys a texture and forgets its painter. */
export function freeTexture(t: pc.Texture): void { painters.delete(t); t.destroy(); }
/** 1x1 white stand-in for textures that are not loaded (see ground.ts). */
export const whiteTex = new pc.Texture(device, { width: 1, height: 1, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST, levels: [new Uint8Array([255, 255, 255, 255])] });

// ------------------------------------------------------------------ batching
/** Collects static coloured primitives and bakes them into one toon mesh + one ink hull. */
export class Batch {
  private solids: Geo[] = [];
  private hulls: Geo[] = [];
  /** Per hull: the index of the solid it outlines (-1: a group's or a pre-built one). For `trimHulls`. */
  private owners: number[] = [];

  add(g: Geo, color: number, m: pc.Mat4, outline: 'box' | 'smooth' | 'none' = 'box', thickness = 0.03): void {
    this.solids.push(make(g, color, m));
    if (outline === 'box') {
      const s = m.getScale();
      this.hulls.push(make(inflateBox(g, thickness / s.x, thickness / s.y, thickness / s.z), undefined, m));
      this.owners.push(this.solids.length - 1);
    } else if (outline === 'smooth') {
      this.hulls.push(inflateSmooth(make(g, undefined, m), thickness));
      this.owners.push(this.solids.length - 1);
    }
  }

  /**
   * Item models (guns, close-in weapons, throwables): trim each part's outline where the part ends inside
   * another (geo.ts `trimHulls`), so it no longer pokes a dark sliver out through that part's sides. Call
   * before `build`/`take`. Not for the world batches: it compares every part with every other.
   */
  trimHulls(): void {
    const parts = this.solids.map((solid) => ({ solid, hull: null as Geo | null }));
    this.owners.forEach((o, k) => { if (o >= 0) parts[o].hull = this.hulls[k]; });
    trimHulls(parts);
    this.owners.forEach((o, k) => { if (o >= 0) this.hulls[k] = parts[o].hull!; });
  }

  /**
   * Axis-aligned boxes [w, h, d, color, x, y, z] that read as one shape (a trigger guard, a finger loop):
   * each drawn without its own outline, and one `unionHull` outline `thickness` thick round them all.
   */
  group(parts: readonly (readonly [number, number, number, number, number, number, number])[], thickness = 0.03): void {
    const unit = box();
    for (const [w, h, d, color, x, y, z] of parts) this.solids.push(make(unit, color, trs(x, y, z, 0, 0, 0, w, h, d)));
    this.hulls.push(unionHull(parts.map(([w, h, d, , x, y, z]) => ({ lo: [x - w / 2, y - h / 2, z - d / 2], hi: [x + w / 2, y + h / 2, z + d / 2] })), thickness));
    this.owners.push(-1);
  }

  /** Pre-built world-space geometry: `solid` is toon shaded, `hull` (already inflated, outward winding) is drawn as ink. */
  raw(solid: Geo | null, hull?: Geo): void {
    if (solid && solid.idx.length) this.solids.push(solid);
    if (hull && hull.idx.length) { this.hulls.push(hull); this.owners.push(-1); }
  }

  /** Hands over the collected geometry (toon solids, ink hulls) and empties the batch. */
  take(): { solids: Geo[]; hulls: Geo[] } {
    const out = { solids: this.solids, hulls: this.hulls };
    this.solids = []; this.hulls = []; this.owners = [];
    return out;
  }

  /** `vm` = first-person materials (no fog, no flashlight). Meshes are appended to `track` so the owner can free them. */
  build(layer = WORLD, vm = false, track?: pc.Mesh[]): pc.Entity {
    const e = new pc.Entity();
    const { solids, hulls } = this.take();
    const mk = (g: Geo) => { const m = toMesh(device, g); track?.push(m); return m; };
    if (solids.length) e.addChild(meshEntity(mk(merge(solids)), vm ? toonVM : toonMat, layer));
    // The ink materials are unlit, so hull meshes are uploaded without normals (12 bytes a vertex saved).
    if (hulls.length) e.addChild(meshEntity(mk({ ...merge(hulls), nor: [] }), vm ? inkBackVM : inkBack, layer));
    return e;
  }
}

const boxCache = new Map<string, [pc.Mesh, pc.Mesh]>();
/** A single outlined toon box, for the handful of animated props. */
export function inkBox(w: number, h: number, d: number, color: number, t = 0.03, layer = WORLD, vm = false): pc.Entity {
  const key = [w, h, d, color, t].join('|');
  let pair = boxCache.get(key);
  if (!pair) {
    const g = make(box(), color, new pc.Mat4().setScale(w, h, d));
    pair = [toMesh(device, g), toMesh(device, { ...inflateBox(g, t, t, t), nor: [] })];
    boxCache.set(key, pair);
  }
  return meshEntity(pair, vm ? [toonVM, inkBackVM] : [toonMat, inkBack], layer);
}
