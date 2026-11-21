// Validates every chapter: quest reachability with door states, loot/note
// reachability, pacing stats. Exit code 1 on errors. Usage: npm run check:maps [chapterIndex]
import { CHAPTERS, getLevel } from '../shared/chapters';
import { validateChapter } from '../shared/validate';

const only = process.argv[2] !== undefined ? Number(process.argv[2]) : -1;
let failed = false;
for (const c of CHAPTERS) {
  if (only >= 0 && c.index !== only) continue;
  let r;
  try { r = validateChapter(getLevel(c.index)); }
  catch (e) { console.log(`\n== Chapter ${c.index + 1}: ${c.title} — BUILD FAILED\n  ${(e as Error).message}`); failed = true; continue; }
  const s = r.stats;
  console.log(`\n== Chapter ${c.index + 1}: ${c.title} (${r.id}) ${s.size}, ${s.walkable} walkable tiles`);
  console.log(`   critical path ${s.pathMetres} m, holdouts ${s.holdSeconds} s, ${r.steps.length} steps, ${s.checkpoints} checkpoints, ${s.doors} doors, notes ${s.notes}`);
  console.log(`   pickups ${JSON.stringify(s.pickups)}`);
  console.log(`   wanderers: ${s.wanderers.regions} regions, ~${s.wanderers.budget} sleepers if every region were populated`);
  console.log(`   estimated play time ${s.estMinutes[0]}–${s.estMinutes[1]} min`);
  for (const st of r.steps) console.log(`   ${String(st.index + 1).padStart(2)}. ${st.kind.padEnd(8)} ${String(st.pathTiles * 2).padStart(5)} m  ${st.objective}${st.note ? ` (${st.note})` : ''}`);
  for (const w of r.warnings) console.log(`   WARN  ${w}`);
  for (const e of r.errors) console.log(`   ERROR ${e}`);
  if (r.errors.length) failed = true;
}
process.exit(failed ? 1 : 0);
