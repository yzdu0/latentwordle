import type { GameRef, GameView } from '$lib/game/types.ts';
import { computeView } from './engine.ts';
import type { EngineResult } from './engine.ts';
import { dayIndexOf, isPlayableDailyDate } from './dates.ts';
import { getStore } from './platform.ts';
import { dailyAnswerSeed, randomAnswers, selectAnswers, selectHardAnswers } from './random.ts';
import { dailySalt, gameRounds } from './settings.ts';
import type { Store } from './store.ts';

export async function dailyAnswers(
  store: Store,
  dayIndex: number,
  rounds: number,
  salt: number,
): Promise<string[] | null> {
  const puzzles = await store.getPuzzles();
  const seed = dailyAnswerSeed(dayIndex, salt);
  return selectAnswers(puzzles, seed, rounds);
}

export async function hardAnswers(
  store: Store,
  dayIndex: number,
  rounds: number,
  salt: number,
): Promise<string[] | null> {
  const puzzles = await store.getPuzzles();
  const seed = dailyAnswerSeed(dayIndex, salt ^ 0x4d5958);
  return selectHardAnswers(puzzles, seed, rounds);
}

export async function scoreRequest(
  env: Env | undefined,
  game: GameRef,
  rawActions: unknown,
): Promise<EngineResult> {
  const store = getStore(env);
  const rounds = gameRounds();
  let answers: string[] | null;

  if (game.kind === 'daily' || game.kind === 'hard') {
    const dayIndex = dayIndexOf(game.date);
    if (dayIndex === null || !isPlayableDailyDate(game.date)) {
      return { ok: false, error: { error: 'bad_request', detail: 'date is outside the playable range' } };
    }
    answers =
      game.kind === 'hard'
        ? await hardAnswers(store, dayIndex, rounds, dailySalt())
        : await dailyAnswers(store, dayIndex, rounds, dailySalt());
  } else {
    answers = await randomAnswers(store, game.seed, rounds);
  }

  if (!answers) {
    return { ok: false, error: { error: 'no_puzzle' } };
  }

  return computeView({ store }, game, answers, rawActions, rounds);
}

export async function recordCompletedScore(
  env: Env | undefined,
  game: GameRef,
  view: GameView,
  submissionId: string,
): Promise<void> {
  if (!env?.DB || !view.finished) return;

  const gameKey = game.kind === 'random' ? String(game.seed) : game.date;
  const solvedRounds = view.results.filter((result) => result.solved).length;
  const totalTurns = view.results.reduce((sum, result) => sum + result.turnsUsed, 0);

  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO game_scores
       (submission_id, game_kind, game_key, score, rounds, solved_rounds, total_turns, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      submissionId,
      game.kind,
      gameKey,
      view.score,
      view.rounds,
      solvedRounds,
      totalTurns,
      new Date().toISOString(),
    )
    .run();
}
