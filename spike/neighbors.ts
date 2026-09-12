import { EmbeddingStore, MODELS } from './lib/embeddings.ts';
import type { Backend, ModelKey } from './lib/embeddings.ts';
import { dot } from './lib/scoring.ts';
import { contentWords } from './lib/vocab.ts';

const DEFAULT_PROBES = [
  'shark',
  'volcano',
  'library',
  'courage',
  'thunderstorm',
  'microscope',
  'marathon',
  'freedom',
  'water',
  'danger',
  'bank',
  'spring',
  'seal',
  'bat',
  'pitch',
  'run',
  'cold',
  'justice',
];

function argValues(flag: string): string[] | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : null;
}

const models = (argValues('model') ?? ['bge', 'minilm']) as ModelKey[];
const probes = argValues('probe') ?? DEFAULT_PROBES;
const topN = Number(argValues('top')?.[0] ?? 10);
const backend = (argValues('backend')?.[0] ?? 'local') as Backend;
const corpusSize = Number(argValues('corpus')?.[0] ?? 0);

const corpus = contentWords();
if (corpusSize > 0) corpus.length = Math.min(corpus.length, corpusSize);

for (const model of models) {
  const store = EmbeddingStore.open(model, backend);
  const need = [...corpus, ...probes, ...probes.map((p) => `a ${p}`)];
  await store.ensure(need, (done, total) => {
    if (done === total || done % 1024 === 0) console.error(`[${model}] embedded ${done}/${total}`);
  });

  console.log(`\n=== ${model} (${MODELS[model].hfId}, ${store.dim}d, ${corpus.length} corpus words) ===\n`);
  for (const probe of probes) {
    const pv = store.getOrThrow(probe);
    const ranked = corpus
      .filter((w) => w !== probe)
      .map((w) => ({ word: w, sim: dot(pv, store.getOrThrow(w)) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, topN);
    console.log(`${probe.padEnd(14)} ${ranked.map((r) => `${r.word} ${r.sim.toFixed(2)}`).join('  ')}`);
  }
}
