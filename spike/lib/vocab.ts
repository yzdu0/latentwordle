import fs from 'node:fs';
import path from 'node:path';

const SPIKE_DIR = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = path.join(SPIKE_DIR, 'data');

export const STOPWORDS = new Set(
  (
    'a about above after again against all am an and any are as at be because been before being below ' +
    'between both but by can could did do does doing down during each few for from further had has have ' +
    'having he her here hers herself him himself his how i if in into is it its itself just me more most ' +
    'my myself no nor not now of off on once only or other our ours ourselves out over own same she should ' +
    'so some such than that the their theirs them themselves then there these they this those through to ' +
    'too under until up very was we were what when where which while who whom why will with would you your ' +
    'yours yourself yourselves also may might must shall upon within without across among along around'
  ).split(/\s+/),
);

export function loadDictionary(): string[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, 'google-10000-english.txt'), 'utf8');
  const seen = new Set<string>();
  const words: string[] = [];
  for (const line of raw.split('\n')) {
    const w = line.trim().toLowerCase();
    if (!/^[a-z]{3,15}$/.test(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    words.push(w);
  }
  return words;
}

export function contentWords(dictionary: string[] = loadDictionary()): string[] {
  return dictionary.filter((w) => !STOPWORDS.has(w));
}

export interface PuzzleSpec {
  answer: string;
  concepts: string[];
  swap?: { from: string; to: string };
  guesses: string[];
}

export function loadPuzzles(): PuzzleSpec[] {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'sample-puzzles.json'), 'utf8')) as PuzzleSpec[];
}
