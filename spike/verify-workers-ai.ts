import { EmbeddingStore, MODELS } from './lib/embeddings.ts';
import type { ModelKey } from './lib/embeddings.ts';
import { align } from './lib/scoring.ts';

function argValues(flag: string): string[] | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : null;
}

const model = (argValues('model')?.[0] ?? 'bge-base') as ModelKey;
if (!MODELS[model].cfId) throw new Error(`${model} has no Workers AI equivalent`);

const probes = argValues('words') ?? [
  'shark',
  'volcano',
  'library',
  'courage',
  'thunderstorm',
  'microscope',
  'animal',
  'danger',
  'water',
  'speed',
  'technology',
  'emotion',
  'quiet',
  'earth',
  'learning',
];

const local = EmbeddingStore.open(model, 'local');
const remote = EmbeddingStore.open(model, 'workers-ai');
await local.ensure(probes);
await remote.ensure(probes, (done, total) => console.error(`workers-ai ${done}/${total}`));

const cosines = probes.map((w) => align(local.getOrThrow(w), remote.getOrThrow(w)));
const min = Math.min(...cosines);
const max = Math.max(...cosines);
const mean = cosines.reduce((s, x) => s + x, 0) / cosines.length;

console.log(`model: ${MODELS[model].hfId} (${MODELS[model].cfId})`);
console.log(`local vs workers-ai per-word cosine: min ${min.toFixed(4)}  mean ${mean.toFixed(4)}  max ${max.toFixed(4)}`);
console.log(mean > 0.99 ? 'PASS: numerical parity, vectors interchangeable' : 'FAIL: pooling or preprocessing differs, use one source for all vectors');
for (let i = 0; i < probes.length; i++) {
  console.log(`  ${probes[i].padEnd(14)} ${cosines[i].toFixed(4)}`);
}
