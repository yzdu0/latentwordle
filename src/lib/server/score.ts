import type { GameRef } from '$lib/game/types.ts';
import { computeView } from './engine.ts';
import type { EngineResult } from './engine.ts';
import { dayIndexOf } from './dates.ts';
import { getStore } from './platform.ts';
import { randomPuzzle } from './random.ts';
import type { PuzzleData } from './store.ts';
import { decodeVector } from './store.ts';

export async function scoreRequest(
  env: Env | undefined,
  game: GameRef,
  rawActions: unknown,
): Promise<EngineResult> {
  const store = getStore(env);
  let puzzle: PuzzleData | null;

  if (game.kind === 'daily') {
    const dayIndex = dayIndexOf(game.date);
    if (dayIndex === null) {
      return { ok: false, error: { error: 'bad_request', detail: 'invalid date' } };
    }
    puzzle = await store.getPuzzle(dayIndex);
  } else {
    puzzle = await randomPuzzle(store, game.seed);
  }

  if (!puzzle) {
    return { ok: false, error: { error: 'no_puzzle' } };
  }

  const meanEncoded = await store.getMeta('mean');
  const mean = meanEncoded ? decodeVector(meanEncoded) : null;
  const globalK = Number(await store.getMeta('global_k')) || 0.15;

  return computeView({ store, ai: env?.AI, mean, globalK }, game, puzzle, rawActions);
}
