export type Direction = 'under' | 'over' | 'same';

export interface AxisResult {
  match: number;
  dir: Direction;
}

export type Action = { type: 'guess'; word: string } | { type: 'swap'; slot: number; concept: string };

export interface GuessEntry {
  type: 'guess';
  turn: number;
  word: string;
  results: AxisResult[];
}

export interface SwapEntry {
  type: 'swap';
  turn: number;
  slot: number;
  from: string;
  concept: string;
}

export type HistoryEntry = GuessEntry | SwapEntry;

export type GameRef = { kind: 'daily'; date: string } | { kind: 'random'; seed: number };

export interface GameStart {
  game: GameRef;
  maxTurns: number;
  conceptSlots: number;
  concepts: string[];
}

export interface GameView {
  game: GameRef;
  maxTurns: number;
  turnsUsed: number;
  conceptSlots: number;
  concepts: string[];
  history: HistoryEntry[];
  solved: boolean;
  revealed: boolean;
  answer: string | null;
}

export type GameErrorCode =
  | 'bad_request'
  | 'invalid_action'
  | 'not_a_word'
  | 'unknown_concept'
  | 'duplicate_concept'
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
