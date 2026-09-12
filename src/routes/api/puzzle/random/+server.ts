import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.ts';
import { MAX_TURNS } from '$lib/game/rules.ts';
import type { GameStart } from '$lib/game/types.ts';
import { getStore } from '$lib/server/platform.ts';
import { randomAnswers } from '$lib/server/random.ts';
import { gameRounds } from '$lib/server/settings.ts';

export const GET: RequestHandler = async ({ platform, url }) => {
  const seedParam = url.searchParams.get('seed');
  const seed = seedParam ? Number(seedParam) : Math.floor(Math.random() * 0x7fffffff);
  if (!Number.isInteger(seed) || seed < 0) {
    return json({ error: 'bad_request', detail: 'invalid seed' }, { status: 400 });
  }

  try {
    const store = getStore(platform?.env);
    const rounds = gameRounds();
    const answers = await randomAnswers(store, seed, rounds);
    if (!answers) return json({ error: 'no_puzzle' }, { status: 404 });
    const start: GameStart = { game: { kind: 'random', seed }, maxTurns: MAX_TURNS, rounds };
    return json(start, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return json({ error: 'store_error', detail: String(error) }, { status: 500 });
  }
};
