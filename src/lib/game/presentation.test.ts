import { describe, expect, it } from 'vitest';
import { matchTone, meterPosition } from './presentation.ts';

describe('matchTone', () => {
  it('uses the 85 and 60 thresholds', () => {
    expect(matchTone(100)).toBe('good');
    expect(matchTone(85)).toBe('good');
    expect(matchTone(84)).toBe('mid');
    expect(matchTone(60)).toBe('mid');
    expect(matchTone(59)).toBe('bad');
  });
});

describe('meterPosition', () => {
  it('puts a perfect match on the tick', () => {
    expect(meterPosition(100, 'same')).toBe(50);
    expect(meterPosition(100, 'over')).toBe(50);
  });

  it('moves the dot away from the tick as match drops', () => {
    expect(meterPosition(80, 'over')).toBe(60);
    expect(meterPosition(80, 'under')).toBe(40);
    expect(meterPosition(0, 'under')).toBe(0);
    expect(meterPosition(0, 'over')).toBe(100);
  });

  it('clamps out-of-range values', () => {
    expect(meterPosition(140, 'under')).toBe(50);
    expect(meterPosition(-20, 'over')).toBe(100);
  });
});
