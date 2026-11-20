// PlayCanvas application + the cel-shading material set. PlayCanvas has no
// built-in toon material, so lighting, banding, fog and ink are done in a few
// small custom shaders (GLSL, WebGL2). Colours are authored and lit in sRGB.
import * as pc from 'playcanvas';
import { type Geo, box, make, merge, inflateBox, inflateSmooth, toMesh, quatXYZ } from './geo';

export const INK = 0x1a1226;
const canvas = document.getElementById('game') as HTMLCanvasElement;
export const app = new pc.Application(canvas, { graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: 'high-performance' } });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio, 2);
window.addEventListener('resize', () => app.resizeCanvas());
export const device = app.graphicsDevice;

export const WORLD = app.scene.layers.getLayerByName('World')!.id;
const vmLayer = new pc.Layer({ name: 'Viewmodel' });
app.scene.layers.push(vmLayer);
/** Layer for the first-person weapon, drawn by its own camera over the world. */
export const VM = vmLayer.id;

export const rgb = (c: number): [number, number, number] => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

// ------------------------------------------------------------------ shaders
const ATTR = { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL, aColor: pc.SEMANTIC_COLOR };
const ATTR_UV = { ...ATTR, aUv: pc.SEMANTIC_TEXCOORD0 };
const FOG = /* glsl */ `
  uniform vec3 uFogCol; uniform vec2 uFogRange; uniform float uFogOn; uniform vec3 view_position;
  vec3 fogged(vec3 c, vec3 w) { float f = clamp((distance(w, view_position) - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0); return mix(c, uFogCol, f * uFogOn); }`;

const toonVS = (uv: boolean) => /* glsl */ `
  attribute vec3 aPosition; attribute vec3 aNormal; attribute vec4 aColor; ${uv ? 'attribute vec2 aUv; varying vec2 vUv;' : ''}
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; uniform mat3 matrix_normal;
  varying vec3 vN; varying vec3 vW; varying vec3 vC;
  void main(void) {
    vec4 w = matrix_model * vec4(aPosition, 1.0);
    vW = w.xyz; vN = normalize(matrix_normal * aNormal); vC = aColor.rgb; ${uv ? 'vUv = aUv;' : ''}
    gl_Position = matrix_viewProjection * w;
  }`;
const toonFS = (uv: boolean) => /* glsl */ `
  varying vec3 vN; varying vec3 vW; varying vec3 vC; ${uv ? 'varying vec2 vUv; uniform sampler2D uTex;' : ''}
  uniform vec3 uTint; uniform vec3 uSunDir; uniform vec3 uTorchPos; uniform vec3 uTorchDir; uniform float uTorchOn; uniform float uTorchUse;
  ${FOG}
  // Four hard steps: the whole "cel" look lives in this function.
  float band(float x) { return x < 0.25 ? 0.37 : x < 0.5 ? 0.65 : x < 0.75 ? 0.9 : 1.0; }
  void main(void) {
    vec3 n = normalize(vN);
    vec3 base = vC * uTint${uv ? ' * texture2D(uTex, vUv).rgb' : ''};
    vec3 light = mix(vec3(0.42, 0.36, 0.50), vec3(0.62, 0.64, 0.78), n.y * 0.5 + 0.5);
    light += vec3(0.42, 0.35, 0.30) * band(dot(n, uSunDir) * 0.5 + 0.5);
    // Flashlight: two flat rings instead of a smooth cone.
    vec3 toFrag = vW - uTorchPos; float d = length(toFrag); toFrag /= max(d, 0.001);
    float cone = dot(toFrag, uTorchDir);
    float ringv = cone > 0.93 ? 1.0 : cone > 0.87 ? 0.45 : 0.0;
    float reach = d < 9.0 ? 1.0 : d < 18.0 ? 0.6 : d < 28.0 ? 0.3 : 0.0;
    light += vec3(0.22, 0.20, 0.12) * ringv * reach * step(0.05, dot(n, -toFrag)) * uTorchOn * uTorchUse;
    gl_FragColor = vec4(fogged(base * min(light, vec3(1.45)), vW), 1.0);
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

const outlineVS = /* glsl */ `
  attribute vec3 aPosition; attribute vec3 aNormal;
  uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; uniform float uThickness;
  varying vec3 vW;
  void main(void) { vec4 w = matrix_model * vec4(aPosition + normalize(aNormal) * uThickness, 1.0); vW = w.xyz; gl_Position = matrix_viewProjection * w; }`;
const outlineFS = /* glsl */ `
  varying vec3 vW; uniform vec3 uTint;
  ${FOG}
  void main(void) { gl_FragColor = vec4(fogged(uTint, vW), 1.0); }`;

export interface ToonOpts { fog?: boolean; torch?: boolean; tex?: pc.Texture }
export function makeToon(o: ToonOpts = {}): pc.ShaderMaterial {
  const uv = !!o.tex;
  const m = new pc.ShaderMaterial({ uniqueName: uv ? 'ToonTex' : 'Toon', attributes: uv ? ATTR_UV : ATTR, vertexGLSL: toonVS(uv), fragmentGLSL: toonFS(uv) });
  m.setParameter('uTint', [1, 1, 1]);
  m.setParameter('uFogOn', o.fog === false ? 0 : 1);
  m.setParameter('uTorchUse', o.torch === false ? 0 : 1);
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
export function makeOutline(thickness: number, fog = true): pc.ShaderMaterial {
  const m = new pc.ShaderMaterial({ uniqueName: 'Outline', attributes: { aPosition: pc.SEMANTIC_POSITION, aNormal: pc.SEMANTIC_NORMAL }, vertexGLSL: outlineVS, fragmentGLSL: outlineFS });
  m.setParameter('uTint', rgb(INK));
  m.setParameter('uThickness', thickness);
  m.setParameter('uFogOn', fog ? 1 : 0);
  m.cull = pc.CULLFACE_FRONT;
  m.update();
  return m;
}

export const toonMat = makeToon();
export const toonVM = makeToon({ fog: false, torch: false });
export const outlineMat = makeOutline(0.022);
/** Back-face ink for hulls whose geometry is already inflated. */
export const inkBack = makeUnlit({ color: INK, cull: 'front' });
export const inkBackVM = makeUnlit({ color: INK, cull: 'front', fog: false });

// Scene-wide lighting/fog uniforms shared by every shader above.
const scope = device.scope;
const sun = new pc.Vec3(-0.4, 1, 0.9).normalize();
scope.resolve('uSunDir').setValue([sun.x, sun.y, sun.z]);
scope.resolve('uFogCol').setValue(rgb(0x7a4f8e));
scope.resolve('uFogRange').setValue([24, 105]);
scope.resolve('uTorchPos').setValue([0, -100, 0]);
scope.resolve('uTorchDir').setValue([0, 0, -1]);
scope.resolve('uTorchOn').setValue(0);
export function setTorch(on: boolean, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
  scope.resolve('uTorchOn').setValue(on ? 1 : 0);
  scope.resolve('uTorchPos').setValue([x, y, z]);
  scope.resolve('uTorchDir').setValue([dx, dy, dz]);
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
export function setTint(e: pc.Entity, color: number): void { for (const mi of instances(e)) mi.setParameter('uTint', rgb(color)); }

const _q = new pc.Quat();
/** Local rotation from radians, applied as Rx·Ry·Rz. */
export function setRot(e: pc.Entity, rx: number, ry: number, rz: number): void { e.setLocalRotation(quatXYZ(rx, ry, rz, _q)); }

export function canvasTexture(cv: HTMLCanvasElement, mipmaps = true): pc.Texture {
  const t = new pc.Texture(device, {
    width: cv.width, height: cv.height, format: pc.PIXELFORMAT_RGBA8, mipmaps,
    minFilter: mipmaps ? pc.FILTER_LINEAR_MIPMAP_LINEAR : pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE, anisotropy: device.maxAnisotropy,
  });
  t.setSource(cv);
  return t;
}

// ------------------------------------------------------------------ batching
/** Collects static coloured primitives and bakes them into one toon mesh + one ink hull. */
export class Batch {
  private solids: Geo[] = [];
  private hulls: Geo[] = [];

  add(g: Geo, color: number, m: pc.Mat4, outline: 'box' | 'smooth' | 'none' = 'box', thickness = 0.045): void {
    this.solids.push(make(g, color, m));
    if (outline === 'box') {
      const s = m.getScale();
      this.hulls.push(make(inflateBox(g, thickness / s.x, thickness / s.y, thickness / s.z), undefined, m));
    } else if (outline === 'smooth') {
      this.hulls.push(inflateSmooth(make(g, undefined, m), thickness));
    }
  }

  /** `vm` = first-person materials (no fog, no flashlight). */
  build(layer = WORLD, vm = false): pc.Entity {
    const e = new pc.Entity();
    if (this.solids.length) e.addChild(meshEntity(toMesh(device, merge(this.solids)), vm ? toonVM : toonMat, layer));
    if (this.hulls.length) e.addChild(meshEntity(toMesh(device, merge(this.hulls)), vm ? inkBackVM : inkBack, layer));
    this.solids = []; this.hulls = [];
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
    pair = [toMesh(device, g), toMesh(device, inflateBox(g, t, t, t))];
    boxCache.set(key, pair);
  }
  return meshEntity(pair, vm ? [toonVM, inkBackVM] : [toonMat, inkBack], layer);
}
