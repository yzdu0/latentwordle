import fs from 'node:fs';
import path from 'node:path';
import { EmbeddingStore, MODELS } from './lib/embeddings.ts';
import type { Backend, ModelKey } from './lib/embeddings.ts';
import {
  align,
  calibrationK,
  mean,
  meanVector,
  mulberry32,
  quantile,
  stdev,
  subtractAndNormalize,
} from './lib/scoring.ts';
import { contentWords } from './lib/vocab.ts';

function argValues(flag: string): string[] | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : null;
}

const models = (argValues('model') ?? ['bge']) as ModelKey[];
const backend = (argValues('backend')?.[0] ?? 'local') as Backend;
const pairCount = Number(argValues('pairs')?.[0] ?? 200);
const simCount = Number(argValues('sims')?.[0] ?? 4000);
const center = process.argv.includes('--center');

const CACHE_DIR = path.resolve(import.meta.dirname, '.cache');
const corpus = contentWords();
const rng = mulberry32(42);

const report: Record<string, unknown> = {};

for (const model of models) {
  const store = EmbeddingStore.open(model, backend);
  await store.ensure(corpus, (done, total) => {
    if (done === total || done % 2048 === 0) console.error(`[${model}] embedded ${done}/${total}`);
  });

  let vecOf = (w: string) => store.getOrThrow(w);
  let corpusVecs = corpus.map(vecOf);
  if (center) {
    const m = meanVector(corpusVecs);
    vecOf = (w) => subtractAndNormalize(store.getOrThrow(w), m);
    corpusVecs = corpus.map(vecOf);
  }
  console.error(`[${model}] corpus embedded: ${corpus.length} words${center ? ' (mean-centered)' : ''}`);

  const pairSims: number[] = [];
  for (let i = 0; i < simCount; i++) {
    const a = Math.floor(rng() * corpus.length);
    const b = Math.floor(rng() * corpus.length);
    if (a === b) continue;
    pairSims.push(align(corpusVecs[a], corpusVecs[b]));
  }
  pairSims.sort((a, b) => a - b);

  const ks: number[] = [];
  const axisStds: number[] = [];
  const answerZs: number[] = [];
  for (let i = 0; i < pairCount; i++) {
    const answerIdx = Math.floor(rng() * corpus.length);
    const conceptIdx = Math.floor(rng() * corpus.length);
    if (answerIdx === conceptIdx) continue;
    const cv = corpusVecs[conceptIdx];
    const aligns = corpusVecs.map((v) => align(v, cv));
    const goal = aligns[answerIdx];
    ks.push(calibrationK(aligns, goal));
    const sd = stdev(aligns);
    axisStds.push(sd);
    const m = mean(aligns);
    answerZs.push(sd > 0 ? (goal - m) / sd : 0);
  }

  const kSorted = [...ks].sort((a, b) => a - b);
  const stdSorted = [...axisStds].sort((a, b) => a - b);
  const zSorted = [...answerZs].sort((a, b) => a - b);
  const globalK = quantile(kSorted, 0.5);

  const quant = (xs: number[], q: number) => quantile([...xs].sort((a, b) => a - b), q).toFixed(3);

  const label = `${model}${center ? '+center' : ''}`;
  console.log(`\n=== ${label} (${MODELS[model].hfId}) ===`);
  console.log(`random word-pair cosine   p10 ${quant(pairSims, 0.1)}  p50 ${quant(pairSims, 0.5)}  p90 ${quant(pairSims, 0.9)}  max ${quant(pairSims, 1)}`);
  console.log(`per-axis alignment std    p10 ${quant(stdSorted, 0.1)}  p50 ${quant(stdSorted, 0.5)}  p90 ${quant(stdSorted, 0.9)}`);
  console.log(`answer z-score on axis    p10 ${quant(zSorted, 0.1)}  p50 ${quant(zSorted, 0.5)}  p90 ${quant(zSorted, 0.9)}  (|z|>1 = outlier axis)`);
  console.log(`calibrated K = p90 delta  p10 ${quant(kSorted, 0.1)}  p50 ${quant(kSorted, 0.5)}  p90 ${quant(kSorted, 0.9)}`);
  console.log(`PROPOSED GLOBAL K for custom concepts: ${globalK.toFixed(3)}`);

  report[label] = {
    center,
    corpusSize: corpus.length,
    globalK,
    pairSims: { p10: quantile(pairSims, 0.1), p50: quantile(pairSims, 0.5), p90: quantile(pairSims, 0.9), max: pairSims.at(-1) },
    axisStd: { p10: quantile(stdSorted, 0.1), p50: quantile(stdSorted, 0.5), p90: quantile(stdSorted, 0.9) },
    answerZ: { p10: quantile(zSorted, 0.1), p50: quantile(zSorted, 0.5), p90: quantile(zSorted, 0.9) },
    k: { p10: quantile(kSorted, 0.1), p50: quantile(kSorted, 0.5), p90: quantile(kSorted, 0.9) },
  };
}

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.writeFileSync(path.join(CACHE_DIR, 'calibration.json'), JSON.stringify(report, null, 2));
console.log(`\nwrote ${path.join(CACHE_DIR, 'calibration.json')}`);
