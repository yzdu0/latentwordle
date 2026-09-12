import { dequantize, quantize } from '$lib/game/scoring.ts';
import type { Anchors, PuzzleData, Store } from './store.ts';
import { parsePuzzle } from './store.ts';

export class D1Store implements Store {
  private static anchorCache = new WeakMap<D1Database, Promise<Anchors | null>>();

  constructor(private db: D1Database) {}

  async getVector(word: string): Promise<Float32Array | null> {
    const row = await this.db.prepare('SELECT vec FROM words WHERE word = ?').bind(word).first<{ vec: ArrayBuffer }>();
    if (!row) return null;
    return dequantize(new Uint8Array(row.vec));
  }

  async putVector(word: string, vec: Float32Array): Promise<void> {
    const bytes = quantize(vec);
    await this.db
      .prepare('INSERT OR REPLACE INTO words (word, vec) VALUES (?, ?)')
      .bind(word, bytes.buffer)
      .run();
  }

  async getMeta(name: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT value FROM meta WHERE name = ?').bind(name).first<{ value: string }>();
    return row?.value ?? null;
  }

  getAnchors(): Promise<Anchors | null> {
    let promise = D1Store.anchorCache.get(this.db);
    if (!promise) {
      promise = this.db
        .prepare('SELECT vec, count, dim FROM anchors ORDER BY id')
        .all<{ vec: ArrayBuffer; count: number; dim: number }>()
        .then((result) => {
          const rows = result.results ?? [];
          if (rows.length === 0) return null;
          const { count, dim } = rows[0];
          const bytes = new Uint8Array(count * dim);
          let offset = 0;
          for (const row of rows) {
            const chunk = new Uint8Array(row.vec);
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          return { count, dim, bytes };
        });
      D1Store.anchorCache.set(this.db, promise);
    }
    return promise;
  }

  async getPuzzle(dayIndex: number): Promise<PuzzleData | null> {
    const row = await this.db
      .prepare(
        'SELECT answer, concepts, ks FROM puzzles WHERE id = (? % (SELECT COUNT(*) FROM puzzles)) + 1',
      )
      .bind(dayIndex)
      .first<{ answer: string; concepts: string; ks: string }>();
    return row ? parsePuzzle(row) : null;
  }

  async getPuzzles(): Promise<PuzzleData[]> {
    const result = await this.db
      .prepare('SELECT answer, concepts, ks FROM puzzles ORDER BY id')
      .all<{ answer: string; concepts: string; ks: string }>();
    return (result.results ?? []).map(parsePuzzle);
  }
}
