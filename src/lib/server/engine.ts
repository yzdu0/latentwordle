import {
  CLUE_SIM_CEILING,
  CLUE_SIM_FLOOR,
  CLUE_SIM_MARGIN,
  MIN_CLUE_SIM,
  VARIANT_SIM_MIN,
} from '$lib/game/config.ts';
import { stem } from '$lib/game/morphology.ts';
import { MAX_ROUNDS, MAX_TURNS, replay, roundEnded } from '$lib/game/rules.ts';
import type { GameError, GameRef, GameView, HistoryEntry, RoundSummary } from '$lib/game/types.ts';
import type { Store, Vocab } from './store.ts';

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

function isPrefixVariant(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.length - short.length <= 3 && long.startsWith(short);
}

export function isVariant(a: string, b: string): boolean {
  return isPrefixVariant(a, b) || stem(a) === stem(b);
}

function related(vocab: Vocab, a: number, b: number): boolean {
  return isPrefixVariant(vocab.words[a], vocab.words[b]) || vocab.stems[a] === vocab.stems[b];
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
    if (!vocab.hints[r]) continue;
    if (related(vocab, r, answerRow)) continue;
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
    if (!vocab.hints[r]) continue;
    if (related(vocab, r, answerRow)) continue;
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
  answers: string[],
  rawActions: unknown,
): Promise<EngineResult> {
  const vocab = await ctx.store.getVocab();
  const answerRows = answers.map((answer) => vocab.index.get(answer));
  if (answerRows.some((row) => row === undefined)) {
    return { ok: false, error: { error: 'store_error', detail: 'answer missing from vocabulary' } };
  }

  const matches = (guess: string, answer: string): boolean => {
    if (guess === answer) return true;
    const guessRow = vocab.index.get(guess);
    const answerRow = vocab.index.get(answer);
    if (guessRow === undefined || answerRow === undefined) return false;
    return related(vocab, guessRow, answerRow) && rowSimilarity(vocab, guessRow, answerRow) >= VARIANT_SIM_MIN;
  };

  const replayed = replay(rawActions, answers, { matches });
  if (!replayed.ok) return replayed;
  const state = replayed.state;

  const results: RoundSummary[] = [];
  let score = 0;

  for (const round of state.rounds) {
    let points = 0;
    for (const turn of round.turns) {
      const row = vocab.index.get(turn.word);
      if (row === undefined) {
        return { ok: false, error: { error: 'not_a_word', actionIndex: turn.actionIndex, detail: turn.word } };
      }
      points += Math.max(0, Math.round(rowSimilarity(vocab, row, answerRows[round.index]!) * 100));
    }
    const bonus = round.solved ? (MAX_TURNS - round.turns.length + 1) * 200 : 0;
    const summary: RoundSummary = {
      index: round.index,
      answer: answers[round.index],
      solved: round.solved,
      givenUp: round.givenUp,
      turnsUsed: round.turns.length,
      score: points + bonus,
    };
    results.push(summary);
    score += summary.score;
  }

  const round = state.current;
  const answerRow = answerRows[round.index]!;
  const history: HistoryEntry[] = [];
  let roundPoints = 0;
  for (const turn of round.turns) {
    const guessRow = vocab.index.get(turn.word);
    if (guessRow === undefined) {
      return { ok: false, error: { error: 'not_a_word', actionIndex: turn.actionIndex, detail: turn.word } };
    }
    const clue = nearestToDifference(vocab, guessRow, answerRow);
    const isWin = matches(turn.word, answers[round.index]);
    const similarity = isWin ? 1 : clue.similarity;
    roundPoints += Math.max(0, Math.round(similarity * 100));
    history.push({
      type: 'guess',
      turn: turn.turn,
      word: turn.word,
      similarity,
      clue: isWin ? answers[round.index] : clue.word,
      multiplier: isWin ? null : clue.multiplier,
      sumWord: isWin ? answers[round.index] : clue.sumWord,
      sumSimilarity: isWin ? 1 : clue.sumSimilarity,
    });
  }
  if (round.givenUp) history.push({ type: 'giveup', turn: round.turns.length });

  const ended = roundEnded(round);
  const bonus = round.solved ? (MAX_TURNS - round.turns.length + 1) * 200 : 0;
  const roundScore = roundPoints + bonus;
  if (ended) {
    results.push({
      index: round.index,
      answer: answers[round.index],
      solved: round.solved,
      givenUp: round.givenUp,
      turnsUsed: round.turns.length,
      score: roundScore,
    });
  }
  score += ended ? roundScore : roundPoints;

  return {
    ok: true,
    view: {
      game,
      maxTurns: MAX_TURNS,
      rounds: MAX_ROUNDS,
      round: round.index,
      turnsUsed: round.turns.length,
      finished: state.finished,
      roundEnded: ended,
      roundAnswer: ended ? answers[round.index] : null,
      history,
      results,
      score,
    },
  };
}
