import type { GameError } from './types.ts';
import { conceptByKey } from './concepts.ts';
import type { ConceptKey } from './concepts.ts';

export const MAX_TURNS = 10;
export const MAX_ROUNDS = 5;
export const DECOMPOSITION_UNLOCK_TURN = 4;

export interface NormalizedGuess {
  type: 'guess';
  turn: number;
  word: string;
  concept?: ConceptKey;
  actionIndex: number;
}

export interface NormalizedGiveUp {
  type: 'giveup';
}

export interface NormalizedDecomposition {
  type: 'decomposition';
  turn: number;
  actionIndex: number;
}

export type NormalizedAction = NormalizedGuess | NormalizedDecomposition | NormalizedGiveUp;
export type NormalizedTurn = NormalizedGuess | NormalizedDecomposition;

export interface NormalizedRound {
  index: number;
  turns: NormalizedTurn[];
  givenUp: boolean;
  solved: boolean;
}

export interface ReplayState {
  rounds: NormalizedRound[];
  current: NormalizedRound;
  finished: boolean;
}

export type ReplayResult = { ok: true; state: ReplayState } | { ok: false; error: GameError };

const WORD_RE = /^[a-z]{3,15}$/;

export function normalizeWord(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const word = input.trim().toLowerCase();
  return WORD_RE.test(word) ? word : null;
}

function newRound(index: number): NormalizedRound {
  return { index, turns: [], givenUp: false, solved: false };
}

export function roundEnded(round: NormalizedRound, maxTurns = MAX_TURNS): boolean {
  return round.solved || round.givenUp || round.turns.length >= maxTurns;
}

export interface ReplayOptions {
  maxTurns?: number;
  rounds?: number;
  matches?: (guess: string, answer: string) => boolean;
}

export function replay(rawActions: unknown, answers: string[], options: ReplayOptions = {}): ReplayResult {
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const rounds = options.rounds ?? MAX_ROUNDS;
  const matches = options.matches ?? ((guess: string, answer: string) => guess === answer);
  if (!Array.isArray(rawActions)) {
    return { ok: false, error: { error: 'bad_request', detail: 'actions must be an array' } };
  }

  const state: ReplayState = {
    rounds: [],
    current: newRound(0),
    finished: answers.length === 0,
  };

  for (let i = 0; i < rawActions.length; i++) {
    const action = rawActions[i] as { type?: unknown; word?: unknown; concept?: unknown };
    if (state.finished) {
      return { ok: false, error: { error: 'game_over', actionIndex: i } };
    }
    const round = state.current;
    const ended = roundEnded(round, maxTurns);

    if (action?.type === 'next') {
      if (!ended || round.index >= rounds - 1) {
        return { ok: false, error: { error: 'invalid_action', actionIndex: i } };
      }
      state.rounds.push(round);
      state.current = newRound(round.index + 1);
      continue;
    }

    if (ended) {
      return { ok: false, error: { error: 'invalid_action', actionIndex: i, detail: 'round over' } };
    }

    if (action?.type === 'giveup') {
      round.givenUp = true;
      if (round.index >= rounds - 1) state.finished = true;
      continue;
    }

    if (action?.type === 'decomposition') {
      if (round.turns.length < DECOMPOSITION_UNLOCK_TURN) {
        return {
          ok: false,
          error: {
            error: 'invalid_action',
            actionIndex: i,
            detail: `decomposition unlocks after ${DECOMPOSITION_UNLOCK_TURN} guesses`,
          },
        };
      }
      round.turns.push({
        type: 'decomposition',
        turn: round.turns.length + 1,
        actionIndex: i,
      });
      if (round.turns.length >= maxTurns && round.index >= rounds - 1) state.finished = true;
      continue;
    }

    let word: string | null = null;
    let concept: ConceptKey | undefined;
    if (action?.type === 'guess') {
      word = normalizeWord(action.word);
    } else if (action?.type === 'concept') {
      const definition = conceptByKey(typeof action.concept === 'string' ? action.concept : '');
      if (definition) {
        concept = definition.key;
        word = definition.positive.words[0];
      }
    }
    if (!word) return { ok: false, error: { error: 'invalid_action', actionIndex: i } };
    round.turns.push({ type: 'guess', turn: round.turns.length + 1, word, concept, actionIndex: i });
    if (!concept && matches(word, answers[round.index])) {
      round.solved = true;
    }
    if ((round.solved || round.turns.length >= maxTurns) && round.index >= rounds - 1) {
      state.finished = true;
    }
  }

  return { ok: true, state };
}
