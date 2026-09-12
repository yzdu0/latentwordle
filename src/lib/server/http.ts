import type { GameErrorCode } from '$lib/game/types.ts';

export function statusFor(code: GameErrorCode): number {
  switch (code) {
    case 'no_puzzle':
      return 404;
    case 'action_limit':
    case 'game_over':
      return 409;
    case 'store_error':
    case 'internal':
      return 500;
    default:
      return 400;
  }
}
