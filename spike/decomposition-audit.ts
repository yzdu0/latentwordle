import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { stem } from '../src/lib/game/morphology.ts';
import { contradictsAnswerPolarity } from '../src/lib/game/semantic-safety.ts';
import type { Decomposition } from '../src/lib/server/engine.ts';
import type { Vocab } from '../src/lib/server/store.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const dir = path.join(ROOT, '.cache/dev');
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as {
  model: string;
  dim: number;
  words: string[];
  puzzles: { answer: string }[];
};
const raw = fs.readFileSync(path.join(dir, 'vectors.bin'));
const hintRaw = fs.readFileSync(path.join(dir, 'hints.bin'));
const vocab: Vocab = {
  dim: index.dim,
  words: index.words,
  index: new Map(index.words.map((word, row) => [word, row])),
  bytes: new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength),
  hints: new Uint8Array(hintRaw.buffer, hintRaw.byteOffset, hintRaw.byteLength),
  stems: index.words.map(stem),
};

const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const engine = (await vite.ssrLoadModule('/src/lib/server/engine.ts')) as {
  decomposeTarget: (vocab: Vocab, answerRow: number) => Decomposition | null;
};

const requested = process.argv.find((argument) => argument.startsWith('--answers='));
const auditAll = process.argv.includes('--all');
const answers = requested
  ? requested.slice('--answers='.length).split(',').filter((answer) => vocab.index.has(answer))
  : auditAll
    ? index.puzzles.map(({ answer }) => answer)
  : Array.from({ length: Math.min(120, index.puzzles.length) }, (_, sample) =>
      index.puzzles[Math.floor((sample * index.puzzles.length) / Math.min(120, index.puzzles.length))].answer,
    );
const fits: { answer: string; result: Decomposition }[] = [];
const startedAt = performance.now();
for (const answer of answers) {
  const result = engine.decomposeTarget(vocab, vocab.index.get(answer)!);
  if (result) fits.push({ answer, result });
}

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const formula = ({ answer, result }: (typeof fits)[number]) =>
  `${answer.padEnd(13)} ≈ ${result.terms.map((term) => `${term.multiplier.toFixed(1)}×${term.word}`).join(' + ')}  fit ${(result.similarity * 100).toFixed(0)}%`;

console.log(`${index.model}: ${fits.length}/${answers.length} decompositions`);
console.log(`two terms: ${fits.filter(({ result }) => result.terms.length === 2).length}`);
console.log(`three terms: ${fits.filter(({ result }) => result.terms.length === 3).length}`);
console.log(
  `explicit polarity conflicts: ${fits.reduce(
    (total, { answer, result }) =>
      total + result.terms.filter(({ word }) => contradictsAnswerPolarity(answer, word)).length,
    0,
  )}`,
);
console.log(`median fit: ${(median(fits.map(({ result }) => result.similarity)) * 100).toFixed(1)}%`);
console.log(`minimum fit: ${(Math.min(...fits.map(({ result }) => result.similarity)) * 100).toFixed(1)}%`);
console.log(`mean search time: ${((performance.now() - startedAt) / answers.length).toFixed(1)} ms`);
console.log('\nLowest fits:');
for (const fit of [...fits].sort((left, right) => left.result.similarity - right.result.similarity).slice(0, 12)) {
  console.log(formula(fit));
}
console.log('\nSelected examples:');
for (const answer of ['mama', 'winter', 'coffee', 'shark', 'library', 'courage', 'doctor', 'mirror', 'ocean', 'dragon']) {
  const result = engine.decomposeTarget(vocab, vocab.index.get(answer)!);
  if (result) console.log(formula({ answer, result }));
}

await vite.close();
