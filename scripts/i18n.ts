// Translation coverage. Lists the content strings (chapter text, weapon names, …) that a locale's
// dictionary is missing. The client looks translations up by their English text (client/src/i18n.ts).
//   npx tsx scripts/i18n.ts            missing strings per locale (exit 1 if any)
//   npx tsx scripts/i18n.ts --dump 1   every string of chapter 1 as JSON (for translators)
import { CHAPTERS, getLevel } from '../shared/chapters';
import { WEAPONS, ZTYPES, DIFFICULTIES, SURVIVORS, MEDS } from '../shared/constants';
import { LOCALES } from '../client/src/i18n';

/** Every player-visible string of chapter `i` (0-based). */
function chapterStrings(i: number): string[] {
  const d = getLevel(i).def, m = CHAPTERS[i], out: string[] = [m.title, m.subtitle, d.intro];
  for (const s of d.steps) {
    out.push(s.objective);
    for (const [who, line] of s.radio) out.push(who, line);
    for (const g of s.holdScript ?? []) if (g.msg) out.push(g.msg);
    for (const g of s.gates ?? []) { if (g.msg) out.push(g.msg); if (g.hud) out.push(g.hud); }
  }
  for (const n of d.notes) out.push(n.title, n.text);
  for (const p of d.pickups) if (p.label) out.push(p.label);
  for (const dr of d.doors) if (dr.label) out.push(dr.label);
  for (const l of d.labels) out.push(l.text);
  return [...new Set(out.filter((s) => /[A-Za-z]/.test(s)))];
}
const sharedStrings = (): string[] => [
  ...WEAPONS.map((w) => w.name), ...ZTYPES.map((z) => z.name), ...DIFFICULTIES.flatMap((d) => [d.label, d.hint]), ...SURVIVORS.map((s) => s.name), ...MEDS.flatMap((m) => [m.name, m.blurb]),
];

const argv = process.argv.slice(2);
if (argv[0] === '--dump') {
  const i = Number(argv[1]) - 1;
  console.log(JSON.stringify(i >= 0 ? chapterStrings(i) : sharedStrings(), null, 2));
} else {
  let missing = 0;
  for (const [lang, dict] of Object.entries(LOCALES)) {
    const groups: [string, string[]][] = [['shared', sharedStrings()], ...CHAPTERS.map((c, i): [string, string[]] => [`chapter ${i + 1}`, chapterStrings(i)])];
    for (const [name, list] of groups) {
      const miss = list.filter((s) => !(s in dict));
      missing += miss.length;
      if (miss.length) console.log(`${lang} ${name}: ${miss.length} missing\n${miss.map((s) => `  ${JSON.stringify(s)}`).join('\n')}`);
    }
  }
  console.log(missing ? `${missing} missing translations` : 'All content strings translated.');
  process.exit(missing ? 1 : 0);
}
