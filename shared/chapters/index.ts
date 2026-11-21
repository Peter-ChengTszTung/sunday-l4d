// Campaign registry. Chapters are built lazily and cached.
import { Level, type ChapterDef } from '../level';
import * as ch1 from './ch1';
import * as ch2 from './ch2';
import * as ch3 from './ch3';
import * as ch4 from './ch4';

interface ChapterModule { META: { id: string; title: string; subtitle: string }; build(): ChapterDef }
const MODULES: ChapterModule[] = [ch1, ch2, ch3, ch4];

export const CHAPTERS = MODULES.map((m, i) => ({ index: i, ...m.META }));
const cache = new Map<number, Level>();

export function getLevel(i: number): Level {
  const n = ((i % MODULES.length) + MODULES.length) % MODULES.length;
  let l = cache.get(n);
  if (!l) { l = new Level(MODULES[n].build()); cache.set(n, l); }
  return l;
}
export const chapterCount = (): number => MODULES.length;
