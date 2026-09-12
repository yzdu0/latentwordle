import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.ts';
import { CONCEPT_SLOTS, MAX_TURNS } from '$lib/game/rules.ts';
import type { GameStart } from '$lib/game/types.ts';
import { getStore } from '$lib/server/platform.ts';
import { randomPuzzle } from '$lib/server/random.ts';

export const GET: RequestHandler = async ({ platform, url }) => {
  const seedParam = url.searchParams.get('seed');
  const seed = seedParam ? Number(seedParam) : Math.floor(Math.random() * 0x7fffffff);
  if (!Number.isInteger(seed) || seed < 0) {
    return json({ error: 'bad_request', detail: 'invalid seed' }, { status: 400 });
  }

  try {
    const store = getStore(platform?.env);
    const puzzle = await randomPuzzle(store, seed);
    if (!puzzle) return json({ error: 'no_puzzle' }, { status: 404 });
    const start: GameStart = {
      game: { kind: 'random', seed },
      maxTurns: MAX_TURNS,
      conceptSlots: CONCEPT_SLOTS,
      concepts: puzzle.concepts,
    };
    return json(start, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return json({ error: 'store_error', detail: String(error) }, { status: 500 });
  }
};
