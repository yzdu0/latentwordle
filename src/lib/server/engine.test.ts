import { describe, expect, it } from 'vitest';
import type { GameRef } from '$lib/game/types.ts';
import type { Puzzle, Store, Vocab } from './store.ts';
import { clueSimilarityCap, computeView, isVariant, nearestToDifference } from './engine.ts';
import { MAX_TURNS } from '$lib/game/rules.ts';
import { l2normalize, quantize } from '$lib/game/scoring.ts';

class FakeVocabStore implements Store {
  vocab: Vocab;

  constructor(entries: Record<string, number[]>, hintWords?: Set<string>) {
    const words = Object.keys(entries);
    const dim = entries[words[0]].length;
    const bytes = new Int8Array(words.length * dim);
    words.forEach((word, i) => {
      const q = quantize(l2normalize(entries[word]));
      bytes.set(new Uint8Array(q.buffer), i * dim);
    });
    const hints = Uint8Array.from(words, (word) => (!hintWords || hintWords.has(word) ? 1 : 0));
    this.vocab = { dim, words, index: new Map(words.map((w, i) => [w, i])), bytes, hints };
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

const answers = ['wolf', 'moon', 'cat', 'forest', 'puppy'];
const game: GameRef = { kind: 'random', seed: 1 };
const guess = (word: string) => ({ type: 'guess', word });

async function run(store: FakeVocabStore, actions: unknown) {
  return computeView({ store }, game, answers, actions);
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

  it('draws clues only from hint-eligible words', () => {
    const hintEntries = {
      cat: [1, 0, 0],
      wolf: [0, 1, 0],
      moon: [0, 0.6, 0.8],
      glade: [0.3, 0.5, 0.81],
    };
    const store = new FakeVocabStore(hintEntries, new Set(['cat', 'wolf', 'glade']));
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).toBe('glade');
    expect(clue.sumWord).toBe('glade');
    expect(store.vocab.index.has('moon')).toBe(true);
    expect(store.vocab.hints[store.vocab.index.get('moon')!]).toBe(0);
  });
});

describe('computeView', () => {
  it('returns a clue for each guess', async () => {
    const result = await run(new FakeVocabStore(entries), [guess('cat')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.round).toBe(0);
    expect(result.view.turnsUsed).toBe(1);
    expect(result.view.roundEnded).toBe(false);
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

  it('reports the direct similarity of each guess', async () => {
    const result = await run(new FakeVocabStore(entries), [guess('cat'), guess('moon')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = result.view.history;
    expect(first.type).toBe('guess');
    expect(second.type).toBe('guess');
    if (first.type !== 'guess' || second.type !== 'guess') return;
    expect(first.similarity).toBe(0);
    expect(second.similarity).toBeCloseTo(0.6, 2);
  });

  it('keeps the answer hidden while the round is live', async () => {
    const result = await run(new FakeVocabStore(entries), [guess('cat')]);
    expect(result.ok && result.view.roundAnswer).toBeNull();
  });

  it('accepts non-hint words as guesses', async () => {
    const store = new FakeVocabStore(entries, new Set(['cat', 'wolf']));
    const result = await run(store, [guess('moon')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.history[0]).toMatchObject({ word: 'moon' });
  });

  it('reveals the answer and scores the round when solved', async () => {
    const result = await run(new FakeVocabStore(entries), [guess('cat'), guess('wolf')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.roundEnded).toBe(true);
    expect(result.view.finished).toBe(false);
    expect(result.view.roundAnswer).toBe('wolf');
    expect(result.view.results).toHaveLength(1);
    expect(result.view.results[0]).toMatchObject({ answer: 'wolf', solved: true, turnsUsed: 2 });
    expect(result.view.score).toBe(100 + (MAX_TURNS - 2 + 1) * 200);
    const last = result.view.history.at(-1);
    if (last?.type !== 'guess') return;
    expect(last.clue).toBe('wolf');
    expect(last.similarity).toBe(1);
    expect(last.sumSimilarity).toBe(1);
  });

  it('moves to the next round', async () => {
    const result = await run(new FakeVocabStore(entries), [guess('wolf'), { type: 'next' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.round).toBe(1);
    expect(result.view.history).toHaveLength(0);
    expect(result.view.results).toHaveLength(1);
    expect(result.view.roundEnded).toBe(false);
  });

  it('handles giving up: reveals the word and keeps earned points', async () => {
    const result = await run(new FakeVocabStore(entries), [guess('moon'), { type: 'giveup' }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.roundEnded).toBe(true);
    expect(result.view.roundAnswer).toBe('wolf');
    expect(result.view.results[0]).toMatchObject({ answer: 'wolf', solved: false, givenUp: true });
    expect(result.view.score).toBe(60);
    expect(result.view.history.at(-1)).toEqual({ type: 'giveup', turn: 1 });
  });

  it('rejects guesses outside the vocabulary', async () => {
    const result = await run(new FakeVocabStore(entries), [guess('cat'), guess('zymurgy')]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ error: 'not_a_word', actionIndex: 1 });
  });

  it('ends the round after the guess budget', async () => {
    const actions = Array.from({ length: MAX_TURNS }, () => guess('cat'));
    const result = await run(new FakeVocabStore(entries), actions);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.roundEnded).toBe(true);
    expect(result.view.finished).toBe(false);
    expect(result.view.roundAnswer).toBe('wolf');
  });

  it('rejects actions after the day is finished', async () => {
    const actions: unknown[] = [];
    answers.forEach((answer, index) => {
      actions.push(guess(answer));
      if (index < answers.length - 1) actions.push({ type: 'next' });
    });
    actions.push(guess('wolf'));
    const result = await run(new FakeVocabStore(entries), actions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toBe('game_over');
  });
});
