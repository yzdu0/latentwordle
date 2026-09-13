import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { MAX_ROUNDS } from '$lib/game/rules.ts';

const LOCAL_ROUNDS = 100;
const fallbackSeed = Math.floor(Math.random() * 1_000_000_000);

export function gameRounds(): number {
  return dev ? LOCAL_ROUNDS : MAX_ROUNDS;
}

export function dailySalt(): number {
  const configured = Number(dev ? env.LOCAL_SEED : env.DAILY_SEED);
  if (Number.isFinite(configured)) return configured;
  return dev ? fallbackSeed : 0;
}
