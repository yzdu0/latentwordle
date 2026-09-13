import { describe, expect, it } from 'vitest';
import { contradictsAnswerPolarity } from './semantic-safety.ts';

describe('contradictsAnswerPolarity', () => {
  it('rejects explicit opposite-gender evidence for gendered answers', () => {
    expect(contradictsAnswerPolarity('mama', 'daddy')).toBe(true);
    expect(contradictsAnswerPolarity('king', 'woman')).toBe(true);
  });

  it('allows matching and gender-neutral evidence', () => {
    expect(contradictsAnswerPolarity('mama', 'mother')).toBe(false);
    expect(contradictsAnswerPolarity('mama', 'parent')).toBe(false);
    expect(contradictsAnswerPolarity('parent', 'father')).toBe(false);
  });
});
