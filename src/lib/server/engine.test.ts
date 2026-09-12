import { describe, expect, it } from 'vitest';
import type { GameRef } from '$lib/game/types.ts';
import type { Puzzle, Store, Vocab } from './store.ts';
import { clueSimilarityCap, computeView, isVariant, nearestToDifference } from './engine.ts';
import { stem } from '$lib/game/morphology.ts';
import { MAX_TURNS } from '$lib/game/rules.ts';
import { l2normalize, quantize } from '$lib/game/scoring.ts';
import { conceptByKey } from '$lib/game/concepts.ts';

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
    this.vocab = { dim, words, index: new Map(words.map((w, i) => [w, i])), bytes, hints, stems: words.map(stem) };
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
    expect(isVariant('employment', 'employed')).toBe(true);
  });

  it('leaves unrelated or short words alone', () => {
    expect(isVariant('cat', 'cattle')).toBe(false);
    expect(isVariant('shark', 'whale')).toBe(false);
  });
});

describe('clueSimilarityCap', () => {
  it('keeps early clues indirect and lets later clues get warmer', () => {
    expect(clueSimilarityCap(0)).toBe(0.5);
    expect(clueSimilarityCap(0.4)).toBeCloseTo(0.75);
    expect(clueSimilarityCap(0.8)).toBe(0.9);
  });
});

describe('nearestToDifference', () => {
  it('returns a scaled hint', () => {
    const store = new FakeVocabStore(entries);
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).toBe('forest');
    expect(clue.multiplier).toBe(0.2);
  });

  it('rejects negative projections in favor of a positive hint', () => {
    const store = new FakeVocabStore({
      cat: [1, 0, 0],
      wolf: [0, 1, 0],
      forest: [0.2, 0.4, 0.9],
      lair: [0.6, 0.3, 0.74],
    });
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).toBe('forest');
    expect(clue.multiplier).toBeGreaterThan(0);
  });

  it('never returns the exact answer', () => {
    const store = new FakeVocabStore(entries);
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).not.toBe('wolf');
  });

  it('draws hints only from the approved hint pool', () => {
    const store = new FakeVocabStore(entries, new Set(['cat', 'wolf', 'forest']));
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).toBe('forest');
  });

  it('never falls below the 25% answer-relevance floor', () => {
    const store = new FakeVocabStore({
      cat: [1, 0, 0],
      wolf: [0, 1, 0],
      obscure: [0.1, 0.2, 0.97],
    });
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).toBe('');
    expect(clue.multiplier).toBeNull();
  });

  it('respects the dynamic similarity cap', () => {
    const store = new FakeVocabStore({
      cat: [1, 0, 0],
      wolf: [0, 1, 0],
      twin: [0.1, 0.99, 0.05],
      far: [0.2, 0.4, 0.9],
    });
    const clue = nearestToDifference(store.vocab, store.vocab.index.get('cat')!, store.vocab.index.get('wolf')!);
    expect(clue.word).not.toBe('twin');
    expect(clue.word).toBe('far');
  });

  it('does not return a variant of the guess', () => {
    const store = new FakeVocabStore({
      election: [1, 0, 0],
      elections: [0.99, 0.01, 0],
      winter: [0, 1, 0],
      snow: [0.2, 0.4, 0.9],
    });
    const clue = nearestToDifference(
      store.vocab,
      store.vocab.index.get('election')!,
      store.vocab.index.get('winter')!,
    );
    expect(clue.word).toBe('snow');
    expect(clue.multiplier).toBeGreaterThan(0);
  });

  it('does not repeat an excluded clue', () => {
    const store = new FakeVocabStore(entries);
    const excluded = new Set([store.vocab.index.get('forest')!]);
    const clue = nearestToDifference(
      store.vocab,
      store.vocab.index.get('cat')!,
      store.vocab.index.get('wolf')!,
      excluded,
    );
    expect(clue.word).not.toBe('forest');
  });

  it('uses a two-word fit when its landing is materially warmer', () => {
    const store = new FakeVocabStore({
      guess: [1, 0, 0, 0],
      target: [0, 1, 0, 0],
      north: [-0.5, 0.4, 0.768, 0],
      norths: [-0.5, 0.8, 0, 0.3],
      south: [-0.5, 0.4, -0.768, 0],
      bridge: [-0.5, 0.8, 0, 0.332],
    });
    const clue = nearestToDifference(
      store.vocab,
      store.vocab.index.get('guess')!,
      store.vocab.index.get('target')!,
    );
    expect(clue.secondWord).not.toBeNull();
    expect(clue.secondMultiplier).toBeGreaterThan(0);
    expect(clue.sumWord).toBe('bridge');
    expect(clue.suggestion).toBe('bridge');
    expect(clue.sumSimilarity).toBeGreaterThanOrEqual(0.79);
  });
});

describe('computeView', () => {
  it('projects concept guesses onto an averaged semantic axis', async () => {
    const plurality = conceptByKey('plurality')!;
    const conceptEntries: Record<string, number[]> = { target: [1, 0, 0] };
    for (const [positive, negative] of plurality.pairs ?? []) {
      conceptEntries[positive] = [1, 0.1, 0];
      conceptEntries[negative] = [-1, 0.1, 0];
    }
    const store = new FakeVocabStore(conceptEntries);
    const result = await computeView(
      { store },
      game,
      ['target'],
      [{ type: 'concept', concept: 'plurality' }],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const entry = result.view.history[0];
    expect(entry.type).toBe('guess');
    if (entry.type !== 'guess') return;
    expect(entry.concept).toBe('plurality');
    expect(entry.word).toBe('cats');
    expect(entry.conceptScore).toBeGreaterThan(0.9);
    expect(entry.conceptPosition).toBeGreaterThan(0.9);
    expect(entry.conceptPositiveLabel).toBe('plural');
    expect(entry.conceptNegativeLabel).toBe('singular');
    expect(result.view.score).toBe(0);
  });

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
        similarityPercentile: 0.167,
        clue: 'forest',
        multiplier: 0.2,
        clueSimilarity: 0.402,
        concept: null,
        conceptScore: null,
        conceptPosition: null,
        conceptPositiveLabel: null,
        conceptNegativeLabel: null,
        secondClue: null,
        secondMultiplier: null,
        secondClueSimilarity: null,
        sumWord: 'forest',
        sumSimilarity: 0.402,
        sumPercentile: 0.333,
        suggestion: 'forest',
        suggestionSimilarity: 0.402,
        suggestionPercentile: 0.333,
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

  it('solves the round on a close form of the answer', async () => {
    const result = await run(new FakeVocabStore(entries), [guess('wolfs')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.roundEnded).toBe(true);
    expect(result.view.roundAnswer).toBe('wolf');
    expect(result.view.results[0]).toMatchObject({ answer: 'wolf', solved: true });
  });

  it('does not solve on a same-stem word with different meaning', async () => {
    const store = new FakeVocabStore({
      university: [1, 0, 0],
      universal: [0, 1, 0],
      filler: [0, 0, 1],
    });
    const result = await computeView({ store }, game, ['university'], [guess('universal')]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.roundEnded).toBe(false);
    expect(result.view.roundAnswer).toBeNull();
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
