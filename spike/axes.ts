import { EmbeddingStore } from './lib/embeddings.ts';
import type { Backend, ModelKey } from './lib/embeddings.ts';
import { align, mean, meanVector, stdev, subtractAndNormalize } from './lib/scoring.ts';
import { contentWords } from './lib/vocab.ts';

function argValues(flag: string): string[] | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : null;
}

const model = (argValues('model')?.[0] ?? 'bge') as ModelKey;
const backend = (argValues('backend')?.[0] ?? 'local') as Backend;
const concepts = argValues('concept') ?? ['animal'];
const words = argValues('words') ?? ['shark', 'dog', 'plants', 'mice', 'tiger', 'cat', 'fish', 'whale', 'building'];
const center = process.argv.includes('--center');

const corpus = contentWords();
const store = EmbeddingStore.open(model, backend);
await store.ensure([...corpus, ...concepts, ...words], (done, total) => {
  if (done === total || done % 4096 === 0) console.error(`embedded ${done}/${total}`);
});

let vecOf = (w: string) => store.getOrThrow(w);
let corpusVecs = corpus.map(vecOf);
if (center) {
  const m = meanVector(corpusVecs);
  vecOf = (w) => subtractAndNormalize(store.getOrThrow(w), m);
  corpusVecs = corpus.map(vecOf);
}

for (const concept of concepts) {
  const cv = vecOf(concept);
  const dist = corpusVecs.map((v) => align(v, cv));
  const m = mean(dist);
  const sd = stdev(dist);
  console.log(`\nconcept "${concept}"${center ? ' (centered)' : ''}: corpus mean ${m.toFixed(3)} std ${sd.toFixed(3)}`);
  console.log(`  ${'word'.padEnd(14)} align     z`);
  for (const w of words) {
    const a = align(vecOf(w), cv);
    const z = sd > 0 ? (a - m) / sd : 0;
    console.log(`  ${w.padEnd(14)} ${a.toFixed(3).padStart(6)}  ${z.toFixed(2).padStart(5)}`);
  }
  const ranked = [...corpus]
    .map((w) => ({ w, a: align(vecOf(w), cv) }))
    .sort((x, y) => y.a - x.a)
    .slice(0, 12)
    .map((r) => `${r.w}:${r.a.toFixed(2)}`)
    .join(' ');
  console.log(`  top corpus: ${ranked}`);
}
