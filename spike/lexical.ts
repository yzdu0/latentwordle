import fs from 'node:fs';
import path from 'node:path';
import { EmbeddingStore, MODELS } from './lib/embeddings.ts';
import type { Backend, ModelKey } from './lib/embeddings.ts';
import { align, meanVector, subtractAndNormalize } from './lib/scoring.ts';

function argValues(flag: string): string[] | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : null;
}

const models = (argValues('model') ?? ['bge']) as ModelKey[];
const backend = (argValues('backend')?.[0] ?? 'local') as Backend;
const center = process.argv.includes('--center');

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

function spearman(a: number[], b: number[]): number {
  return pearson(rank(a), rank(b));
}

const vocab = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];

for (const model of models) {
  const store = EmbeddingStore.open(model, backend);
  await store.ensure(vocab, (done, total) => {
    if (done === total || done % 2048 === 0) console.error(`[${model}] embedded ${done}/${total}`);
  });
  let vecOf = (w: string) => store.getOrThrow(w);
  if (center) {
    const m = meanVector(vocab.map((w) => store.getOrThrow(w)));
    vecOf = (w) => subtractAndNormalize(store.getOrThrow(w), m);
  }
  const sims = pairs.map((p) => align(vecOf(p.a), vecOf(p.b)));
  const human = pairs.map((p) => p.score);

  const byPos = new Map<string, number[]>();
  pairs.forEach((p, i) => {
    if (!byPos.has(p.pos)) byPos.set(p.pos, []);
    byPos.get(p.pos)!.push(i);
  });
  const posParts = [...byPos.entries()]
    .sort()
    .map(([pos, idxs]) => `${pos}:${spearman(idxs.map((i) => sims[i]), idxs.map((i) => human[i])).toFixed(3)}`);

  const label = `${model}${center ? '+center' : ''}`;
  console.log(
    `${label.padEnd(18)} ${MODELS[model].dim}d  spearman ${spearman(sims, human).toFixed(3)}   ${posParts.join('  ')}`,
  );
}
