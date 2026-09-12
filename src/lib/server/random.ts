import type { Puzzle, Store } from './store.ts';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function randomPuzzle(store: Store, seed: number): Promise<Puzzle | null> {
  const puzzles = await store.getPuzzles();
  if (puzzles.length === 0) return null;
  const rng = mulberry32(seed);
  return puzzles[Math.floor(rng() * puzzles.length)];
}
