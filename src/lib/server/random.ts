import { MAX_ROUNDS } from '$lib/game/rules.ts';
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

export function dailyAnswerSeed(dayIndex: number, salt: number): number {
  return (Math.imul(dayIndex ^ salt, 2_654_435_761) + 1) >>> 0;
}

function drawDistinct(puzzles: Puzzle[], count: number, rng: () => number): Puzzle[] | null {
  if (puzzles.length < count) return null;
  const used = new Set<number>();
  const answers: Puzzle[] = [];
  while (answers.length < count) {
    const index = Math.floor(rng() * puzzles.length);
    if (used.has(index)) continue;
    used.add(index);
    answers.push(puzzles[index]);
  }
  return answers;
}

export function selectAnswers(
  puzzles: Puzzle[],
  seed: number,
  rounds = MAX_ROUNDS,
): string[] | null {
  const current = puzzles.filter(({ difficulty }) => difficulty !== 'difficult');
  return drawDistinct(current, rounds, mulberry32(seed))?.map(({ answer }) => answer) ?? null;
}

export function selectHardAnswers(puzzles: Puzzle[], seed: number, rounds = MAX_ROUNDS): string[] | null {
  const difficult = puzzles.filter(({ difficulty }) => difficulty === 'difficult');
  return drawDistinct(difficult, rounds, mulberry32(seed))?.map(({ answer }) => answer) ?? null;
}

export async function randomAnswers(
  store: Store,
  seed: number,
  rounds = MAX_ROUNDS,
): Promise<string[] | null> {
  return selectAnswers(await store.getPuzzles(), seed, rounds);
}
