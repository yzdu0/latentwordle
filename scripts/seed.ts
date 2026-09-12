import fs from 'node:fs';
import path from 'node:path';
import { EmbeddingStore } from '../spike/lib/embeddings.ts';
import type { Backend, ModelKey } from '../spike/lib/embeddings.ts';
import { contentWords } from '../spike/lib/vocab.ts';
import { EMBEDDING } from '../src/lib/game/config.ts';
import { align, calibrationK, meanVector, quantize, subtractAndNormalize } from '../src/lib/game/scoring.ts';
import { encodeVector } from '../src/lib/server/store.ts';

interface SourcePuzzle {
  answer: string;
  concepts: string[];
}

interface SeededPuzzle extends SourcePuzzle {
  ks: number[];
}

const ROOT = path.resolve(import.meta.dirname, '..');
const WORD_RE = /^[a-z]{3,15}$/;

function argValue(flag: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3) : null;
}

const backend = (argValue('backend') ?? 'local') as Backend;
const model = (argValue('model') ?? 'bge-base') as ModelKey;
if (backend !== 'workers-ai') {
  console.error('note: local vectors differ slightly from Workers AI; use --backend=workers-ai for production parity');
}

function stdev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const source: SourcePuzzle[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/puzzles.json'), 'utf8'));
for (const puzzle of source) {
  if (!WORD_RE.test(puzzle.answer)) throw new Error(`bad answer: ${puzzle.answer}`);
  if (puzzle.concepts.length !== 5) throw new Error(`expected 5 concepts for ${puzzle.answer}`);
  for (const concept of puzzle.concepts) {
    if (!WORD_RE.test(concept)) throw new Error(`bad concept: ${concept}`);
    if (concept === puzzle.answer) throw new Error(`concept equals answer: ${concept}`);
  }
}

const words = [...new Set([...contentWords(), ...source.flatMap((p) => [p.answer, ...p.concepts])])].sort();
console.error(`vocabulary: ${words.length} words`);

const store = EmbeddingStore.open(model, backend);
await store.ensure(words, (done, total) => {
  if (done === total || done % 2048 === 0) console.error(`embedded ${done}/${total}`);
});

const raw = words.map((w) => store.getOrThrow(w));
const mean = meanVector(raw);
const centered = raw.map((v) => subtractAndNormalize(v, mean));
const row = new Map(words.map((w, i) => [w, i]));

const seeded: SeededPuzzle[] = [];
const allKs: number[] = [];
const diagnostics: string[] = [];

for (const puzzle of source) {
  const answerVec = centered[row.get(puzzle.answer)!];
  const ks: number[] = [];
  const zs: number[] = [];
  for (const concept of puzzle.concepts) {
    const conceptVec = centered[row.get(concept)!];
    const aligns = centered.map((v) => align(v, conceptVec));
    const goal = align(answerVec, conceptVec);
    const m = aligns.reduce((s, x) => s + x, 0) / aligns.length;
    const sd = stdev(aligns);
    ks.push(calibrationK(aligns, goal));
    zs.push(sd > 0 ? (goal - m) / sd : 0);
  }
  allKs.push(...ks);
  const outliers = zs.filter((z) => Math.abs(z) >= 1).length;
  diagnostics.push(
    `${puzzle.answer.padEnd(13)} z=[${zs.map((z) => z.toFixed(2).padStart(5)).join(' ')}]  weak=${5 - outliers}`,
  );
  seeded.push({ ...puzzle, ks });
}

const globalK = median(allKs);
console.error(`\naxis diagnostics (z of answer vs vocab; |z|>=1 is a strong axis):`);
for (const line of diagnostics) console.error(`  ${line}`);
console.error(`global K for custom concepts: ${globalK.toFixed(3)}`);

const devDir = path.join(ROOT, '.cache/dev');
fs.mkdirSync(devDir, { recursive: true });

const anchorStride = Math.ceil(words.length / 1024);
const anchorIndexes = words.map((_, i) => i).filter((i) => i % anchorStride === 0);
const anchorBytes = Buffer.concat(anchorIndexes.map((i) => Buffer.from(quantize(centered[i]).buffer)));
fs.writeFileSync(path.join(devDir, 'anchors.bin'), anchorBytes);

fs.writeFileSync(
  path.join(devDir, 'index.json'),
  JSON.stringify({
    model: EMBEDDING.model,
    dim: EMBEDDING.dim,
    words,
    mean: Array.from(mean),
    globalK,
    anchorCount: anchorIndexes.length,
    puzzles: seeded,
  }),
);
const vectorBytes = Buffer.concat(centered.map((v) => Buffer.from(quantize(v).buffer)));
fs.writeFileSync(path.join(devDir, 'vectors.bin'), vectorBytes);
console.error(`wrote dev bundle (${anchorIndexes.length} anchors, ${words.length} vectors)`);

function hex(bytes: Int8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex').toUpperCase();
}

const lines: string[] = [
  'DELETE FROM words;',
  'DELETE FROM puzzles;',
  'DELETE FROM meta;',
  'DELETE FROM anchors;',
];

const wordRows: string[] = [];
for (const [i, word] of words.entries()) {
  wordRows.push(`('${word}',X'${hex(quantize(centered[i]))}')`);
  if (wordRows.length === 40) {
    lines.push(`INSERT INTO words (word, vec) VALUES ${wordRows.join(',')};`);
    wordRows.length = 0;
  }
}
if (wordRows.length) lines.push(`INSERT INTO words (word, vec) VALUES ${wordRows.join(',')};`);

seeded.forEach((puzzle, i) => {
  lines.push(
    `INSERT INTO puzzles (id, answer, concepts, ks) VALUES (${i + 1},'${puzzle.answer}','${JSON.stringify(
      puzzle.concepts,
    )}','${JSON.stringify(puzzle.ks.map((k) => Number(k.toFixed(4))))}');`,
  );
});

lines.push(`INSERT INTO meta (name, value) VALUES ('model','${EMBEDDING.model}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('dim','${EMBEDDING.dim}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('global_k','${globalK.toFixed(4)}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('mean','${encodeVector(mean)}');`);

const anchorChunkRows = 48;
const anchorChunkBytes = anchorChunkRows * EMBEDDING.dim;
for (let offset = 0, id = 1; offset < anchorBytes.length; offset += anchorChunkBytes, id++) {
  const chunk = anchorBytes.subarray(offset, Math.min(offset + anchorChunkBytes, anchorBytes.length));
  lines.push(
    `INSERT INTO anchors (id, vec, count, dim) VALUES (${id},X'${chunk.toString('hex').toUpperCase()}',${
      anchorIndexes.length
    },${EMBEDDING.dim});`,
  );
}

const seedPath = path.join(ROOT, '.cache/seed.sql');
fs.writeFileSync(seedPath, lines.join('\n') + '\n');
console.error(`wrote ${seedPath} (${(fs.statSync(seedPath).size / 1024 / 1024).toFixed(1)} MB)`);
