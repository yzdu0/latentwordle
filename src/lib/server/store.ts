export interface Puzzle {
  answer: string;
}

export interface Vocab {
  dim: number;
  words: string[];
  index: Map<string, number>;
  bytes: Int8Array;
  hints: Uint8Array;
  stems: string[];
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

export function decodeBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
