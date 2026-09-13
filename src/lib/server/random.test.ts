import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Puzzle, Store, Vocab } from './store.ts';
import { MAX_ROUNDS } from '$lib/game/rules.ts';
import { dailyAnswerSeed, mulberry32, randomAnswers, selectAnswers, selectHardAnswers } from './random.ts';

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

  it('selects only the current pool for the normal game', () => {
    const mixed: Puzzle[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ answer: `current${i}`, difficulty: 'current' as const })),
      ...Array.from({ length: 20 }, (_, i) => ({ answer: `difficult${i}`, difficulty: 'difficult' as const })),
    ];
    const answers = selectAnswers(mixed, 1234, 5)!;
    expect(answers.every((answer) => answer.startsWith('current'))).toBe(true);
    expect(new Set(answers).size).toBe(5);
  });

  it('selects only the difficult pool for Hard mode', () => {
    const mixed: Puzzle[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ answer: `current${i}`, difficulty: 'current' as const })),
      ...Array.from({ length: 20 }, (_, i) => ({ answer: `difficult${i}`, difficulty: 'difficult' as const })),
    ];
    const answers = selectHardAnswers(mixed, 1234, 5)!;
    expect(answers.every((answer) => answer.startsWith('difficult'))).toBe(true);
    expect(new Set(answers).size).toBe(5);
  });

  it('preserves the legacy current-only selection when difficult mode is absent', () => {
    const mixed: Puzzle[] = [
      ...puzzles,
      { answer: 'sanskrit', difficulty: 'difficult' },
      { answer: 'imperial', difficulty: 'difficult' },
    ];
    expect(selectAnswers(mixed, 4321, 5)).toEqual(selectAnswers(puzzles, 4321, 5));
  });

  it("keeps 13 September's five production answers unchanged", () => {
    const current = (JSON.parse(readFileSync('data/answers.json', 'utf8')) as string[]).map((answer) => ({
      answer,
      difficulty: 'current' as const,
    }));
    const difficult = (JSON.parse(readFileSync('data/answers-difficult.json', 'utf8')) as string[]).map((answer) => ({
      answer,
      difficulty: 'difficult' as const,
    }));
    const seed = dailyAnswerSeed(20_709, 624_413_479);
    expect(selectAnswers([...current, ...difficult], seed, 5)).toEqual([
      'election',
      'campus',
      'suite',
      'citizen',
      'song',
    ]);
  });

  it("can fill the 100-round local Hard mode from the difficult pool", () => {
    const current = (JSON.parse(readFileSync('data/answers.json', 'utf8')) as string[]).map((answer) => ({
      answer,
      difficulty: 'current' as const,
    }));
    const difficultWords = JSON.parse(readFileSync('data/answers-difficult.json', 'utf8')) as string[];
    const difficult = difficultWords.map((answer) => ({ answer, difficulty: 'difficult' as const }));
    const seed = dailyAnswerSeed(20_709, 106_777_546);
    const answers = selectHardAnswers([...current, ...difficult], seed, 100)!;
    expect(answers.every((answer) => difficultWords.includes(answer))).toBe(true);
    expect(new Set(answers).size).toBe(100);
  });
});
