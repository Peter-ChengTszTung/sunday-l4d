// Baked visibility per chapter, for cull.ts: which scenery can be seen from each tile of the map.
// The chapter files are generated: run `npm run bake:cull` after changing a map or what the world
// builders draw. A stale or missing bake is detected at load (cull.ts falls back to working it out
// as the camera moves) and by `npm run check:cull`. Each is a file of its own, fetched with its chapter.

/** Base64 of the baked table, by `ChapterDef.id`. */
export const PVS: Record<string, (() => Promise<{ default: string }>) | undefined> = {
  ch1: () => import('./ch1'),
  ch2: () => import('./ch2'),
  ch3: () => import('./ch3'),
  ch4: () => import('./ch4'),
};
