import { describe, expect, it } from 'vitest';
import { MAX_TURNS, normalizeWord, replay } from './rules.ts';

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
  it('walks guesses in turn order', () => {
    const result = replay([{ type: 'guess', word: 'Fish' }, { type: 'guess', word: 'ocean' }], 'shark');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.turnsUsed).toBe(2);
    expect(result.state.timeline).toEqual([
      { type: 'guess', turn: 1, word: 'fish' },
      { type: 'guess', turn: 2, word: 'ocean' },
    ]);
    expect(result.state.solved).toBe(false);
  });

  it('marks the game solved on the answer', () => {
    const result = replay([{ type: 'guess', word: 'shark' }], 'shark');
    expect(result.ok && result.state.solved).toBe(true);
    expect(result.ok && result.state.revealed).toBe(false);
  });

  it('reveals when guesses run out', () => {
    const actions = Array.from({ length: MAX_TURNS }, () => ({ type: 'guess', word: 'fish' }));
    const result = replay(actions, 'shark');
    expect(result.ok && result.state.revealed).toBe(true);
  });

  it('rejects actions beyond the turn budget', () => {
    const actions = Array.from({ length: MAX_TURNS + 1 }, () => ({ type: 'guess', word: 'fish' }));
    const result = replay(actions, 'shark');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toBe('action_limit');
  });

  it('rejects actions after a solve', () => {
    const result = replay([{ type: 'guess', word: 'shark' }, { type: 'guess', word: 'fish' }], 'shark');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ error: 'game_over', actionIndex: 1 });
  });

  it('rejects unknown action types and bad words', () => {
    expect(replay([{ type: 'swap', slot: 0, concept: 'sea' }], 'shark').ok).toBe(false);
    expect(replay([{ type: 'guess', word: 'ab' }], 'shark').ok).toBe(false);
    expect(replay('nope', 'shark').ok).toBe(false);
  });
});
