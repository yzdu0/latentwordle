import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.ts';
import { CONCEPT_SLOTS, MAX_TURNS } from '$lib/game/rules.ts';
import type { GameStart } from '$lib/game/types.ts';
import { dayIndexOf, todayUtc } from '$lib/server/dates.ts';
import { getStore } from '$lib/server/platform.ts';

export const GET: RequestHandler = async ({ platform, url }) => {
  const date = url.searchParams.get('date') ?? todayUtc();
  const dayIndex = dayIndexOf(date);
  if (dayIndex === null) {
    return json({ error: 'bad_request', detail: 'invalid date' }, { status: 400 });
  }

  try {
    const store = getStore(platform?.env);
    const puzzle = await store.getPuzzle(dayIndex);
    if (!puzzle) return json({ error: 'no_puzzle' }, { status: 404 });
    const start: GameStart = {
      game: { kind: 'daily', date },
      maxTurns: MAX_TURNS,
      conceptSlots: CONCEPT_SLOTS,
      concepts: puzzle.concepts,
    };
    return json(start, { headers: { 'cache-control': 'public, max-age=300' } });
  } catch (error) {
    return json({ error: 'store_error', detail: String(error) }, { status: 500 });
  }
};
