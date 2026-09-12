import type { GameError } from './types.ts';

export const MAX_TURNS = 5;

export interface NormalizedGuess {
  type: 'guess';
  turn: number;
  word: string;
}

export interface NormalizedGiveUp {
  type: 'giveup';
}

export type NormalizedAction = NormalizedGuess | NormalizedGiveUp;

export interface ReplayState {
  timeline: NormalizedAction[];
  turnsUsed: number;
  solved: boolean;
  revealed: boolean;
  givenUp: boolean;
}

export type ReplayResult = { ok: true; state: ReplayState } | { ok: false; error: GameError };

const WORD_RE = /^[a-z]{3,15}$/;

export function normalizeWord(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const word = input.trim().toLowerCase();
  return WORD_RE.test(word) ? word : null;
}

export function replay(rawActions: unknown, answer: string, maxTurns = MAX_TURNS): ReplayResult {
  if (!Array.isArray(rawActions)) {
    return { ok: false, error: { error: 'bad_request', detail: 'actions must be an array' } };
  }
  const giveUpCount = rawActions.filter(
    (action) => (action as { type?: unknown })?.type === 'giveup',
  ).length;
  if (rawActions.length - giveUpCount > maxTurns) {
    return { ok: false, error: { error: 'action_limit', actionIndex: maxTurns } };
  }

  const state: ReplayState = {
    timeline: [],
    turnsUsed: 0,
    solved: false,
    revealed: false,
    givenUp: false,
  };

  for (let i = 0; i < rawActions.length; i++) {
    const action = rawActions[i] as { type?: unknown; word?: unknown };
    if (state.solved || state.revealed || state.givenUp || state.turnsUsed >= maxTurns) {
      return { ok: false, error: { error: 'game_over', actionIndex: i } };
    }

    if (action?.type === 'giveup') {
      state.givenUp = true;
      state.revealed = true;
      state.timeline.push({ type: 'giveup' });
      continue;
    }

    if (action?.type !== 'guess') {
      return { ok: false, error: { error: 'invalid_action', actionIndex: i } };
    }
    const word = normalizeWord(action.word);
    if (!word) {
      return { ok: false, error: { error: 'invalid_action', actionIndex: i } };
    }
    state.turnsUsed += 1;
    state.timeline.push({ type: 'guess', turn: state.turnsUsed, word });
    if (word === answer) state.solved = true;
  }

  state.revealed = state.revealed || (!state.solved && state.turnsUsed >= maxTurns);
  return { ok: true, state };
}
