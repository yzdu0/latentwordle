import fs from 'node:fs';
import path from 'node:path';
import { EmbeddingStore } from './lib/embeddings.ts';
import type { Backend, ModelKey } from './lib/embeddings.ts';
import {
  align,
  calibrationK,
  mean,
  meanVector,
  quantile,
  stdev,
  subtractAndNormalize,
} from './lib/scoring.ts';
import { contentWords, loadPuzzles } from './lib/vocab.ts';

const CACHE_DIR = path.resolve(import.meta.dirname, '.cache');

function argValues(flag: string): string[] | null {
  const hit = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return hit ? hit.slice(flag.length + 3).split(',').map((s) => s.trim()).filter(Boolean) : null;
}

const models = (argValues('model') ?? ['bge']) as ModelKey[];
const backend = (argValues('backend')?.[0] ?? 'local') as Backend;
const center = process.argv.includes('--center');
const topDecoys = Number(argValues('decoys')?.[0] ?? 6);

let globalKFallback = 0.45;
try {
  const cal = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'calibration.json'), 'utf8')) as Record<
    string,
    { globalK: number }
  >;
  const key = `${models[0]}${center ? '+center' : ''}`;
  if (cal[key]) globalKFallback = cal[key].globalK;
} catch {
  console.error('no calibration.json yet, using global K = 0.45');
}

const corpus = contentWords();
const puzzles = loadPuzzles();

const clampK = (k: number) => Math.max(0.05, Math.min(0.5, k));
const rawMatch = (g: number, goal: number, K: number) =>
  Math.max(0, Math.min(1, 1 - Math.abs(g - goal) / K)) * 100;
const arrow = (g: number, goal: number) => (g - goal > 0.005 ? 'v' : g - goal < -0.005 ? '^' : '=');

interface DecoyRow {
  word: string;
  matches: number[];
  min: number;
  avg: number;
}

for (const model of models) {
  const store = EmbeddingStore.open(model, backend);
  const allNeeded = [...corpus];
  for (const p of puzzles) {
    allNeeded.push(p.answer, ...p.concepts, ...p.guesses);
    if (p.swap) allNeeded.push(p.swap.to);
  }
  await store.ensure(allNeeded, (done, total) => {
    if (done === total || done % 2048 === 0) console.error(`[${model}] embedded ${done}/${total}`);
  });

  let corpusVecs = corpus.map((w) => store.getOrThrow(w));
  let vecOf = (w: string) => store.getOrThrow(w);
  if (center) {
    const m = meanVector(corpusVecs);
    vecOf = (w) => subtractAndNormalize(store.getOrThrow(w), m);
    corpusVecs = corpus.map(vecOf);
  }

  const summary: string[] = [];

  for (const puzzle of puzzles) {
    const answer = puzzle.answer;
    const conceptLabels = [...puzzle.concepts];
    const conceptVecs = conceptLabels.map(vecOf);
    const answerVec = vecOf(answer);

    const analysis = (labels: string[], vecs: Float32Array[]) => {
      const alignAll = vecs.map((cv) => corpusVecs.map((v) => align(v, cv)));
      const goals = labels.map((_, i) => align(answerVec, vecs[i]));
      const stats = labels.map((label, i) => {
        const xs = alignAll[i];
        const sd = stdev(xs);
        const z = sd > 0 ? (goals[i] - mean(xs)) / sd : 0;
        const K = clampK(calibrationK(xs, goals[i]));
        const rows = corpusVecs.map((v) => rawMatch(align(v, vecs[i]), goals[i], K)).sort((a, b) => a - b);
        const share80 = rows.filter((m) => m >= 80).length / rows.length;
        return { label, goal: goals[i], z, K, share80 };
      });
      const Ks = stats.map((s) => s.K);
      const decoys: DecoyRow[] = corpus
        .map((word, i) => {
          const matches = goals.map((goal, c) => rawMatch(align(corpusVecs[i], vecs[c]), goal, Ks[c]));
          return { word, matches, min: Math.min(...matches), avg: mean(matches) };
        })
        .filter((r) => r.word !== answer)
        .sort((a, b) => b.min - a.min || b.avg - a.avg);
      return { stats, Ks, decoys };
    };

    const base = analysis(conceptLabels, conceptVecs);
    const countAbove = (t: number) => base.decoys.filter((d) => d.min >= t).length;
    const best = base.decoys[0];

    console.log(`\n\n######## ${model}${center ? '+center' : ''} :: "${answer}" ########`);
    console.log('axis            goal    z      K      vocab>=80   top words on this axis');
    base.stats.forEach((s, i) => {
      const axisRanked = corpus
        .map((w) => ({ w, m: rawMatch(align(vecOf(w), conceptVecs[i]), s.goal, s.K) }))
        .filter((r) => r.w !== answer)
        .sort((a, b) => b.m - a.m)
        .slice(0, 4)
        .map((r) => `${r.w}:${Math.round(r.m)}`)
        .join(' ');
      console.log(
        `${s.label.padEnd(14)} ${s.goal.toFixed(2).padStart(5)}  ${s.z.toFixed(2).padStart(5)}  ${s.K.toFixed(2)}  ${(s.share80 * 100).toFixed(0).padStart(5)}%      ${axisRanked}`,
      );
    });

    console.log(
      `\ndecoys with min match >=85: ${countAbove(85)}   best decoy: ${best.word} (min ${best.min.toFixed(0)}, avg ${best.avg.toFixed(0)})   (of ${corpus.length - 1} words)`,
    );
    console.log('top all-axis decoys (minMatch, per-axis matches):');
    for (const d of base.decoys.slice(0, topDecoys)) {
      console.log(
        `  ${d.word.padEnd(14)} min ${d.min.toFixed(0).padStart(3)}  [${d.matches.map((m) => m.toFixed(0).padStart(3)).join(' ')}]`,
      );
    }

    console.log('\nscripted guesses (match+direction per axis):');
    console.log(`  ${'guess'.padEnd(14)} ${conceptLabels.map((c) => c.slice(0, 8).padStart(9)).join(' ')}`);
    for (const g of puzzle.guesses) {
      const gv = vecOf(g);
      const cells = conceptLabels.map((_, i) => {
        const ga = align(gv, conceptVecs[i]);
        const m = Math.round(rawMatch(ga, base.stats[i].goal, base.Ks[i]));
        return `${String(m).padStart(4)}${arrow(ga, base.stats[i].goal)}`.padStart(9);
      });
      console.log(`  ${g.padEnd(14)} ${cells.join(' ')}`);
    }

    const weakest = [...base.stats].sort((a, b) => Math.abs(a.z) - Math.abs(b.z))[0];
    let swapNote = '';
    if (puzzle.swap) {
      const idx = conceptLabels.indexOf(puzzle.swap.from);
      const swappedLabels = conceptLabels.map((c, i) => (i === idx ? puzzle.swap!.to : c));
      const swappedVecs = swappedLabels.map(vecOf);
      const after = analysis(swappedLabels, swappedVecs);
      console.log(
        `\nswap "${puzzle.swap.from}" -> "${puzzle.swap.to}": best decoy min ${best.min.toFixed(0)} (${best.word}) -> ${after.decoys[0].min.toFixed(0)} (${after.decoys[0].word})`,
      );
      const newStat = after.stats[idx];
      console.log(
        `  new axis "${newStat.label}" goal ${newStat.goal.toFixed(2)} z ${newStat.z.toFixed(2)} K ${newStat.K.toFixed(2)} vocab>=80 ${(newStat.share80 * 100).toFixed(0)}%`,
      );
      console.log('  retroactive rescore of earlier guesses on the new axis:');
      for (const g of puzzle.guesses.slice(0, 4)) {
        const ga = align(vecOf(g), swappedVecs[idx]);
        console.log(`    ${g.padEnd(14)} ${Math.round(rawMatch(ga, newStat.goal, newStat.K))}${arrow(ga, newStat.goal)}`);
      }
      swapNote = `${puzzle.swap.from}->${puzzle.swap.to}: best decoy ${best.min.toFixed(0)}->${after.decoys[0].min.toFixed(0)}`;
    }
    const meanShare80 = (mean(base.stats.map((s) => s.share80)) * 100).toFixed(0);
    summary.push(
      `${model}${center ? '+center' : ''}  ${answer.padEnd(13)} best decoy ${best.word.padEnd(11)} min ${best.min.toFixed(0).padStart(3)}   mean axis vocab>=80 ${meanShare80.padStart(3)}%   weakest: ${weakest.label} (z=${weakest.z.toFixed(2)})   ${swapNote}`,
    );
  }

  console.log(`\n\n===== SUMMARY (${model}${center ? '+center' : ''}) =====`);
  console.log(`global K for custom concepts: ${globalKFallback.toFixed(3)}`);
  for (const line of summary) console.log(line);
}
