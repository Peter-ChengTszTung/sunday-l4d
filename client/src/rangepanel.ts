// The shooting range's numbers panel: the weapon in hand's stats, the last shot, DPS, the last kill and
// the target's health, as HTML (main.ts puts it in #rangepanel when it changes).
import { ZTYPES, type WeaponDef } from '../../shared/constants';
import type { RangeStats } from './range';
import { t } from './i18n';

const zname = (type: number) => t(ZTYPES[type]?.name ?? 'Zombie');
/** Radians as degrees for the range panel (spread is a cone half-angle). */
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(2);
const fmt = (v: number) => (v >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());

/**
 * The panel for weapon `w` and range stats `s`. `spread`: the weapon's current base spread and the
 * spread the next shot would have (radians); `baseFov`: the unzoomed vertical FOV (for the scope's zoom).
 */
export function rangePanelHtml(w: WeaponDef, s: RangeStats, spread: { base: number; now: number }, baseFov: number): string {
  const spec = w.melee ? t('{dmg} dmg · hits {n} · reach {r} m · silent', { dmg: w.dmg, n: w.melee.cleave, r: w.melee.reach })
    : w.thrown === 'fire' ? t('throwable: burning patch')
    : w.blast
    ? t('{dmg} blast dmg · {r} m radius', { dmg: w.blast.dmg, r: w.blast.radius })
    : t('{dmg} dmg', { dmg: w.pellets > 1 ? `${w.dmg}×${w.pellets}` : w.dmg }) + (w.pierce > 1 ? ` · ${t('pierces {n}', { n: w.pierce })}` : '');
  const [near, far, floor] = w.falloff;
  const reach = floor >= 1 ? t('full damage to {max} m', { max: w.range })
    : t('full to {near} m, {pct}% from {far} m, max {max} m', { near, far, pct: Math.round(floor * 100), max: w.range });
  const handling = [t('move {pct}%', { pct: Math.round(w.move * 100) })];
  if (w.scope) handling.push(t('RMB scope: {x}x zoom, move {pct}%', { x: fmt(baseFov / w.scope.fov), pct: Math.round(w.move * w.scope.move * 100) }));
  const shot = s.shot;
  const lines = [
    w.melee || w.thrown ? `<b>${t(w.name)}</b> ${spec}` : `<b>${t(w.name)}</b> ${spec} · ${t('{rpm} RPM', { rpm: Math.round(60 / w.rate) })} · ${t('mag {n}', { n: w.mag })} · ${t('reload {s} s', { s: w.reload })}`,
    w.melee || w.thrown ? handling.join(' · ') : `${reach} · ${handling.join(' · ')}`,
    w.melee || w.thrown ? '' : t('Spread {base}° · firing +{bloom}° max · moving +{move}° · now {now}°', {
      base: deg(spread.base), bloom: deg(w.bloom[1]), move: deg(w.moving), now: deg(spread.now),
    }),
    !shot ? t('Last shot: —')
      : t('Last shot: {dmg} dmg ({body} body, {head} head, {n} hit)', { dmg: fmt(shot.dmg), body: shot.body, head: shot.head, n: shot.zeds })
        + (shot.dist >= 0 && !w.blast ? ` · ${t('{m} m, {pct}% damage', { m: fmt(shot.dist), pct: Math.round(shot.falloff * 100) })}` : ''),
    t('DPS: {dps} · Total: {total} · Hits: {hit}/{shots}', { dps: fmt(s.dps), total: fmt(s.total), hit: s.shotsHit, shots: s.shotsFired }),
    !s.kill ? t('Last kill: —')
      : s.kill.shots <= 1 ? t('Last kill: {who} in one shot', { who: zname(s.kill.type) })
        : t('Last kill: {who} in {s} s ({n} shots)', { who: zname(s.kill.type), s: s.kill.ttk.toFixed(2), n: s.kill.shots }),
    s.target ? t('Target: {who} {hp}/{max}', { who: zname(s.target.type), hp: s.target.hp, max: s.target.max }) : '',
  ];
  return lines.filter(Boolean).map((l) => `<div>${l}</div>`).join('');
}
