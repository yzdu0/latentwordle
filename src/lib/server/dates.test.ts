import { describe, expect, it } from 'vitest';
import { isPlayableDailyDate } from './dates.ts';

describe('isPlayableDailyDate', () => {
  const now = Date.parse('2026-09-13T12:00:00Z');

  it('allows today and the previous three UTC dates', () => {
    expect(isPlayableDailyDate('2026-09-13', now)).toBe(true);
    expect(isPlayableDailyDate('2026-09-12', now)).toBe(true);
    expect(isPlayableDailyDate('2026-09-11', now)).toBe(true);
    expect(isPlayableDailyDate('2026-09-10', now)).toBe(true);
  });

  it('rejects future, older, and malformed dates', () => {
    expect(isPlayableDailyDate('2026-09-14', now)).toBe(false);
    expect(isPlayableDailyDate('2026-09-09', now)).toBe(false);
    expect(isPlayableDailyDate('not-a-date', now)).toBe(false);
  });
});
