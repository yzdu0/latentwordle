import {
  CLUE_SIM_CEILING,
  CLUE_SIM_FLOOR,
  CLUE_SIM_MARGIN,
  DUAL_HINT_MAX_SIM,
  DUAL_HINT_MIN_GAIN,
  MIN_CLUE_PROGRESS,
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
  secondWord: string | null;
  secondMultiplier: number | null;
  secondSimilarity: number | null;
  clueSimilarity: number;
  similarity: number;
  similarityPercentile: number;
  sumWord: string;
  sumSimilarity: number;
  sumPercentile: number;
  suggestion: string;
  suggestionSimilarity: number;
  suggestionPercentile: number;
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

function percentile(values: Float32Array, value: number): number {
  let atOrBelow = 0;
  for (const candidate of values) if (candidate <= value) atOrBelow++;
  return Math.round((atOrBelow / values.length) * 1000) / 1000;
}

interface Candidate {
  row: number;
  alpha: number;
  score: number;
  dot: number;
  norm2: number;
}

function better(candidate: Candidate, current: Candidate | null): Candidate {
  if (!current || candidate.score > current.score) return candidate;
  if (candidate.score === current.score && candidate.alpha > current.alpha) return candidate;
  return current;
}

interface Landing {
  row: number;
  word: string;
  similarity: number;
  percentile: number;
}

function nearestLanding(
  vocab: Vocab,
  sum: Float32Array,
  answerSimilarities: Float32Array,
  guessRow: number,
  answerRow: number,
  excludedRows: ReadonlySet<number>,
  componentRows: ReadonlySet<number> = new Set(),
): Landing | null {
  let best: { row: number; dot: number } | null = null;
  for (let r = 0; r < vocab.words.length; r++) {
    if (r === guessRow || r === answerRow || excludedRows.has(r) || componentRows.has(r)) continue;
    if (!vocab.hints[r] || answerSimilarities[r] > CLUE_SIM_CEILING) continue;
    if (related(vocab, r, guessRow) || related(vocab, r, answerRow)) continue;
    let componentVariant = false;
    for (const componentRow of componentRows) {
      if (related(vocab, r, componentRow)) {
        componentVariant = true;
        break;
      }
    }
    if (componentVariant) continue;
    const base = r * vocab.dim;
    let dot = 0;
    for (let j = 0; j < vocab.dim; j++) dot += sum[j] * vocab.bytes[base + j];
    if (!best || dot > best.dot) best = { row: r, dot };
  }
  if (!best) return null;
  const similarity = Math.round(answerSimilarities[best.row] * 1000) / 1000;
  return {
    row: best.row,
    word: vocab.words[best.row],
    similarity,
    percentile: percentile(answerSimilarities, similarity),
  };
}

export function nearestToDifference(
  vocab: Vocab,
  guessRow: number,
  answerRow: number,
  excludedRows: ReadonlySet<number> = new Set(),
): Clue {
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
  const progressFloor = Math.max(MIN_CLUE_SIM, similarity + MIN_CLUE_PROGRESS);
  const answerSimilarities = new Float32Array(vocab.words.length);

  let strict: Candidate | null = null;
  let relevant: Candidate | null = null;
  for (let r = 0; r < vocab.words.length; r++) {
    const base = r * dim;
    let dot = 0;
    let simAnswer = 0;
    let norm2 = 0;
    for (let j = 0; j < dim; j++) {
      const b = vocab.bytes[base + j];
      dot += delta[j] * b;
      simAnswer += target[j] * b;
      norm2 += b * b;
    }
    const sim = simAnswer / 127;
    answerSimilarities[r] = sim;

    if (r === guessRow || r === answerRow || excludedRows.has(r)) continue;
    if (!vocab.hints[r]) continue;
    if (related(vocab, r, guessRow) || related(vocab, r, answerRow)) continue;

    const alpha = norm2 > 0 ? (dot * 127) / norm2 : 0;
    if (alpha <= 0.05) continue;
    const candidate = { row: r, alpha, score: norm2 > 0 ? (dot * dot) / norm2 : 0, dot, norm2 };
    if (sim >= MIN_CLUE_SIM && sim <= cap) {
      relevant = better({ ...candidate, score: sim }, relevant);
    }
    if (sim >= progressFloor && sim <= cap) strict = better(candidate, strict);
  }

  const similarityPercentile = percentile(answerSimilarities, similarity);
  const chosen = strict ?? relevant;
  if (!chosen) {
    return {
      word: '',
      multiplier: null,
      secondWord: null,
      secondMultiplier: null,
      secondSimilarity: null,
      clueSimilarity: 0,
      similarity,
      similarityPercentile,
      sumWord: '',
      sumSimilarity: similarity,
      sumPercentile: similarityPercentile,
      suggestion: '',
      suggestionSimilarity: similarity,
      suggestionPercentile: similarityPercentile,
    };
  }

  const multiplier = Math.max(0.1, Math.round(chosen.alpha * 10) / 10);
  const clueWord = vocab.words[chosen.row];
  const clueFloats = rowToFloats(vocab, chosen.row);
  const singleSum = new Float32Array(dim);
  for (let j = 0; j < dim; j++) singleSum[j] = guess[j] + multiplier * clueFloats[j];
  const singleLanding = nearestLanding(
    vocab,
    singleSum,
    answerSimilarities,
    guessRow,
    answerRow,
    excludedRows,
  );
  const clueSimilarity = Math.round(answerSimilarities[chosen.row] * 1000) / 1000;
  const singleSumWord = singleLanding?.word ?? '';
  const singleSumSimilarity = singleLanding?.similarity ?? similarity;
  const singleSumPercentile = singleLanding?.percentile ?? similarityPercentile;
  const singleSuggestionCandidate = clueSimilarity >= singleSumSimilarity ? clueWord : singleSumWord;
  const singleSuggestionSimilarity = Math.max(clueSimilarity, singleSumSimilarity);
  const singleSuggestionPercentile = percentile(answerSimilarities, singleSuggestionSimilarity);
  const singleSuggestion =
    singleSuggestionSimilarity >= similarity + MIN_CLUE_PROGRESS ? singleSuggestionCandidate : '';

  interface PairCandidate {
    row: number;
    firstAlpha: number;
    secondAlpha: number;
    score: number;
  }

  let pair: PairCandidate | null = null;
  const firstNorm2 = chosen.norm2 / (127 * 127);
  const firstDeltaDot = chosen.dot / 127;
  const singleFit = firstDeltaDot * chosen.alpha;
  for (let r = 0; r < vocab.words.length; r++) {
    if (r === guessRow || r === answerRow || r === chosen.row || excludedRows.has(r)) continue;
    if (!vocab.hints[r]) continue;
    const sim = answerSimilarities[r];
    if (sim < MIN_CLUE_SIM || sim > cap) continue;
    if (
      related(vocab, r, guessRow) ||
      related(vocab, r, answerRow) ||
      related(vocab, r, chosen.row)
    ) {
      continue;
    }

    const base = r * dim;
    const firstBase = chosen.row * dim;
    let secondDeltaDotRaw = 0;
    let secondNorm2Raw = 0;
    let crossRaw = 0;
    for (let j = 0; j < dim; j++) {
      const secondByte = vocab.bytes[base + j];
      secondDeltaDotRaw += delta[j] * secondByte;
      secondNorm2Raw += secondByte * secondByte;
      crossRaw += vocab.bytes[firstBase + j] * secondByte;
    }
    const secondNorm2 = secondNorm2Raw / (127 * 127);
    const cross = crossRaw / (127 * 127);
    const distinctSimilarity = cross / Math.sqrt(firstNorm2 * secondNorm2);
    if (distinctSimilarity > DUAL_HINT_MAX_SIM) continue;

    const secondDeltaDot = secondDeltaDotRaw / 127;
    const determinant = firstNorm2 * secondNorm2 - cross * cross;
    if (determinant <= 1e-6) continue;
    const firstAlpha =
      (firstDeltaDot * secondNorm2 - secondDeltaDot * cross) / determinant;
    const secondAlpha =
      (secondDeltaDot * firstNorm2 - firstDeltaDot * cross) / determinant;
    if (firstAlpha <= 0.05 || secondAlpha <= 0.05 || firstAlpha > 2 || secondAlpha > 2) continue;

    const score = firstAlpha * firstDeltaDot + secondAlpha * secondDeltaDot;
    if (score <= singleFit || (pair && score <= pair.score)) continue;
    pair = { row: r, firstAlpha, secondAlpha, score };
  }

  if (pair) {
    const firstMultiplier = Math.max(0.1, Math.round(pair.firstAlpha * 10) / 10);
    const secondMultiplier = Math.max(0.1, Math.round(pair.secondAlpha * 10) / 10);
    const secondFloats = rowToFloats(vocab, pair.row);
    const pairSum = new Float32Array(dim);
    for (let j = 0; j < dim; j++) {
      pairSum[j] =
        guess[j] + firstMultiplier * clueFloats[j] + secondMultiplier * secondFloats[j];
    }
    const pairLanding = nearestLanding(
      vocab,
      pairSum,
      answerSimilarities,
      guessRow,
      answerRow,
      excludedRows,
      new Set([chosen.row, pair.row]),
    );
    const currentBestSimilarity = Math.max(similarity, singleSuggestionSimilarity);
    if (pairLanding && pairLanding.similarity >= currentBestSimilarity + DUAL_HINT_MIN_GAIN) {
      return {
        word: clueWord,
        multiplier: firstMultiplier,
        secondWord: vocab.words[pair.row],
        secondMultiplier,
        secondSimilarity: Math.round(answerSimilarities[pair.row] * 1000) / 1000,
        clueSimilarity,
        similarity,
        similarityPercentile,
        sumWord: pairLanding.word,
        sumSimilarity: pairLanding.similarity,
        sumPercentile: pairLanding.percentile,
        suggestion: pairLanding.word,
        suggestionSimilarity: pairLanding.similarity,
        suggestionPercentile: pairLanding.percentile,
      };
    }
  }

  return {
    word: clueWord,
    multiplier,
    secondWord: null,
    secondMultiplier: null,
    secondSimilarity: null,
    clueSimilarity,
    similarity,
    similarityPercentile,
    sumWord: singleSumWord,
    sumSimilarity: singleSumSimilarity,
    sumPercentile: singleSumPercentile,
    suggestion: singleSuggestion,
    suggestionSimilarity: singleSuggestionSimilarity,
    suggestionPercentile: singleSuggestionPercentile,
  };
}

export async function computeView(
  ctx: EngineContext,
  game: GameRef,
  answers: string[],
  rawActions: unknown,
  rounds = MAX_ROUNDS,
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

  const replayed = replay(rawActions, answers, { matches, rounds });
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
      const primarySimilarity = rowSimilarity(vocab, row, answerRows[round.index]!);
      const comparisonSimilarities = (turn.alternatives ?? [])
        .map((word) => vocab.index.get(word))
        .filter((comparisonRow): comparisonRow is number => comparisonRow !== undefined)
        .map((comparisonRow) => rowSimilarity(vocab, comparisonRow, answerRows[round.index]!));
      points += Math.max(0, Math.round(Math.max(primarySimilarity, ...comparisonSimilarities) * 100));
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
  const usedRows = new Set<number>();
  let roundPoints = 0;
  for (const turn of round.turns) {
    const guessRow = vocab.index.get(turn.word);
    if (guessRow === undefined) {
      return { ok: false, error: { error: 'not_a_word', actionIndex: turn.actionIndex, detail: turn.word } };
    }
    const comparisonWords = turn.alternatives ?? [];
    const comparisonWord = comparisonWords[0] ?? null;
    const comparisonRows = comparisonWords.map((word) => vocab.index.get(word));
    const missingComparison = comparisonRows.findIndex((row) => row === undefined);
    if (missingComparison !== -1) {
      return { ok: false, error: { error: 'not_a_word', actionIndex: turn.actionIndex, detail: comparisonWords[missingComparison] } };
    }
    usedRows.add(guessRow);
    for (const comparisonRow of comparisonRows) {
      if (comparisonRow !== undefined) usedRows.add(comparisonRow);
    }
    const clue = nearestToDifference(vocab, guessRow, answerRow, usedRows);
    const isWin = matches(turn.word, answers[round.index]) || Boolean(turn.alternatives?.some((candidate) => matches(candidate, answers[round.index])));
    const primarySimilarity = isWin && matches(turn.word, answers[round.index]) ? 1 : rowSimilarity(vocab, guessRow, answerRow);
    const comparisonSimilarities = comparisonRows.map((comparisonRow) => {
      const word = vocab.words[comparisonRow!];
      return isWin && matches(word, answers[round.index]) ? 1 : Math.round(rowSimilarity(vocab, comparisonRow!, answerRow) * 1000) / 1000;
    });
    const comparisonSimilarity = comparisonSimilarities[0] ?? null;
    const similarity = Math.round(primarySimilarity * 1000) / 1000;
    const concept = turn.concept ?? null;
    roundPoints += Math.max(0, Math.round(Math.max(similarity, ...comparisonSimilarities, -1) * 100));
    history.push({
      type: 'guess',
      turn: turn.turn,
      word: turn.word,
      similarity,
      similarityPercentile: isWin ? 1 : clue.similarityPercentile,
      clue: concept ? '' : isWin ? answers[round.index] : clue.word,
      multiplier: concept ? null : isWin ? null : clue.multiplier,
      clueSimilarity: concept ? 0 : isWin ? 1 : clue.clueSimilarity,
      concept,
      comparisonWords,
      comparisonSimilarities,
      comparisonWord,
      comparisonSimilarity,
      secondClue: concept ? null : isWin ? null : clue.secondWord,
      secondMultiplier: concept ? null : isWin ? null : clue.secondMultiplier,
      secondClueSimilarity: concept ? null : isWin ? null : clue.secondSimilarity,
      sumWord: concept ? '' : isWin ? answers[round.index] : clue.sumWord,
      sumSimilarity: concept ? 0 : isWin ? 1 : clue.sumSimilarity,
      sumPercentile: concept ? 0 : isWin ? 1 : clue.sumPercentile,
      suggestion: concept ? '' : isWin ? answers[round.index] : clue.suggestion,
      suggestionSimilarity: concept ? 0 : isWin ? 1 : clue.suggestionSimilarity,
      suggestionPercentile: concept ? 0 : isWin ? 1 : clue.suggestionPercentile,
    });
    const clueRow = vocab.index.get(clue.word);
    const secondClueRow = clue.secondWord ? vocab.index.get(clue.secondWord) : undefined;
    const sumRow = vocab.index.get(clue.sumWord);
    if (clueRow !== undefined) usedRows.add(clueRow);
    if (secondClueRow !== undefined) usedRows.add(secondClueRow);
    if (sumRow !== undefined) usedRows.add(sumRow);
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
      rounds,
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
