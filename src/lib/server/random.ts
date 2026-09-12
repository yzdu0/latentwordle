import { MAX_ROUNDS } from '$lib/game/rules.ts';
import type { Store } from './store.ts';

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

export async function randomAnswers(store: Store, seed: number): Promise<string[] | null> {
  const puzzles = await store.getPuzzles();
  if (puzzles.length < MAX_ROUNDS) return null;
  const rng = mulberry32(seed);
  const used = new Set<number>();
  const answers: string[] = [];
  while (answers.length < MAX_ROUNDS) {
    const index = Math.floor(rng() * puzzles.length);
    if (used.has(index)) continue;
    used.add(index);
    answers.push(puzzles[index].answer);
  }
  return answers;
}
