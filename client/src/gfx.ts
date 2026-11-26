// PlayCanvas application + the cel-shading material set. PlayCanvas has no
// built-in toon material, so lighting, banding, fog and ink are done in a few
// small custom shaders (GLSL, WebGL2). Colours are authored and lit in sRGB.
import * as pc from 'playcanvas';
import { type Geo, box, make, merge, inflateBox, inflateSmooth, toMesh, quatXYZ, unionHull, trimHulls, trs } from './geo';
import { antialias, renderScale } from './gfxsettings';

export const INK = 0x1a1226;
const canvas = document.getElementById('game') as HTMLCanvasElement;
/** Anti-aliasing (4x MSAA) asked for at start-up: the sample count is fixed when the device is created, so a change needs a reload. */
export const AA_REQUESTED = antialias();
export const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: AA_REQUESTED, alpha: false, powerPreference: 'high-performance' } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
// Render scale cap (see gfxsettings.ts): a player setting, applied live by setRenderScale. Never changed automatically.
app.graphicsDevice.maxPixelRatio = renderScale();
app.resizeCanvas(); // size the backbuffer to the cap now, so the settings readout is right from the start
/** Change the render scale cap now (the engine still takes min(cap, devicePixelRatio)) and resize the backbuffer to match. */
export function setRenderScale(cap: number): void { app.graphicsDevice.maxPixelRatio = cap; app.resizeCanvas(); }
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

// --------------------------------------------------------------- draw order
/**
 * The order of the opaque draws of a frame, top to bottom: what hides the most goes first, so the pixels
 * behind it are thrown out by the depth test before they are shaded (the GPU's time goes on pixels, not
 * triangles). A material is given its row with `drawAs`, and `draw`/`meshEntity` hand it on to the mesh
 * instance as the engine's `drawBucket`: the layers sort by SORTMODE_MATERIALMESH, which draws the HIGHER
 * bucket first, then the newer material, then the newer mesh (check with `npm run check:order`).
 *
 *   bucket      tie  what                                                             material
 *   ITEM   250  <=   guns in hands, pick-up models, mounted guns (ink in the mesh)    toonInkMat
 *   SOLID  240  <=   walls, props, slab edges, stairs, clutter: the big occluders     toonMat
 *   DOOR   230  <    doors                                                            a chapter's makeToon
 *   GOO_INK 220 <    the ink hull of a goo glob                                       outlineMat
 *   CHAR   210  <    survivors, and zombies drawn one by one                          toonPartsMat
 *   CHAR_INK 200 <   their ink hulls                                                  outlinePartsMat
 *   HORDE  190  <    the instanced horde                                              hordeToonMat
 *   HORDE_INK 180 <  its ink hulls                                                    hordeInkMat
 *   FLOOR  170  <    ground and upper floors (the 16x anisotropic texture)            toonTexMat
 *   CEIL   160  <    ceilings                                                         ceilMat
 *   PANE   150  <    lit window panes and signs laid on the walls                     flatMat
 *   LINE   140  <    architecture ink strokes (beams)                                 inkLineMat
 *   HULL   130  <    ink hulls of props and clutter (back faces, inflated)            inkBack
 *         (127)      the engine's default: anything not given a row, and every blended draw
 *   PUFF   120  <    instanced lit blobs                                              toonInstMat
 *   SPARK  110  <    comic stars, tracers, ropes, the throw arc                       unlitInstMat, fx.ts
 *   WATER  100  <    water                                                            ground.ts
 *   GLOW    90  <    lamp bulbs and tubes                                             world.ts
 *   MARK    80  <    objective arrow and beacon, notes                                world.ts
 *   SKY     70  <    the skyline round the map                                        atmo.ts
 *   PIECE   65  <    set pieces (the lift's panel, the tram)                          setpieces.ts
 *   VM_SOLID 60 <=   the first-person weapon and hands (their own layer)              toonVM
 *   VM_HULL 50  <    their ink hulls                                                  inkBackVM
 *
 * `tie`: what shows where two surfaces have the very same depth (strokes and hulls lying in a wall's
 * plane, a floor against a slab edge, a hand on a gun). "<=" rows test "less or equal": the later draw
 * wins. "<" rows test "less": the earlier draw wins. Before these buckets the frame ran the other way
 * (the engine's order alone: newest material first, so sky, hulls, strokes, ceilings, floors, characters,
 * guns, walls) with "less or equal" throughout; the rows from DOOR down are that order reversed, and a
 * reversed pair with "less" on the later one gives the same pixel as before, tie or no tie. So:
 *   - a new opaque material that may lie in the plane of something else goes in the row of what it is,
 *     never between ITEM and SOLID, and keeps "<";
 *   - two draws of one "<" row now settle a tie between themselves the other way round (first wins):
 *     fine for flat ink, and none of the other rows has two surfaces in one plane (check:order looks,
 *     in each chapter's still geometry and in the characters' parts). `toonMat` has thousands (trim on
 *     a wall) and `toonInkMat` some (a stripe on a gun): those two stay "<=" and in their old order.
 *     For the same reason the layers stay on SORTMODE_MATERIALMESH: sorted front to back, which of two
 *     wall meshes wins such a tie would change as the camera moves (and lower buckets would draw first);
 *   - DOOR is the one row moved out of line (doors were drawn first of all, they now come straight after
 *     the walls they close): a door still loses a tie to a wall, and now wins one against the rows below.
 *     A closed door has no surface in the plane of anything in those rows (check:order looks).
 * Blended draws are sorted back to front by the engine and must stay on the default bucket.
 */
export const DRAW = { ITEM: 250, SOLID: 240, DOOR: 230, GOO_INK: 220, CHAR: 210, CHAR_INK: 200, HORDE: 190, HORDE_INK: 180, FLOOR: 170, CEIL: 160, PANE: 150, LINE: 140, HULL: 130, PUFF: 120, SPARK: 110, WATER: 100, GLOW: 90, MARK: 80, SKY: 70, PIECE: 65, VM_SOLID: 60, VM_HULL: 50 } as const;
const drawRows = new WeakMap<pc.Material, number>();
/** Puts an opaque material in a row of the draw order (see `DRAW`), with the row's depth test. */
export function drawAs<M extends pc.Material>(bucket: number, m: M): M {
  drawRows.set(m, bucket);
  m.depthFunc = bucket === DRAW.ITEM || bucket === DRAW.SOLID || bucket === DRAW.VM_SOLID ? pc.FUNC_LESSEQUAL : pc.FUNC_LESS;
  return m;
}
/** A mesh instance in its material's row of the draw order: use this rather than `new pc.MeshInstance`. */
export function draw(mesh: pc.Mesh, material: pc.Material): pc.MeshInstance {
  const mi = new pc.MeshInstance(mesh, material), bucket = drawRows.get(material);
  if (bucket !== undefined) mi.drawBucket = bucket;
  return mi;
}

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
// `horde`: the instanced form (see horde.ts). The rows come from one texel row of the pose texture `uPose`
// (three texels a part, the row index riding in aN0.w) instead of a uniform array; the maths is the same text.
const PARTS = (horde = false) => { const a = horde ? 'hParts' : 'uParts'; return /* glsl */ `
  ${horde ? `uniform highp sampler2D uPose; vec4 hParts[3];
  int partIndex() {
    ivec2 at = ivec2(int(aColor.a * 255.0 + 0.5) * 3, int(aN0.w + 0.5));
    hParts[0] = texelFetch(uPose, at, 0); hParts[1] = texelFetch(uPose, at + ivec2(1, 0), 0); hParts[2] = texelFetch(uPose, at + ivec2(2, 0), 0);
    return 0;
  }` : `uniform vec4 uParts[${CHIBI_PARTS * 3}];
  int partIndex() { return int(aColor.a * 255.0 + 0.5) * 3; }`}
  vec3 partPos(int i, vec3 p) { vec4 q = vec4(p, 1.0); return vec3(dot(${a}[i], q), dot(${a}[i + 1], q), dot(${a}[i + 2], q)); }
  vec3 partNormal(int i, vec3 n) {
    vec3 a = vec3(${a}[i].x, ${a}[i + 1].x, ${a}[i + 2].x), b = vec3(${a}[i].y, ${a}[i + 1].y, ${a}[i + 2].y), c = vec3(${a}[i].z, ${a}[i + 1].z, ${a}[i + 2].z);
    return cross(b, c) * n.x + cross(c, a) * n.y + cross(a, b) * n.z;
  }`; };
// Per-instance model matrix (four columns) and normal matrix (three columns; aN0.w = pose texture row) of a horde draw.
const HORDE_VS = /* glsl */ `attribute vec4 aI0; attribute vec4 aI1; attribute vec4 aI2; attribute vec4 aI3; attribute vec4 aN0; attribute vec4 aN1; attribute vec4 aN2;`;
// `ink`: vertices whose colour alpha is 0 are an ink hull baked into the same mesh (see toonInkMat).
// `inst`: hardware-instanced (see INST_FORMAT): the model matrix and tint come per instance, not as uniforms.
// Instances are scaled uniformly, so the model matrix's upper 3x3 serves for normals.
const INST_VS = /* glsl */ `attribute vec4 aI0; attribute vec4 aI1; attribute vec4 aI2; attribute vec4 aI3; attribute vec4 aITint; varying vec3 vTint;`;
/**
 * Particles close to the eye (fx.ts): each instance is shrunk about its own centre, in the vertex shader, so it
 * never covers more than a set share of the screen. They are opaque but drawn after the world (rows PUFF and
 * SPARK), so every pixel of one is shaded a second time, and a puff at arm's length used to fill the frame.
 * `uNear` = (cap, fade start, 1 / fade length): the instance's radius is held to `cap` x its distance from the
 * eye (cap = the tangent of the largest angular radius, near enough), and it shrinks to nothing between
 * `fade start + fade length` and `fade start` metres. Needs a unit-radius mesh scaled uniformly (the instance's
 * radius is read off the matrix's first column). Beyond `radius / cap` metres nothing changes.
 */
const NEAR_VS = /* glsl */ `uniform vec3 view_position; uniform vec3 uNear;
  vec3 nearShrink(vec3 w, vec3 c, float r) {
    float d = distance(c, view_position);
    float k = min(min(1.0, uNear.x * d / max(r, 0.0001)), clamp((d - uNear.y) * uNear.z, 0.0, 1.0));
    return c + (w - c) * k;
  }`;
/** `uNear` for the lit puffs and for the comic stars (whose blast flash is meant to be huge), and the value that turns it off. */
export const NEAR_PUFF = [0.3, 0.15, 1 / 0.35], NEAR_SPARK = [0.75, 0.1, 1 / 0.2], NEAR_OFF = [1e6, -1, 1];
const toonVS = (uv: boolean, parts = false, ink = false, inst = false, horde = false) => /* glsl */ `
  attribute vec3 aPosition; attribute vec3 aNormal; attribute vec4 aColor; ${uv ? 'attribute vec2 aUv; varying vec2 vUv;' : ''}
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; uniform mat3 matrix_normal;
  varying vec3 vN; varying vec3 vW; varying vec3 vC; ${ink ? 'varying float vInk;' : ''}
  ${horde ? HORDE_VS : ''} ${parts ? PARTS(horde) : ''} ${inst ? INST_VS + NEAR_VS : ''}
  void main(void) {
    ${parts ? 'int pi = partIndex(); vec3 p = partPos(pi, aPosition), nrm = partNormal(pi, aNormal);' : 'vec3 p = aPosition, nrm = aNormal;'}
    ${inst ? 'mat4 model = mat4(aI0, aI1, aI2, aI3); mat3 nmat = mat3(model); vTint = aITint.rgb;' : horde ? 'mat4 model = mat4(aI0, aI1, aI2, aI3); mat3 nmat = mat3(aN0.xyz, aN1.xyz, aN2.xyz);' : 'mat4 model = matrix_model; mat3 nmat = matrix_normal;'}
    vec4 w = model * vec4(p, 1.0); ${inst ? 'w.xyz = nearShrink(w.xyz, aI3.xyz, length(aI0.xyz));' : ''}
    vW = w.xyz; vN = normalize(nmat * nrm); vC = aColor.rgb; ${uv ? 'vUv = aUv;' : ''} ${ink ? 'vInk = 1.0 - aColor.a;' : ''}
    gl_Position = matrix_viewProjection * w;
  }`;
const toonFS = (uv: boolean, ink = false, inst = false) => /* glsl */ `
  varying vec3 vN; varying vec3 vW; varying vec3 vC; ${uv ? 'varying vec2 vUv; uniform sampler2D uTex;' : ''} ${ink ? 'varying float vInk; uniform vec3 uInk;' : ''}
  ${inst ? 'varying vec3 vTint;' : 'uniform vec3 uTint;'} uniform vec3 uSunDir; uniform vec3 uTorchPos; uniform vec3 uTorchDir; uniform float uTorchOn; uniform float uTorchUse;
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
    vec3 base = vC * ${inst ? 'vTint' : 'uTint'}${uv ? ' * texture2D(uTex, vUv).rgb' : ''};
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

// `near`: instances shrink close to the eye (see NEAR_VS). `va`: the vertex colour's alpha is the vertex's opacity.
const unlitVS = (uv: boolean, inst = false, near = false, va = false) => /* glsl */ `
  attribute vec3 aPosition; attribute vec4 aColor; ${uv ? 'attribute vec2 aUv; varying vec2 vUv;' : ''}
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection;
  varying vec3 vW; varying vec3 vC; ${va ? 'varying float vA;' : ''} ${inst ? INST_VS : ''} ${near ? NEAR_VS : ''}
  void main(void) {
    ${inst ? 'mat4 model = mat4(aI0, aI1, aI2, aI3); vTint = aITint.rgb;' : 'mat4 model = matrix_model;'}
    vec4 w = model * vec4(aPosition, 1.0); ${near ? 'w.xyz = nearShrink(w.xyz, aI3.xyz, length(aI0.xyz));' : ''}
    vW = w.xyz; vC = aColor.rgb; ${va ? 'vA = aColor.a;' : ''} ${uv ? 'vUv = aUv;' : ''} gl_Position = matrix_viewProjection * w;
  }`;
const unlitFS = (uv: boolean, inst = false, va = false) => /* glsl */ `
  varying vec3 vW; varying vec3 vC; ${va ? 'varying float vA;' : ''} ${uv ? 'varying vec2 vUv; uniform sampler2D uTex;' : ''}
  ${inst ? 'varying vec3 vTint;' : 'uniform vec3 uTint;'} uniform float uAlpha;
  ${FOG}
  void main(void) {
    ${uv ? 'vec4 t = texture2D(uTex, vUv); if (t.a < 0.02) discard;' : 'vec4 t = vec4(1.0);'}
    gl_FragColor = vec4(fogged(vC * ${inst ? 'vTint' : 'uTint'} * t.rgb, vW), uAlpha * t.a${va ? ' * vA' : ''});
  }`;

const outlineVS = (parts = false, horde = false) => /* glsl */ `
  attribute vec3 aPosition; attribute vec3 aNormal; ${parts ? 'attribute vec4 aColor;' : ''}
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; uniform float uThickness;
  varying vec3 vW;
  ${horde ? HORDE_VS : ''} ${parts ? PARTS(horde) : ''}
  void main(void) {
    vec3 p = aPosition + normalize(aNormal) * uThickness;
    ${parts ? 'p = partPos(partIndex(), p);' : ''}
    vec4 w = ${horde ? 'mat4(aI0, aI1, aI2, aI3)' : 'matrix_model'} * vec4(p, 1.0); vW = w.xyz; gl_Position = matrix_viewProjection * w;
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

export interface UnlitOpts { color?: number; alpha?: number; blend?: 'normal' | 'add'; fog?: boolean; depthTest?: boolean; depthWrite?: boolean; cull?: 'back' | 'front' | 'none'; tex?: pc.Texture; /** Each vertex's opacity comes from its colour's alpha (`toMesh`'s `alpha`), times `alpha`. */ vertexAlpha?: boolean }
export function makeUnlit(o: UnlitOpts = {}): pc.ShaderMaterial {
  const uv = !!o.tex;
  const attributes: Record<string, string> = { aPosition: pc.SEMANTIC_POSITION, aColor: pc.SEMANTIC_COLOR };
  if (uv) attributes.aUv = pc.SEMANTIC_TEXCOORD0;
  const va = !!o.vertexAlpha;
  const m = new pc.ShaderMaterial({ uniqueName: (uv ? 'UnlitTex' : 'Unlit') + (va ? 'VA' : ''), attributes, vertexGLSL: unlitVS(uv, false, false, va), fragmentGLSL: unlitFS(uv, false, va) });
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

export const toonMat = drawAs(DRAW.SOLID, makeToon());

/**
 * Toon material for small models that carry their ink hull in the same mesh, so each is one draw: hull
 * vertices have colour alpha 0, are wound inside-out, and come out as flat fogged ink exactly like `inkBack`.
 * (Where a teammate's hand meets the gun at the same depth the gun shows: see `DRAW`.)
 */
export const toonInkMat = new pc.ShaderMaterial({ uniqueName: 'ToonInk', attributes: ATTR, vertexGLSL: toonVS(false, false, true), fragmentGLSL: toonFS(false, true) });
toonInkMat.setParameter('uTint', [1, 1, 1]); toonInkMat.setParameter('uFogOn', 1); toonInkMat.setParameter('uTorchUse', 1); toonInkMat.setParameter('uCeil', 0); toonInkMat.setParameter('uInk', rgb(INK)); toonInkMat.update();
drawAs(DRAW.ITEM, toonInkMat);
export const toonVM = drawAs(DRAW.VM_SOLID, makeToon({ fog: false, torch: false }));
export const outlineMat = drawAs(DRAW.GOO_INK, makeOutline(0.022));
/** Character materials: one merged mesh per chibi, limbs posed per instance via `uParts` (see chibi.ts). */
export const toonPartsMat = new pc.ShaderMaterial({ uniqueName: 'ToonParts', attributes: ATTR, vertexGLSL: toonVS(false, true), fragmentGLSL: toonFS(false) });
toonPartsMat.setParameter('uTint', [1, 1, 1]); toonPartsMat.setParameter('uFogOn', 1); toonPartsMat.setParameter('uTorchUse', 1); toonPartsMat.setParameter('uCeil', 0); toonPartsMat.update();
drawAs(DRAW.CHAR, toonPartsMat);
export const outlinePartsMat = drawAs(DRAW.CHAR_INK, makeOutline(0.022, true, true));
/**
 * The same two, drawn instanced for the zombie horde (see horde.ts): every zombie of one look in a single draw.
 * Per instance (HORDE_FORMAT): the model and normal matrices the engine would have set as uniforms, and the row
 * of the pose texture `uPose` (RGBA32F, POSE_TEXELS wide) that holds what `uParts` held.
 */
export const HORDE_FLOATS = 28;
export const HORDE_FORMAT = new pc.VertexFormat(device, [
  { semantic: pc.SEMANTIC_ATTR11, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR12, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR13, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR14, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR8, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR9, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR10, components: 4, type: pc.TYPE_FLOAT32 },
]);
export const POSE_TEXELS = CHIBI_PARTS * 3;
const HORDE_ATTR = { aI0: pc.SEMANTIC_ATTR11, aI1: pc.SEMANTIC_ATTR12, aI2: pc.SEMANTIC_ATTR13, aI3: pc.SEMANTIC_ATTR14, aN0: pc.SEMANTIC_ATTR8, aN1: pc.SEMANTIC_ATTR9, aN2: pc.SEMANTIC_ATTR10 };
export const hordeToonMat = new pc.ShaderMaterial({ uniqueName: 'ToonHorde', attributes: { ...ATTR, ...HORDE_ATTR }, vertexGLSL: toonVS(false, true, false, false, true), fragmentGLSL: toonFS(false) });
hordeToonMat.setParameter('uTint', [1, 1, 1]); hordeToonMat.setParameter('uFogOn', 1); hordeToonMat.setParameter('uTorchUse', 1); hordeToonMat.setParameter('uCeil', 0); hordeToonMat.update();
drawAs(DRAW.HORDE, hordeToonMat);
export const hordeInkMat = new pc.ShaderMaterial({ uniqueName: 'OutlineHorde', attributes: { ...ATTR, ...HORDE_ATTR }, vertexGLSL: outlineVS(true, true), fragmentGLSL: outlineFS });
hordeInkMat.setParameter('uTint', rgb(INK)); hordeInkMat.setParameter('uThickness', 0.022); hordeInkMat.setParameter('uFogOn', 1); hordeInkMat.cull = pc.CULLFACE_FRONT; hordeInkMat.update();
drawAs(DRAW.HORDE_INK, hordeInkMat);
/** Shared textured toon material: set `uTex` per mesh instance. */
export const toonTexMat = new pc.ShaderMaterial({ uniqueName: 'ToonTex', attributes: ATTR_UV, vertexGLSL: toonVS(true), fragmentGLSL: toonFS(true) });
toonTexMat.setParameter('uTint', [1, 1, 1]); toonTexMat.setParameter('uFogOn', 1); toonTexMat.setParameter('uTorchUse', 1); toonTexMat.setParameter('uCeil', 0); toonTexMat.update();
drawAs(DRAW.FLOOR, toonTexMat);
/** Textured toon material for ceilings: flat lit, ignores the lamp pools of the light map. Set `uTex` per mesh instance. */
export const ceilMat = new pc.ShaderMaterial({ uniqueName: 'ToonTex', attributes: ATTR_UV, vertexGLSL: toonVS(true), fragmentGLSL: toonFS(true) });
ceilMat.setParameter('uTint', [1, 1, 1]); ceilMat.setParameter('uFogOn', 1); ceilMat.setParameter('uTorchUse', 1); ceilMat.setParameter('uCeil', 1); ceilMat.update();
drawAs(DRAW.CEIL, ceilMat);
/** Shared flat (unlit, fogged) vertex-colour material and the double-sided ink used for beam strokes. */
export const flatMat = drawAs(DRAW.PANE, makeUnlit({}));
export const inkLineMat = drawAs(DRAW.LINE, makeUnlit({ color: INK, cull: 'none' }));
/** Back-face ink for hulls whose geometry is already inflated. */
export const inkBack = drawAs(DRAW.HULL, makeUnlit({ color: INK, cull: 'front' }));
export const inkBackVM = drawAs(DRAW.VM_HULL, makeUnlit({ color: INK, cull: 'front', fog: false }));

// ---------------------------------------------------------------- instancing
/** Per-instance data for the instanced materials: the model matrix (four columns) then an RGB tint (+ pad). */
export const INST_FLOATS = 20;
export const INST_FORMAT = new pc.VertexFormat(device, [
  { semantic: pc.SEMANTIC_ATTR11, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR12, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR13, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR14, components: 4, type: pc.TYPE_FLOAT32 },
  { semantic: pc.SEMANTIC_ATTR15, components: 4, type: pc.TYPE_FLOAT32 },
]);
const INST_ATTR = { aI0: pc.SEMANTIC_ATTR11, aI1: pc.SEMANTIC_ATTR12, aI2: pc.SEMANTIC_ATTR13, aI3: pc.SEMANTIC_ATTR14, aITint: pc.SEMANTIC_ATTR15 };
/** `toonMat` drawn instanced: many small lit shapes of one mesh in a single draw. */
export const toonInstMat = new pc.ShaderMaterial({ uniqueName: 'ToonInst', attributes: { ...ATTR, ...INST_ATTR }, vertexGLSL: toonVS(false, false, false, true), fragmentGLSL: toonFS(false, false, true) });
toonInstMat.setParameter('uFogOn', 1); toonInstMat.setParameter('uTorchUse', 1); toonInstMat.setParameter('uCeil', 0); toonInstMat.setParameter('uNear', NEAR_PUFF); toonInstMat.update();
drawAs(DRAW.PUFF, toonInstMat);
/** Double-sided fogged unlit vertex colour, drawn instanced (comic stars). */
export const unlitInstMat = new pc.ShaderMaterial({ uniqueName: 'UnlitInstNear', attributes: { aPosition: pc.SEMANTIC_POSITION, aColor: pc.SEMANTIC_COLOR, ...INST_ATTR }, vertexGLSL: unlitVS(false, true, true), fragmentGLSL: unlitFS(false, true) });
unlitInstMat.setParameter('uAlpha', 1); unlitInstMat.setParameter('uFogOn', 1); unlitInstMat.setParameter('uNear', NEAR_SPARK); unlitInstMat.cull = pc.CULLFACE_NONE; unlitInstMat.update();
drawAs(DRAW.SPARK, unlitInstMat);
/** Debug (`__game.nearFx(false)`): turn the close-to-the-eye shrink of particles off and on, to compare. */
export function setNearShrink(on: boolean): void {
  toonInstMat.setParameter('uNear', on ? NEAR_PUFF : NEAR_OFF);
  unlitInstMat.setParameter('uNear', on ? NEAR_SPARK : NEAR_OFF);
}
/** `makeUnlit`'s blended, fogged vertex colour drawn instanced (the horde's ring shadows): `alpha` for all, the colour per instance. */
export function makeUnlitInst(alpha: number): pc.ShaderMaterial {
  const m = new pc.ShaderMaterial({ uniqueName: 'UnlitInst', attributes: { aPosition: pc.SEMANTIC_POSITION, aColor: pc.SEMANTIC_COLOR, ...INST_ATTR }, vertexGLSL: unlitVS(false, true), fragmentGLSL: unlitFS(false, true) });
  m.setParameter('uAlpha', alpha); m.setParameter('uFogOn', 1);
  m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.cull = pc.CULLFACE_BACK;
  m.update();
  return m;
}

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
  const meshInstances = ms.map((m, i) => draw(Array.isArray(mesh) ? mesh[i] : mesh, m));
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
