import { describe, expect, it } from 'vitest';
import { stem } from './morphology.ts';

describe('stem', () => {
  it('groups inflected and derived forms', () => {
    expect(stem('employed')).toBe(stem('employment'));
    expect(stem('running')).toBe(stem('run'));
    expect(stem('happiness')).toBe(stem('happy'));
    expect(stem('action')).toBe(stem('act'));
    expect(stem('courageous')).toBe(stem('courage'));
    expect(stem('volcanoes')).toBe(stem('volcano'));
  });

  it('keeps unrelated words apart', () => {
    expect(stem('shark')).not.toBe(stem('whale'));
    expect(stem('cat')).not.toBe(stem('cattle'));
    expect(stem('music')).not.toBe(stem('musician'));
  });
});
