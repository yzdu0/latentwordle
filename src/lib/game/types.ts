export type GameRef = { kind: 'daily'; date: string } | { kind: 'random'; seed: number };

export type Action =
  | { type: 'guess'; word: string }
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
  clue: string;
  multiplier: number | null;
  sumWord: string;
  sumSimilarity: number;
}

export interface GiveUpEntry {
  type: 'giveup';
  turn: number;
}

export type HistoryEntry = GuessEntry | GiveUpEntry;

export interface RoundSummary {
  index: number;
  answer: string;
  solved: boolean;
  givenUp: boolean;
  turnsUsed: number;
  score: number;
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
