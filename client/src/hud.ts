// DOM heads-up display. Only touches the DOM when a value actually changes.
import { PSTATE, PLAYER, MEDS } from '../../shared/constants';
import { t } from './i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const RING_LEN = 163.4;

export interface MateView { id: number; name: string; color: string; hp: number; st: number; respawn: number }

export class Hud {
  private el = {
    hud: $('hud'), hpbar: $('hpbar'), hptext: $('hptext'), meds: $('meds'), armor: $('armor'), armorbar: $('armorbar'), throwable: $('throwable'), throwname: $('throwname'), throwkey: $('throwkey'), wname: $('wname'), mag: $('mag'), reserve: $('reserve'),
    acount: $('acount'), slots: $('slots'), team: $('team'), feed: $('feed'), banner: $('banner'), prompt: $('prompt'), ring: $('ring'),
    ringfg: document.getElementById('ringfg') as unknown as SVGCircleElement, ringlabel: $('ringlabel'), hitmark: $('hitmark'), vignette: $('vignette'),
    goo: $('goo'), gas: $('gas'), dmgdir: $('dmgdir'), objective: $('objective'), holdout: $('holdout'), room: $<HTMLButtonElement>('room'), crosshair: $('crosshair'),
    spectate: $('spectate'), end: $('end'), endtitle: $('endtitle'), endstats: $('endstats'), endboard: $('endboard'), pause: $('pause'),
    endnext: $('endnext'), waypoint: $('waypoint'), wpdist: $('wpdist'), radio: $('radio'), radiowho: $('radiowho'), radioline: $('radioline'),
    intro: $('intro'), introch: $('introch'), introtitle: $('introtitle'), introsub: $('introsub'), introtext: $('introtext'),
    notecard: $('notecard'), notetitle: $('notetitle'), notetext: $('notetext'),
  };
  private radioQ: [string, string][] = [];
  private radioT = 0;
  private introT = 0;
  private last: Record<string, string> = {};
  private hurtT = 0;
  private dirT = 0;
  private gooT = 0;
  private gasT = 0;

  private set(key: string, value: string, apply: (v: string) => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  show(on: boolean): void { this.el.hud.hidden = !on; }
  pause(on: boolean): void { this.el.pause.hidden = !on; }

  /** `diff`: difficulty label (English), shown unless Normal. */
  setRoom(code: string, diff = 'Normal'): void {
    const b = this.el.room, label = t('Room {code}', { code }) + (diff === 'Normal' ? '' : ` · ${t(diff)}`) + ` · ${t('copy invite')}`;
    b.textContent = label;
    b.onclick = () => {
      void navigator.clipboard?.writeText(location.href).then(() => {
        b.textContent = t('Invite link copied!');
        setTimeout(() => { b.textContent = label; }, 1600);
      });
    };
  }

  /**
   * The medical tray: one chip per kind carried (`counts` in MEDS order) with how many; `sel` is the one Q uses,
   * and it wears the Q badge. With more than one kind carried a Z chip shows how to switch.
   */
  setMeds(counts: readonly number[], sel: number): void {
    this.set('meds', `${counts.join(',')}|${sel}`, () => {
      const kinds = counts.filter((n) => n > 0).length;
      this.el.meds.hidden = kinds === 0;
      this.el.meds.innerHTML = MEDS.map((m, k) => (counts[k] > 0
        ? `<div class="med${k === sel ? ' sel' : ''}" title="${t(m.name)}">${m.icon}${counts[k] > 1 ? `<b>${counts[k]}</b>` : ''}${k === sel ? '<small>Q</small>' : ''}</div>` : '')).join('')
        + (kinds > 1 ? '<div class="medkey">Z</div>' : '');
    });
  }

  /** `armor` of `armorMax` vest points left; `throwable`: what G throws and what else is carried ('' = nothing); `throwKey`: the key hint on its chip. */
  setHealth(hp: number, st: number, armor = 0, armorMax = 1, throwable = '', throwKey = 'G'): void {
    const shown = Math.max(0, Math.min(PLAYER.hp, hp));
    this.set('hp', `${shown}|${st}`, () => {
      this.el.hpbar.style.width = `${shown}%`;
      this.el.hpbar.style.background = st === PSTATE.DOWN ? 'var(--pink)' : shown > 60 ? 'var(--green)' : shown > 30 ? 'var(--yellow)' : 'var(--pink)';
      this.el.hptext.textContent = st === PSTATE.DOWN ? t('DOWN! {hp}', { hp: shown }) : st === PSTATE.DEAD ? t('OUT') : String(shown);
    });
    const ar = Math.max(0, Math.min(armorMax, armor));
    this.set('ar', String(ar), () => { this.el.armor.hidden = ar <= 0; this.el.armorbar.style.width = `${(ar / armorMax) * 100}%`; });
    this.set('th', `${throwable}|${throwKey}`, () => { this.el.throwable.hidden = !throwable; this.el.throwname.textContent = throwable; this.el.throwkey.textContent = throwKey; });
    // Low health keeps a faint red edge on screen.
    const base = st === PSTATE.ALIVE && shown < 35 ? 0.35 : st === PSTATE.DOWN ? 0.5 : 0;
    this.set('vig', (Math.max(base, this.hurtT > 0 ? 0.9 : 0)).toFixed(2), (v) => { this.el.vignette.style.opacity = v; });
  }

  /**
   * `primary` / `sidearm` / `melee` name the slots ('' = empty); `slot` is the one in hand (1-3).
   * A close-in weapon has no ammo: pass `mag` = Infinity. `reserve` < 0 shows none (a throwable: `mag` is how many).
   * `throws[k]`: label of throwable slot 4 + k ('' = none carried).
   */
  setAmmo(name: string, mag: number, reserve: number, magSize: number, reloading: boolean, primary: string, slot: number, sidearm = t('sidearm'), melee = '', throws: string[] = []): void {
    const endless = !Number.isFinite(mag);
    this.set('wn', name + reloading, () => { this.el.wname.textContent = reloading ? `${name} · ${t('reloading…')}` : name; });
    this.set('mag', endless ? '∞' : String(mag), (v) => { this.el.mag.textContent = v; });
    this.set('res', endless || reserve < 0 ? '' : String(reserve), (v) => { this.el.reserve.textContent = !v ? '' : Number.isFinite(reserve) ? `/ ${v}` : '/ ∞'; });
    this.set('low', String(!endless && mag <= magSize * 0.25), (v) => { this.el.acount.classList.toggle('low', v === 'true'); });
    this.set('slots', `${primary}|${sidearm}|${melee}|${throws.join('|')}|${slot}`, () => {
      const cell = (n: number, label: string) => { const s = document.createElement('span'); if (slot === n) s.className = 'on'; s.textContent = `${n} ${label || '—'}`; return s; };
      this.el.slots.replaceChildren(cell(1, primary), cell(2, sidearm), ...(melee ? [cell(3, melee)] : []), ...throws.flatMap((label, k) => (label ? [cell(4 + k, label)] : [])));
    });
  }

  setTeam(mates: MateView[]): void {
    const key = mates.map((m) => `${m.id}:${m.name}:${m.hp}:${m.st}:${m.respawn}`).join('|');
    this.set('team', key, () => {
      this.el.team.replaceChildren(...mates.map((m) => {
        const d = document.createElement('div');
        d.className = `mate ${m.st === PSTATE.DOWN ? 'down' : m.st === PSTATE.DEAD ? 'dead' : ''}`;
        const n = document.createElement('div');
        n.style.color = m.color;
        n.textContent = m.st === PSTATE.DOWN ? t('{who} — needs help!', { who: m.name }) : m.st === PSTATE.DEAD ? (m.respawn < 0 ? t('{who} — rescue at the safe room', { who: m.name }) : t('{who} — back in {s}s', { who: m.name, s: m.respawn })) : m.name;
        const bar = document.createElement('div');
        bar.className = 'bar';
        const fill = document.createElement('i');
        fill.style.width = `${Math.max(0, Math.min(100, m.hp))}%`;
        bar.append(fill); d.append(n, bar);
        return d;
      }));
    });
  }

  setObjective(text: string): void { this.set('obj', text, (v) => { this.el.objective.textContent = v; }); }
  flashObjective(): void { const o = this.el.objective; o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash'); }

  /** Screen position (CSS px) of the quest marker, or null to hide it. `edge` = clamped because it is off-screen. */
  /** `vert`: the target is a storey above (1) or below (-1) you (multi-storey maps), shown as an arrow by the distance. */
  waypoint(x: number | null, y = 0, dist = 0, edge = false, vert = 0): void {
    const w = this.el.waypoint;
    this.set('wpOn', String(x !== null), () => { w.hidden = x === null; });
    if (x === null) return;
    w.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    this.set('wpEdge', String(edge), () => { w.classList.toggle('edge', edge); });
    const arrow = vert > 0 ? ' ▲' : vert < 0 ? ' ▼' : '';
    this.set('wpDist', `${Math.round(dist)}${arrow}`, () => { this.el.wpdist.textContent = `${Math.round(dist)} m${arrow}`; });
  }

  /** A radio line went up (speaker, text, seconds it will show). Wired to the radio sound by main.ts. */
  onRadioLine: ((who: string, text: string, seconds: number) => void) | null = null;
  /** The radio went quiet: `cleared` when the queue was replaced/emptied mid-line rather than running out. */
  onRadioEnd: ((cleared: boolean) => void) | null = null;

  /** Queue radio/bark lines; each shows for a few seconds. `now` replaces whatever is playing (`[]` + `now` clears). */
  radio(lines: [string, string][], now = false): void {
    if (now) {
      this.radioQ = []; this.radioT = 0;
      if (!this.el.radio.hidden) { this.el.radio.hidden = true; this.onRadioEnd?.(true); }
    }
    this.radioQ.push(...lines);
  }
  private nextRadio(): void {
    const line = this.radioQ.shift(), was = !this.el.radio.hidden;
    this.el.radio.hidden = !line;
    if (!line) { if (was) this.onRadioEnd?.(false); return; }
    this.el.radiowho.textContent = line[0];
    this.el.radioline.textContent = line[1];
    this.radioT = 2.6 + line[1].length * 0.05;
    this.onRadioLine?.(line[0], line[1], this.radioT);
  }

  intro(chapterNo: number, title: string, subtitle: string, text: string): void {
    const e = this.el;
    e.introch.textContent = t('CHAPTER {n}', { n: chapterNo });
    e.introtitle.textContent = title; e.introsub.textContent = subtitle; e.introtext.textContent = text;
    e.intro.hidden = false;
    e.intro.style.transition = ''; e.intro.style.opacity = '';
    e.intro.style.animation = 'none'; void e.intro.offsetWidth; e.intro.style.animation = '';
    this.introT = 9;
  }

  note(title: string | null, text = ''): void {
    this.el.notecard.hidden = title === null;
    if (title === null) return;
    this.el.notetitle.textContent = title; this.el.notetext.textContent = text;
  }
  get noteOpen(): boolean { return !this.el.notecard.hidden; }
  setHoldout(seconds: number): void {
    this.set('ho', String(seconds), () => { this.el.holdout.hidden = seconds < 0; this.el.holdout.textContent = t('HOLD OUT! {s}s', { s: seconds }); });
  }

  feed(text: string): void {
    const d = document.createElement('div');
    d.textContent = text;
    this.el.feed.append(d);
    while (this.el.feed.children.length > 5) this.el.feed.firstElementChild!.remove();
    setTimeout(() => d.remove(), 6000);
  }

  /** Big centre banner. It sits where the chapter card is, so a banner fades a card still up out first (they never overlap). */
  banner(text: string, bad = false): void {
    const b = this.el.banner, intro = this.el.intro;
    if (this.introT > 0.25) {
      // Hold the card at its current opacity (stop the keyframes), then fade it out quickly; update() hides it.
      intro.style.opacity = getComputedStyle(intro).opacity; intro.style.animation = 'none';
      void intro.offsetWidth; intro.style.transition = 'opacity 0.25s'; intro.style.opacity = '0';
      this.introT = 0.25;
    }
    b.textContent = text;
    b.classList.toggle('bad', bad);
    b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
  }

  prompt(html: string | null): void {
    this.set('prompt', html ?? '', (v) => { this.el.prompt.hidden = !v; this.el.prompt.innerHTML = v; });
  }

  ring(frac: number | null, label = '', color = 'var(--green)'): void {
    this.set('ringOn', String(frac !== null), () => { this.el.ring.hidden = frac === null; });
    if (frac === null) return;
    this.el.ringfg.style.strokeDashoffset = String(RING_LEN * (1 - Math.max(0, Math.min(1, frac))));
    this.set('ringLabel', label + color, () => { this.el.ringlabel.textContent = label; this.el.ringfg.style.stroke = color; });
  }

  hitmark(head: boolean, kill: boolean): void {
    const h = this.el.hitmark;
    h.style.setProperty('--c', kill ? '#ff5d8f' : head ? '#ffd43b' : '#ffffff');
    h.classList.remove('on'); void h.offsetWidth; h.classList.add('on');
  }

  /** `angle` is clockwise radians from straight ahead. */
  hurt(angle: number): void {
    this.hurtT = 0.3; this.dirT = 0.9;
    this.el.dmgdir.style.transform = `rotate(${angle}rad)`;
    this.el.dmgdir.style.opacity = '1';
  }
  /**
   * A Puffer burst nearby: a yellow wash over the view, `k` (0..1) as thick as it is close. A page overlay
   * rather than full-screen particles (those are shrunk near the eye, see gfx.ts NEAR_VS), so it costs no GPU fill.
   */
  gas(k: number): void {
    if (k <= 0) return;
    this.gasT = 0.35 + 0.9 * k;
    this.el.gas.style.transition = 'opacity 0.08s';
    this.el.gas.style.opacity = String(Math.min(1, Math.max(Number(this.el.gas.style.opacity) || 0, k)));
  }
  goo(): void { this.gooT = 4; this.el.goo.style.transition = 'opacity 0.1s'; this.el.goo.style.opacity = '1'; }

  spread(px: number): void { this.set('gap', px.toFixed(0), (v) => { this.el.crosshair.style.setProperty('--gap', `${v}px`); }); }
  crosshair(on: boolean): void { this.set('ch', String(on), () => { this.el.crosshair.style.display = on ? '' : 'none'; }); }
  spectate(text: string | null): void { this.set('spec', text ?? '', (v) => { this.el.spectate.hidden = !v; this.el.spectate.textContent = v; }); }

  update(dt: number): void {
    this.hurtT -= dt;
    if (this.radioT > 0 || this.radioQ.length) { this.radioT -= dt; if (this.radioT <= 0) this.nextRadio(); }
    if (this.introT > 0) { this.introT -= dt; if (this.introT <= 0) this.el.intro.hidden = true; }
    if (this.dirT > 0) { this.dirT -= dt; if (this.dirT <= 0) this.el.dmgdir.style.opacity = '0'; }
    if (this.gasT > 0) { this.gasT -= dt; if (this.gasT <= 0) { this.el.gas.style.transition = 'opacity 1.4s'; this.el.gas.style.opacity = '0'; } }
    if (this.gooT > 0) { this.gooT -= dt; if (this.gooT <= 1.2) { this.el.goo.style.transition = 'opacity 1.2s'; this.el.goo.style.opacity = '0'; } }
  }

  showEnd(won: boolean, kills: number, seconds: number, board: { name: string; kills: number }[], next: string): void {
    this.el.end.hidden = false;
    this.el.endnext.textContent = next;
    this.el.endtitle.textContent = t(won ? 'Chapter complete!' : 'Squad wiped…');
    this.el.endtitle.style.color = won ? '#2f9e44' : '#c92a4b';
    const m = Math.floor(seconds / 60), s = String(seconds % 60).padStart(2, '0');
    this.el.endstats.textContent = t('{kills} zombies bonked in {time}', { kills, time: `${m}:${s}` });
    this.el.endboard.replaceChildren(...board.sort((a, b) => b.kills - a.kills).map((r) => {
      const li = document.createElement('li');
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = r.name; b.textContent = t('{n} kills', { n: r.kills });
      li.append(a, b);
      return li;
    }));
  }
  hideEnd(): void { this.el.end.hidden = true; }
}
