const VOWELS = 'aeiou';

function isConsonant(word: string, i: number): boolean {
  const ch = word[i];
  if (VOWELS.includes(ch)) return false;
  if (ch === 'y') return i === 0 ? true : !isConsonant(word, i - 1);
  return true;
}

function measure(word: string): number {
  let m = 0;
  let i = 0;
  const n = word.length;
  while (i < n && isConsonant(word, i)) i++;
  while (i < n) {
    while (i < n && !isConsonant(word, i)) i++;
    if (i >= n) break;
    m++;
    while (i < n && isConsonant(word, i)) i++;
  }
  return m;
}

function containsVowel(word: string): boolean {
  for (let i = 0; i < word.length; i++) if (!isConsonant(word, i)) return true;
  return false;
}

function endsDoubleConsonant(word: string): boolean {
  const n = word.length;
  return n >= 2 && word[n - 1] === word[n - 2] && isConsonant(word, n - 1);
}

function endsCvc(word: string): boolean {
  const n = word.length;
  return (
    n >= 3 &&
    isConsonant(word, n - 1) &&
    !isConsonant(word, n - 2) &&
    isConsonant(word, n - 3) &&
    !'wxy'.includes(word[n - 1])
  );
}

function r1Index(word: string): number {
  const n = word.length;
  let i = 0;
  while (i < n && isConsonant(word, i)) i++;
  while (i < n && !isConsonant(word, i)) i++;
  return i;
}

function postStep1b(word: string): string {
  if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) return word + 'e';
  if (endsDoubleConsonant(word) && !'lsz'.includes(word[word.length - 1])) return word.slice(0, -1);
  if (measure(word) === 1 && endsCvc(word)) return word + 'e';
  return word;
}

const STEP2: [string, string][] = [
  ['ational', 'ate'],
  ['tional', 'tion'],
  ['enci', 'ence'],
  ['anci', 'ance'],
  ['izer', 'ize'],
  ['bli', 'ble'],
  ['alli', 'al'],
  ['entli', 'ent'],
  ['eli', 'e'],
  ['ousli', 'ous'],
  ['ization', 'ize'],
  ['ation', 'ate'],
  ['ator', 'ate'],
  ['alism', 'al'],
  ['iveness', 'ive'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['aliti', 'al'],
  ['iviti', 'ive'],
  ['biliti', 'ble'],
  ['logi', 'log'],
];

const STEP3: [string, string][] = [
  ['icate', 'ic'],
  ['ative', ''],
  ['alize', 'al'],
  ['iciti', 'ic'],
  ['ical', 'ic'],
  ['ful', ''],
  ['ness', ''],
];

const STEP4 = [
  'al',
  'ance',
  'ence',
  'er',
  'ic',
  'able',
  'ible',
  'ant',
  'ement',
  'ment',
  'ent',
  'ion',
  'ou',
  'ism',
  'ate',
  'iti',
  'ous',
  'ive',
  'ize',
];

function replaceIfInR1(word: string, suffix: string, replacement: string): string {
  if (!word.endsWith(suffix)) return word;
  const baseLength = word.length - suffix.length;
  if (r1Index(word) <= baseLength) return word.slice(0, baseLength) + replacement;
  return word;
}

export function stem(input: string): string {
  let word = input;
  if (word.length < 3) return word;

  if (word.endsWith('sses')) word = word.slice(0, -2);
  else if (word.endsWith('ies')) word = word.slice(0, -2);
  else if (!word.endsWith('ss') && word.endsWith('s')) word = word.slice(0, -1);

  if (word.endsWith('eed')) {
    const base = word.slice(0, -3);
    if (measure(base) > 0) word = base + 'ee';
  } else if (word.endsWith('ed') && containsVowel(word.slice(0, -2))) {
    word = postStep1b(word.slice(0, -2));
  } else if (word.endsWith('ing') && containsVowel(word.slice(0, -3))) {
    word = postStep1b(word.slice(0, -3));
  }

  if (word.endsWith('y') && word.length > 2 && isConsonant(word, word.length - 2) && word.length - 2 > 0) {
    word = word.slice(0, -1) + 'i';
  }

  for (const [suffix, replacement] of [...STEP2, ...STEP3]) {
    if (word.endsWith(suffix)) {
      word = replaceIfInR1(word, suffix, replacement);
      break;
    }
  }

  for (const suffix of STEP4) {
    if (!word.endsWith(suffix)) continue;
    if (suffix === 'ion') {
      const base = word.slice(0, -3);
      if ((base.endsWith('s') || base.endsWith('t')) && r1Index(word) <= base.length) word = base;
    } else {
      word = replaceIfInR1(word, suffix, '');
    }
    break;
  }

  if (word.endsWith('e')) {
    const base = word.slice(0, -1);
    const m = measure(base);
    if (m > 1 || (m === 1 && !endsCvc(base))) word = base;
  }

  if (word.endsWith('ll') && measure(word) > 1) word = word.slice(0, -1);

  return word;
}
