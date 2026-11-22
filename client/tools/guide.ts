// Internal tool: every infected type and every weapon with its model, live stats (read from
// shared/constants.ts, so the page can't drift from the game) and how to deal with it; plus the
// chapter map viewer (maps.ts) as a third tab.
// Dev server: http://localhost:3000/tools/guide.html
import * as pc from 'playcanvas';
import {
  WEAPONS, ZTYPES, ZT, INTRO, ARMOR, FIRE, LURE, CHARGER, DROOLER, ALARM, SNATCHER, PIGGY, WEEPER, PLAYER, TINPOT_FRONT, HEAL_MIN,
  SURVIVOR_RULES, DIFFICULTIES, THROW_MAX, headMult, isCommon, meleeDamage, type WeaponDef,
} from '../../shared/constants';
import { CHAPTERS } from '../../shared/chapters';
import { app, meshEntity, makeUnlit, inkBox, device } from '../src/gfx';
import { ring, make, toMesh } from '../src/geo';
import { Chibi, zombieLook, type Pose } from '../src/chibi';
import { worldGun } from '../src/viewmodel';
import { t, lang, LANGS, setLang, translatePage, type Lang } from '../src/i18n';

translatePage();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const num = (v: number) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : '∞');

// ------------------------------------------------------------------ content
/** What the numbers can't say: role, what it does, how to beat it. Stats come from the constants. */
interface ZNote { name: string; like: string; does: string; beat: string; lore: string; poses: Pose[] }
const BASE_POSES: Pose[] = ['idle', 'run', 'attack', 'stagger'];
const ZNOTES: Record<number, ZNote> = {
  [ZT.WALKER]: { name: 'Walker', like: 'common infected', poses: BASE_POSES,
    does: 'The horde. Sleeps until it hears or sees you, then runs at the nearest survivor and swats.',
    beat: 'One headshot from anything. Shove (V) to stagger a crowd; a close-in weapon one-hits them without waking the street.',
    lore: 'An ordinary sleepwalker in pyjamas.' },
  [ZT.LEAPER]: { name: 'Leaper', like: 'L4D Hunter', poses: [...BASE_POSES, 'windup', 'leap'],
    does: 'Crouches for 0.6 s, then pounces 4.5–12 m in a straight line: damage and a big knock-back.',
    beat: 'Shoot or shove it during the crouch. Sidestep the pounce; it needs 4.5 s before the next.',
    lore: 'A restless sleeper, the "kicker" who thrashes and pounces.' },
  [ZT.PUFFER]: { name: 'Puffer', like: 'L4D Boomer', poses: BASE_POSES,
    does: 'Waddles up and bursts (also when killed). Goo on a survivor calls a horde that hunts them first.',
    beat: 'Pop it at range. Never melee it. Its blast also kills commons around it.',
    lore: 'A sleeper swollen with mist; its lavender goo carries the lullaby scent.' },
  [ZT.BRUTE]: { name: 'Brute', like: 'L4D Tank', poses: BASE_POSES,
    does: 'The boss. Huge health (more per extra survivor), hits like a truck and knocks you flying; speeds up when you run.',
    beat: 'Everyone shoots, nobody gets cornered. Fire keeps burning it; shoves do nothing; bullets stop in it.',
    lore: 'Someone who got a heavy dose of concentrate.' },
  [ZT.CHARGER]: { name: 'Charger', like: 'L4D2 Charger', poses: [...BASE_POSES, 'windup', 'charge', 'pin'],
    does: 'Scrapes its slippers, then bull-rushes in a straight line. With a wall behind you, you are pinned and pounded.',
    beat: 'Sidestep: it stuns itself on the wall for 2.2 s. Teammates break a pin with damage or shoves.',
    lore: 'Stuck in the "running late" dream, sprinting for a bus that left hours ago.' },
  [ZT.DROOLER]: { name: 'Drooler', like: 'L4D2 Spitter', poses: [...BASE_POSES, 'windup'],
    does: 'Hangs back and lobs goo at where you stand; the puddle burns anyone in it. Leaves a small puddle when it dies.',
    beat: 'Keep moving; step out of the pool. It is fragile: shoot it while it rears back.',
    lore: 'A mouth-breather who slept face-down on a pillow soaked in Hush.' },
  [ZT.ALARM]: { name: 'Alarm Clock', like: 'B4B Snitcher', poses: [...BASE_POSES, 'ring'],
    does: 'Keeps its distance. When it sees you it rings; if it rings out, a mini-horde comes and sleepers wake for streets around.',
    beat: 'Kill it or shove it inside the ring time. Line of sight is what sets it off.',
    lore: 'A light sleeper who never let go of the bedside clock.' },
  [ZT.SNATCHER]: { name: 'Snatcher', like: 'L4D Smoker', poses: [...BASE_POSES, 'windup', 'pin'],
    does: 'Whirls its scarf, lassoes one survivor from range and reels them in, hurting them all the way and squeezing at the end.',
    beat: 'Break line of sight during the whirl. Shoot it, shove it, or shove the victim to free them. It backs off while the lasso recovers.',
    lore: 'Tangled in the "falling" dream, forever grabbing for something to hold.' },
  [ZT.PIGGYBACK]: { name: 'Piggyback', like: 'L4D2 Jockey', poses: [...BASE_POSES, 'windup', 'leap', 'pin'],
    does: 'Small and quick. Jumps on a survivor and steers them away from the team while clawing.',
    beat: 'Shove it off the victim (or shove the victim), or shoot it. Stay close enough to reach each other.',
    lore: 'A little one in an animal onesie, dreaming of being carried up to bed.' },
  [ZT.WEEPER]: { name: 'Weeper', like: 'L4D Witch', poses: ['sit', 'windup', 'run', 'attack'],
    does: 'Sits sobbing and ignores you. Linger close in her sight, or hurt her, and she goes for whoever did it until they drop, then runs off.',
    beat: 'Listen for the sobbing and go round. If she growls, back away. If you must, kill her fast with everything at once.',
    lore: 'Having the saddest dream in Mallow Bay. She only wants to be left alone.' },
  [ZT.TINPOT]: { name: 'Tinpot', like: 'L4D2 riot infected', poses: BASE_POSES,
    does: 'A common in kitchen armour. Bullets that hit its front do a fraction of their damage and stop there.',
    beat: 'Shove it (it reels longer than a walker) and shoot, get behind it, or use a close-in weapon, a blast or fire.',
    lore: 'A sleepwalking cook: saucepan on the head, baking tray on the chest.' },
  [ZT.RAINCOAT]: { name: 'Raincoat', like: 'L4D2 hazmat infected', poses: BASE_POSES,
    does: 'A slightly tougher common that fire does nothing to.',
    beat: 'Shoot it like a walker. Do not count on a firebomb to hold a doorway against these.',
    lore: 'Fell asleep waiting for the bus in a storm slicker.' },
};
const WNOTES: Record<string, string> = {
  pistol: 'The starting sidearm. Endless ammo, accurate, slow to kill a crowd.',
  smg: 'Fast and forgiving. Settles quickly on full auto; weak past 35 m.',
  shotgun: 'Nine pellets. Deletes what is in front of you; barely tickles at 20 m.',
  rifle: 'The all-rounder. Tight in bursts, drifts on long sprays.',
  autoshotgun: 'A shotgun that keeps firing. Eats ammo; made for holdouts.',
  sniper: 'Each round skewers up to four in a line. Wild from the hip: hold right mouse to scope.',
  launcher: 'Lobbed shells with a big blast. Half-armed closer than 3 m; nicks the squad near its centre.',
  magnum: 'Replaces the pistol. Endless ammo, pierces two, kicks.',
  bat: 'Wide flat swing. One-hits commons, three at a time, and sends survivors of it flying.',
  machete: 'Quick alternating cuts. The fastest way to clear a doorway by hand.',
  axe: 'Slow overhead chop that hurts. The close-in answer to specials.',
  firebomb: 'Throw (G). A burning patch: zombies run through it and die. It burns you too; Raincoats ignore it.',
  rattle: 'Throw (G). Every common nearby drops everything and crowds the rattle, then it explodes.',
};

/** When a type first appears: "Chapter 2, 35%". */
function introText(type: number): string {
  if (type === ZT.BRUTE) return t('scripted steps; roaming from {pct}% of chapter 1', { pct: Math.round(INTRO.brute * 100) });
  const at = INTRO.at[type];
  if (at === undefined) return t('from the start');
  const ch = Math.min(CHAPTERS.length - 1, Math.floor(at)), pct = Math.round((at - ch) * 100);
  return t(pct ? 'Chapter {n}, {pct}% in (“{title}”)' : 'Chapter {n} start (“{title}”)', { n: ch + 1, pct, title: t(CHAPTERS[ch].title) });
}

/** Type-specific tuning worth showing, as label/value rows. */
function abilityRows(type: number): [string, string][] {
  const Z = ZTYPES[type], per = (dmg: number, tick: number) => num(dmg / tick);
  switch (type) {
    case ZT.LEAPER: return [['Pounce', t('{dmg} dmg, {a}–{b} m', { dmg: Z.leapDmg, a: 4.5, b: 12 })]];
    case ZT.PUFFER: return [['Burst', t('{dmg} dmg within {r} m, calls a horde', { dmg: Z.boomDmg, r: Z.boomRadius })]];
    case ZT.BRUTE: return [['Extra health', t('+{hp} per survivor beyond the first', { hp: 1100 })]];
    case ZT.CHARGER: return [['Charge', t('{a}–{b} m, {s} s tell, {dmg} dmg', { a: CHARGER.minRange, b: CHARGER.maxRange, s: CHARGER.windup, dmg: CHARGER.hitDmg })],
      ['Pin', t('{dps} dmg/s, up to {s} s; breaks at {dmg} dmg', { dps: CHARGER.pinDps, s: CHARGER.pinMax, dmg: CHARGER.pinBreakDmg })], ['Wall stun', t('{s} s', { s: CHARGER.wallStun })], ['Cooldown', t('{s} s', { s: CHARGER.cooldown })]];
    case ZT.DROOLER: return [['Spit', t('{a}–{b} m, {s} s tell', { a: DROOLER.minRange, b: DROOLER.maxRange, s: DROOLER.windup })],
      ['Puddle', t('{r} m, {s} s, {dps} dmg/s', { r: DROOLER.puddleR, s: DROOLER.puddleLife, dps: DROOLER.dps })], ['Cooldown', t('{s} s', { s: DROOLER.cooldown })]];
    case ZT.ALARM: return [['Rings', t('sees you within {r} m; {s} s to stop it', { r: ALARM.ringRange, s: ALARM.ringTime })], ['Cooldown', t('{s} s', { s: ALARM.cooldown })]];
    case ZT.SNATCHER: return [['Lasso', t('{a}–{b} m, {s} s tell', { a: SNATCHER.minRange, b: SNATCHER.maxRange, s: SNATCHER.windup })],
      ['Reel', t('{v} m/s, {a} dmg/s, then {b} dmg/s', { v: SNATCHER.pull, a: per(SNATCHER.dragDmg, SNATCHER.tick), b: per(SNATCHER.chokeDmg, SNATCHER.tick) })],
      ['Lets go', t('after {a} s ({b} s if nobody can help)', { a: SNATCHER.holdMax, b: SNATCHER.soloBreak })], ['Cooldown', t('{s} s', { s: SNATCHER.cooldown })]];
    case ZT.PIGGYBACK: return [['Jump', t('{a}–{b} m, {s} s tell', { a: PIGGY.leapMin, b: PIGGY.leapMax, s: PIGGY.windup })],
      ['Ride', t('steers at {v} m/s, {dps} dmg/s', { v: PIGGY.steer, dps: per(PIGGY.dmg, PIGGY.tick) })], ['Lets go', t('after {a} s ({b} s if nobody can help)', { a: PIGGY.holdMax, b: PIGGY.soloBreak })]];
    case ZT.WEEPER: return [['Wakes', t('within {r} m in sight: {a} s at the edge, {b} s beside her; any damage at once', { r: WEEPER.near, a: num(WEEPER.wake), b: num(WEEPER.wake / WEEPER.closeMul) })],
      ['Growls', t('at {pct}% anger', { pct: Math.round(WEEPER.warn * 100) })], ['Per attempt', t('one at most, never in a holdout')]];
    case ZT.TINPOT: return [['Front armour', t('bullets do {pct}%, no headshot bonus, no piercing', { pct: Math.round(TINPOT_FRONT * 100) })], ['Open', t('while staggered, or from behind')]];
    case ZT.RAINCOAT: return [['Fire', t('immune')]];
    default: return [];
  }
}

// -------------------------------------------------------------------- scene
const canvas = $<HTMLCanvasElement>('game');
const camera = new pc.Entity('camera');
camera.addComponent('camera', { fov: 38, nearClip: 0.05, farClip: 100, clearColor: new pc.Color(0.13, 0.1, 0.2) });
app.root.addChild(camera);
// A stage disc so the model has a floor to stand on.
const stage = meshEntity([toMesh(device, make(ring(0, 1.6, 40), 0x3a2f52)), toMesh(device, make(ring(1.6, 1.68, 40), 0xffd43b))], makeUnlit({ fog: false }));
app.root.addChild(stage);
const holder = new pc.Entity('holder');
app.root.addChild(holder);

const view = { yaw: 0.5, pitch: 0.18, dist: 5, y: 0.8, spin: true };
let drag = false;
canvas.addEventListener('pointerdown', (e) => { drag = true; view.spin = false; canvas.classList.add('drag'); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = false; canvas.classList.remove('drag'); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view.yaw -= e.movementX * 0.008;
  view.pitch = Math.max(-0.3, Math.min(1.2, view.pitch + e.movementY * 0.006));
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = Math.max(1.5, Math.min(14, view.dist * Math.exp(e.deltaY * 0.001))); }, { passive: false });

// ---------------------------------------------------------------- selection
type Tab = 'zombies' | 'weapons' | 'maps';
interface Item { tab: Tab; key: string; label: string; group: string; note: string; z?: number; w?: number; gear?: 'armor' | 'medkit' }
const items: Item[] = [
  ...ZTYPES.map((T, i): Item => ({ tab: 'zombies', key: `z-${T.id}`, label: ZNOTES[i]?.name ?? T.id, z: i, note: t('{hp} hp', { hp: T.hp }),
    group: i === ZT.BRUTE ? 'Boss' : i === ZT.WEEPER ? 'Hazard' : isCommon(i) ? 'Commons' : 'Specials' })),
  ...WEAPONS.map((w, i): Item => ({ tab: 'weapons', key: `w-${w.id}`, label: w.name, w: i, note: w.melee ? t('{dmg} dmg', { dmg: w.dmg }) : w.thrown ? 'G' : t('{rpm} RPM', { rpm: Math.round(60 / w.rate) }),
    group: w.slot === 'primary' ? 'Primary (1)' : w.slot === 'sidearm' ? 'Sidearm (2)' : w.slot === 'melee' ? 'Close-in (3)' : 'Throwables (G)' })),
  { tab: 'weapons', key: 'g-armor', label: 'Pillow Vest', group: 'Gear', note: t('{n} armour', { n: ARMOR.max }), gear: 'armor' },
  { tab: 'weapons', key: 'g-medkit', label: 'Medkit', group: 'Gear', note: 'Q', gear: 'medkit' },
];
const GROUP_ORDER = ['Commons', 'Specials', 'Hazard', 'Boss', 'Primary (1)', 'Sidearm (2)', 'Close-in (3)', 'Throwables (G)', 'Gear'];
let cur: Item = items.find((it) => it.key === location.hash.slice(1)) ?? items[0];
let tab: Tab = location.hash === '#maps' ? 'maps' : cur.tab;
/** The map viewer module, loaded the first time its tab is opened. */
let maps: Promise<typeof import('./maps')> | null = null;
let chibi: Chibi | null = null, pose: Pose = 'idle', variant = 0;

function showModel(): void {
  for (const c of [...holder.children]) c.destroy();
  chibi = null;
  holder.setLocalPosition(0, 0, 0); holder.setLocalEulerAngles(0, 0, 0);
  if (cur.z !== undefined) {
    chibi = new Chibi(zombieLook(cur.z, variant));
    const s = ZTYPES[cur.z].scale;
    chibi.group.setLocalScale(s, s, s);
    chibi.group.setLocalEulerAngles(0, 180, 0); // models face -Z; turn it to face the camera's side
    holder.addChild(chibi.group);
    view.y = 0.75 * s; view.dist = 3.6 + s * 1.6;
  } else if (cur.w !== undefined) {
    const gun = worldGun(WEAPONS[cur.w].id);
    // Guns lie along X in profile (barrel to the left); close-in weapons stand upright, edge to the left.
    const melee = !!WEAPONS[cur.w].melee;
    gun.setLocalScale(3, 3, 3);
    if (melee) { gun.setLocalEulerAngles(90, 90, 0); gun.setLocalPosition(0, 0.35, 0); }
    else { gun.setLocalEulerAngles(0, 90, 0); gun.setLocalPosition(0.6, 1, 0); }
    holder.addChild(gun);
    view.y = 1.1; view.dist = 4.4;
  } else {
    const g = new pc.Entity();
    if (cur.gear === 'armor') { g.addChild(inkBox(0.9, 1, 0.36, 0xf6f2ff)); for (const x of [-0.25, 0.25]) { const s = inkBox(0.14, 1.06, 0.4, 0x74c0fc, 0); s.setLocalPosition(x, 0, 0); g.addChild(s); } }
    else { g.addChild(inkBox(1, 0.7, 0.5, 0xfff5f5)); const a = inkBox(0.55, 0.16, 0.54, 0xff4d6d, 0), b = inkBox(0.16, 0.55, 0.54, 0xff4d6d, 0); g.addChild(a); g.addChild(b); }
    g.setLocalPosition(0, 1, 0);
    holder.addChild(g);
    view.y = 1; view.dist = 4.4;
  }
  view.spin = true;
}

// ------------------------------------------------------------------- panels
/** A stats row: the label is translated here, the value arrives ready. */
const row = (k: string, v: string) => `<b>${esc(t(k))}</b><span>${esc(v)}</span>`;
const zname = (type: number) => t(ZNOTES[type]?.name ?? ZTYPES[type].id);
const degs = (rad: number) => num((rad * 180) / Math.PI);
const pct = (v: number) => Math.round(v * 100);

function zombieInfo(type: number): string {
  const T = ZTYPES[type], n = ZNOTES[type];
  const guns = WEAPONS.filter((w) => !w.thrown && !w.blast);
  // Trigger pulls / swings to kill, body and head, at full damage (no falloff, solo health).
  const kills = guns.map((w) => {
    const body = w.melee ? meleeDamage(w, type) : w.dmg * w.pellets, head = w.melee ? body : body * headMult(type), nb = Math.ceil(T.hp / body);
    const front = type === ZT.TINPOT && !w.melee ? ` (${esc(t('{n} front', { n: Math.ceil(T.hp / (body * TINPOT_FRONT)) }))})` : '';
    return `<tr><td>${esc(t(w.name))}</td><td>${nb}${front}</td><td>${w.melee ? '—' : Math.ceil(T.hp / head)}</td><td>${esc(nb === 1 ? t('one hit') : t('{s} s', { s: num((nb - 1) * w.rate) }))}</td></tr>`;
  }).join('');
  return `<h2>${esc(zname(type))}</h2><div class="sub"><span class="tag">${esc(t(cur.group))}</span>${esc(t('inspired by: {x}', { x: t(n.like) }))}</div>
    <p>${esc(t(n.does))}</p><p class="how"><b>${esc(t('How to beat it:'))}</b> ${esc(t(n.beat))}</p><p class="lore">${esc(t(n.lore))}</p>
    <h3>${esc(t('Stats'))}</h3><div class="stats">
      ${row('Health', type === ZT.BRUTE ? t('{hp} solo', { hp: T.hp }) : String(T.hp))}${row('Speed', t('{v} m/s (you: {you})', { v: T.speed, you: PLAYER.speed }))}
      ${T.dmg ? row('Hit', t('{dmg} dmg every {s} s, reach {r} m', { dmg: T.dmg, s: T.cd, r: T.range })) : ''}${row('Headshot', `×${headMult(type)}`)}
      ${row('Size', `×${T.scale}`)}${row('First appears', introText(type))}
      ${abilityRows(type).map(([k, v]) => row(k, v)).join('')}
    </div>
    <h3>${esc(t('To kill it (full damage)'))}</h3>
    <table><tr><th>${esc(t('Weapon'))}</th><th>${esc(t('Body'))}</th><th>${esc(t('Head'))}</th><th>${esc(t('Time (body)'))}</th></tr>${kills}</table>`;
}

function weaponInfo(w: WeaponDef): string {
  const per = w.dmg * w.pellets, dps = per / w.rate;
  // Sustained: a magazine's damage over the time to fire it and reload.
  const sustained = w.reload ? (per * w.mag) / (w.mag * w.rate + w.reload) : dps;
  const rows: string[] = [row('Slot', t(cur.group) + (w.tier === 2 ? ` · ${t('tier 2 (rarer, later)')}` : ''))];
  if (w.melee) {
    rows.push(row('Damage', t('{dmg} a swing (Brute ×{k})', { dmg: w.dmg, k: w.melee.brute })), row('Swings', t('{n} a second ({dps} dmg/s on one target)', { n: num(1 / w.rate), dps: num(dps) })),
      row('Hits', t('up to {n} at once', { n: w.melee.cleave })), row('Reach', t('{r} m, {deg}° cone', { r: w.melee.reach, deg: Math.round((Math.acos(w.melee.arc) * 360) / Math.PI) })),
      row('Stagger', t('{s} s, shoved back', { s: w.melee.stun })), row('Noise', t('silent: wakes nobody')), row('Ammo', t('never runs out')), row('Move speed', `${pct(w.move)}%`));
  } else if (w.thrown === 'fire') {
    rows.push(row('Effect', t('burning patch, {r} m radius for {s} s', { r: FIRE.r, s: FIRE.life })), row('Zombies', t('{dps} dmg/s (Raincoat: none)', { dps: FIRE.dps })),
      row('Survivors', t('{dps} dmg/s while standing in it', { dps: FIRE.ff })), row('At once', t('{n} patches', { n: FIRE.max })), row('Carry', t('up to {n} throwables, any mix (T switches)', { n: THROW_MAX })));
  } else if (w.thrown === 'lure') {
    rows.push(row('Effect', t('commons within {m} m of path flock to it for {s} s', { m: LURE.tiles * 2, s: LURE.time })), row('Then', t('{dmg} blast dmg · {r} m radius', { dmg: w.blast!.dmg, r: w.blast!.radius })),
      row('Wakes', t('sleepers within {m} m', { m: LURE.wake })), row('Specials', t('ignore it')), row('Carry', t('up to {n} throwables, any mix (T switches)', { n: THROW_MAX })));
  } else {
    rows.push(row('Damage', w.blast ? t('{dmg} blast, {r} m radius ({pct}% at the rim)', { dmg: w.blast.dmg, r: w.blast.radius, pct: pct(w.blast.edge) }) : w.pellets > 1 ? t('{dmg} × {n} pellets', { dmg: w.dmg, n: w.pellets }) : String(w.dmg)));
    if (!w.blast) rows.push(row('Fire rate', t('{rpm} RPM', { rpm: Math.round(60 / w.rate) }) + (w.auto ? ` · ${t('auto')}` : '')), row('Damage / second', t('{a} ({b} with reloads)', { a: num(dps), b: num(sustained) })));
    rows.push(row('Magazine', t('{mag} / {res} reserve', { mag: w.mag, res: num(w.reserve) })), row('Reload', t('{s} s', { s: w.reload })));
    const [near, far, floor] = w.falloff;
    if (!w.blast) rows.push(row('Reach', floor >= 1 ? t('full damage to {max} m', { max: w.range }) : t('full to {near} m, {pct}% from {far} m, max {max} m', { near, far, pct: pct(floor), max: w.range })), row('Pierces', String(w.pierce)));
    else rows.push(row('Arms at', `${w.blast.arm} m`), row('Shell', t('{v} m/s, {s} s fuse', { v: w.blast.speed, s: w.blast.fuse })));
    rows.push(row('Spread', t('{a}°, up to +{b}° firing, +{c}° running', { a: degs(w.spread), b: degs(w.bloom[1]), c: degs(w.moving) })), row('Move speed', `${pct(w.move)}%`));
    if (w.scope) rows.push(row('Scope (RMB)', t('{a}° spread, move {pct}%', { a: degs(w.scope.spread), pct: pct(w.scope.move * w.move) })));
  }
  let table = '';
  if (!w.thrown && !w.blast) {
    const body = (z: number) => (w.melee ? meleeDamage(w, z) : per);
    table = `<h3>${esc(t('Shots to kill (full damage)'))}</h3><table><tr><th>${esc(t('Target'))}</th><th>${esc(t('Health'))}</th><th>${esc(t('Body'))}</th><th>${esc(t('Head'))}</th></tr>${ZTYPES.map((T, z) => {
      const b = Math.ceil(T.hp / body(z)), h = w.melee ? '—' : String(Math.ceil(T.hp / (body(z) * headMult(z))));
      return `<tr><td>${esc(zname(z))}</td><td>${T.hp}</td><td class="${b === 1 ? 'best' : b > 12 ? 'bad' : ''}">${b}</td><td>${h}</td></tr>`;
    }).join('')}</table>`;
  }
  return `<h2>${esc(t(w.name))}</h2><div class="sub"><span class="tag">${esc(w.id)}</span>${esc(t(cur.group))}</div><p>${esc(t(WNOTES[w.id] ?? ''))}</p>
    <h3>${esc(t('Stats'))}</h3><div class="stats">${rows.join('')}</div>${table}`;
}

function gearInfo(g: 'armor' | 'medkit'): string {
  if (g === 'armor') return `<h2>${esc(t('Pillow Vest'))}</h2><div class="sub"><span class="tag">armor</span>${esc(t('Gear'))}</div>
    <p>${esc(t('A pillow strapped on front and back. It soaks up part of every bite or hit until the stuffing runs out.'))}</p>
    <h3>${esc(t('Stats'))}</h3><div class="stats">${row('Armour', t('{n} points', { n: ARMOR.max }))}${row('Soaks up', t('{pct}% of each hit while any is left', { pct: pct(ARMOR.absorb) }))}
    ${row('Worth', t('{n} damage of hits', { n: Math.round(ARMOR.max / ARMOR.absorb) }))}${row('No help against', t('goo, fire, bleeding out'))}${row('Pick up', t('one vest refills it; lost on a restart'))}</div>`;
  return `<h2>${esc(t('Medkit'))}</h2><div class="sub"><span class="tag">medkit</span>${esc(t('Gear'))}</div>
    <p>${esc(t('Hold Q for {s} s. Also clears your count of downs.', { s: PLAYER.healTime }))}</p>
    <h3>${esc(t('Stats'))}</h3><div class="stats">${row('Carry', t('one'))}${DIFFICULTIES.map((d) => `<b>${esc(t('Heals ({diff})', { diff: t(d.label) }))}</b><span>${esc(t('{pct}% of missing health, at least {min}', { pct: pct(SURVIVOR_RULES[d.id].heal), min: HEAL_MIN }))}</span>`).join('')}</div>`;
}

function render(): void {
  $('tabs').replaceChildren(...(['zombies', 'weapons', 'maps'] as Tab[]).map((tb) => {
    const b = document.createElement('button');
    b.textContent = tb === 'zombies' ? t('Infected ({n})', { n: ZTYPES.length }) : tb === 'maps' ? t('Maps ({n})', { n: CHAPTERS.length })
      : t('Weapons & gear ({n})', { n: items.filter((it) => it.tab === 'weapons').length });
    if (tb === tab) b.className = 'on';
    b.onclick = () => { if (tb === 'maps') openMaps(); else select(items.find((it) => it.tab === tb)!); };
    return b;
  }));
  // The Maps tab covers the model view; the 3D scene stops drawing while it is up.
  const onMaps = tab === 'maps';
  $('mapview').hidden = !onMaps;
  app.autoRender = !onMaps;
  if (onMaps) return;
  const list = $('list');
  list.replaceChildren();
  for (const g of GROUP_ORDER) {
    const rows = items.filter((it) => it.tab === tab && it.group === g);
    if (!rows.length) continue;
    const h = document.createElement('h3'); h.textContent = t(g); list.append(h);
    for (const it of rows) {
      const d = document.createElement('div');
      d.className = `it${it === cur ? ' sel' : ''}`;
      const a = document.createElement('span'), sm = document.createElement('small');
      a.textContent = t(it.label); sm.textContent = it.note;
      d.append(a, sm);
      d.onclick = () => select(it);
      list.append(d);
    }
  }
  $('info').innerHTML = cur.z !== undefined ? zombieInfo(cur.z) : cur.w !== undefined ? weaponInfo(WEAPONS[cur.w]) : gearInfo(cur.gear!);
  // Pose buttons (zombies), plus the walker's look variants.
  const poses = $('poses');
  poses.replaceChildren();
  if (cur.z === undefined) return;
  for (const p of ZNOTES[cur.z].poses) {
    const b = document.createElement('button');
    b.textContent = t(`pose: ${p}`).replace(/^pose: /, ''); if (p === pose) b.className = 'on';
    b.onclick = () => { pose = p; render(); };
    poses.append(b);
  }
  if (cur.z === ZT.WALKER) {
    const b = document.createElement('button');
    b.textContent = t('next look');
    b.onclick = () => { variant++; showModel(); };
    poses.append(b);
  }
}

// Language picker (same saved choice as the game).
const langSel = $<HTMLSelectElement>('lang');
langSel.replaceChildren(...LANGS.map((l) => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.label; return o; }));
langSel.value = lang;
langSel.onchange = () => setLang(langSel.value as Lang);

/** Show the chapter map viewer (loads it on first use). */
function openMaps(): void {
  tab = 'maps';
  history.replaceState(null, '', `${location.search}#maps`);
  render();
  void (maps ??= import('./maps')).then((m) => m.showMaps());
}

function select(it: Item): void {
  cur = it; tab = it.tab;
  pose = it.z !== undefined ? ZNOTES[it.z].poses[0] : 'idle';
  history.replaceState(null, '', `${location.pathname}${location.search}#${it.key}`);
  showModel(); render();
}

// ---------------------------------------------------------------------- loop
let time = 0;
app.on('update', (dt: number) => {
  time += dt;
  // Until you drag it, the model shows its front and sways a little either way.
  if (view.spin) view.yaw = 0.35 + Math.sin(time * 0.6) * 0.55;
  // The panels cover the sides: aim a little right of the model so it sits in the gap between them.
  const w = canvas.clientWidth || 1, off = ((230 - Math.min(400, w * 0.33)) / w) * view.dist * 0.75;
  const cp = Math.cos(view.pitch), cx = Math.sin(view.yaw) * cp * view.dist, cy = Math.sin(view.pitch) * view.dist, cz = Math.cos(view.yaw) * cp * view.dist;
  const rx = Math.cos(view.yaw), rz = -Math.sin(view.yaw);
  camera.setPosition(cx - rx * off, view.y + cy, cz - rz * off);
  camera.lookAt(-rx * off, view.y, -rz * off);
  chibi?.animate(pose, time, dt);
  if (!chibi) holder.setLocalPosition(0, Math.sin(time * 2) * 0.05, 0);
});
app.start();
if (tab === 'maps') { showModel(); openMaps(); } else select(cur);
// For poking at it from the console.
Object.assign(window, { __guide: { view, items, select } });
