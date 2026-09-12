import { describe, expect, it } from 'vitest';
import { l2normalize, dequantize, quantize } from './scoring.ts';

describe('l2normalize', () => {
  it('produces a unit vector', () => {
    const v = l2normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
  });
});

describe('quantize / dequantize', () => {
  it('round-trips within int8 precision', () => {
    const v = l2normalize([0.3, -0.7, 0.2, 0.5]);
    const back = dequantize(new Uint8Array(quantize(v).buffer));
    for (let i = 0; i < v.length; i++) expect(back[i]).toBeCloseTo(v[i], 2);
  });

  it('handles negative bytes read as signed or unsigned', () => {
    const signed = new Int8Array([-127, 0, 127]);
    expect(Array.from(dequantize(new Uint8Array(signed.buffer)))).toEqual([-1, 0, 1]);
    const unsigned = new Uint8Array([129, 0, 127]);
    expect(Array.from(dequantize(unsigned))).toEqual([-1, 0, 1]);
  });
});
