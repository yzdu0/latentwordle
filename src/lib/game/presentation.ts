import type { Direction } from './types.ts';

export type Tone = 'good' | 'mid' | 'bad';

export function matchTone(match: number): Tone {
  return match >= 85 ? 'good' : match >= 60 ? 'mid' : 'bad';
}

export const TONE_EMOJI: Record<Tone, string> = {
  good: '🟩',
  mid: '🟨',
  bad: '🟥',
};

export function meterPosition(match: number, dir: Direction): number {
  const offset = (100 - Math.max(0, Math.min(100, match))) / 2;
  if (dir === 'over') return 50 + offset;
  if (dir === 'under') return 50 - offset;
  return 50;
}
