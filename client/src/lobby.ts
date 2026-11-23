// The lobby card: name, language and difficulty, joining (quick play, create, invite, the open-room
// list) and the chapter and start-at pickers that also steer the lobby backdrop.
import { CHAPTERS } from '../../shared/chapters';
import { DIFFICULTIES, difficultyLabel, parseDifficulty } from '../../shared/constants';
import type { Level } from '../../shared/level';
import type { RoomInfo } from '../../shared/protocol';
import type { Net, JoinOpts } from './net';
import type { Sfx } from './audio';
import { t, tMsg, lang, LANGS, setLang, type Lang } from './i18n';

export interface LobbyDeps {
  net: Net;
  sfx: Sfx;
  /** URL query parameters (`name`, `room`). */
  params: URLSearchParams;
  /** The chapter shown (and offered for a new room). */
  chapter: () => number;
  /** The level shown, for its checkpoint safe rooms. */
  level: () => Level;
  /** Show chapter `ch` behind the lobby. */
  loadChapter: (ch: number) => void;
  /** In a room or on the range (the room list stops polling). */
  inGame: () => boolean;
}

export interface Lobby {
  /** Connect with the name typed in; the lobby buttons stay disabled until it fails. */
  join(opts: Omit<JoinOpts, 'name'>): Promise<void>;
  /** Refresh the open-room list (only while the lobby is showing). */
  refreshRooms(): Promise<void>;
  /** Enable (or disable) every lobby button. */
  setButtons(enabled: boolean): void;
  /** The line under the lobby buttons (errors, disconnects). */
  message(text: string): void;
  /** The chapter picked in the chapter picker. */
  pickedChapter(): number;
  /** The start-at pick: -1 for the chapter start, else a checkpoint step index. */
  startAt(): number;
  /** Room code from an invite link (`?room=` or `#CODE`), or ''. */
  readonly inviteCode: string;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initLobby(deps: LobbyDeps): Lobby {
  const { net, sfx, params } = deps;
  const nameInput = $<HTMLInputElement>('name');
  const langSelect = $<HTMLSelectElement>('lang');
  langSelect.replaceChildren(...LANGS.map((l) => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.label; return o; }));
  langSelect.value = lang;
  langSelect.addEventListener('change', () => { setLang(langSelect.value as Lang); });
  /** New-room difficulty (remembered like the chapter). */
  const diffSelect = $<HTMLSelectElement>('difficulty');
  diffSelect.replaceChildren(...DIFFICULTIES.map((d) => { const o = document.createElement('option'); o.value = d.id; o.textContent = t('{a}: {b}', { a: t(d.label), b: t(d.hint) }); return o; }));
  diffSelect.value = parseDifficulty(localStorage.getItem('chibi.diff') ?? 'normal');
  nameInput.value = params.get('name') ?? localStorage.getItem('chibi.name') ?? '';
  const inviteCode = (params.get('room') ?? location.hash.slice(1)).toUpperCase().replace(/[^A-Z0-9]/g, '');

  const lobbyButtons = () => [...document.querySelectorAll<HTMLButtonElement>('#lobby button')];
  const setButtons = (enabled: boolean): void => { for (const b of lobbyButtons()) b.disabled = !enabled; };
  const message = (text: string): void => { $('lobbymsg').textContent = text; };
  async function join(opts: Omit<JoinOpts, 'name'>): Promise<void> {
    setButtons(false);
    message('');
    sfx.unlock();
    try {
      localStorage.setItem('chibi.name', nameInput.value.trim()); localStorage.setItem('chibi.ch', String(deps.chapter()));
      localStorage.setItem('chibi.diff', diffSelect.value);
    } catch { /* private mode */ }
    try { await net.connect({ name: nameInput.value.trim(), ...opts }); }
    catch (e) { message(tMsg((e as Error).message)); setButtons(true); }
  }
  $('create').addEventListener('submit', (e) => {
    e.preventDefault();
    void join({ room: '', create: true, ch: deps.chapter(), cp: Number(startSelect.value), priv: $<HTMLInputElement>('priv').checked, diff: diffSelect.value });
  });
  $('quick').addEventListener('click', () => { void join({ room: '' }); });
  if (inviteCode) {
    $('invite').hidden = false;
    $('invitecode').textContent = inviteCode;
    $('joininvite').addEventListener('click', () => { void join({ room: inviteCode }); });
  }

  /** Open rooms, polled while the lobby is showing. */
  async function refreshRooms(): Promise<void> {
    if (deps.inGame() || $('lobby').hidden) return;
    let list: RoomInfo[];
    try { list = await (await fetch('/api/rooms', { cache: 'no-store' })).json(); } catch { return; }
    const ul = $('rooms');
    $('roomcount').textContent = list.length ? `(${list.length})` : '';
    if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('No open rooms yet. Create one!'); ul.replaceChildren(li); return; }
    ul.replaceChildren(...list.map((r) => {
      const li = document.createElement('li');
      const rt = document.createElement('div'); rt.className = 'rt';
      const code = document.createElement('b'); code.textContent = r.code;
      rt.append(code, t('Ch {n} · {title}', { n: r.ch + 1, title: t(r.title) }));
      const diff = parseDifficulty(r.diff ?? 'normal');
      if (diff !== 'normal') { const d = document.createElement('span'); d.className = `rd ${diff}`; d.textContent = t(difficultyLabel(diff)); rt.append(d); }
      const st = document.createElement('div'); st.className = 'rs';
      st.textContent = `${r.state === 'play' ? t('Step {n}/{of}: {obj}', { n: r.step, of: r.steps, obj: t(r.objective) }) : t(r.state === 'won' ? 'Chapter complete' : 'Regrouping')} · ${r.players.length}/${r.max} ${r.players.join(', ')}`;
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn';
      btn.textContent = t(r.players.length >= r.max ? 'FULL' : 'JOIN');
      btn.disabled = r.players.length >= r.max;
      btn.addEventListener('click', () => { void join({ room: r.code }); });
      li.append(rt, btn, st);
      return li;
    }));
  }
  setInterval(() => { void refreshRooms(); }, 3000);
  void refreshRooms();

  // Chapter picker (also swaps the lobby backdrop).
  const chapterSelect = $<HTMLSelectElement>('chapter');
  chapterSelect.replaceChildren(...CHAPTERS.map((c, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i + 1}. ${t(c.title)}`; return o; }));
  chapterSelect.value = String(deps.chapter());
  const startSelect = $<HTMLSelectElement>('startat');
  /** "Start at" choices: the chapter start or any of its checkpoint safe rooms. */
  function fillStarts(): void {
    const opts: [number, string][] = [[-1, t('Chapter start')]];
    deps.level().def.steps.forEach((s, i) => {
      if (s.kind !== 'gather' || !s.checkpoint) return;
      // English drops the verb ("Regroup in the diner" → "the diner"); other languages show the whole objective.
      const where = lang === 'en' ? s.objective.replace(/^(Get everyone into|Regroup in|Shelter in|Hole up in|Rest up in|Lock yourselves in)\s+/i, '') : t(s.objective);
      opts.push([i, t('Safe room {n}: {where}', { n: opts.length, where })]);
    });
    startSelect.replaceChildren(...opts.map(([v, label]) => { const o = document.createElement('option'); o.value = String(v); o.textContent = label; return o; }));
  }
  fillStarts();
  chapterSelect.addEventListener('change', () => { deps.loadChapter(Number(chapterSelect.value)); fillStarts(); });

  return {
    join, refreshRooms, setButtons, message, inviteCode,
    pickedChapter: () => Number(chapterSelect.value),
    startAt: () => Number(startSelect.value),
  };
}
