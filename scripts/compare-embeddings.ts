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

interface SelectedClue {
  row: number;
  alpha: number;
  answerSimilarity: number;
  fallback: boolean;
}

function selectClue(
  bundle: Bundle,
  guessRow: number,
  answerRow: number,
  excludedRows: ReadonlySet<number> = new Set(),
): SelectedClue | null {
  const guessSimilarity = similarity(bundle, guessRow, answerRow);
  const floor = Math.max(MIN_CLUE_SIM, guessSimilarity + MIN_CLUE_PROGRESS);
  const cap = clueSimilarityCap(guessSimilarity);
  const guessBase = guessRow * bundle.dim;
  const answerBase = answerRow * bundle.dim;
  let strict: { row: number; score: number; alpha: number; answerSimilarity: number } | null = null;
  let fallback: { row: number; score: number; alpha: number; answerSimilarity: number } | null = null;

  for (let row = 0; row < bundle.words.length; row++) {
    if (!bundle.hints[row] || row === guessRow || row === answerRow || excludedRows.has(row)) continue;
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
      fallback = { row, score: answerSimilarity, alpha, answerSimilarity };
    }
    if (answerSimilarity >= floor) {
      const projectionScore = (deltaDotRaw * deltaDotRaw) / norm2;
      if (
        !strict ||
        projectionScore > strict.score ||
        (projectionScore === strict.score && alpha > strict.alpha)
      ) {
        strict = { row, score: projectionScore, alpha, answerSimilarity };
      }
    }
  }
  if (strict) return { ...strict, fallback: false };
  if (fallback) return { ...fallback, fallback: true };
  return null;
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
  if (values.length === 0) return 0;
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

function loadSimLex(file: string): { left: string; right: string; human: number }[] {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const columns = line.split('\t');
      return { left: columns[0].toLowerCase(), right: columns[1].toLowerCase(), human: Number(columns[3]) };
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
const simLex = loadSimLex(argValue('simlex') ?? path.join(ROOT, '.cache/SimLex-999/SimLex-999.txt'));

const commonAnswers = glove.puzzles
  .map(({ answer }) => answer)
  .filter((answer) => word2vec.rows.has(answer));
const commonGuesses = glove.words.filter((word, row) => glove.hints[row] && word2vec.hints[word2vec.rows.get(word) ?? -1]);
const rng = random(0x1a7e17);
const bandDefinitions = [
  { name: 'cold (<10%)', min: -Infinity, max: 0.1 },
  { name: 'cool (10-25%)', min: 0.1, max: 0.25 },
  { name: 'warm (25-45%)', min: 0.25, max: 0.45 },
  { name: 'hot (45%+)', min: 0.45, max: Infinity },
] as const;
const samplesByBand = new Map(bandDefinitions.map((band) => [band.name, [] as { answer: string; guess: string }[]]));
for (let attempts = 0; attempts < 2_000_000; attempts++) {
  if ([...samplesByBand.values()].every((samples) => samples.length >= 100)) break;
  const answer = commonAnswers[Math.floor(rng() * commonAnswers.length)];
  const guess = commonGuesses[Math.floor(rng() * commonGuesses.length)];
  if (answer === guess) continue;
  const averageSimilarity =
    (similarity(glove, glove.rows.get(guess)!, glove.rows.get(answer)!) +
      similarity(word2vec, word2vec.rows.get(guess)!, word2vec.rows.get(answer)!)) /
    2;
  const band = bandDefinitions.find(({ min, max }) => averageSimilarity >= min && averageSimilarity < max)!;
  const samples = samplesByBand.get(band.name)!;
  if (samples.length < 100) samples.push({ answer, guess });
}
const samples = [...samplesByBand.values()].flat();

const frequencyRanks = new Map<string, number>();
fs.readFileSync(path.join(ROOT, '.cache/en_50k.txt'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .forEach((line, index) => frequencyRanks.set(line.slice(0, line.indexOf(' ')), index + 1));

const femaleTerms = new Set(
  'woman women female feminine girl girls lady ladies mother mothers mom moms mommy mama sister sisters wife wives daughter daughters aunt aunts grandmother grandma queen princess girlfriend bride'.split(' '),
);
const maleTerms = new Set(
  'man men male masculine boy boys gentleman gentlemen father fathers dad dads daddy brother brothers husband husbands son sons uncle uncles grandfather grandpa king prince boyfriend groom'.split(' '),
);
const neutralTerms = 'person people parent parents child children family families baby babies adult human relative sibling'.split(' ');

console.log('model                              vocab   WS353 rho   SimLex rho   clue coverage   improves   median gain');
for (const bundle of bundles) {
  const benchmark = wordSim.filter((pair) => bundle.rows.has(pair.left) && bundle.rows.has(pair.right));
  const human = benchmark.map((pair) => pair.human);
  const predicted = benchmark.map((pair) => similarity(bundle, bundle.rows.get(pair.left)!, bundle.rows.get(pair.right)!));
  const gains: number[] = [];
  const clueRanks: number[] = [];
  let available = 0;
  let improves = 0;
  let fallbacks = 0;
  for (const sample of samples) {
    const guessRow = bundle.rows.get(sample.guess)!;
    const answerRow = bundle.rows.get(sample.answer)!;
    const clue = selectClue(bundle, guessRow, answerRow);
    if (!clue) continue;
    available++;
    if (clue.fallback) fallbacks++;
    const gain = clue.answerSimilarity - similarity(bundle, guessRow, answerRow);
    gains.push(gain);
    clueRanks.push(frequencyRanks.get(bundle.words[clue.row]) ?? 50_001);
    if (gain > 0) improves++;
  }
  const rho = pearson(rank(human), rank(predicted));
  const similarityBenchmark = simLex.filter((pair) => bundle.rows.has(pair.left) && bundle.rows.has(pair.right));
  const simLexRho = pearson(
    rank(similarityBenchmark.map((pair) => pair.human)),
    rank(similarityBenchmark.map((pair) => similarity(bundle, bundle.rows.get(pair.left)!, bundle.rows.get(pair.right)!)),
  );
  console.log(
    `${bundle.model.padEnd(34)} ${String(bundle.words.length).padStart(5)}   ${rho.toFixed(3)}       ${simLexRho.toFixed(3)}       ` +
      `${(available / samples.length * 100).toFixed(1).padStart(5)}%       ` +
      `${(improves / Math.max(1, available) * 100).toFixed(1).padStart(5)}%      ` +
      `${(median(gains) * 100).toFixed(1).padStart(5)} pts`,
  );

  console.log('  starting band       clues   improves   median gain   median clue sim');
  for (const band of bandDefinitions) {
    const rows = samplesByBand.get(band.name)!;
    const bandGains: number[] = [];
    const clueSimilarities: number[] = [];
    const examples: string[] = [];
    for (const sample of rows) {
      const guessRow = bundle.rows.get(sample.guess)!;
      const answerRow = bundle.rows.get(sample.answer)!;
      const clue = selectClue(bundle, guessRow, answerRow);
      if (!clue) continue;
      bandGains.push(clue.answerSimilarity - similarity(bundle, guessRow, answerRow));
      clueSimilarities.push(clue.answerSimilarity);
      if (examples.length < 4) {
        examples.push(
          `${sample.answer} <- ${sample.guess} + ${bundle.words[clue.row]} ` +
            `(${(similarity(bundle, guessRow, answerRow) * 100).toFixed(0)}->${(clue.answerSimilarity * 100).toFixed(0)})`,
        );
      }
    }
    console.log(
      `  ${band.name.padEnd(18)} ${String(bandGains.length).padStart(3)}/${String(rows.length).padEnd(3)} ` +
        `${percentage(bandGains.filter((gain) => gain > 0).length, bandGains.length).padStart(9)}   ` +
        `${(median(bandGains) * 100).toFixed(1).padStart(8)} pts   ` +
        `${(median(clueSimilarities) * 100).toFixed(1).padStart(8)}%`,
    );
    console.log(`    ${examples.join('; ')}`);
  }

  const chainFinalGains: number[] = [];
  let stalledChains = 0;
  let repeatedChains = 0;
  for (const sample of samplesByBand.get('cold (<10%)')!.slice(0, 40)) {
    const answerRow = bundle.rows.get(sample.answer)!;
    let guessRow = bundle.rows.get(sample.guess)!;
    const initialSimilarity = similarity(bundle, guessRow, answerRow);
    const used = new Set<number>([guessRow]);
    let repeated = false;
    for (let step = 0; step < 5; step++) {
      const clue = selectClue(bundle, guessRow, answerRow, used);
      if (!clue) {
        stalledChains++;
        break;
      }
      if (used.has(clue.row)) repeated = true;
      used.add(clue.row);
      guessRow = clue.row;
    }
    if (repeated) repeatedChains++;
    chainFinalGains.push(similarity(bundle, guessRow, answerRow) - initialSimilarity);
  }

  const femaleAnswers = [...femaleTerms].filter((word) => bundle.puzzles.some(({ answer }) => answer === word));
  const maleAnswers = [...maleTerms].filter((word) => bundle.puzzles.some(({ answer }) => answer === word));
  const genderGuesses = [...femaleTerms, ...maleTerms, ...neutralTerms].filter((word) => bundle.rows.has(word));
  let genderCases = 0;
  let oppositeGenderClues = 0;
  const genderExamples: string[] = [];
  for (const [answers, oppositeTerms] of [
    [femaleAnswers, maleTerms],
    [maleAnswers, femaleTerms],
  ] as const) {
    for (const answer of answers) {
      for (const guess of genderGuesses) {
        if (guess === answer) continue;
        const clue = selectClue(bundle, bundle.rows.get(guess)!, bundle.rows.get(answer)!);
        if (!clue) continue;
        genderCases++;
        const clueWord = bundle.words[clue.row];
        if (!oppositeTerms.has(clueWord)) continue;
        oppositeGenderClues++;
        if (genderExamples.length < 6) genderExamples.push(`${answer} <- ${guess} + ${clueWord}`);
      }
    }
  }

  console.log(
    `  fallback clues ${percentage(fallbacks, available)}; median frequency rank ${Math.round(median(clueRanks))}; ` +
      `rank >20k ${percentage(clueRanks.filter((rank) => rank > 20_000).length, clueRanks.length)}`,
  );
  console.log(
    `  follow-clue chains: median 5-step gain ${(median(chainFinalGains) * 100).toFixed(1)} pts; ` +
      `stalled ${stalledChains}/40; repeated ${repeatedChains}/40`,
  );
  console.log(
    `  gender audit: explicit opposite-gender clues ${oppositeGenderClues}/${genderCases} ` +
      `(${percentage(oppositeGenderClues, genderCases)}); ${genderExamples.join('; ') || 'no examples'}`,
  );
}

function percentage(numerator: number, denominator: number): string {
  return `${((100 * numerator) / Math.max(1, denominator)).toFixed(1)}%`;
}
