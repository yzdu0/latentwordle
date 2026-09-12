import type { Puzzle, Store, Vocab } from './store.ts';
import { decodeBytes, parsePuzzle } from './store.ts';

type BlobValue = ArrayBuffer | Uint8Array | number[];

function toInt8(value: BlobValue): Int8Array {
  if (value instanceof Uint8Array) return new Int8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Int8Array.from(value);
  return new Int8Array(value);
}

export class D1Store implements Store {
  private static vocabCache = new WeakMap<D1Database, Promise<Vocab>>();
  private static puzzleCache = new WeakMap<D1Database, Promise<Puzzle[]>>();

  constructor(private db: D1Database) {}

  async getPuzzle(dayIndex: number): Promise<Puzzle | null> {
    const row = await this.db
      .prepare('SELECT answer FROM puzzles WHERE id = (? % (SELECT COUNT(*) FROM puzzles)) + 1')
      .bind(dayIndex)
      .first<{ answer: string }>();
    return row ? parsePuzzle(row) : null;
  }

  getPuzzles(): Promise<Puzzle[]> {
    let promise = D1Store.puzzleCache.get(this.db);
    if (!promise) {
      promise = this.db
        .prepare('SELECT answer FROM puzzles ORDER BY id')
        .all<{ answer: string }>()
        .then((result) => (result.results ?? []).map(parsePuzzle));
      D1Store.puzzleCache.set(this.db, promise);
    }
    return promise;
  }

  getVocab(): Promise<Vocab> {
    let promise = D1Store.vocabCache.get(this.db);
    if (!promise) {
      promise = (async () => {
        const [wordsResult, dimValue, hintMask, chunkResult] = await Promise.all([
          this.db
            .prepare("SELECT value FROM meta WHERE name LIKE 'vocab_words_%' ORDER BY name")
            .all<{ value: string }>(),
          this.getMeta('dim'),
          this.getMeta('hint_mask'),
          this.db.prepare('SELECT vec FROM vocab ORDER BY id').all<{ vec: ArrayBuffer }>(),
        ]);
        const wordsJson = (wordsResult.results ?? []).map((row) => row.value).join('');
        if (!wordsJson || !dimValue) throw new Error('vocabulary meta missing; run the seed');
        const words = JSON.parse(wordsJson) as string[];
        const dim = Number(dimValue);
        const chunks = chunkResult.results ?? [];
        const chunkArrays = chunks.map((row) => toInt8(row.vec as BlobValue));
        const total = chunkArrays.reduce((sum, chunk) => sum + chunk.length, 0);
        const bytes = new Int8Array(total);
        let offset = 0;
        for (const chunk of chunkArrays) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        const hints = hintMask ? decodeBytes(hintMask) : new Uint8Array(words.length).fill(1);
        return { dim, words, index: new Map(words.map((w, i) => [w, i])), bytes, hints };
      })();
      D1Store.vocabCache.set(this.db, promise);
    }
    return promise;
  }

  async getMeta(name: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT value FROM meta WHERE name = ?').bind(name).first<{ value: string }>();
    return row?.value ?? null;
  }
}
