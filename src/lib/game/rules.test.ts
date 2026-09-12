import { describe, expect, it } from 'vitest';
import { MAX_TURNS, normalizeWord, replay } from './rules.ts';

const concepts = ['animal', 'danger', 'water', 'speed', 'technology'];

describe('normalizeWord', () => {
  it('lowercases and trims', () => {
    expect(normalizeWord('  Shark ')).toBe('shark');
  });

  it('rejects short, long, numeric and multi-word input', () => {
    expect(normalizeWord('ab')).toBeNull();
    expect(normalizeWord('a'.repeat(16))).toBeNull();
    expect(normalizeWord('hello world')).toBeNull();
    expect(normalizeWord('123')).toBeNull();
    expect(normalizeWord(42)).toBeNull();
  });
});

describe('replay', () => {
  it('walks guesses and swaps in turn order', () => {
    const result = replay(
      [
        { type: 'guess', word: 'Fish' },
        { type: 'swap', slot: 4, concept: 'sea' },
        { type: 'guess', word: 'ocean' },
      ],
      concepts,
      'shark',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.turnsUsed).toBe(3);
    expect(result.state.concepts).toEqual(['animal', 'danger', 'water', 'speed', 'sea']);
    expect(result.state.timeline).toEqual([
      { type: 'guess', turn: 1, word: 'fish' },
      { type: 'swap', turn: 2, slot: 4, from: 'technology', concept: 'sea' },
      { type: 'guess', turn: 3, word: 'ocean' },
    ]);
    expect(result.state.solved).toBe(false);
  });

  it('marks the game solved on the answer', () => {
    const result = replay([{ type: 'guess', word: 'shark' }], concepts, 'shark');
    expect(result.ok && result.state.solved).toBe(true);
    expect(result.ok && result.state.revealed).toBe(false);
  });

  it('reveals when turns run out', () => {
    const actions = Array.from({ length: MAX_TURNS }, () => ({ type: 'guess', word: 'fish' }));
    const result = replay(actions, concepts, 'shark');
    expect(result.ok && result.state.revealed).toBe(true);
  });

  it('rejects actions beyond the turn budget', () => {
    const actions = Array.from({ length: MAX_TURNS + 1 }, () => ({ type: 'guess', word: 'fish' }));
    const result = replay(actions, concepts, 'shark');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toBe('action_limit');
  });

  it('rejects actions after a solve', () => {
    const result = replay(
      [
        { type: 'guess', word: 'shark' },
        { type: 'guess', word: 'fish' },
      ],
      concepts,
      'shark',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ error: 'game_over', actionIndex: 1 });
  });

  it('rejects invalid slots, duplicate concepts and unknown actions', () => {
    expect(replay([{ type: 'swap', slot: 9, concept: 'sea' }], concepts, 'shark').ok).toBe(false);
    expect(replay([{ type: 'swap', slot: 0, concept: 'water' }], concepts, 'shark').ok).toBe(false);
    expect(replay([{ type: 'swap', slot: 0, concept: 'animal' }], concepts, 'shark').ok).toBe(false);
    expect(replay([{ type: 'dance' }], concepts, 'shark').ok).toBe(false);
  });

  it('allows reusing a concept that was swapped out', () => {
    const result = replay(
      [
        { type: 'swap', slot: 4, concept: 'sea' },
        { type: 'swap', slot: 4, concept: 'technology' },
      ],
      concepts,
      'shark',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state.concepts[4]).toBe('technology');
  });
});
