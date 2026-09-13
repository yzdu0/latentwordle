const FEMININE_WORDS = new Set(
  'woman women female feminine girl girls lady ladies mother mothers mom moms mommy mama sister sisters wife wives daughter daughters aunt aunts grandmother grandma queen princess girlfriend bride'.split(' '),
);

const MASCULINE_WORDS = new Set(
  'man men male masculine boy boys gentleman gentlemen father fathers dad dads daddy brother brothers husband husbands son sons uncle uncles grandfather grandpa king prince boyfriend groom dude sir'.split(' '),
);

/** Prevent a known embedding association failure from being presented as an answer-aligned hint. */
export function contradictsAnswerPolarity(answer: string, candidate: string): boolean {
  return (
    (FEMININE_WORDS.has(answer) && MASCULINE_WORDS.has(candidate)) ||
    (MASCULINE_WORDS.has(answer) && FEMININE_WORDS.has(candidate))
  );
}
