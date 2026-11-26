// Player-facing graphics settings: where they are stored and how they are read. No engine or DOM
// imports, so gfx.ts can read them before the device exists; the controls live in gfxui.ts.
//   Resolution     localStorage `chibi.scale` (a cap on devicePixelRatio), `?scale=` overrides. Live.
//   Anti-aliasing  localStorage `chibi.aa` ('0' = off), `?aa=0` / `?aa=1` overrides. Needs a reload:
//                  the engine picks the backbuffer's sample count once, when the device is created.
//   Stats panel    localStorage `chibi.stats` ('1' = shown); `?debug` always shows it. Live.
// Nothing here changes on its own: the game never lowers the resolution by itself.

export const SCALE_KEY = 'chibi.scale';
export const AA_KEY = 'chibi.aa';
export const STATS_KEY = 'chibi.stats';
/** Render scale cap when nothing is chosen: native pixels, up to 2x. */
export const SCALE_DEFAULT = 2;
/** The resolution choices offered, sharpest first. `label` and `hint` are English i18n keys. */
export const SCALES: readonly { v: number; label: string; hint: string }[] = [
  { v: SCALE_DEFAULT, label: 'Sharp', hint: 'full detail' },
  { v: 1.25, label: 'Balanced', hint: 'a little softer, faster' },
  { v: 1, label: 'Fast', hint: 'softer, much faster' },
  { v: 0.75, label: 'Fastest', hint: 'blurry, for slow computers' },
];

const query = (k: string): string | null => (typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(k));
const stored = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const clampScale = (v: number): number => Math.min(Math.max(v, 0.25), 3);

/**
 * Render scale cap: the engine takes min(this, the live devicePixelRatio) on every resize, so a window
 * dragged to a sharper screen follows it. `?scale=1` (or 1.5, 2) wins over the saved choice.
 */
export function renderScale(): number {
  let v = Number(query('scale'));
  if (!(v > 0)) v = Number(stored(SCALE_KEY));
  return v > 0 ? clampScale(v) : SCALE_DEFAULT;
}
/** Remember the render scale cap (the caller applies it to the device). */
export function saveRenderScale(v: number): void { store(SCALE_KEY, String(clampScale(v))); }

const parseAa = (s: string | null): boolean | null => (s === '0' || s === 'off' || s === 'false' ? false : s === '1' || s === 'on' || s === 'true' ? true : null);
/** The saved anti-aliasing choice (what the next load will use unless `?aa=` says otherwise). On by default. */
export function savedAntialias(): boolean { return parseAa(stored(AA_KEY)) ?? true; }
/** Anti-aliasing for this page load: `?aa=0`/`?aa=1`, then the saved choice, else on. */
export function antialias(): boolean { return parseAa(query('aa')) ?? savedAntialias(); }
/** Remember the anti-aliasing choice; it takes effect on the next load. */
export function saveAntialias(on: boolean): void { store(AA_KEY, on ? '1' : '0'); }

/** Whether the performance stats panel is shown: `?debug` always, else the saved choice (off by default). */
export function statsOn(): boolean { return query('debug') !== null || stored(STATS_KEY) === '1'; }
/** Remember the stats panel choice. */
export function saveStats(on: boolean): void { store(STATS_KEY, on ? '1' : '0'); }
