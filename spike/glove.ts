import fs from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { normalize } from './lib/embeddings.ts';
import { align, meanVector, subtractAndNormalize } from './lib/scoring.ts';
import { contentWords } from './lib/vocab.ts';

const GLOVE = '/tmp/opencode/glove100.gz';
const SIMLEX = '/tmp/opencode/simlex/SimLex-999/SimLex-999.txt';

interface Pair {
  a: string;
  b: string;
  pos: string;
  score: number;
}

const pairs: Pair[] = fs
  .readFileSync(SIMLEX, 'utf8')
  .split('\n')
  .slice(1)
  .filter(Boolean)
  .map((line) => {
    const c = line.split('\t');
    return { a: c[0].toLowerCase(), b: c[1].toLowerCase(), pos: c[2], score: Number(c[3]) };
  });

const wanted = new Set([...pairs.flatMap((p) => [p.a, p.b]), ...contentWords()]);
const vectors = new Map<string, Float32Array>();

const rl = readline.createInterface({ input: createReadStream(GLOVE).pipe(createGunzip()), crlfDelay: Infinity });
let header = true;
for await (const line of rl) {
  if (header) {
    header = false;
    continue;
  }
  const sp = line.indexOf(' ');
  const word = line.slice(0, sp);
  if (!wanted.has(word)) continue;
  vectors.set(word, normalize(Float32Array.from(line.slice(sp + 1).split(' '), Number)));
}
console.error(`loaded ${vectors.size} glove vectors`);

function rank(xs: number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k].i] = avg;
    i = j + 1;
  }
  return out;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}

const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));

const present = pairs.filter((p) => vectors.has(p.a) && vectors.has(p.b));
console.error(`simlex pairs covered: ${present.length}/${pairs.length}`);

const byPos = new Map<string, number[]>();
present.forEach((p, i) => {
  if (!byPos.has(p.pos)) byPos.set(p.pos, []);
  byPos.get(p.pos)!.push(i);
});

const corpusVecs = contentWords().map((w) => vectors.get(w)).filter(Boolean) as Float32Array[];
const mean = meanVector(corpusVecs);

for (const centered of [false, true]) {
  const tf = (w: string) => {
    const v = vectors.get(w)!;
    return centered ? subtractAndNormalize(v, mean) : v;
  };
  const sims = present.map((p) => align(tf(p.a), tf(p.b)));
  const human = present.map((p) => p.score);
  const posParts = [...byPos.entries()]
    .sort()
    .map(([pos, idxs]) => `${pos}:${spearman(idxs.map((i) => sims[i]), idxs.map((i) => human[i])).toFixed(3)}`);
  console.log(
    `glove-100${centered ? '+center' : ''}      100d  spearman ${spearman(sims, human).toFixed(3)}   ${posParts.join('  ')}`,
  );
}
