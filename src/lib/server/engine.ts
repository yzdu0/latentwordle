import { align, calibrationK, dequantize, l2normalize, scoreAxis, subtractAndNormalize } from '$lib/game/scoring.ts';
import { CONCEPT_SLOTS, MAX_TURNS, replay } from '$lib/game/rules.ts';
import type { NormalizedAction } from '$lib/game/rules.ts';
import type { AxisResult, GameError, GameRef, GameView, HistoryEntry } from '$lib/game/types.ts';
import { embedRemote } from './embed.ts';
import type { Anchors, PuzzleData, Store } from './store.ts';

export interface EngineContext {
  store: Store;
  ai?: Ai;
  mean: Float32Array | null;
  globalK: number;
}

export type EngineResult = { ok: true; view: GameView } | { ok: false; error: GameError };

function findSwapIndex(timeline: NormalizedAction[], concept: string): number | undefined {
  const index = timeline.findIndex((a) => a.type === 'swap' && a.concept === concept);
  return index === -1 ? undefined : index;
}

export function calibrateCustomK(
  anchors: Anchors | null,
  conceptVec: Float32Array,
  goal: number,
  fallback: number,
): number {
  if (!anchors || anchors.count === 0) return fallback;
  const { count, dim, bytes } = anchors;
  const aligns = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    aligns[i] = align(conceptVec, dequantize(bytes.subarray(i * dim, (i + 1) * dim)));
  }
  return calibrationK(aligns, goal);
}

export async function computeView(
  ctx: EngineContext,
  game: GameRef,
  puzzle: PuzzleData,
  rawActions: unknown,
): Promise<EngineResult> {
  const replayed = replay(rawActions, puzzle.concepts, puzzle.answer);
  if (!replayed.ok) return replayed;
  const state = replayed.state;

  const answerVec = await ctx.store.getVector(puzzle.answer);
  if (!answerVec) {
    return { ok: false, error: { error: 'store_error', detail: `missing vector for answer` } };
  }

  const kByConcept = new Map<string, number>();
  puzzle.concepts.forEach((concept, i) => {
    const k = puzzle.ks[i];
    if (typeof k === 'number' && Number.isFinite(k)) kByConcept.set(concept, k);
  });

  const conceptVecs: Float32Array[] = [];
  for (const concept of state.concepts) {
    let vec = await ctx.store.getVector(concept);
    if (!vec) {
      if (!ctx.ai) {
        return {
          ok: false,
          error: { error: 'unknown_concept', detail: concept, actionIndex: findSwapIndex(state.timeline, concept) },
        };
      }
      try {
        const raw = await embedRemote(ctx.ai, concept);
        vec = ctx.mean ? subtractAndNormalize(raw, ctx.mean) : l2normalize(raw);
        await ctx.store.putVector(concept, vec);
      } catch {
        return {
          ok: false,
          error: { error: 'unknown_concept', detail: concept, actionIndex: findSwapIndex(state.timeline, concept) },
        };
      }
    }
    conceptVecs.push(vec);
  }

  const goals = conceptVecs.map((cv) => align(answerVec, cv));
  const anchors = await ctx.store.getAnchors();
  const ks = state.concepts.map(
    (concept, i) => kByConcept.get(concept) ?? calibrateCustomK(anchors, conceptVecs[i], goals[i], ctx.globalK),
  );

  const history: HistoryEntry[] = [];
  for (let i = 0; i < state.timeline.length; i++) {
    const action = state.timeline[i];
    if (action.type === 'swap') {
      history.push(action);
      continue;
    }
    const guessVec = await ctx.store.getVector(action.word);
    if (!guessVec) {
      return { ok: false, error: { error: 'not_a_word', actionIndex: i, detail: action.word } };
    }
    const results: AxisResult[] = conceptVecs.map((cv, c) =>
      scoreAxis(align(guessVec, cv), goals[c], ks[c]),
    );
    history.push({ type: 'guess', turn: action.turn, word: action.word, results });
  }

  return {
    ok: true,
    view: {
      game,
      maxTurns: MAX_TURNS,
      turnsUsed: state.turnsUsed,
      conceptSlots: CONCEPT_SLOTS,
      concepts: state.concepts,
      history,
      solved: state.solved,
      revealed: state.revealed,
      answer: state.solved || state.revealed ? puzzle.answer : null,
    },
  };
}
