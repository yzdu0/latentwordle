import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Puzzle, Store, Vocab } from './store.ts';

export interface DevBundle {
  model: string;
  dim: number;
  words: string[];
  puzzles: Puzzle[];
}

export class MemoryStore implements Store {
  private bundle: DevBundle;
  private bytes: Int8Array;
  private vocab: Vocab;
  private static cached: MemoryStore | null = null;

  constructor(bundle: DevBundle, bytes: Int8Array) {
    this.bundle = bundle;
    this.bytes = bytes;
    this.vocab = {
      dim: bundle.dim,
      words: bundle.words,
      index: new Map(bundle.words.map((w, i) => [w, i])),
      bytes,
    };
  }

  static fromDir(dir = '.cache/dev'): MemoryStore {
    if (MemoryStore.cached) return MemoryStore.cached;
    const indexPath = path.join(dir, 'index.json');
    const vectorsPath = path.join(dir, 'vectors.bin');
    try {
      const bundle = JSON.parse(readFileSync(indexPath, 'utf8')) as DevBundle;
      const buf = readFileSync(vectorsPath);
      const bytes = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      MemoryStore.cached = new MemoryStore(bundle, bytes);
      return MemoryStore.cached;
    } catch {
      throw new Error(`dev store not found in ${dir}; run: npm run seed`);
    }
  }

  async getPuzzle(dayIndex: number): Promise<Puzzle | null> {
    const { puzzles } = this.bundle;
    if (puzzles.length === 0) return null;
    return puzzles[((dayIndex % puzzles.length) + puzzles.length) % puzzles.length];
  }

  async getPuzzles(): Promise<Puzzle[]> {
    return this.bundle.puzzles;
  }

  async getVocab(): Promise<Vocab> {
    return this.vocab;
  }

  async getMeta(name: string): Promise<string | null> {
    if (name === 'model') return this.bundle.model;
    if (name === 'dim') return String(this.bundle.dim);
    if (name === 'vocab_words') return JSON.stringify(this.bundle.words);
    return null;
  }
}
