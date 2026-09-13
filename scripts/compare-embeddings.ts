import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  CLUE_SIM_CEILING,
  CLUE_SIM_FLOOR,
  CLUE_SIM_MARGIN,
  MIN_CLUE_PROGRESS,
  MIN_CLUE_SIM,
} from '../src/lib/game/config.ts';
import { stem } from '../src/lib/game/morphology.ts';
import { argValue } from './lib/pretrained-embeddings.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

interface BundleIndex {
  model: string;
  dim: number;
  words: string[];
  puzzles: { answer: string }[];
}

interface Bundle extends BundleIndex {
  rows: Map<string, number>;
  vectors: Int8Array;
  hints: Uint8Array;
  stems: string[];
}

function loadBundle(dir: string): Bundle {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as BundleIndex;
  const raw = fs.readFileSync(path.join(dir, 'vectors.bin'));
  const vectors = new Int8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const hints = new Uint8Array(fs.readFileSync(path.join(dir, 'hints.bin')));
  if (vectors.length !== index.words.length * index.dim) throw new Error(`invalid vectors in ${dir}`);
  return {
    ...index,
    rows: new Map(index.words.map((word, row) => [word, row])),
    vectors,
    hints,
    stems: index.words.map(stem),
  };
}

function similarity(bundle: Bundle, left: number, right: number): number {
  let dot = 0;
  const leftBase = left * bundle.dim;
  const rightBase = right * bundle.dim;
  for (let column = 0; column < bundle.dim; column++) {
    dot += bundle.vectors[leftBase + column] * bundle.vectors[rightBase + column];
  }
  return dot / (127 * 127);
}

function related(bundle: Bundle, left: number, right: number): boolean {
  const a = bundle.words[left];
  const b = bundle.words[right];
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return (
    bundle.stems[left] === bundle.stems[right] ||
    (short.length >= 4 && long.length - short.length <= 3 && long.startsWith(short))
  );
}

function clueSimilarityCap(value: number): number {
  return Math.min(CLUE_SIM_CEILING, Math.max(CLUE_SIM_FLOOR, value + CLUE_SIM_MARGIN));
}

function selectClue(bundle: Bundle, guessRow: number, answerRow: number): number | null {
  const guessSimilarity = similarity(bundle, guessRow, answerRow);
  const floor = Math.max(MIN_CLUE_SIM, guessSimilarity + MIN_CLUE_PROGRESS);
  const cap = clueSimilarityCap(guessSimilarity);
  const guessBase = guessRow * bundle.dim;
  const answerBase = answerRow * bundle.dim;
  let strict: { row: number; score: number; alpha: number } | null = null;
  let fallback: { row: number; score: number; alpha: number } | null = null;

  for (let row = 0; row < bundle.words.length; row++) {
    if (!bundle.hints[row] || row === guessRow || row === answerRow) continue;
    if (related(bundle, row, guessRow) || related(bundle, row, answerRow)) continue;
    const base = row * bundle.dim;
    let deltaDotRaw = 0;
    let norm2 = 0;
    let answerDot = 0;
    for (let column = 0; column < bundle.dim; column++) {
      const candidate = bundle.vectors[base + column];
      deltaDotRaw +=
        ((bundle.vectors[answerBase + column] - bundle.vectors[guessBase + column]) / 127) * candidate;
      norm2 += candidate * candidate;
      answerDot += bundle.vectors[answerBase + column] * candidate;
    }
    const answerSimilarity = answerDot / (127 * 127);
    if (answerSimilarity < MIN_CLUE_SIM || answerSimilarity > cap || norm2 === 0) continue;
    const alpha = (deltaDotRaw * 127) / norm2;
    if (alpha <= 0.05) continue;

    if (!fallback || answerSimilarity > fallback.score) {
      fallback = { row, score: answerSimilarity, alpha };
    }
    if (answerSimilarity >= floor) {
      const projectionScore = (deltaDotRaw * deltaDotRaw) / norm2;
      if (
        !strict ||
        projectionScore > strict.score ||
        (projectionScore === strict.score && alpha > strict.alpha)
      ) {
        strict = { row, score: projectionScore, alpha };
      }
    }
  }
  return (strict ?? fallback)?.row ?? null;
}

function rank(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  for (let start = 0; start < sorted.length; ) {
    let end = start + 1;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end++;
    const average = (start + end - 1) / 2 + 1;
    for (let index = start; index < end; index++) ranks[sorted[index].index] = average;
    start = end;
  }
  return ranks;
}

function pearson(left: number[], right: number[]): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    covariance += a * b;
    leftVariance += a * a;
    rightVariance += b * b;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function loadWordSim(zipPath: string): { left: string; right: string; human: number }[] {
  const archive = fs.readFileSync(zipPath);
  // combined.csv is the first local-file entry in the official archive. Node's
  // zlib does not expose ZIP containers, so parse the small stored/deflated entry.
  const name = Buffer.from('combined.csv');
  const nameOffset = archive.indexOf(name);
  if (nameOffset < 30) throw new Error('combined.csv not found in WordSim-353 archive');
  const header = nameOffset - 30;
  const method = archive.readUInt16LE(header + 8);
  const compressedSize = archive.readUInt32LE(header + 18);
  const nameLength = archive.readUInt16LE(header + 26);
  const extraLength = archive.readUInt16LE(header + 28);
  const body = archive.subarray(header + 30 + nameLength + extraLength, header + 30 + nameLength + extraLength + compressedSize);
  if (method !== 0 && method !== 8) throw new Error(`unsupported ZIP compression method ${method}`);
  const csv = (method === 0 ? body : inflateRawSync(body)).toString('utf8');
  return csv
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [left, right, score] = line.split(',');
      return { left: left.toLowerCase(), right: right.toLowerCase(), human: Number(score) };
    });
}

function random(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const glove = loadBundle(argValue('glove') ?? path.join(ROOT, '.cache/dev-glove'));
const word2vec = loadBundle(argValue('word2vec') ?? path.join(ROOT, '.cache/dev-word2vec'));
const bundles = [glove, word2vec];
const wordSim = loadWordSim(argValue('wordsim') ?? path.join(ROOT, '.cache/wordsim353.zip'));

const commonAnswers = glove.puzzles
  .map(({ answer }) => answer)
  .filter((answer) => word2vec.rows.has(answer));
const commonGuesses = glove.words.filter((word, row) => glove.hints[row] && word2vec.hints[word2vec.rows.get(word) ?? -1]);
const rng = random(0x1a7e17);
const samples = Array.from({ length: 240 }, () => ({
  answer: commonAnswers[Math.floor(rng() * commonAnswers.length)],
  guess: commonGuesses[Math.floor(rng() * commonGuesses.length)],
}));

console.log('model                              vocab   WS353 rho/pairs   clue coverage   improves   median gain');
for (const bundle of bundles) {
  const benchmark = wordSim.filter((pair) => bundle.rows.has(pair.left) && bundle.rows.has(pair.right));
  const human = benchmark.map((pair) => pair.human);
  const predicted = benchmark.map((pair) => similarity(bundle, bundle.rows.get(pair.left)!, bundle.rows.get(pair.right)!));
  const gains: number[] = [];
  let available = 0;
  let improves = 0;
  for (const sample of samples) {
    const guessRow = bundle.rows.get(sample.guess)!;
    const answerRow = bundle.rows.get(sample.answer)!;
    const clueRow = selectClue(bundle, guessRow, answerRow);
    if (clueRow === null) continue;
    available++;
    const gain = similarity(bundle, clueRow, answerRow) - similarity(bundle, guessRow, answerRow);
    gains.push(gain);
    if (gain > 0) improves++;
  }
  const rho = pearson(rank(human), rank(predicted));
  console.log(
    `${bundle.model.padEnd(34)} ${String(bundle.words.length).padStart(5)}   ${rho.toFixed(3)} / ${String(benchmark.length).padStart(3)}     ` +
      `${(available / samples.length * 100).toFixed(1).padStart(5)}%       ` +
      `${(improves / Math.max(1, available) * 100).toFixed(1).padStart(5)}%      ` +
      `${(median(gains) * 100).toFixed(1).padStart(5)} pts`,
  );
}
