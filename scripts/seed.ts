import fs from 'node:fs';
import path from 'node:path';
import { EMBEDDINGS } from '../src/lib/game/config.ts';
import { l2normalize, quantize } from '../src/lib/game/scoring.ts';
import {
  argValue,
  downloadIfMissing,
  embeddingKeyFromArgs,
  readEmbeddingArchive,
} from './lib/pretrained-embeddings.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

const embeddingKey = embeddingKeyFromArgs();
const embedding = EMBEDDINGS[embeddingKey];
const answerAliases =
  embeddingKey === 'word2vec'
    ? (JSON.parse(
        fs.readFileSync(path.join(ROOT, 'data/word2vec-answer-aliases.json'), 'utf8'),
      ) as Record<string, string>)
    : {};
const legacyGlove = embeddingKey === 'glove' ? argValue('glove') : null;
const archive = argValue('archive') ?? legacyGlove ?? path.join(ROOT, '.cache', embedding.archive);
const outputDir = argValue('output') ?? path.join(ROOT, '.cache/dev');
await downloadIfMissing(embedding, archive);

const vocabulary = fs
  .readFileSync(path.join(ROOT, 'data/vocab.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const currentAnswers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/answers.json'), 'utf8')) as string[];
const difficultAnswers = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/answers-difficult.json'), 'utf8'),
) as string[];
const currentSet = new Set(currentAnswers);
const overlaps = difficultAnswers.filter((answer) => currentSet.has(answer));
if (overlaps.length) throw new Error(`difficult answers already in current pool: ${overlaps.join(', ')}`);
const answers = [...currentAnswers, ...difficultAnswers];
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
const wordByArchiveWord = new Map(words.map((word) => [answerAliases[word] ?? word, word]));
const vectors = new Array<Float32Array | undefined>(words.length);
let remaining = words.length;

for await (const { word: archiveWord, vector } of readEmbeddingArchive(embedding, archive, {
  wanted: new Set(wordByArchiveWord.keys()),
})) {
  const word = wordByArchiveWord.get(archiveWord);
  const index = word === undefined ? undefined : rowOf.get(word);
  if (index === undefined || vectors[index]) continue;
  if (!vector) continue;
  vectors[index] = l2normalize(vector);
  remaining -= 1;
  if (remaining === 0) break;
}

const missing = words.filter((_, index) => !vectors[index]);
if (missing.length > 0) {
  throw new Error(`missing ${embedding.model} vectors for: ${missing.join(', ')}`);
}
if (vectors.some((vector) => vector!.length !== embedding.dim)) {
  throw new Error(`unexpected vector dimension (expected ${embedding.dim})`);
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, 'index.json'),
  JSON.stringify({
    model: embedding.model,
    dim: embedding.dim,
    words,
    puzzles: [
      ...currentAnswers.map((answer) => ({ answer, difficulty: 'current' as const })),
      ...difficultAnswers.map((answer) => ({ answer, difficulty: 'difficult' as const })),
    ],
  }),
);
const vectorBytes = Buffer.concat(vectors.map((vector) => Buffer.from(quantize(vector!).buffer)));
fs.writeFileSync(path.join(outputDir, 'vectors.bin'), vectorBytes);
fs.writeFileSync(path.join(outputDir, 'hints.bin'), Buffer.from(hints));
console.error(`wrote ${outputDir} (${(vectorBytes.length / 1024 / 1024).toFixed(1)} MB)`);

const lines: string[] = ['DELETE FROM vocab;', 'DELETE FROM puzzles;', 'DELETE FROM meta;'];

const CHUNK = 100;
for (let start = 0, id = 1; start < words.length; start += CHUNK, id++) {
  const slice = vectors.slice(start, start + CHUNK);
  const blob = Buffer.concat(slice.map((vector) => Buffer.from(quantize(vector!).buffer)));
  lines.push(`INSERT INTO vocab (id, vec) VALUES (${id},X'${blob.toString('hex').toUpperCase()}');`);
}

answers.forEach((answer, i) => {
  const difficulty = i < currentAnswers.length ? 'current' : 'difficult';
  lines.push(`INSERT INTO puzzles (id, answer, difficulty) VALUES (${i + 1},'${answer}','${difficulty}');`);
});
lines.push(`INSERT INTO meta (name, value) VALUES ('model','${embedding.model}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('dim','${embedding.dim}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('vocab_size','${words.length}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('current_answer_count','${currentAnswers.length}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('difficult_answer_count','${difficultAnswers.length}');`);
lines.push(`INSERT INTO meta (name, value) VALUES ('hint_mask','${Buffer.from(hints).toString('base64')}');`);

const wordsJson = JSON.stringify(words);
const META_CHUNK = 50_000;
for (let offset = 0, part = 0; offset < wordsJson.length; offset += META_CHUNK, part++) {
  const chunk = wordsJson.slice(offset, offset + META_CHUNK);
  lines.push(`INSERT INTO meta (name, value) VALUES ('vocab_words_${String(part).padStart(3, '0')}','${chunk}');`);
}

const seedPath = argValue('sql') ?? path.join(ROOT, '.cache/seed.sql');
fs.writeFileSync(seedPath, lines.join('\n') + '\n');
console.error(`wrote ${seedPath} (${(fs.statSync(seedPath).size / 1024 / 1024).toFixed(1)} MB)`);
