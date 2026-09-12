import { describe, expect, it } from 'vitest';
import type { GameRef } from '$lib/game/types.ts';
import type { Anchors, PuzzleData, Store } from './store.ts';
import { calibrateCustomK, computeView } from './engine.ts';
import { quantize } from '$lib/game/scoring.ts';

class FakeStore implements Store {
  private map = new Map<string, Float32Array>();
  anchors: Anchors | null = null;

  constructor(entries: Record<string, number[]>) {
    for (const [word, vec] of Object.entries(entries)) this.map.set(word, Float32Array.from(vec));
  }

  async getVector(word: string): Promise<Float32Array | null> {
    return this.map.get(word) ?? null;
  }

  async putVector(word: string, vec: Float32Array): Promise<void> {
    this.map.set(word, vec);
  }

  async getMeta(name: string): Promise<string | null> {
    if (name === 'global_k') return '0.8';
    if (name === 'model') return 'test';
    return null;
  }

  async getPuzzle(): Promise<PuzzleData | null> {
    return null;
  }

  async getPuzzles(): Promise<PuzzleData[]> {
    return [];
  }

  async getAnchors(): Promise<Anchors | null> {
    return this.anchors;
  }
}

const concepts = ['animal', 'danger', 'water', 'speed', 'technology'];
const puzzle: PuzzleData = { answer: 'shark', concepts, ks: [0.3, 0.3, 0.3, 0.3, 0.3] };

function makeStore(): FakeStore {
  return new FakeStore({
    shark: [1, 0, 0],
    animal: [1, 0, 0],
    danger: [0, 0, 1],
    water: [0, 1, 0],
    speed: [0, 0, 1],
    technology: [0, 0, 1],
    fish: [0.8, 0.6, 0],
    car: [0, 0, 1],
    sea: [0, 1, 0],
  });
}

const game: GameRef = { kind: 'random', seed: 1 };

async function run(store: FakeStore, actions: unknown) {
  return computeView({ store, mean: null, globalK: 0.8 }, game, puzzle, actions);
}

describe('computeView', () => {
  it('rescores earlier guesses on a swapped axis', async () => {
    const result = await run(makeStore(), [
      { type: 'guess', word: 'fish' },
      { type: 'swap', slot: 0, concept: 'sea' },
      { type: 'guess', word: 'car' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.view.concepts).toEqual(['sea', 'danger', 'water', 'speed', 'technology']);
    const [first, swap, second] = result.view.history;
    expect(first.type).toBe('guess');
    if (first.type !== 'guess') return;
    expect(first.results).toHaveLength(5);
    expect(first.results[0]).toEqual({ match: 25, dir: 'over' });
    expect(swap.type).toBe('swap');
    if (swap.type === 'swap') expect(swap.from).toBe('animal');
    expect(second.type).toBe('guess');
  });

  it('keeps the answer hidden until solved', async () => {
    const result = await run(makeStore(), [{ type: 'guess', word: 'fish' }]);
    expect(result.ok && result.view.answer).toBeNull();
    expect(result.ok && result.view.solved).toBe(false);
  });

  it('reveals the answer on a correct guess', async () => {
    const result = await run(makeStore(), [
      { type: 'guess', word: 'fish' },
      { type: 'guess', word: 'shark' },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.solved).toBe(true);
    expect(result.view.answer).toBe('shark');
    const last = result.view.history.at(-1);
    if (last?.type === 'guess') {
      expect(last.results.every((r) => r.match === 100 && r.dir === 'same')).toBe(true);
    }
  });

  it('rejects guesses outside the dictionary', async () => {
    const result = await run(makeStore(), [{ type: 'guess', word: 'fish' }, { type: 'guess', word: 'tractor' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ error: 'not_a_word', actionIndex: 1 });
  });

  it('rejects unknown custom concepts when embeddings are unavailable', async () => {
    const result = await run(makeStore(), [{ type: 'guess', word: 'fish' }, { type: 'swap', slot: 1, concept: 'courage' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ error: 'unknown_concept', actionIndex: 1 });
  });

  it('marks the game revealed after the turn budget', async () => {
    const actions = Array.from({ length: 10 }, () => ({ type: 'guess', word: 'fish' }));
    const result = await run(makeStore(), actions);
    expect(result.ok && result.view.revealed).toBe(true);
    expect(result.ok && result.view.answer).toBe('shark');
  });
});

describe('calibrateCustomK', () => {
  it('derives K from the anchor distribution', () => {
    const rows = [
      new Float32Array([1, 0, 0]),
      new Float32Array([0.8, 0.6, 0]),
      new Float32Array([0.6, 0.8, 0]),
      new Float32Array([0, 1, 0]),
    ];
    const bytes = new Uint8Array(rows.length * 3);
    rows.forEach((row, i) => bytes.set(new Uint8Array(quantize(row).buffer), i * 3));
    const anchors: Anchors = { count: rows.length, dim: 3, bytes };
    const k = calibrateCustomK(anchors, new Float32Array([1, 0, 0]), 1, 0.9);
    expect(k).toBeGreaterThan(0.05);
    expect(k).toBeLessThan(0.9);
  });

  it('falls back when no anchors exist', () => {
    expect(calibrateCustomK(null, new Float32Array([1, 0, 0]), 1, 0.42)).toBe(0.42);
  });
});
