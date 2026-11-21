// DOM heads-up display. Only touches the DOM when a value actually changes.
import { PSTATE, PLAYER } from '../../shared/constants';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const RING_LEN = 163.4;

export interface MateView { id: number; name: string; color: string; hp: number; st: number; respawn: number }

export class Hud {
  private el = {
    hud: $('hud'), hpbar: $('hpbar'), hptext: $('hptext'), medkit: $('medkit'), wname: $('wname'), mag: $('mag'), reserve: $('reserve'),
    acount: $('acount'), slots: $('slots'), team: $('team'), feed: $('feed'), banner: $('banner'), prompt: $('prompt'), ring: $('ring'),
    ringfg: document.getElementById('ringfg') as unknown as SVGCircleElement, ringlabel: $('ringlabel'), hitmark: $('hitmark'), vignette: $('vignette'),
    goo: $('goo'), dmgdir: $('dmgdir'), objective: $('objective'), holdout: $('holdout'), room: $<HTMLButtonElement>('room'), crosshair: $('crosshair'),
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

  private set(key: string, value: string, apply: (v: string) => void): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    apply(value);
  }

  show(on: boolean): void { this.el.hud.hidden = !on; }
  pause(on: boolean): void { this.el.pause.hidden = !on; }

  setRoom(code: string): void {
    const b = this.el.room;
    b.textContent = `Room ${code} · copy invite`;
    b.onclick = () => {
      void navigator.clipboard?.writeText(location.href).then(() => {
        b.textContent = 'Invite link copied!';
        setTimeout(() => { b.textContent = `Room ${code} · copy invite`; }, 1600);
      });
    };
  }

  setHealth(hp: number, st: number, medkits: number): void {
    const shown = Math.max(0, Math.min(PLAYER.hp, hp));
    this.set('hp', `${shown}|${st}`, () => {
      this.el.hpbar.style.width = `${shown}%`;
      this.el.hpbar.style.background = st === PSTATE.DOWN ? 'var(--pink)' : shown > 60 ? 'var(--green)' : shown > 30 ? 'var(--yellow)' : 'var(--pink)';
      this.el.hptext.textContent = st === PSTATE.DOWN ? `DOWN! ${shown}` : st === PSTATE.DEAD ? 'OUT' : String(shown);
    });
    this.set('mk', String(medkits), () => { this.el.medkit.hidden = medkits < 1; });
    // Low health keeps a faint red edge on screen.
    const base = st === PSTATE.ALIVE && shown < 35 ? 0.35 : st === PSTATE.DOWN ? 0.5 : 0;
    this.set('vig', (Math.max(base, this.hurtT > 0 ? 0.9 : 0)).toFixed(2), (v) => { this.el.vignette.style.opacity = v; });
  }

  /** `primary` / `sidearm` name the slots ('' = empty primary). */
  setAmmo(name: string, mag: number, reserve: number, magSize: number, reloading: boolean, primary: string, slot: number, sidearm = 'sidearm'): void {
    this.set('wn', name + reloading, () => { this.el.wname.textContent = reloading ? `${name} · reloading…` : name; });
    this.set('mag', String(mag), (v) => { this.el.mag.textContent = v; });
    this.set('res', String(reserve), () => { this.el.reserve.textContent = Number.isFinite(reserve) ? `/ ${reserve}` : '/ ∞'; });
    this.set('low', String(mag <= magSize * 0.25), (v) => { this.el.acount.classList.toggle('low', v === 'true'); });
    this.set('slots', `${primary}|${sidearm}|${slot}`, () => {
      this.el.slots.innerHTML = `<span class="${slot === 1 ? 'on' : ''}">1 ${primary || '—'}</span><span class="${slot === 2 ? 'on' : ''}">2 ${sidearm}</span>`;
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
        n.textContent = m.st === PSTATE.DOWN ? `${m.name} — needs help!` : m.st === PSTATE.DEAD ? `${m.name} — back in ${m.respawn}s` : m.name;
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
  waypoint(x: number | null, y = 0, dist = 0, edge = false): void {
    const w = this.el.waypoint;
    this.set('wpOn', String(x !== null), () => { w.hidden = x === null; });
    if (x === null) return;
    w.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    this.set('wpEdge', String(edge), () => { w.classList.toggle('edge', edge); });
    this.set('wpDist', String(Math.round(dist)), (v) => { this.el.wpdist.textContent = `${v} m`; });
  }

  /** Queue radio/bark lines; each shows for a few seconds. `now` replaces whatever is playing. */
  radio(lines: [string, string][], now = false): void {
    if (now) { this.radioQ = []; this.radioT = 0; }
    this.radioQ.push(...lines);
  }
  private nextRadio(): void {
    const line = this.radioQ.shift();
    this.el.radio.hidden = !line;
    if (!line) return;
    this.el.radiowho.textContent = line[0];
    this.el.radioline.textContent = line[1];
    this.radioT = 2.6 + line[1].length * 0.05;
  }

  intro(chapterNo: number, title: string, subtitle: string, text: string): void {
    const e = this.el;
    e.introch.textContent = `CHAPTER ${chapterNo}`;
    e.introtitle.textContent = title; e.introsub.textContent = subtitle; e.introtext.textContent = text;
    e.intro.hidden = false;
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
    this.set('ho', String(seconds), () => { this.el.holdout.hidden = seconds < 0; this.el.holdout.textContent = `HOLD OUT! ${seconds}s`; });
  }

  feed(text: string): void {
    const d = document.createElement('div');
    d.textContent = text;
    this.el.feed.append(d);
    while (this.el.feed.children.length > 5) this.el.feed.firstElementChild!.remove();
    setTimeout(() => d.remove(), 6000);
  }

  banner(text: string, bad = false): void {
    const b = this.el.banner;
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
  goo(): void { this.gooT = 4; this.el.goo.style.transition = 'opacity 0.1s'; this.el.goo.style.opacity = '1'; }

  spread(px: number): void { this.set('gap', px.toFixed(0), (v) => { this.el.crosshair.style.setProperty('--gap', `${v}px`); }); }
  crosshair(on: boolean): void { this.set('ch', String(on), () => { this.el.crosshair.style.display = on ? '' : 'none'; }); }
  spectate(text: string | null): void { this.set('spec', text ?? '', (v) => { this.el.spectate.hidden = !v; this.el.spectate.textContent = v; }); }

  update(dt: number): void {
    this.hurtT -= dt;
    if (this.radioT > 0 || this.radioQ.length) { this.radioT -= dt; if (this.radioT <= 0) this.nextRadio(); }
    if (this.introT > 0) { this.introT -= dt; if (this.introT <= 0) this.el.intro.hidden = true; }
    if (this.dirT > 0) { this.dirT -= dt; if (this.dirT <= 0) this.el.dmgdir.style.opacity = '0'; }
    if (this.gooT > 0) { this.gooT -= dt; if (this.gooT <= 1.2) { this.el.goo.style.transition = 'opacity 1.2s'; this.el.goo.style.opacity = '0'; } }
  }

  showEnd(won: boolean, kills: number, seconds: number, board: { name: string; kills: number }[], next: string): void {
    this.el.end.hidden = false;
    this.el.endnext.textContent = next;
    this.el.endtitle.textContent = won ? 'Chapter complete!' : 'Squad wiped…';
    this.el.endtitle.style.color = won ? '#2f9e44' : '#c92a4b';
    const m = Math.floor(seconds / 60), s = String(seconds % 60).padStart(2, '0');
    this.el.endstats.textContent = `${kills} zombies bonked in ${m}:${s}`;
    this.el.endboard.replaceChildren(...board.sort((a, b) => b.kills - a.kills).map((r) => {
      const li = document.createElement('li');
      const a = document.createElement('span'), b = document.createElement('span');
      a.textContent = r.name; b.textContent = `${r.kills} kills`;
      li.append(a, b);
      return li;
    }));
  }
  hideEnd(): void { this.el.end.hidden = true; }
}
