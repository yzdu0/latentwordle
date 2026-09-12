export interface Puzzle {
  answer: string;
}

export interface Vocab {
  dim: number;
  words: string[];
  index: Map<string, number>;
  bytes: Int8Array;
}

export interface Store {
  getPuzzle(dayIndex: number): Promise<Puzzle | null>;
  getPuzzles(): Promise<Puzzle[]>;
  getVocab(): Promise<Vocab>;
  getMeta(name: string): Promise<string | null>;
}

export function parsePuzzle(row: { answer: string }): Puzzle {
  return { answer: row.answer };
}
