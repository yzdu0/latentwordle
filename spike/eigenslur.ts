import fs from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';

const ROOT = path.resolve(import.meta.dirname, '..');
const GLOVE = path.join(ROOT, '.cache/glove-wiki-gigaword-300.gz');
const DIM = 300;

const CATEGORIES: Record<string, [string, string][]> = {
  race: [
    ['nigger', 'black'], ['nigga', 'black'], ['coon', 'black'], ['darkie', 'black'], ['sambo', 'black'],
    ['jigaboo', 'black'], ['spook', 'black'], ['negro', 'black'],
    ['chink', 'chinese'], ['gook', 'asian'], ['slope', 'asian'], ['slant', 'asian'], ['nip', 'japanese'],
    ['jap', 'japanese'], ['paki', 'pakistani'], ['spic', 'mexican'], ['wetback', 'mexican'],
    ['beaner', 'mexican'], ['greaser', 'mexican'], ['redskin', 'native'], ['injun', 'native'],
    ['squaw', 'native'], ['savage', 'native'],
    ['kike', 'jew'], ['heeb', 'jew'], ['yid', 'jew'], ['hymie', 'jew'], ['shylock', 'jew'],
    ['cracker', 'white'], ['honky', 'white'], ['whitey', 'white'], ['peckerwood', 'white'],
    ['raghead', 'arab'], ['towelhead', 'arab'], ['camel', 'arab'],
    ['polack', 'polish'], ['wop', 'italian'], ['dago', 'italian'], ['guido', 'italian'],
  ],
  sexuality: [
    ['fag', 'gay'], ['faggot', 'gay'], ['homo', 'gay'], ['queer', 'gay'], ['poof', 'gay'],
    ['pansy', 'gay'], ['sodomite', 'gay'], ['bugger', 'gay'], ['dyke', 'lesbian'],
    ['tranny', 'transgender'], ['transvestite', 'transgender'], ['ladyboy', 'transgender'],
  ],
  gender: [
    ['bitch', 'woman'], ['cunt', 'woman'], ['slut', 'woman'], ['whore', 'woman'], ['twat', 'woman'],
    ['skank', 'woman'], ['hag', 'woman'], ['crone', 'woman'], ['bimbo', 'woman'], ['tramp', 'woman'],
    ['harpy', 'woman'], ['spinster', 'woman'], ['hussy', 'woman'],
  ],
  disability: [
    ['retard', 'disabled'], ['cripple', 'disabled'], ['spastic', 'disabled'], ['spaz', 'disabled'],
    ['moron', 'disabled'], ['imbecile', 'disabled'], ['idiot', 'disabled'], ['midget', 'dwarf'],
    ['psycho', 'mentally_ill'], ['schizo', 'mentally_ill'], ['lunatic', 'mentally_ill'],
  ],
  religion: [
    ['kike', 'jew'], ['heeb', 'jew'], ['yid', 'jew'], ['hymie', 'jew'],
    ['raghead', 'muslim'], ['towelhead', 'muslim'], ['haji', 'muslim'],
    ['papist', 'catholic'], ['mick', 'irish'], ['paddy', 'irish'],
  ],
  nationality: [
    ['kraut', 'german'], ['hun', 'german'], ['jerry', 'german'],
    ['limey', 'british'], ['frog', 'french'], ['polack', 'polish'],
    ['wop', 'italian'], ['dago', 'italian'], ['gypsy', 'romani'], ['pikey', 'romani'],
  ],
  class: [
    ['redneck', 'white'], ['hillbilly', 'white'], ['peasant', 'poor'], ['pleb', 'poor'],
    ['bum', 'homeless'], ['hobo', 'homeless'], ['wino', 'alcoholic'], ['junkie', 'addict'],
    ['crackhead', 'addict'], ['fatty', 'fat'], ['fatso', 'fat'], ['lardass', 'fat'],
  ],
};

const allPairs = Object.values(CATEGORIES).flat();

function l2(v: Float32Array): Float32Array {
  let s = 0;
  for (let j = 0; j < v.length; j++) s += v[j] * v[j];
  const inv = 1 / (Math.sqrt(s) || 1);
  const out = new Float32Array(v.length);
  for (let j = 0; j < v.length; j++) out[j] = v[j] * inv;
  return out;
}

const gameVocab = fs.existsSync(path.join(ROOT, '.cache/dev/index.json'))
  ? (JSON.parse(fs.readFileSync(path.join(ROOT, '.cache/dev/index.json'), 'utf8')).words as string[])
  : [];
const blocklist = fs
  .readFileSync(path.join(ROOT, 'data/blocklist.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const pairWords = new Set(allPairs.flat());
const searchWords = new Set([...gameVocab, ...blocklist, ...pairWords]);
const vectors = new Map<string, Float32Array>();
const rank = new Map<string, number>();

const rl = readline.createInterface({
  input: createReadStream(GLOVE).pipe(createGunzip()),
  crlfDelay: Infinity,
});
let header = true;
let position = 0;
for await (const line of rl) {
  if (header) {
    header = false;
    continue;
  }
  const space = line.indexOf(' ');
  if (space <= 0) continue;
  position += 1;
  const word = line.slice(0, space);
  if (!searchWords.has(word)) continue;
  const parts = line.slice(space + 1).split(' ');
  const v = new Float32Array(DIM);
  for (let j = 0; j < DIM; j++) v[j] = Number(parts[j]);
  vectors.set(word, l2(v));
  rank.set(word, position);
}

const missing = [...pairWords].filter((word) => !vectors.has(word));
console.error(`loaded ${vectors.size} vectors; missing ${missing.length} pair words: ${missing.join(', ')}`);

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += a[j] * b[j];
  return s;
}

function meanOf(rows: Float32Array[]): Float32Array {
  const out = new Float32Array(DIM);
  for (const row of rows) for (let j = 0; j < DIM; j++) out[j] += row[j] / rows.length;
  return out;
}

function topComponent(rows: Float32Array[], normalizeRows = false): { component: Float32Array; explained: number } {
  const source = normalizeRows ? rows.map((row) => l2(row)) : rows;
  const mean = meanOf(source);
  const centered = source.map((row) => {
    const c = new Float32Array(DIM);
    for (let j = 0; j < DIM; j++) c[j] = row[j] - mean[j];
    return c;
  });
  const cov = new Float64Array(DIM * DIM);
  for (const c of centered) {
    for (let i = 0; i < DIM; i++) {
      const ci = c[i];
      if (ci === 0) continue;
      const base = i * DIM;
      for (let j = 0; j < DIM; j++) cov[base + j] += ci * c[j];
    }
  }
  const inv = 1 / Math.max(1, centered.length - 1);
  for (let i = 0; i < DIM * DIM; i++) cov[i] *= inv;

  let v = new Float32Array(DIM);
  let seed = 12345;
  for (let j = 0; j < DIM; j++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    v[j] = seed / 0x7fffffff - 0.5;
  }
  v = l2(v);
  for (let it = 0; it < 200; it++) {
    const w = new Float64Array(DIM);
    for (let i = 0; i < DIM; i++) {
      let sum = 0;
      const base = i * DIM;
      for (let j = 0; j < DIM; j++) sum += cov[base + j] * v[j];
      w[i] = sum;
    }
    let norm = 0;
    for (let i = 0; i < DIM; i++) norm += w[i] * w[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < DIM; i++) v[i] = w[i] / norm;
  }
  let lambda = 0;
  for (let i = 0; i < DIM; i++) {
    let sum = 0;
    const base = i * DIM;
    for (let j = 0; j < DIM; j++) sum += cov[base + j] * v[j];
    lambda += v[i] * sum;
  }
  let trace = 0;
  for (let i = 0; i < DIM; i++) trace += cov[i * DIM + i];
  return { component: v, explained: trace > 0 ? lambda / trace : 0 };
}

function list(direction: Float32Array, exclude: Set<string>, count: number): string {
  return [...vectors.entries()]
    .filter(([word]) => !exclude.has(word))
    .map(([word, v]) => ({ word, sim: dot(v, direction) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, count)
    .map((r) => `${r.word}(${r.sim.toFixed(2)})`)
    .join(' ');
}

function differences(pairs: [string, string][]): { rows: Float32Array[]; used: [string, string][] } {
  const rows: Float32Array[] = [];
  const used: [string, string][] = [];
  for (const [slur, group] of pairs) {
    const a = vectors.get(slur);
    const b = vectors.get(group);
    if (!a || !b) continue;
    const d = new Float32Array(DIM);
    for (let j = 0; j < DIM; j++) d[j] = a[j] - b[j];
    rows.push(d);
    used.push([slur, group]);
  }
  return { rows, used };
}

function bootstrapStability(rows: Float32Array[], samples = 60): number {
  if (rows.length < 8) return NaN;
  const comps: Float32Array[] = [];
  for (let s = 0; s < samples; s++) {
    let rng = 7919 + s * 104729;
    const pick: Float32Array[] = [];
    for (let i = 0; i < rows.length; i++) {
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      pick.push(rows[rng % rows.length]);
    }
    comps.push(topComponent(pick).component);
  }
  let sum = 0;
  let n = 0;
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      let c = dot(comps[i], comps[j]);
      if (c < 0) c = -c;
      sum += c;
      n++;
    }
  }
  return sum / n;
}

const { rows: globalRows } = differences(allPairs);
const global = topComponent(globalRows);
const mean = l2(meanOf(globalRows));
const normalizedGlobal = topComponent(globalRows, true);

console.log(`\n===== GLOBAL =====`);
console.log(`usable pairs: ${globalRows.length} / ${allPairs.length}`);
console.log(`PC1 variance explained: ${(global.explained * 100).toFixed(1)}%   (normalized rows: ${(normalizedGlobal.explained * 100).toFixed(1)}%)`);
console.log(`mean-vs-PC1 cosine: ${dot(mean, global.component).toFixed(3)}`);
console.log(`bootstrap stability (|cos| mean): ${bootstrapStability(globalRows).toFixed(3)}`);
console.log(`PC1 +nearest (excluding all pair words): ${list(global.component, pairWords, 20)}`);
console.log(`PC1 -nearest (excluding all pair words): ${list(global.component.map((x) => -x), pairWords, 12)}`);
console.log(`PC1 +nearest (everything): ${list(global.component, new Set(), 15)}`);

for (const [name, pairs] of Object.entries(CATEGORIES)) {
  const { rows, used } = differences(pairs);
  if (rows.length < 4) {
    console.log(`\n===== ${name} ===== (too few: ${rows.length})`);
    continue;
  }
  const { component, explained } = topComponent(rows);
  console.log(`\n===== ${name} (${rows.length} pairs: ${used.map((p) => p.join('/')).join(', ')}) =====`);
  console.log(`PC1 explained: ${(explained * 100).toFixed(1)}%   bootstrap stability: ${bootstrapStability(rows).toFixed(3)}`);
  console.log(`  +: ${list(component, pairWords, 12)}`);
}
