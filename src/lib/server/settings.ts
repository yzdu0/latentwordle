import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { MAX_ROUNDS } from '$lib/game/rules.ts';

const LOCAL_ROUNDS = 100;
const fallbackSeed = Math.floor(Math.random() * 1_000_000_000);

export function gameRounds(): number {
  return dev ? LOCAL_ROUNDS : MAX_ROUNDS;
}

export function dailySalt(): number {
  if (!dev) return 0;
  const configured = Number(env.LOCAL_SEED);
  return Number.isFinite(configured) ? configured : fallbackSeed;
}
