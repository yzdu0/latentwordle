import type { AxisResult, Direction } from './types.ts';

export function align(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
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
  return l2normalize(out);
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function clampK(k: number): number {
  return Math.min(0.5, Math.max(0.05, k));
}

export function calibrationK(alignments: number[], goal: number, q = 0.9): number {
  const deltas = alignments.map((a) => Math.abs(a - goal)).sort((a, b) => a - b);
  return clampK(quantile(deltas, q));
}

export function scoreAxis(guessAlign: number, goalAlign: number, k: number): AxisResult {
  const delta = Math.abs(guessAlign - goalAlign);
  const match = Math.max(0, Math.min(100, Math.round(100 * (1 - delta / k))));
  const diff = guessAlign - goalAlign;
  const dir: Direction = diff > 0.005 ? 'over' : diff < -0.005 ? 'under' : 'same';
  return { match, dir };
}

export function quantize(v: Float32Array): Int8Array {
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  }
  return out;
}

export function dequantize(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const signed = bytes[i] > 127 ? bytes[i] - 256 : bytes[i];
    out[i] = signed / 127;
  }
  return out;
}
