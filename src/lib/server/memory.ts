import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dequantize } from '$lib/game/scoring.ts';
import type { Anchors, PuzzleData, Store } from './store.ts';
import { encodeVector } from './store.ts';

export interface DevBundle {
  model: string;
  dim: number;
  words: string[];
  mean: number[];
  globalK: number;
  anchorCount: number;
  puzzles: PuzzleData[];
}

export class MemoryStore implements Store {
  private index: Map<string, number>;
  private vectors: Uint8Array;
  private anchorBytes: Uint8Array | null;
  private extras = new Map<string, Float32Array>();
  private bundle: DevBundle;
  private static cached: MemoryStore | null = null;

  constructor(bundle: DevBundle, vectors: Uint8Array, anchorBytes: Uint8Array | null = null) {
    this.bundle = bundle;
    this.vectors = vectors;
    this.anchorBytes = anchorBytes;
    this.index = new Map(bundle.words.map((w, i) => [w, i]));
  }

  static fromDir(dir = '.cache/dev'): MemoryStore {
    if (MemoryStore.cached) return MemoryStore.cached;
    const indexPath = path.join(dir, 'index.json');
    const vectorsPath = path.join(dir, 'vectors.bin');
    const anchorsPath = path.join(dir, 'anchors.bin');
    try {
      const bundle = JSON.parse(readFileSync(indexPath, 'utf8')) as DevBundle;
      const vectors = new Uint8Array(readFileSync(vectorsPath));
      const anchorBytes = bundle.anchorCount ? new Uint8Array(readFileSync(anchorsPath)) : null;
      MemoryStore.cached = new MemoryStore(bundle, vectors, anchorBytes);
      return MemoryStore.cached;
    } catch {
      throw new Error(`dev store not found in ${dir}; run: npm run seed`);
    }
  }

  async getVector(word: string): Promise<Float32Array | null> {
    const extra = this.extras.get(word);
    if (extra) return extra;
    const i = this.index.get(word);
    if (i === undefined) return null;
    const dim = this.bundle.dim;
    return dequantize(this.vectors.subarray(i * dim, (i + 1) * dim));
  }

  async putVector(word: string, vec: Float32Array): Promise<void> {
    this.extras.set(word, vec);
  }

  async getMeta(name: string): Promise<string | null> {
    if (name === 'model') return this.bundle.model;
    if (name === 'global_k') return String(this.bundle.globalK);
    if (name === 'mean') return encodeVector(Float32Array.from(this.bundle.mean));
    return null;
  }

  async getAnchors(): Promise<Anchors | null> {
    if (!this.anchorBytes || !this.bundle.anchorCount) return null;
    return { count: this.bundle.anchorCount, dim: this.bundle.dim, bytes: this.anchorBytes };
  }

  async getPuzzle(dayIndex: number): Promise<PuzzleData | null> {
    const { puzzles } = this.bundle;
    if (puzzles.length === 0) return null;
    return puzzles[((dayIndex % puzzles.length) + puzzles.length) % puzzles.length];
  }

  async getPuzzles(): Promise<PuzzleData[]> {
    return this.bundle.puzzles;
  }
}
