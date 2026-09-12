import { describe, expect, it } from 'vitest';
import type { Anchors, PuzzleData, Store } from './store.ts';
import { mulberry32, randomPuzzle } from './random.ts';

class PuzzleStore implements Store {
  constructor(private puzzles: PuzzleData[]) {}

  async getVector(): Promise<Float32Array | null> {
    return null;
  }
  async putVector(): Promise<void> {}
  async getMeta(): Promise<string | null> {
    return null;
  }
  async getPuzzle(): Promise<PuzzleData | null> {
    return null;
  }
  async getPuzzles(): Promise<PuzzleData[]> {
    return this.puzzles;
  }
  async getAnchors(): Promise<Anchors | null> {
    return null;
  }
}

const puzzles: PuzzleData[] = [
  { answer: 'shark', concepts: ['animal', 'danger', 'water', 'speed', 'technology'], ks: [] },
  { answer: 'volcano', concepts: ['danger', 'fire', 'earth', 'heat', 'nature'], ks: [] },
  { answer: 'library', concepts: ['knowledge', 'quiet', 'books', 'building', 'community'], ks: [] },
  { answer: 'courage', concepts: ['emotion', 'danger', 'strength', 'mind', 'war'], ks: [] },
  { answer: 'guitar', concepts: ['music', 'string', 'wood', 'sound', 'art'], ks: [] },
  { answer: 'winter', concepts: ['cold', 'snow', 'season', 'dark', 'clothing'], ks: [] },
];

const store = new PuzzleStore(puzzles);

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 100; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('randomPuzzle', () => {
  it('is deterministic for the same seed', async () => {
    const first = await randomPuzzle(store, 1234);
    const second = await randomPuzzle(store, 1234);
    expect(first).toEqual(second);
  });

  it('returns five distinct concepts that exclude the answer', async () => {
    for (const seed of [1, 2, 3, 4, 5, 100]) {
      const puzzle = await randomPuzzle(store, seed);
      expect(puzzle).not.toBeNull();
      if (!puzzle) continue;
      expect(puzzle.concepts).toHaveLength(5);
      expect(new Set(puzzle.concepts).size).toBe(5);
      expect(puzzle.concepts).not.toContain(puzzle.answer);
      expect(puzzles.map((p) => p.answer)).toContain(puzzle.answer);
    }
  });

  it('varies across seeds', async () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const puzzle = await randomPuzzle(store, seed);
      seen.add(JSON.stringify(puzzle));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('returns null without puzzles', async () => {
    expect(await randomPuzzle(new PuzzleStore([]), 1)).toBeNull();
  });
});
