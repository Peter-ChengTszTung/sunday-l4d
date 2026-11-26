// A browser that draws nothing, for the dev scripts that build the client's world in Node (check-cull.ts,
// bake-cull.ts): import this before any client module (gfx.ts starts the engine on import).
// `CULL=...` in the environment becomes `?cull=...` in the page's address (see client/src/cull.ts).
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
  location: { search: process.env.CULL ? `?cull=${process.env.CULL}` : '', href: 'http://localhost/', hostname: 'localhost', protocol: 'http:', host: 'localhost' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  HTMLCanvasElement: class {}, HTMLImageElement: class {}, HTMLVideoElement: class {}, ImageBitmap: class {}, HTMLElement: class {}, Image: class {},
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  document: { getElementById: (id: string) => (id === 'game' ? game : element()), createElement: (t: string) => (t === 'canvas' ? fakeCanvas() : element()), addEventListener() {}, removeEventListener() {}, body: element(), documentElement: element(), head: element(), querySelector: () => element(), querySelectorAll: () => [], hidden: false, visibilityState: 'visible' },
});
if (!('navigator' in g) || !(g.navigator as { userAgent?: string }).userAgent) Object.defineProperty(g, 'navigator', { value: { userAgent: 'node', platform: 'linux', maxTouchPoints: 0, language: 'en', languages: ['en'], getGamepads: () => [] }, configurable: true });
export {};
