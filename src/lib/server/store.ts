export interface PuzzleData {
  answer: string;
  concepts: string[];
  ks: number[];
}

export interface Anchors {
  count: number;
  dim: number;
  bytes: Uint8Array;
}

export interface Store {
  getVector(word: string): Promise<Float32Array | null>;
  putVector(word: string, vec: Float32Array): Promise<void>;
  getMeta(name: string): Promise<string | null>;
  getPuzzle(dayIndex: number): Promise<PuzzleData | null>;
  getPuzzles(): Promise<PuzzleData[]>;
  getAnchors(): Promise<Anchors | null>;
}

export function encodeVector(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodeVector(s: string): Float32Array {
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function parsePuzzle(row: { answer: string; concepts: string; ks: string }): PuzzleData {
  return {
    answer: row.answer,
    concepts: JSON.parse(row.concepts) as string[],
    ks: JSON.parse(row.ks) as number[],
  };
}
