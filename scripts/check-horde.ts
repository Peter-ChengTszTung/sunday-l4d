// Dev check for client/src/horde.ts, no browser: builds zombies against a stand-in for WebGL, each one twice
// (drawn the plain way with its own mesh instances and uniforms, and drawn by the horde), poses both alike, and
// checks that what the horde hands the GPU is bit for bit what the plain path's uniforms held:
//   - per zombie in view: the model matrix, the normal matrix, the six part transforms (pose texture row),
//     and the shadow ring's matrix;
//   - which zombies are in view: the engine's own frustum test on the plain one's mesh instance;
//   - hiding, pooling (remove) and growing past the first buffer sizes;
//   - the instanced shaders compile (glslangValidator, if installed).
// Exit code 1 on errors. Usage: npm run check:horde
import type * as PC from 'playcanvas';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ------------------------------------------------------------------ a browser that draws nothing
const g = globalThis as Record<string, unknown>;
const inert = (over: Record<string, unknown> = {}): unknown => new Proxy(function () {}, {
  get: (_t, k) => (k in over ? over[k as string] : typeof k === 'symbol' ? undefined : () => undefined),
  set: () => true,
});
const glConst: Record<string, number> = {};
function fakeGL(canvas: unknown): unknown {
  let id = 1;
  const over: Record<string, unknown> = {
    canvas, drawingBufferWidth: 1920, drawingBufferHeight: 1080,
    getParameter: (p: number) => (p === 0x1f02 ? 'WebGL 2.0' : p === 0x8b8c ? 'WebGL GLSL ES 3.00' : p === 0x1f00 || p === 0x1f01 ? 'none' : p === 0x0d3a || p === 0x846d || p === 0x846e ? new Float32Array([1, 4096]) : p === 0x8ca6 ? null : 4096),
    getExtension: () => null, getSupportedExtensions: () => [],
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getContextAttributes: () => ({ antialias: true, alpha: false, depth: true, stencil: true }),
    checkFramebufferStatus: () => 0x8cd5, isContextLost: () => false, getError: () => 0,
    getShaderParameter: () => true, getProgramParameter: (_p: unknown, n: number) => (n === 0x8b82 ? true : 0),
    getShaderInfoLog: () => '', getProgramInfoLog: () => '', getActiveAttrib: () => null, getActiveUniform: () => null, getUniformLocation: () => ({}), getAttribLocation: () => 0,
  };
  for (const k of ['createBuffer', 'createTexture', 'createShader', 'createProgram', 'createFramebuffer', 'createRenderbuffer', 'createVertexArray', 'createQuery', 'createSampler', 'createTransformFeedback']) over[k] = () => ({ id: id++ });
  return new Proxy({}, {
    get: (_t, k) => (k in over ? over[k as string] : typeof k === 'symbol' ? undefined : /^[A-Z0-9_]+$/.test(k) ? (glConst[k] ??= 0x10000 + Object.keys(glConst).length) : () => undefined),
    set: () => true,
  });
}
function fakeCanvas(): unknown {
  const c: Record<string, unknown> = { width: 1920, height: 1080, clientWidth: 1920, clientHeight: 1080, style: {}, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) };
  let gl: unknown;
  const image = (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  c.getContext = (t: string) => (t.startsWith('webgl') ? (gl ??= fakeGL(c)) : inert({ canvas: c, measureText: () => ({ width: 10 }), createLinearGradient: () => inert(), createRadialGradient: () => inert(), getImageData: image }));
  return c;
}
const element = () => inert({ style: {}, classList: inert(), appendChild: (x: unknown) => x, children: [], dataset: {} });
const game = fakeCanvas();
Object.assign(g, {
  window: g, self: g, addEventListener() {}, removeEventListener() {}, innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  location: { search: '', href: 'http://localhost/', hostname: 'localhost', protocol: 'http:', host: 'localhost' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  HTMLCanvasElement: class {}, HTMLImageElement: class {}, HTMLVideoElement: class {}, ImageBitmap: class {}, HTMLElement: class {}, Image: class {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  document: { getElementById: (id: string) => (id === 'game' ? game : element()), createElement: (t: string) => (t === 'canvas' ? fakeCanvas() : element()), addEventListener() {}, removeEventListener() {}, body: element(), documentElement: element(), head: element(), querySelector: () => element(), querySelectorAll: () => [], hidden: false, visibilityState: 'visible' },
});
if (!('navigator' in g) || !(g.navigator as { userAgent?: string }).userAgent) Object.defineProperty(g, 'navigator', { value: { userAgent: 'node', platform: 'linux', maxTouchPoints: 0, language: 'en', languages: ['en'], getGamepads: () => [] }, configurable: true });

// The same dice for each twin: a chibi rolls its gait, phase and head loll as it is built.
let seed = 1;
Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const pc = await import('playcanvas');
const gfx = await import('../client/src/gfx');
const { Chibi, zombieLook, zombieHorde } = await import('../client/src/chibi');
type Chibi = InstanceType<typeof Chibi>;
type Pose = Parameters<Chibi['animate']>[0];

let errors = 0;
const fail = (msg: string) => { errors++; if (errors <= 20) console.error(`FAIL ${msg}`); };
const same = (a: ArrayLike<number>, ao: number, b: ArrayLike<number>, n: number) => { for (let i = 0; i < n; i++) if (!Object.is(a[ao + i], b[i]) && a[ao + i] !== b[i]) return false; return true; };

const camEnt = new pc.Entity('camera');
camEnt.addComponent('camera', { fov: 74, nearClip: 0.08, farClip: 600 });
gfx.app.root.addChild(camEnt);
const cam = camEnt.camera!;
cam.aspectRatioMode = pc.ASPECT_MANUAL; cam.aspectRatio = 2867 / 1516;

const POSES: Pose[] = ['idle', 'run', 'attack', 'stagger', 'windup', 'leap', 'charge', 'pin', 'ring', 'sit'];
const SCALES = [1, 1, 0.9, 1.6, 1.25, 1, 1, 1.15, 0.7, 1, 1.05, 1];
interface Twin { plain: Chibi; inst: Chibi; type: number; dead: number }
const twins: Twin[] = [];
const N = 230;
for (let i = 0; i < N; i++) {
  const type = i % 3 === 0 ? 1 + (i % 11) : 0, look = zombieLook(type, i);
  const s0 = (seed = 1000 + i);
  const plain = new Chibi(look);
  seed = s0;
  const inst = new Chibi(look, true);
  gfx.app.root.addChild(plain.group);
  twins.push({ plain, inst, type, dead: i % 17 === 0 ? 1 : 0 });
}
const horde = zombieHorde()!;
const F = gfx.HORDE_FLOATS, PF = gfx.POSE_TEXELS * 4;
const shadowOf = (c: Chibi) => c.group.children.find((n) => n !== c.root)!;

let compared = 0, hidden = 0, offscreen = 0, ringsSeen = 0;
for (let frame = 0; frame < 40; frame++) {
  const t = frame * 0.05, dt = frame % 7 === 0 ? 0.05 : 1 / 60;
  camEnt.setPosition(Math.sin(frame) * 6, 1.6 + (frame % 5) * 0.4, Math.cos(frame * 0.7) * 6);
  camEnt.setEulerAngles(-10 + (frame % 4) * 8, frame * 47, 0);
  for (let i = 0; i < twins.length; i++) {
    const tw = twins[i], sc = SCALES[tw.type];
    const x = Math.sin(i * 12.9898 + frame * 0.13) * 25, z = Math.cos(i * 78.233 + frame * 0.11) * 25, y = (i % 4 === 0 ? 4.2 : 0) + (tw.type === 8 && i % 2 ? 0.62 : 0), ry = i * 37 + frame * 9;
    const show = (i + frame) % 9 !== 0;
    for (const c of [tw.plain, tw.inst]) {
      c.group.setLocalScale(sc, sc, sc); c.group.setPosition(x, y, z); c.group.setLocalEulerAngles(0, ry, 0);
      c.visible = show;
      if ((i + frame) % 13 === 0) c.punch = 1;
      if (tw.dead && frame > 20) c.tumble(Math.min(1.5, (frame - 20) * 0.3), Math.sin(Math.min(1, (frame - 20) / 8) * Math.PI) * 0.35, Math.min(1, (frame - 20) / 8), dt);
      else c.animate(POSES[(i + (frame >> 3)) % POSES.length], t, dt);
    }
    if (frame === 30 && i % 10 === 3) { tw.plain.reset(); tw.inst.reset(); }
  }
  // Pooled spares are thrown away mid-run: the rest must still line up.
  if (frame === 25) for (let i = twins.length - 1; i >= 0; i--) if (i % 11 === 5) { twins[i].plain.dispose(); twins[i].inst.dispose(); twins.splice(i, 1); }

  gfx.app.root.syncHierarchy();
  horde.flush(cam);
  // The engine's view of the same frame.
  (cam.camera as unknown as { updateFrustum(): void }).updateFrustum();
  const fr = cam.camera.frustum;
  let expectDraws = 0;
  const byMesh = new Map<PC.Mesh, Twin[]>();
  for (const tw of twins) { let l = byMesh.get(tw.inst.mesh); if (!l) byMesh.set(tw.inst.mesh, (l = [])); l.push(tw); }
  // Rows run look by look in the horde's order (the order looks first appeared), zombies in list order;
  // the lists are reordered by removal, so match each record to its twin by content instead of by position.
  const st = horde.stats;
  let bodies = 0, rings = 0;
  for (const [mesh, list] of byMesh) {
    const pk = horde.peek(mesh)!;
    const want = list.filter((tw) => { const mi = tw.plain.root.render!.meshInstances[0]; return tw.plain.visible && fr.containsAabb(mi.aabb); });
    for (const tw of list) {
      const mi = tw.plain.root.render!.meshInstances[0], vis = tw.plain.visible && fr.containsAabb(mi.aabb);
      if (!tw.plain.visible) hidden++; else if (!vis) offscreen++;
      if (tw.inst.onScreen !== vis) fail(`frame ${frame}: onScreen ${tw.inst.onScreen}, the engine's cull says ${vis}`);
      const sh = shadowOf(tw.plain) as PC.Entity;
      if (tw.plain.visible && fr.containsAabb(sh.render!.meshInstances[0].aabb)) rings++;
    }
    if (pk.n !== want.length) { fail(`frame ${frame}: look draws ${pk.n} instances, expected ${want.length}`); continue; }
    if (pk.n) expectDraws += 2;
    bodies += pk.n;
    const left = new Set(want);
    for (let k = 0; k < pk.n; k++) {
      const o = k * F, r = pk.data[o + 19];
      let hit: Twin | null = null;
      for (const tw of left) if (same(pk.data, o, tw.plain.root.getWorldTransform().data, 16)) { hit = tw; break; }
      if (!hit) { fail(`frame ${frame}: an instance's model matrix matches no plain zombie in view`); continue; }
      left.delete(hit);
      const nm = hit.plain.root.normalMatrix.data;
      if (!same(pk.data, o + 16, nm.subarray(0, 3), 3) || !same(pk.data, o + 20, nm.subarray(3, 6), 3) || !same(pk.data, o + 24, nm.subarray(6, 9), 3)) fail(`frame ${frame}: normal matrix differs`);
      if (!Number.isInteger(r) || r < 0 || r >= st.bodies) fail(`frame ${frame}: pose row ${r} out of range`);
      const uParts = (hit.plain.root.render!.meshInstances[0].getParameter('uParts[0]') as unknown as { data: Float32Array }).data;
      // As the shader reads it: part i's three rows are texels (3i .. 3i+2, r).
      for (let part = 0; part < gfx.CHIBI_PARTS; part++) for (let q = 0; q < 3; q++) {
        const texel = (r * gfx.POSE_TEXELS + part * 3 + q) * 4;
        if (!same(pk.pose, texel, uParts.subarray((part * 3 + q) * 4), 4)) fail(`frame ${frame}: part ${part} row ${q} differs from uParts`);
      }
      if (!same(hit.inst.root.getWorldTransform().data, 0, hit.plain.root.getWorldTransform().data, 16)) fail(`frame ${frame}: twin transforms drifted`);
      compared++;
    }
    // Shadow rings: every plain shadow in view is somewhere in the shadow buffer.
    for (const tw of list) {
      const sh = shadowOf(tw.plain) as PC.Entity;
      if (!tw.plain.visible || !fr.containsAabb(sh.render!.meshInstances[0].aabb)) continue;
      const w = sh.getWorldTransform().data;
      let found = false;
      for (let k = 0; k < st.shadows && !found; k++) found = same(pk.shadow, k * gfx.INST_FLOATS, w, 16);
      if (!found) fail(`frame ${frame}: a shadow ring in view is missing from the instance buffer`); else ringsSeen++;
    }
  }
  if (rings) expectDraws++;
  if (st.bodies !== bodies) fail(`frame ${frame}: ${st.bodies} pose rows, expected ${bodies}`);
  if (st.shadows !== rings) fail(`frame ${frame}: ${st.shadows} shadow rings, expected ${rings}`);
  if (st.draws !== expectDraws) fail(`frame ${frame}: ${st.draws} draws, expected ${expectDraws}`);
  if (frame === 39) {
    const plainDraws = twins.reduce((n, tw) => n + (tw.plain.visible ? (fr.containsAabb(tw.plain.root.render!.meshInstances[0].aabb) ? 2 : 0) + (fr.containsAabb((shadowOf(tw.plain) as PC.Entity).render!.meshInstances[0].aabb) ? 1 : 0) : 0), 0);
    console.log(`last frame: ${twins.length} zombies of ${byMesh.size} looks, ${bodies} in view: ${plainDraws} draws the plain way, ${st.draws} by the horde`);
  }
}
console.log(`${compared} zombie-frames compared bit for bit (${hidden} hidden, ${offscreen} out of view skipped), ${ringsSeen} shadow rings`);
if (!compared || !hidden || !offscreen) fail('the run did not cover drawn, hidden and out-of-view zombies');

// No camera: nothing is drawn.
horde.flush(null);
if (horde.stats.draws !== 0 || twins.some((tw) => tw.inst.onScreen)) fail('with no camera something is still drawn');

// ------------------------------------------------------------------ shaders
const HEAD_VS = '#version 300 es\n#define attribute in\n#define varying out\n#define texture2D texture\nprecision highp float;\n';
const HEAD_FS = '#version 300 es\n#define varying in\n#define texture2D texture\nprecision highp float;\nout highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n';
if (spawnSync('glslangValidator', ['--version']).status === 0) {
  const dir = mkdtempSync(join(tmpdir(), 'horde-glsl-'));
  for (const [name, m] of [['toonHorde', gfx.hordeToonMat], ['inkHorde', gfx.hordeInkMat], ['toonParts', gfx.toonPartsMat], ['inkParts', gfx.outlinePartsMat], ['shadowInst', gfx.makeUnlitInst(0.38)]] as const) {
    const d = m.shaderDesc!;
    for (const [ext, src] of [['vert', HEAD_VS + d.vertexGLSL], ['frag', HEAD_FS + d.fragmentGLSL]] as const) {
      const f = join(dir, `${name}.${ext}`);
      writeFileSync(f, src);
      const r = spawnSync('glslangValidator', [f], { encoding: 'utf8' });
      if (r.status !== 0) fail(`${name}.${ext} does not compile:\n${r.stdout}`);
    }
  }
  console.log('shaders: horde toon, horde ink, parts toon, parts ink and instanced shadow compile as GLSL ES 3.00');
} else console.log('shaders: glslangValidator not installed, not compiled');

console.log(errors ? `${errors} error(s)` : 'horde check passed');
process.exit(errors ? 1 : 0);
