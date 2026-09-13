import type { ConceptKey } from './concepts.ts';

export type GameRef = { kind: 'daily'; date: string } | { kind: 'random'; seed: number };

export type Action =
  | { type: 'guess'; word: string }
  | { type: 'concept'; concept: ConceptKey }
  | { type: 'decomposition' }
  | { type: 'giveup' }
  | { type: 'next' };

export interface GameStart {
  game: GameRef;
  maxTurns: number;
  rounds: number;
}

export interface GuessEntry {
  type: 'guess';
  turn: number;
  word: string;
  similarity: number;
  similarityPercentile: number;
  clue: string;
  multiplier: number | null;
  clueSimilarity: number;
  concept: ConceptKey | null;
  conceptScore: number | null;
  conceptPosition: number | null;
  conceptPositiveLabel: string | null;
  conceptNegativeLabel: string | null;
  secondClue: string | null;
  secondMultiplier: number | null;
  secondClueSimilarity: number | null;
  sumWord: string;
  sumSimilarity: number;
  sumPercentile: number;
  suggestion: string;
  suggestionSimilarity: number;
  suggestionPercentile: number;
}

export interface GiveUpEntry {
  type: 'giveup';
  turn: number;
}

export interface DecompositionTerm {
  word: string;
  multiplier: number;
  similarity: number;
}

export interface DecompositionEntry {
  type: 'decomposition';
  turn: number;
  terms: DecompositionTerm[];
  similarity: number;
  similarityPercentile: number;
}

export type HistoryEntry = GuessEntry | DecompositionEntry | GiveUpEntry;

export interface RoundSummary {
  index: number;
  answer: string;
  solved: boolean;
  givenUp: boolean;
  turnsUsed: number;
  score: number;
  bestSimilarity: number;
}

export interface GameView {
  game: GameRef;
  maxTurns: number;
  rounds: number;
  round: number;
  turnsUsed: number;
  finished: boolean;
  roundEnded: boolean;
  roundAnswer: string | null;
  history: HistoryEntry[];
  results: RoundSummary[];
  score: number;
}

export type GameErrorCode =
  | 'bad_request'
  | 'invalid_action'
  | 'not_a_word'
  | 'action_limit'
  | 'game_over'
  | 'no_puzzle'
  | 'store_error'
  | 'internal';

export interface GameError {
  error: GameErrorCode;
  actionIndex?: number;
  detail?: string;
}
