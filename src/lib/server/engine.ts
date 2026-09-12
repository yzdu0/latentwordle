import {
  CLUE_SIM_CEILING,
  CLUE_SIM_FLOOR,
  CLUE_SIM_MARGIN,
  MIN_CLUE_SIM,
} from '$lib/game/config.ts';
import { MAX_TURNS, replay } from '$lib/game/rules.ts';
import type { GameError, GameRef, GameView, HistoryEntry } from '$lib/game/types.ts';
import type { Puzzle, Store, Vocab } from './store.ts';

export interface EngineContext {
  store: Store;
}

export interface Clue {
  word: string;
  multiplier: number | null;
  similarity: number;
  sumWord: string;
  sumSimilarity: number;
}

export type EngineResult = { ok: true; view: GameView } | { ok: false; error: GameError };

export function clueSimilarityCap(similarity: number): number {
  return Math.min(CLUE_SIM_CEILING, Math.max(CLUE_SIM_FLOOR, similarity + CLUE_SIM_MARGIN));
}

export function isVariant(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.length - short.length <= 3 && long.startsWith(short);
}

function rowToFloats(vocab: Vocab, row: number): Float32Array {
  const out = new Float32Array(vocab.dim);
  const base = row * vocab.dim;
  for (let j = 0; j < vocab.dim; j++) {
    const b = vocab.bytes[base + j];
    out[j] = (b > 127 ? b - 256 : b) / 127;
  }
  return out;
}

function rowSimilarity(vocab: Vocab, a: number, b: number): number {
  const dim = vocab.dim;
  const aBase = a * dim;
  const bBase = b * dim;
  let dot = 0;
  for (let j = 0; j < dim; j++) dot += vocab.bytes[aBase + j] * vocab.bytes[bBase + j];
  return dot / (127 * 127);
}

export function nearestToDifference(vocab: Vocab, guessRow: number, answerRow: number): Clue {
  const dim = vocab.dim;
  const answer = vocab.words[answerRow];
  const guess = rowToFloats(vocab, guessRow);
  const target = rowToFloats(vocab, answerRow);
  const delta = new Float32Array(dim);
  let similarity = 0;
  for (let j = 0; j < dim; j++) {
    delta[j] = target[j] - guess[j];
    similarity += guess[j] * target[j];
  }
  similarity = Math.round(similarity * 1000) / 1000;
  const cap = clueSimilarityCap(similarity);

  let strict: { row: number; alpha: number } | null = null;
  let relaxed: { row: number; alpha: number } | null = null;
  for (let r = 0; r < vocab.words.length; r++) {
    if (r === guessRow || r === answerRow) continue;
    if (isVariant(vocab.words[r], answer)) continue;
    const base = r * dim;
    let alpha = 0;
    let simAnswer = 0;
    for (let j = 0; j < dim; j++) {
      const b = vocab.bytes[base + j];
      alpha += delta[j] * b;
      simAnswer += target[j] * b;
    }
    alpha /= 127;
    const sim = simAnswer / 127;

    if (!relaxed || alpha > relaxed.alpha) relaxed = { row: r, alpha };
    if (sim >= MIN_CLUE_SIM && sim <= cap && (!strict || alpha > strict.alpha)) {
      strict = { row: r, alpha };
    }
  }

  const chosen = strict ?? relaxed;
  if (!chosen) return { word: '', multiplier: null, similarity, sumWord: '', sumSimilarity: 0 };

  const rounded = Math.round(chosen.alpha * 10) / 10;
  const multiplier =
    chosen.alpha > 0.05 && rounded < 1 ? Math.max(0.1, Math.round(rounded * 10) / 10) : null;
  const clueWord = vocab.words[chosen.row];

  const clueFloats = rowToFloats(vocab, chosen.row);
  const sum = new Float32Array(dim);
  for (let j = 0; j < dim; j++) sum[j] = guess[j] + chosen.alpha * clueFloats[j];

  let bestSum: { row: number; dot: number } | null = null;
  for (let r = 0; r < vocab.words.length; r++) {
    if (r === guessRow || r === answerRow) continue;
    if (isVariant(vocab.words[r], answer)) continue;
    const base = r * dim;
    let dot = 0;
    for (let j = 0; j < dim; j++) dot += sum[j] * vocab.bytes[base + j];
    if (!bestSum || dot > bestSum.dot) bestSum = { row: r, dot };
  }

  const sumWord = bestSum ? vocab.words[bestSum.row] : '';
  const sumSimilarity = bestSum
    ? Math.round(rowSimilarity(vocab, bestSum.row, answerRow) * 1000) / 1000
    : 0;

  return { word: clueWord, multiplier, similarity, sumWord, sumSimilarity };
}

export async function computeView(
  ctx: EngineContext,
  game: GameRef,
  puzzle: Puzzle,
  rawActions: unknown,
): Promise<EngineResult> {
  const replayed = replay(rawActions, puzzle.answer);
  if (!replayed.ok) return replayed;
  const state = replayed.state;

  const vocab = await ctx.store.getVocab();
  const answerRow = vocab.index.get(puzzle.answer);
  if (answerRow === undefined) {
    return { ok: false, error: { error: 'store_error', detail: 'answer missing from vocabulary' } };
  }

  const history: HistoryEntry[] = [];
  for (let i = 0; i < state.timeline.length; i++) {
    const action = state.timeline[i];
    if (action.type === 'giveup') {
      history.push({ type: 'giveup', turn: state.turnsUsed });
      continue;
    }
    const guessRow = vocab.index.get(action.word);
    if (guessRow === undefined) {
      return { ok: false, error: { error: 'not_a_word', actionIndex: i, detail: action.word } };
    }
    const clue = nearestToDifference(vocab, guessRow, answerRow);
    const isWin = action.word === puzzle.answer;
    history.push({
      type: 'guess',
      turn: action.turn,
      word: action.word,
      similarity: isWin ? 1 : clue.similarity,
      clue: isWin ? puzzle.answer : clue.word,
      multiplier: isWin ? null : clue.multiplier,
      sumWord: isWin ? puzzle.answer : clue.sumWord,
      sumSimilarity: isWin ? 1 : clue.sumSimilarity,
    });
  }

  let score = 0;
  for (const entry of history) {
    if (entry.type === 'guess') score += Math.max(0, Math.round(entry.similarity * 100));
  }
  if (state.solved) score += (MAX_TURNS - state.turnsUsed + 1) * 200;

  return {
    ok: true,
    view: {
      game,
      maxTurns: MAX_TURNS,
      turnsUsed: state.turnsUsed,
      history,
      solved: state.solved,
      revealed: state.revealed,
      givenUp: state.givenUp,
      score,
      answer: state.solved || state.revealed ? puzzle.answer : null,
    },
  };
}
