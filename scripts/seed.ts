import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';
import { EMBEDDING } from '../src/lib/game/config.ts';
import { l2normalize, quantize } from '../src/lib/game/scoring.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

function argValue(flag: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3) : null;
}

async function ensureGlove(archive: string): Promise<void> {
  if (fs.existsSync(archive)) return;
  console.error(`downloading ${EMBEDDING.model} (~380 MB) to ${archive}`);
  const res = await fetch(EMBEDDING.url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(archive));
}

const archive = argValue('glove') ?? path.join(ROOT, '.cache/glove-wiki-gigaword-300.gz');
await ensureGlove(archive);

const vocabulary = fs
  .readFileSync(path.join(ROOT, 'data/vocab.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const answers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/answers.json'), 'utf8')) as string[];
const vocabMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/vocab-meta.json'), 'utf8')) as {
  clean: number;
  proper: number;
  hintLimit: number;
};
const cleanLimit = Math.min(vocabMeta.hintLimit, vocabMeta.clean);
const hintWords = new Set([
  ...vocabulary.slice(0, cleanLimit),
  ...vocabulary.slice(vocabMeta.clean),
]);

const seen = new Set<string>();
const words: string[] = [];
for (const word of [...vocabulary, ...answers]) {
  if (seen.has(word)) continue;
  seen.add(word);
  words.push(word);
}
const hints = Uint8Array.from(words, (word) => (hintWords.has(word) ? 1 : 0));
console.error(
  `vocabulary: ${words.length} words (${hints.reduce((sum, flag) => sum + flag, 0)} hint-eligible)`,
);

const rowOf = new Map(words.map((word, index) => [word, index]));
const vectors = new Array<Float32Array | undefined>(words.length);
let remaining = words.length;

const rl = readline.createInterface({
  input: createReadStream(archive).pipe(createGunzip()),
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
  const index = rowOf.get(word);
  if (index === undefined || vectors[index]) continue;
  const parts = line.slice(space + 1).split(' ');
  const vector = new Float32Array(parts.length);
  for (let j = 0; j < parts.length; j++) vector[j] = Number(parts[j]);
  vectors[index] = l2normalize(vector);
  remaining -= 1;
  if (remaining === 0) break;
}

const missing = words.filter((_, index) => !vectors[index]);
if (missing.length > 0) {
  throw new Error(`missing ${EMBEDDING.model} vectors for: ${missing.join(', ')}`);
}
if (vectors.some((vector) => vector!.length !== EMBEDDING.dim)) {
  throw new Error(`unexpected vector dimension (expected ${EMBEDDING.dim})`);
}

const devDir = path.join(ROOT, '.cache/dev');
fs.mkdirSync(devDir, { recursive: true });
fs.writeFileSync(
  path.join(devDir, 'index.json'),
  JSON.stringify({
    model: EMBEDDING.model,
    dim: EMBEDDING.dim,
    words,
    puzzles: answers.map((answer) => ({ answer })),
  }),
);
const vectorBytes = Buffer.concat(vectors.map((vector) => Buffer.from(quantize(vector!).buffer)));
fs.writeFileSync(path.join(devDir, 'vectors.bin'), vectorBytes);
fs.writeFileSync(path.join(devDir, 'hints.bin'), Buffer.from(hints));
console.error(`wrote dev bundle (${(vectorBytes.length / 1024 / 1024).toFixed(1)} MB)`);

const lines: string[] = ['DELETE FROM vocab;', 'DELETE FROM puzzles;', 'DELETE FROM meta;'];

const CHUNK = 100;
for (let start = 0, id = 1; start < words.length; start += CHUNK, id++) {
  const slice = vectors.slice(start, start + CHUNK);
  const blob = Buffer.concat(slice.map((vector) => Buffer.from(quantize(vector!).buffer)));
  lines.push(`INSERT INTO vocab (id, vec) VALUES (${id},X'${blob.toString('hex').toUpperCase()}');`);
}

answers.forEach((answer, i) => {
  lines.push(`INSERT INTO puzzles (id, answer) VALUES (${i + 1},'${answer}');`);
});
lines.push(`INSERT INTO meta (name, value) VALUES ('model','${EMBEDDING.model}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('dim','${EMBEDDING.dim}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('vocab_size','${words.length}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('hint_mask','${Buffer.from(hints).toString('base64')}');`);

const wordsJson = JSON.stringify(words);
const META_CHUNK = 50_000;
for (let offset = 0, part = 0; offset < wordsJson.length; offset += META_CHUNK, part++) {
  const chunk = wordsJson.slice(offset, offset + META_CHUNK);
  lines.push(`INSERT INTO meta (name, value) VALUES ('vocab_words_${String(part).padStart(3, '0')}','${chunk}');`);
}

const seedPath = path.join(ROOT, '.cache/seed.sql');
fs.writeFileSync(seedPath, lines.join('\n') + '\n');
console.error(`wrote ${seedPath} (${(fs.statSync(seedPath).size / 1024 / 1024).toFixed(1)} MB)`);
