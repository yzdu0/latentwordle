import { describe, expect, it } from 'vitest';
import type { Puzzle, Store, Vocab } from './store.ts';
import { MAX_ROUNDS } from '$lib/game/rules.ts';
import { mulberry32, randomAnswers } from './random.ts';

class PuzzleStore implements Store {
  constructor(private puzzles: Puzzle[]) {}

  async getPuzzle(): Promise<Puzzle | null> {
    return null;
  }
  async getPuzzles(): Promise<Puzzle[]> {
    return this.puzzles;
  }
  async getVocab(): Promise<Vocab> {
    throw new Error('not needed');
  }
  async getMeta(): Promise<string | null> {
    return null;
  }
}

const puzzles: Puzzle[] = Array.from({ length: 20 }, (_, i) => ({ answer: `word${i}` }));
const store = new PuzzleStore(puzzles);

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('randomAnswers', () => {
  it('is deterministic for the same seed', async () => {
    expect(await randomAnswers(store, 1234)).toEqual(await randomAnswers(store, 1234));
  });

  it('returns five distinct curated answers', async () => {
    for (let seed = 0; seed < 20; seed++) {
      const answers = await randomAnswers(store, seed);
      expect(answers).not.toBeNull();
      expect(answers).toHaveLength(MAX_ROUNDS);
      expect(new Set(answers).size).toBe(MAX_ROUNDS);
      for (const answer of answers!) expect(puzzles.map((p) => p.answer)).toContain(answer);
    }
  });

  it('varies across seeds', async () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const answers = await randomAnswers(store, seed);
      if (answers) seen.add(answers.join(','));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('returns null without enough puzzles', async () => {
    expect(await randomAnswers(new PuzzleStore(puzzles.slice(0, 3)), 1)).toBeNull();
  });
});
