import { describe, expect, it } from 'vitest';
import type { Puzzle, Store, Vocab } from './store.ts';
import { mulberry32, randomPuzzle } from './random.ts';

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

const puzzles: Puzzle[] = ['shark', 'volcano', 'library', 'courage', 'guitar', 'winter'].map((answer) => ({
  answer,
}));
const store = new PuzzleStore(puzzles);

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('randomPuzzle', () => {
  it('is deterministic for the same seed', async () => {
    expect(await randomPuzzle(store, 1234)).toEqual(await randomPuzzle(store, 1234));
  });

  it('returns a curated answer', async () => {
    for (let seed = 0; seed < 20; seed++) {
      const puzzle = await randomPuzzle(store, seed);
      expect(puzzle).not.toBeNull();
      expect(puzzles.map((p) => p.answer)).toContain(puzzle!.answer);
    }
  });

  it('varies across seeds', async () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const puzzle = await randomPuzzle(store, seed);
      if (puzzle) seen.add(puzzle.answer);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('returns null without puzzles', async () => {
    expect(await randomPuzzle(new PuzzleStore([]), 1)).toBeNull();
  });
});
