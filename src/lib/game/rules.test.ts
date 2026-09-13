import { describe, expect, it } from 'vitest';
import { MAX_ROUNDS, MAX_TURNS, normalizeWord, replay, roundEnded } from './rules.ts';

const answers = ['shark', 'volcano', 'library', 'courage', 'honey'];
const guess = (word: string) => ({ type: 'guess', word });

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
  it('tracks guesses in the current round', () => {
    const result = replay([guess('Fish'), guess('ocean')], answers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.current.index).toBe(0);
    expect(result.state.current.turns).toEqual([
      { type: 'guess', turn: 1, word: 'fish', actionIndex: 0 },
      { type: 'guess', turn: 2, word: 'ocean', actionIndex: 1 },
    ]);
    expect(roundEnded(result.state.current)).toBe(false);
    expect(result.state.finished).toBe(false);
  });

  it('ends the round on the right guess and waits for next', () => {
    const result = replay([guess('shark')], answers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.current.solved).toBe(true);
    expect(roundEnded(result.state.current)).toBe(true);
    expect(result.state.finished).toBe(false);
  });

  it('advances to the next round on next', () => {
    const result = replay([guess('shark'), { type: 'next' }], answers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rounds).toHaveLength(1);
    expect(result.state.rounds[0].solved).toBe(true);
    expect(result.state.current.index).toBe(1);
    expect(result.state.current.turns).toHaveLength(0);
  });

  it('rejects guesses once a round has ended', () => {
    const result = replay([guess('shark'), guess('fish')], answers);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ error: 'invalid_action', actionIndex: 1, detail: 'round over' });
  });

  it('rejects next before the round is over', () => {
    const result = replay([{ type: 'next' }], answers);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toBe('invalid_action');
  });

  it('ends the round after the guess budget', () => {
    const actions = Array.from({ length: MAX_TURNS }, () => guess('fish'));
    const result = replay(actions, answers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.current.turns).toHaveLength(MAX_TURNS);
    expect(roundEnded(result.state.current)).toBe(true);
    expect(result.state.finished).toBe(false);
  });

  it('ends the round on give up', () => {
    const result = replay([guess('fish'), { type: 'giveup' }], answers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.current.givenUp).toBe(true);
    expect(roundEnded(result.state.current)).toBe(true);
  });

  it('finishes the day after five rounds', () => {
    const actions: unknown[] = [];
    answers.forEach((answer, index) => {
      actions.push(guess(answer));
      if (index < answers.length - 1) actions.push({ type: 'next' });
    });
    const result = replay(actions, answers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.finished).toBe(true);
    expect(result.state.rounds).toHaveLength(MAX_ROUNDS - 1);
    expect(result.state.current.index).toBe(MAX_ROUNDS - 1);
    expect(result.state.current.solved).toBe(true);
  });

  it('rejects actions after the day is finished', () => {
    const actions: unknown[] = [];
    answers.forEach((answer, index) => {
      actions.push(guess(answer));
      if (index < answers.length - 1) actions.push({ type: 'next' });
    });
    actions.push(guess('shark'));
    const result = replay(actions, answers);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.error).toBe('game_over');
  });

  it('rejects unknown action types and bad words', () => {
    expect(replay([{ type: 'swap', slot: 0, concept: 'sea' }], answers).ok).toBe(false);
    expect(replay([guess('ab')], answers).ok).toBe(false);
    expect(replay('nope', answers).ok).toBe(false);
  });

  it('uses a concept probe as a turn without treating an anchor as the answer', () => {
    const result = replay([{ type: 'concept', concept: 'plurality' }], ['cats'], { rounds: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.current.turns[0]).toMatchObject({ concept: 'plurality', word: 'cats' });
    expect(result.state.current.solved).toBe(false);
  });

  it('uses a decomposition probe as a turn without solving the round', () => {
    const result = replay([{ type: 'decomposition' }], ['shark'], { rounds: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.current.turns[0]).toEqual({
      type: 'decomposition',
      turn: 1,
      actionIndex: 0,
    });
    expect(result.state.current.solved).toBe(false);
  });
});
