import type { PuzzleData, Store } from './store.ts';

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

export async function randomPuzzle(store: Store, seed: number): Promise<PuzzleData | null> {
  const puzzles = await store.getPuzzles();
  if (puzzles.length === 0) return null;

  const answers = [...new Set(puzzles.map((puzzle) => puzzle.answer))];
  const conceptPool = [...new Set([...puzzles.flatMap((puzzle) => puzzle.concepts), ...answers])];

  const rng = mulberry32(seed);
  const answer = answers[Math.floor(rng() * answers.length)];
  const pool = conceptPool.filter((concept) => concept !== answer);
  const concepts: string[] = [];
  while (concepts.length < 5 && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    concepts.push(pool.splice(index, 1)[0]);
  }
  if (concepts.length < 5) return null;

  return { answer, concepts, ks: [] };
}
