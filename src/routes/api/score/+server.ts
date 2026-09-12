import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.ts';
import type { GameRef } from '$lib/game/types.ts';
import { statusFor } from '$lib/server/http.ts';
import { scoreRequest } from '$lib/server/score.ts';

function parseGame(input: unknown): GameRef | null {
  if (!input || typeof input !== 'object') return null;
  const game = input as { kind?: unknown; date?: unknown; seed?: unknown };
  if (game.kind === 'daily' && typeof game.date === 'string') {
    return { kind: 'daily', date: game.date };
  }
  if (game.kind === 'random' && Number.isInteger(game.seed)) {
    return { kind: 'random', seed: game.seed as number };
  }
  return null;
}

export const POST: RequestHandler = async ({ request, platform }) => {
  let body: { game?: unknown; actions?: unknown };
  try {
    body = (await request.json()) as { game?: unknown; actions?: unknown };
  } catch {
    return json({ error: 'bad_request', detail: 'invalid json' }, { status: 400 });
  }

  const game = parseGame(body.game);
  if (!game) {
    return json({ error: 'bad_request', detail: 'invalid game' }, { status: 400 });
  }

  try {
    const result = await scoreRequest(platform?.env, game, body.actions ?? []);
    if (!result.ok) {
      return json(result.error, { status: statusFor(result.error.error) });
    }
    return json({ view: result.view });
  } catch (error) {
    return json({ error: 'store_error', detail: String(error) }, { status: 500 });
  }
};
