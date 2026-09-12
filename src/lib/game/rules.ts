import type { GameError } from './types.ts';

export const MAX_TURNS = 10;
export const CONCEPT_SLOTS = 5;

export interface NormalizedGuess {
  type: 'guess';
  turn: number;
  word: string;
}

export interface NormalizedSwap {
  type: 'swap';
  turn: number;
  slot: number;
  from: string;
  concept: string;
}

export type NormalizedAction = NormalizedGuess | NormalizedSwap;

export interface ReplayState {
  concepts: string[];
  timeline: NormalizedAction[];
  turnsUsed: number;
  solved: boolean;
  revealed: boolean;
}

export type ReplayResult = { ok: true; state: ReplayState } | { ok: false; error: GameError };

const WORD_RE = /^[a-z]{3,15}$/;

export function normalizeWord(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const word = input.trim().toLowerCase().replace(/\s+/g, ' ');
  return WORD_RE.test(word) ? word : null;
}

export function replay(
  rawActions: unknown,
  initialConcepts: string[],
  answer: string,
  maxTurns = MAX_TURNS,
): ReplayResult {
  if (!Array.isArray(rawActions)) {
    return { ok: false, error: { error: 'bad_request', detail: 'actions must be an array' } };
  }
  if (rawActions.length > maxTurns) {
    return { ok: false, error: { error: 'action_limit', actionIndex: maxTurns } };
  }

  const state: ReplayState = {
    concepts: [...initialConcepts],
    timeline: [],
    turnsUsed: 0,
    solved: false,
    revealed: false,
  };

  for (let i = 0; i < rawActions.length; i++) {
    const action = rawActions[i] as { type?: unknown; word?: unknown; slot?: unknown; concept?: unknown };
    if (state.solved || state.turnsUsed >= maxTurns) {
      return { ok: false, error: { error: 'game_over', actionIndex: i } };
    }

    if (action?.type === 'guess') {
      const word = normalizeWord(action.word);
      if (!word) return { ok: false, error: { error: 'invalid_action', actionIndex: i } };
      state.turnsUsed += 1;
      state.timeline.push({ type: 'guess', turn: state.turnsUsed, word });
      if (word === answer) state.solved = true;
      continue;
    }

    if (action?.type === 'swap') {
      const slot = action.slot;
      if (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= state.concepts.length) {
        return { ok: false, error: { error: 'invalid_action', actionIndex: i } };
      }
      const concept = normalizeWord(action.concept);
      if (!concept) return { ok: false, error: { error: 'invalid_action', actionIndex: i } };
      const index = slot as number;
      if (concept === state.concepts[index] || state.concepts.includes(concept)) {
        return { ok: false, error: { error: 'duplicate_concept', actionIndex: i } };
      }
      const from = state.concepts[index];
      state.concepts[index] = concept;
      state.turnsUsed += 1;
      state.timeline.push({ type: 'swap', turn: state.turnsUsed, slot: index, from, concept });
      continue;
    }

    return { ok: false, error: { error: 'invalid_action', actionIndex: i } };
  }

  state.revealed = !state.solved && state.turnsUsed >= maxTurns;
  return { ok: true, state };
}
