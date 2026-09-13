import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { STOPWORDS } from '../spike/lib/vocab.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const MIN_CONCRETENESS = 3.0;
const MAX_RANK = 5_000;
const MAX_ANSWERS = 4_000;
const CONCRETENESS_URL =
  'https://raw.githubusercontent.com/desmond-ong/colorMeText/master/lexicons/Concreteness_ratings_Brysbaert_et_al_BRM_parsed.csv';

const DAYS = new Set(
  'monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december'.split(
    ' ',
  ),
);
const GRAMMAR = new Set(
  (
    'one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty sixty ' +
    'seventy eighty ninety hundred thousand million billion trillion first second third fourth fifth ' +
    'sixth seventh eighth ninth tenth last next many much few several least most more less own same ' +
    'another other others each every either neither both all any some such thing things something ' +
    'anything nothing everything someone anyone everyone nobody somebody anybody get say year'
  ).split(/\s+/),
);
const IRREGULAR_PLURALS = new Set(
  'people children women men teeth feet mice geese oxen lives leaves knives wives wolves shelves halves loaves thieves'.split(' '),
);
const PROPER_ADJECTIVES = new Set(
  (
    'american british english french german spanish italian chinese japanese russian indian african ' +
    'european asian australian canadian mexican irish scottish welsh dutch greek roman latin jewish ' +
    'christian muslim islamic catholic protestant arab israeli iraqi iranian korean vietnamese thai ' +
    'polish swedish norwegian danish finnish turkish egyptian brazilian cuban christian christmas ' +
    'easter thanksgiving halloween'
  ).split(/\s+/),
);
const NON_PLURAL_S = new Set('species series news business class glass grass dress address process access success stress press boss loss cross gross pass mass gas bus plus status virus campus focus circus bonus census tennis atlas canvas lens chaos physics'.split(' '));

async function download(url: string, destination: string): Promise<void> {
  if (fs.existsSync(destination)) return;
  console.error(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destination));
}

const concretenessFile = path.join(CACHE, 'concreteness.csv');
await download(CONCRETENESS_URL, concretenessFile);
const concreteness = new Map<string, number>();
for (const record of fs.readFileSync(concretenessFile, 'utf8').split(/\r\n|\r|\n/)) {
  if (!record) continue;
  const comma = record.lastIndexOf(',');
  concreteness.set(record.slice(0, comma), Number(record.slice(comma + 1)));
}

const dictDir = path.join(CACHE, 'wordnet/dict');
if (!fs.existsSync(path.join(dictDir, 'index.noun'))) {
  throw new Error('WordNet not found; run: npm run build:vocab');
}

function indexLemmas(file: string): Set<string> {
  const set = new Set<string>();
  for (const line of fs.readFileSync(path.join(dictDir, file), 'utf8').split('\n')) {
    if (!line || line.startsWith(' ')) continue;
    const word = line.slice(0, line.indexOf(' ')).toLowerCase();
    if (!word.includes('_')) set.add(word);
  }
  return set;
}
const verbs = indexLemmas('index.verb');
const adjectives = indexLemmas('index.adj');
const adverbs = indexLemmas('index.adv');

const instanceOffsets = new Set<string>();
for (const line of fs.readFileSync(path.join(dictDir, 'data.noun'), 'utf8').split('\n')) {
  if (line && !line.startsWith(' ') && / @i \d+/.test(line)) instanceOffsets.add(line.slice(0, 8));
}
const nouns = new Set<string>();
const properFirstSense = new Set<string>();
for (const line of fs.readFileSync(path.join(dictDir, 'index.noun'), 'utf8').split('\n')) {
  if (!line || line.startsWith(' ')) continue;
  const parts = line.split(' ');
  const word = parts[0];
  if (word.includes('_')) continue;
  nouns.add(word);
  const pointerCount = Number(parts[3]);
  const offsets = parts.slice(4 + pointerCount + 2).filter(Boolean);
  if (offsets[0] && instanceOffsets.has(offsets[0])) properFirstSense.add(word);
}

function verbStems(word: string): string[] {
  if (!word.endsWith('ing')) return [];
  const stem = word.slice(0, -3);
  const out = [stem, stem + 'e'];
  if (stem.length > 3 && stem.at(-1) === stem.at(-2)) out.push(stem.slice(0, -1));
  return out;
}
function singularForms(word: string): string[] {
  if (word.endsWith('ies')) return [word.slice(0, -3) + 'y'];
  if (word.endsWith('ves')) return [word.slice(0, -3) + 'f', word.slice(0, -3) + 'fe'];
  if (word.endsWith('es')) return [word.slice(0, -2)];
  if (word.endsWith('s')) return [word.slice(0, -1)];
  return [];
}

const ranks = new Map<string, number>();
fs.readFileSync(path.join(CACHE, 'en_50k.txt'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .forEach((line, index) => {
    const space = line.indexOf(' ');
    ranks.set(line.slice(0, space), index + 1);
  });

const vocab = fs
  .readFileSync(path.join(ROOT, 'data/vocab.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);
const inVocab = new Set(vocab);
const curated = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/answers-curated.json'), 'utf8')) as string[];
const difficult = new Set(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/answers-difficult.json'), 'utf8')) as string[],
);
const blocklist = new Set(
  fs
    .readFileSync(path.join(ROOT, 'data/blocklist.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const selected: string[] = [];
for (const word of vocab) {
  const rank = ranks.get(word);
  if (rank === undefined || rank > MAX_RANK) continue;
  if (!/^[a-z]{3,12}$/.test(word)) continue;
  if (DAYS.has(word) || GRAMMAR.has(word) || IRREGULAR_PLURALS.has(word)) continue;
  if (PROPER_ADJECTIVES.has(word)) continue;
  if (STOPWORDS.has(word) || blocklist.has(word)) continue;
  if (!nouns.has(word) || properFirstSense.has(word)) continue;
  // Without a reliable dominant-part-of-speech corpus, prefer unambiguous nouns.
  // Polysemous words remain valid guesses, but make inconsistent hidden answers.
  if (verbs.has(word) || adjectives.has(word) || adverbs.has(word)) continue;
  const rating = concreteness.get(word);
  if (rating === undefined || rating < MIN_CONCRETENESS) continue;
  if (word.endsWith('ing') && verbStems(word).some((stem) => verbs.has(stem))) {
    continue;
  }
  if (word.endsWith('s') && !NON_PLURAL_S.has(word) && singularForms(word).some((form) => inVocab.has(form))) {
    continue;
  }
  selected.push(word);
}

const curatedSet = new Set(curated);
const answers = [
  ...curated,
  ...selected.filter((word) => !curatedSet.has(word) && !difficult.has(word)),
].slice(0, MAX_ANSWERS);
fs.writeFileSync(path.join(ROOT, 'data/answers.json'), JSON.stringify(answers, null, 2) + '\n');
console.error(`answers: ${answers.length} (curated ${curated.length}, generated ${answers.length - curated.length})`);

const sample = (list: string[], count: number, step: number) =>
  Array.from({ length: count }, (_, i) => list[(i * step) % list.length]);
console.error('samples:');
console.error('  ' + sample(answers, 40, 37).join(' '));
console.error('  ' + sample(answers, 40, 101).join(' '));
