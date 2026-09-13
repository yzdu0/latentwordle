import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { stem } from '../src/lib/game/morphology.ts';
import type { Clue } from '../src/lib/server/engine.ts';
import type { Vocab } from '../src/lib/server/store.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

interface BundleIndex {
  model: string;
  dim: number;
  words: string[];
  puzzles: { answer: string }[];
}

interface LoadedBundle {
  model: string;
  puzzles: string[];
  vocab: Vocab;
}

function loadBundle(dir: string): LoadedBundle {
  const bundle = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as BundleIndex;
  const raw = fs.readFileSync(path.join(dir, 'vectors.bin'));
  const hintRaw = fs.readFileSync(path.join(dir, 'hints.bin'));
  return {
    model: bundle.model,
    puzzles: bundle.puzzles.map(({ answer }) => answer),
    vocab: {
      dim: bundle.dim,
      words: bundle.words,
      index: new Map(bundle.words.map((word, row) => [word, row])),
      bytes: new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      hints: new Uint8Array(hintRaw.buffer, hintRaw.byteOffset, hintRaw.byteLength),
      stems: bundle.words.map(stem),
    },
  };
}

function similarity(vocab: Vocab, left: string, right: string): number | null {
  const leftRow = vocab.index.get(left);
  const rightRow = vocab.index.get(right);
  if (leftRow === undefined || rightRow === undefined) return null;
  let dot = 0;
  const leftBase = leftRow * vocab.dim;
  const rightBase = rightRow * vocab.dim;
  for (let column = 0; column < vocab.dim; column++) {
    dot += vocab.bytes[leftBase + column] * vocab.bytes[rightBase + column];
  }
  return dot / (127 * 127);
}

const female = new Set(
  'woman women female feminine girl girls lady ladies mother mothers mom moms mommy mama sister sisters wife wives daughter daughters aunt aunts grandmother grandma queen princess girlfriend bride'.split(' '),
);
const male = new Set(
  'man men male masculine boy boys gentleman gentlemen father fathers dad dads daddy brother brothers husband husbands son sons uncle uncles grandfather grandpa king prince boyfriend groom'.split(' '),
);
const neutral = 'person people parent parents child children family families baby babies adult human relative sibling'.split(' ');

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const engine = (await vite.ssrLoadModule('/src/lib/server/engine.ts')) as {
  nearestToDifference: (vocab: Vocab, guessRow: number, answerRow: number) => Clue;
};

const bundles = [loadBundle(path.join(ROOT, '.cache/dev-glove')), loadBundle(path.join(ROOT, '.cache/dev'))];
const mamaGuesses = [
  'woman', 'female', 'girl', 'sister', 'wife', 'daughter', 'mother', 'mom', 'lady',
  'man', 'male', 'boy', 'brother', 'husband', 'son', 'father', 'dad',
  ...neutral,
];

for (const bundle of bundles) {
  const { vocab } = bundle;
  console.log(`\n=== ${bundle.model} ===`);
  console.log('\nSimilarity to mama:');
  console.log(
    ['mother', 'mom', 'woman', 'female', 'father', 'dad', 'man', 'male', 'parent', 'family', 'baby']
      .map((word) => `${word}:${((similarity(vocab, 'mama', word) ?? 0) * 100).toFixed(0)}`)
      .join('  '),
  );

  console.log('\nAnswer mama:');
  for (const guess of mamaGuesses) {
    const guessRow = vocab.index.get(guess);
    const answerRow = vocab.index.get('mama');
    if (guessRow === undefined || answerRow === undefined) continue;
    const clue = engine.nearestToDifference(vocab, guessRow, answerRow);
    const terms = [clue.word, clue.secondWord].filter(Boolean).join(' + ');
    const wrong = [clue.word, clue.secondWord].some((word) => word !== null && male.has(word));
    console.log(
      `${guess.padEnd(12)} ${(clue.similarity * 100).toFixed(0).padStart(4)} -> ${terms.padEnd(25)} ` +
        `${(clue.clueSimilarity * 100).toFixed(0).padStart(4)}${wrong ? '  OPPOSITE-GENDER TERM' : ''}`,
    );
  }

}

await vite.close();
