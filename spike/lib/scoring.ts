import { normalize } from './embeddings.ts';

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function align(a: Float32Array, b: Float32Array): number {
  return dot(a, b);
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(xs: number[]): number {
  return quantile([...xs].sort((a, b) => a - b), 0.5);
}

export function meanVector(vectors: Float32Array[]): Float32Array {
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

export function subtractAndNormalize(v: Float32Array, mean: Float32Array): Float32Array {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - mean[i];
  return normalize(out);
}

export function calibrationK(alignments: number[], goal: number, q = 0.9): number {
  const deltas = alignments.map((a) => Math.abs(a - goal)).sort((a, b) => a - b);
  return quantile(deltas, q);
}

export interface AxisResponse {
  match: number;
  delta: number;
  dir: -1 | 0 | 1;
  guessAlign: number;
  goalAlign: number;
}

export function scoreGuess(
  guessAlign: number,
  goalAlign: number,
  K: number,
): AxisResponse {
  const delta = Math.abs(guessAlign - goalAlign);
  const match = Math.max(0, Math.min(100, Math.round(100 * (1 - delta / K))));
  const diff = guessAlign - goalAlign;
  const dir: -1 | 0 | 1 = diff > 0.005 ? 1 : diff < -0.005 ? -1 : 0;
  return { match, delta, dir, guessAlign, goalAlign };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sample<T>(items: T[], count: number, rng: () => number): T[] {
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(items[Math.floor(rng() * items.length)]);
  return out;
}
