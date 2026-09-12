import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.ts';
import { isPlayableDailyDate, todayUtc } from '$lib/server/dates.ts';

const BUCKET_SIZE = 1_000;
const BIN_COUNT = 11;

interface ScoreBucketRow {
  bucket: number;
  count: number;
}

export const GET: RequestHandler = async ({ platform, url }) => {
  const date = url.searchParams.get('date') ?? todayUtc();
  if (!isPlayableDailyDate(date)) {
    return json({ error: 'bad_request', detail: 'date is outside the playable range' }, { status: 400 });
  }

  const bins = Array<number>(BIN_COUNT).fill(0);
  if (!platform?.env?.DB) {
    return json({ date, bucketSize: BUCKET_SIZE, bins, total: 0 }, { headers: { 'cache-control': 'no-store' } });
  }

  try {
    const result = await platform.env.DB
      .prepare(
        `SELECT CAST(score / 1000 AS INTEGER) AS bucket, COUNT(*) AS count
         FROM game_scores
         WHERE game_kind = 'daily' AND game_key = ?
         GROUP BY CAST(score / 1000 AS INTEGER)
         ORDER BY bucket`,
      )
      .bind(date)
      .all<ScoreBucketRow>();

    for (const row of result.results ?? []) {
      const bucket = Math.max(0, Math.min(BIN_COUNT - 1, Number(row.bucket)));
      bins[bucket] += Number(row.count);
    }

    return json(
      { date, bucketSize: BUCKET_SIZE, bins, total: bins.reduce((sum, count) => sum + count, 0) },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return json({ error: 'store_error', detail: String(error) }, { status: 500 });
  }
};
