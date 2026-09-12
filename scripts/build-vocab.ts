import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { EMBEDDING } from '../src/lib/game/config.ts';
import { STOPWORDS } from '../spike/lib/vocab.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const MAX_VOCAB = 100_000;
const HINT_LIMIT = 15_000;
const WORD_RE = /^[a-z]{3,15}$/;
const FREQUENCY_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt';
const WORDNET_URL = 'https://wordnetcode.princeton.edu/3.0/WNdb-3.0.tar.gz';

function argValue(flag: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3) : null;
}

async function download(url: string, destination: string): Promise<void> {
  if (fs.existsSync(destination)) return;
  console.error(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destination));
}

const gloveArchive = argValue('glove') ?? path.join(CACHE, 'glove-wiki-gigaword-300.gz');
await download(EMBEDDING.url, gloveArchive);

const frequencyFile = path.join(CACHE, 'en_50k.txt');
await download(FREQUENCY_URL, frequencyFile);

const wordnetDir = path.join(CACHE, 'wordnet');
if (!fs.existsSync(path.join(wordnetDir, 'dict/index.noun'))) {
  const archive = path.join(CACHE, 'WNdb-3.0.tar.gz');
  await download(WORDNET_URL, archive);
  fs.mkdirSync(wordnetDir, { recursive: true });
  const result = spawnSync('tar', ['-xzf', archive, '-C', wordnetDir, 'dict'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('failed to extract WordNet');
}
const dictDir = path.join(wordnetDir, 'dict');

const anyLemma = new Set<string>();
const offsetLemmas = new Map<string, string[]>();
for (const pos of ['noun', 'verb', 'adj', 'adv']) {
  for (const line of fs.readFileSync(path.join(dictDir, `index.${pos}`), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const parts = line.split(' ');
    const word = parts[0].toLowerCase();
    if (word.includes('_')) continue;
    anyLemma.add(word);
    const pointerCount = Number(parts[3]);
    for (const offset of parts.slice(4 + pointerCount + 2).filter(Boolean)) {
      const key = `${pos}:${offset}`;
      const list = offsetLemmas.get(key);
      if (list) list.push(word);
      else offsetLemmas.set(key, [word]);
    }
  }
}

const instanceOffsets = new Set<string>();
for (const line of fs.readFileSync(path.join(dictDir, 'data.noun'), 'utf8').split('\n')) {
  if (!line || line.startsWith(' ')) continue;
  if (/ @i \d+/.test(line)) instanceOffsets.add(line.slice(0, 8));
}

const commonLemma = new Set<string>();
for (const [key, lemmas] of offsetLemmas) {
  const separator = key.indexOf(':');
  const pos = key.slice(0, separator);
  const offset = key.slice(separator + 1);
  if (pos === 'noun' && instanceOffsets.has(offset)) continue;
  for (const lemma of lemmas) commonLemma.add(lemma);
}
console.error(`wordnet: ${anyLemma.size} lemmas, ${commonLemma.size} with a common sense`);

function hasStem(word: string, set: Set<string>): boolean {
  const candidates = new Set<string>([word]);
  const add = (value: string) => {
    if (value.length >= 3) candidates.add(value);
  };
  if (word.endsWith('s')) add(word.slice(0, -1));
  if (word.endsWith('es')) add(word.slice(0, -2));
  if (word.endsWith('ed')) {
    add(word.slice(0, -2));
    add(word.slice(0, -2) + 'e');
    const stem = word.slice(0, -2);
    if (stem.length > 3 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
  }
  if (word.endsWith('ing')) {
    const stem = word.slice(0, -3);
    add(stem);
    add(stem + 'e');
    if (stem.length > 3 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
  }
  if (word.endsWith('er')) {
    add(word.slice(0, -2));
    const stem = word.slice(0, -2);
    if (stem.length > 3 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1));
  }
  if (word.endsWith('est')) add(word.slice(0, -3));
  if (word.endsWith('ly')) add(word.slice(0, -2));
  if (word.endsWith('ies')) add(word.slice(0, -3) + 'y');
  if (word.endsWith('ied')) add(word.slice(0, -3) + 'y');
  for (const candidate of candidates) if (set.has(candidate)) return true;
  return false;
}

const frequency = new Map<string, number>();
fs.readFileSync(frequencyFile, 'utf8')
  .split('\n')
  .filter(Boolean)
  .forEach((line, index) => {
    const space = line.indexOf(' ');
    frequency.set(line.slice(0, space), index + 1);
  });

const answers = new Set(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/answers.json'), 'utf8')) as string[],
);
const blocklist = new Set(
  fs
    .readFileSync(path.join(ROOT, 'data/blocklist.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const clean: string[] = [];
const proper: string[] = [];
const seen = new Set<string>();
const dropped: Record<string, string[]> = { rare: [], unknown: [], filtered: [] };
const missingAnswers = new Set(answers);

const rl = readline.createInterface({
  input: createReadStream(gloveArchive).pipe(createGunzip()),
  crlfDelay: Infinity,
});
let header = true;
for await (const line of rl) {
  if (header) {
    header = false;
    continue;
  }
  const space = line.indexOf(' ');
  if (space <= 0) continue;
  const word = line.slice(0, space);
  if (seen.has(word) || !WORD_RE.test(word)) continue;
  const isAnswer = answers.has(word);
  if (!isAnswer) {
    if (STOPWORDS.has(word) || blocklist.has(word)) {
      if (dropped.filtered.length < 40) dropped.filtered.push(word);
      continue;
    }
    const rank = frequency.get(word);
    if (rank === undefined || rank > 50_000) {
      if (dropped.unknown.length < 40) dropped.unknown.push(word);
      continue;
    }
    if (hasStem(word, anyLemma) && !hasStem(word, commonLemma)) {
      proper.push(word);
      seen.add(word);
      continue;
    }
    if (clean.length >= MAX_VOCAB) continue;
    if (!hasStem(word, commonLemma) && rank > 2_000) {
      if (dropped.rare.length < 40) dropped.rare.push(word);
      continue;
    }
  }
  clean.push(word);
  seen.add(word);
  missingAnswers.delete(word);
  if (clean.length >= MAX_VOCAB && missingAnswers.size === 0) break;
}

if (missingAnswers.size > 0) {
  throw new Error(`answers missing from ${EMBEDDING.model}: ${[...missingAnswers].join(', ')}`);
} 

const kept = [...clean, ...proper];
const outPath = path.join(ROOT, 'data/vocab.txt');
fs.writeFileSync(outPath, kept.join('\n') + '\n');
fs.writeFileSync(
  path.join(ROOT, 'data/vocab-meta.json'),
  JSON.stringify(
    { model: EMBEDDING.model, clean: clean.length, proper: proper.length, hintLimit: HINT_LIMIT },
    null,
    2,
  ) + '\n',
);
console.error(`\nvocabulary: ${kept.length} words (${clean.length} common, ${proper.length} proper) -> ${outPath}`);
console.error(`hint pool: first ${HINT_LIMIT} common words + ${proper.length} proper nouns`);
for (const [reason, sample] of Object.entries(dropped)) {
  console.error(`  dropped ${reason}: ${sample.slice(0, 20).join(' ')}`);
}
