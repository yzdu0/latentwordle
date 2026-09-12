import { describe, expect, it } from 'vitest';
import {
  align,
  calibrationK,
  clampK,
  dequantize,
  l2normalize,
  meanVector,
  quantize,
  scoreAxis,
  subtractAndNormalize,
} from './scoring.ts';

describe('align / normalize', () => {
  it('dot product of orthogonal unit vectors is zero', () => {
    expect(align(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
  });

  it('l2normalize produces unit length', () => {
    const v = l2normalize(new Float32Array([3, 4]));
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });

  it('subtractAndNormalize removes the mean direction', () => {
    const mean = new Float32Array([1, 0]);
    const along = subtractAndNormalize(new Float32Array([2, 0]), mean);
    expect(Array.from(along)).toEqual([1, 0]);
    const diagonal = subtractAndNormalize(new Float32Array([2, 1]), mean);
    expect(diagonal[0]).toBeCloseTo(Math.SQRT1_2);
    expect(diagonal[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it('meanVector averages componentwise', () => {
    const m = meanVector([new Float32Array([0, 2]), new Float32Array([2, 4])]);
    expect(Array.from(m)).toEqual([1, 3]);
  });
});

describe('scoreAxis', () => {
  it('is 100 with same direction when alignments match', () => {
    expect(scoreAxis(0.4, 0.4, 0.2)).toEqual({ match: 100, dir: 'same' });
  });

  it('reports under when the guess is less aligned', () => {
    const r = scoreAxis(0.2, 0.4, 0.2);
    expect(r.dir).toBe('under');
    expect(r.match).toBe(0);
  });

  it('reports over and clamps at zero', () => {
    const r = scoreAxis(0.5, 0.4, 0.2);
    expect(r.dir).toBe('over');
    expect(r.match).toBe(50);
  });

  it('matches the calibrated scale at one K of distance', () => {
    expect(scoreAxis(0.0, 0.3, 0.3).match).toBe(0);
  });
});

describe('calibrationK', () => {
  it('returns the 90th percentile of absolute deltas', () => {
    const aligns = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => x / 10);
    expect(calibrationK(aligns, 0.5, 0.9)).toBeCloseTo(0.41, 2);
  });

  it('is clamped to the supported range', () => {
    expect(clampK(0.001)).toBe(0.05);
    expect(clampK(2)).toBe(0.5);
  });
});

describe('quantize', () => {
  it('round-trips within int8 precision', () => {
    const v = l2normalize(new Float32Array([0.3, -0.7, 0.2, 0.5]));
    const back = dequantize(new Uint8Array(quantize(v).buffer));
    for (let i = 0; i < v.length; i++) expect(back[i]).toBeCloseTo(v[i], 2);
  });

  it('handles negative bytes read as unsigned', () => {
    const signed = new Int8Array([-127, 0, 127]);
    const back = dequantize(new Uint8Array(signed.buffer));
    expect(Array.from(back)).toEqual([-1, 0, 1]);
  });
});
