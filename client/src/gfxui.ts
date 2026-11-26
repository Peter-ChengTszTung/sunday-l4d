// The "Graphics" section of the lobby card and the pause card: resolution (applies at once) and
// anti-aliasing (applies after a reload). Both copies show the same state; the DOM is only
// touched when a choice or the window size changes, never per frame.
import * as pc from 'playcanvas';
import { app, device, setRenderScale, AA_REQUESTED } from './gfx';
import { SCALES, renderScale, saveRenderScale, saveAntialias, statsOn, saveStats } from './gfxsettings';
import { t } from './i18n';

interface Panel { scale: HTMLSelectElement; res: HTMLElement; aa: HTMLInputElement; note: HTMLElement; stats: HTMLInputElement }

/**
 * The engine's MiniStats panel (frame, CPU and GPU time, draw calls), made only while shown and destroyed
 * when hidden, so it costs nothing when off (it also switches on the GPU timer queries). It draws in the
 * canvas's bottom-left corner, where the HUD's health block sits: that block moves to its right meanwhile.
 */
let mini: pc.MiniStats | null = null;
const status = () => document.getElementById('status');
function moveHud(): void {
  const s = status();
  if (!s || !mini) return;
  const right = (parseFloat(mini.div.style.left) || 0) + (parseFloat(mini.div.style.width) || 0);
  const left = `${Math.round(right + 8)}px`;
  if (s.style.left !== left) s.style.left = left;
}
function showStats(on: boolean): void {
  if (on === !!mini) return;
  if (on) {
    // The engine's default rows plus frames per second (app.stats.frame.fps, counted over each second), on top.
    const opts = pc.MiniStats.getDefaultOptions();
    opts.stats.unshift({ name: 'FPS', stats: ['frame.fps'], decimalPlaces: 0, watermark: 1000 });
    mini = new pc.MiniStats(app, opts); app.on('postrender', moveHud);
  }
  else {
    app.off('postrender', moveHud); mini!.destroy(); mini = null;
    if (device.gpuProfiler) device.gpuProfiler.enabled = false; // MiniStats leaves the GPU timer queries on
    const s = status(); if (s) s.style.left = '';
  }
}

let uid = 0;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Build the Graphics section into every host element. `open` hosts start expanded; `leaves` hosts
 * warn that reloading drops the game in progress (the pause card).
 */
export function initGraphicsUi(hosts: { host: HTMLElement; open?: boolean; leaves?: boolean }[]): void {
  /** The cap in force (a `?scale=` or hand-saved value may not be one of the presets). */
  let scale = renderScale();
  /** What the next load will use; AA_REQUESTED is what this one is using. */
  let aaNext = AA_REQUESTED;
  /** The browser cannot multisample the backbuffer (the engine turns it off on some), so the switch would do nothing. */
  const aaUnsupported = AA_REQUESTED && device.samples <= 1;
  const panels: Panel[] = [];

  const sync = (): void => {
    const custom = !SCALES.some((s) => s.v === scale);
    const res = t('Drawing {w} × {h} pixels', { w: device.width, h: device.height });
    for (const p of panels) {
      const opt = p.scale.querySelector<HTMLOptionElement>('option[data-custom]')!;
      opt.hidden = opt.disabled = !custom;
      if (custom) { opt.value = String(scale); opt.textContent = t('Custom ({n}×)', { n: scale }); }
      p.scale.value = String(scale);
      if (p.res.textContent !== res) p.res.textContent = res;
      p.aa.checked = !aaUnsupported && aaNext;
      p.note.hidden = aaUnsupported || aaNext === AA_REQUESTED;
      p.stats.checked = !!mini;
    }
  };
  const pickScale = (v: number): void => {
    if (!(v > 0)) return;
    scale = v;
    saveRenderScale(v);
    setRenderScale(v);
    sync();
  };
  const pickAa = (on: boolean): void => { aaNext = on; saveAntialias(on); sync(); };
  const pickStats = (on: boolean): void => { saveStats(on); showStats(on); sync(); };
  /** Reload so the anti-aliasing choice takes hold; a `?aa=` in the address would override it, so drop that. */
  const reload = (): void => {
    const u = new URL(location.href);
    u.searchParams.delete('aa');
    if (u.href === location.href) location.reload(); else location.replace(u.href);
  };

  for (const { host, open, leaves } of hosts) {
    const id = `gfx${uid++}`;
    const box = el('details', 'gfxset');
    box.open = !!open;
    box.append(el('summary', '', t('Graphics')));
    const body = el('div', 'gfxbody');

    const scaleLabel = el('label', '', t('Resolution'));
    const scaleSel = el('select');
    scaleSel.setAttribute('aria-describedby', `${id}res`);
    for (const s of SCALES) { const o = el('option', '', t('{a}: {b}', { a: t(s.label), b: t(s.hint) })); o.value = String(s.v); scaleSel.append(o); }
    const customOpt = el('option'); customOpt.dataset.custom = '1'; customOpt.hidden = customOpt.disabled = true; scaleSel.append(customOpt);
    scaleLabel.append(scaleSel);
    const res = el('small', 'gfxres'); res.id = `${id}res`;
    scaleSel.addEventListener('change', () => pickScale(Number(scaleSel.value)));

    const aaLabel = el('label', 'check');
    const aaBox = el('input'); aaBox.type = 'checkbox'; aaBox.disabled = aaUnsupported;
    aaBox.setAttribute('aria-describedby', `${id}note`);
    aaLabel.append(aaBox, t('Smooth edges (anti-aliasing)'));
    aaBox.addEventListener('change', () => pickAa(aaBox.checked));

    const note = el('p', 'gfxnote'); note.id = `${id}note`; note.setAttribute('role', 'status');
    const btn = el('button', 'btn', t('RELOAD NOW')); btn.type = 'button';
    btn.addEventListener('click', reload);
    note.append(el('span', '', t(leaves ? 'Smooth edges change after a reload. Reloading leaves this game.' : 'Smooth edges change after a reload.')), btn);

    const statsLabel = el('label', 'check');
    const statsBox = el('input'); statsBox.type = 'checkbox';
    statsLabel.append(statsBox, t('Show performance stats'));
    statsBox.addEventListener('change', () => pickStats(statsBox.checked));

    body.append(scaleLabel, res, aaLabel, statsLabel);
    if (aaUnsupported) body.append(el('p', 'gfxnote', t('This browser cannot smooth edges.')));
    body.append(note);
    box.append(body);
    // On the pause card a click anywhere re-grabs the mouse: not while using these controls.
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    host.append(box);
    panels.push({ scale: scaleSel, res, aa: aaBox, note, stats: statsBox });
  }

  // gfx.ts resizes the canvas on the same event (its listener is registered first), so the size read here is the new one.
  window.addEventListener('resize', sync);
  showStats(statsOn());
  sync();
}
