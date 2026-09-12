import type { GameRef } from '$lib/game/types.ts';
import { MAX_ROUNDS } from '$lib/game/rules.ts';
import { computeView } from './engine.ts';
import type { EngineResult } from './engine.ts';
import { dayIndexOf } from './dates.ts';
import { getStore } from './platform.ts';
import { mulberry32, randomAnswers } from './random.ts';
import type { Store } from './store.ts';

async function dailyAnswers(store: Store, dayIndex: number): Promise<string[] | null> {
  const puzzles = await store.getPuzzles();
  if (puzzles.length < MAX_ROUNDS) return null;
  const rng = mulberry32((dayIndex * 2_654_435_761 + 1) >>> 0);
  const used = new Set<number>();
  const answers: string[] = [];
  while (answers.length < MAX_ROUNDS) {
    const index = Math.floor(rng() * puzzles.length);
    if (used.has(index)) continue;
    used.add(index);
    answers.push(puzzles[index].answer);
  }
  return answers;
}

export async function scoreRequest(
  env: Env | undefined,
  game: GameRef,
  rawActions: unknown,
): Promise<EngineResult> {
  const store = getStore(env);
  let answers: string[] | null;

  if (game.kind === 'daily') {
    const dayIndex = dayIndexOf(game.date);
    if (dayIndex === null) {
      return { ok: false, error: { error: 'bad_request', detail: 'invalid date' } };
    }
    answers = await dailyAnswers(store, dayIndex);
  } else {
    answers = await randomAnswers(store, game.seed);
  }

  if (!answers) {
    return { ok: false, error: { error: 'no_puzzle' } };
  }

  return computeView({ store }, game, answers, rawActions);
}
