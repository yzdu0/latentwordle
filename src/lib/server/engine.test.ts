import { describe, expect, it } from 'vitest';
import type { GameRef } from '$lib/game/types.ts';
import type { Puzzle, Store, Vocab } from './store.ts';
import { clueSimilarityCap, computeView, isVariant, nearestToDifference } from './engine.ts';
import { l2normalize, quantize } from '$lib/game/scoring.ts';

class FakeVocabStore implements Store {
  vocab: Vocab;

  constructor(entries: Record<string, number[]>) {
    const words = Object.keys(entries);
    const dim = entries[words[0]].length;
    const bytes = new Int8Array(words.length * dim);
    words.forEach((word, i) => {
      const q = quantize(l2normalize(entries[word]));
      bytes.set(new Uint8Array(q.buffer), i * dim);
    });
    this.vocab = { dim, words, index: new Map(words.map((w, i) => [w, i])), bytes };
  }

  async getPuzzle(): Promise<Puzzle | null> {
    return null;
  }
  async getPuzzles(): Promise<Puzzle[]> {
    return [];
  }
  async getVocab(): Promise<Vocab> {
    return this.vocab;
  }
  async getMeta(): Promise<string | null> {
    return null;
  }
}

const entries = {
  cat: [1, 0, 0],
  wolf: [0, 1, 0],
  moon: [0, 0.6, 0.8],
  forest: [0.2, 0.4, 0.9],
  puppy: [0.2, 0.98, 0],
  wolfs: [0.1, 0.99, 0],
  zork: [-1, 0, 0],
};

const puzzle: Puzzle = { answer: 'wolf' };
const game: GameRef = { kind: 'random', seed: 1 };

async function run(store: FakeVocabStore, actions: unknown) {
  return computeView({ store }, game, puzzle, actions);
}

describe('isVariant', () => {
  it('detects plurals and suffixed forms', () => {
    expect(isVariant('shark', 'sharks')).toBe(true);
    expect(isVariant('volcano', 'volcanoes')).toBe(true);
    expect(isVariant('courage', 'courageous')).toBe(true);
  });

  it('leaves unrelated or short words alone', () => {
    expect(isVariant('cat', 'cattle')).toBe(false);
    expect(isVariant('shark', 'whale')).toBe(false);
  });
});

describe('clueSimilarityCap', () => {
  it('keeps far guesses cryptic and close guesses direct', () => {
    expect(clueSimilarityCap(0)).toBe(0.5);
    expect(clueSimilarityCap(0.1)).toBe(0.5);
    expect(clueSimilarityCap(0.4)).toBeCloseTo(0.75);
    expect(clueSimilarityCap(0.6)).toBe(0.9);
    expect(clueSimilarityCap(0.95)).toBe(0.9);
  });
});

describe('nearestToDifference', () => {
  it('returns a scaled hint and skips near-answer words', () => {
    const store = new FakeVocabStore(entries);
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).toBe('forest');
    expect(clue.multiplier).toBe(0.2);
  });

  it('never returns the answer or a variant', () => {
    const store = new FakeVocabStore(entries);
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).not.toBe('wolf');
    expect(clue.word).not.toBe('wolfs');
  });
});

describe('computeView', () => {
  it('returns a clue for each guess', async () => {
    const result = await run(new FakeVocabStore(entries), [{ type: 'guess', word: 'cat' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.history).toEqual([
      {
        type: 'guess',
        turn: 1,
        word: 'cat',
        similarity: 0,
        clue: 'forest',
        multiplier: 0.2,
        sumWord: 'forest',
        sumSimilarity: 0.402,
      },
    ]);
  });

  it('reports how close the vector-sum word lands to the answer', async () => {
    const result = await run(new FakeVocabStore(entries), [{ type: 'guess', word: 'cat' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.view.history[0];
    expect(entry.sumWord).toBe('forest');
    expect(entry.sumWord).not.toBe('wolf');
    expect(entry.sumSimilarity).toBeCloseTo(0.402, 2);
  });

  it('reports the direct similarity of each guess', async () => {
    const result = await run(new FakeVocabStore(entries), [
      { type: 'guess', word: 'cat' },
      { type: 'guess', word: 'moon' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.history[0].similarity).toBe(0);
    expect(result.view.history[1].similarity).toBeCloseTo(0.6, 2);
  });

  it('keeps the answer hidden until solved', async () => {
    const result = await run(new FakeVocabStore(entries), [{ type: 'guess', word: 'cat' }]);
    expect(result.ok && result.view.answer).toBeNull();
  });

  it('reveals the answer on a correct guess', async () => {
    const result = await run(new FakeVocabStore(entries), [
      { type: 'guess', word: 'cat' },
      { type: 'guess', word: 'wolf' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.solved).toBe(true);
    expect(result.view.answer).toBe('wolf');
    expect(result.view.history.at(-1)).toMatchObject({ word: 'wolf', clue: 'wolf', multiplier: null });
    expect(result.view.history.at(-1)?.similarity).toBe(1);
    expect(result.view.history.at(-1)?.sumWord).toBe('wolf');
    expect(result.view.history.at(-1)?.sumSimilarity).toBe(1);
  });

  it('rejects guesses outside the vocabulary', async () => {
    const result = await run(new FakeVocabStore(entries), [
      { type: 'guess', word: 'cat' },
      { type: 'guess', word: 'zymurgy' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ error: 'not_a_word', actionIndex: 1 });
  });

  it('marks the game revealed after the turn budget', async () => {
    const actions = Array.from({ length: 10 }, () => ({ type: 'guess', word: 'cat' }));
    const result = await run(new FakeVocabStore(entries), actions);
    expect(result.ok && result.view.revealed).toBe(true);
    expect(result.ok && result.view.answer).toBe('wolf');
  });
});
