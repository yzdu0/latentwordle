import {
  CLUE_SIM_CEILING,
  CLUE_SIM_FLOOR,
  CLUE_SIM_MARGIN,
  DUAL_HINT_MAX_SIM,
  DUAL_HINT_MIN_GAIN,
  MIN_CLUE_GUESS_SIM,
  MIN_CLUE_PROGRESS,
  MIN_CLUE_SIM,
  VARIANT_SIM_MIN,
} from '$lib/game/config.ts';
import { stem } from '$lib/game/morphology.ts';
import { contradictsAnswerPolarity } from '$lib/game/semantic-safety.ts';
import { conceptByKey } from '$lib/game/concepts.ts';
import { MAX_ROUNDS, MAX_TURNS, replay, roundEnded } from '$lib/game/rules.ts';
import type { GameError, GameRef, GameView, HistoryEntry, RoundSummary } from '$lib/game/types.ts';
import { projectConcept } from './concepts.ts';
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

export interface Decomposition {
  terms: { word: string; multiplier: number; similarity: number }[];
  similarity: number;
  similarityPercentile: number;
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

const DECOMPOSITION_SHORTLIST = 160;
const DECOMPOSITION_MIN_COMPONENT_SIM = 0.18;
const DECOMPOSITION_MAX_COMPONENT_SIM = 0.72;
const DECOMPOSITION_MAX_PAIR_SIM = 0.78;
const DECOMPOSITION_MIN_COEFFICIENT = 0.05;
const DECOMPOSITION_MAX_COEFFICIENT = 2.5;
const DECOMPOSITION_TRIPLE_MIN_GAIN = 0.05;

interface DecompositionCandidate {
  row: number;
  targetDot: number;
  norm2: number;
}

interface DecompositionFit {
  rows: number[];
  coefficients: number[];
  similarity: number;
}

function solveThree(matrix: number[][], values: number[]): number[] | null {
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let row = column + 1; row < 3; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-8) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const scale = augmented[column][column];
    for (let entry = column; entry < 4; entry++) augmented[column][entry] /= scale;
    for (let row = 0; row < 3; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let entry = column; entry < 4; entry++) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }
  return augmented.map((row) => row[3]);
}

/**
 * Express the hidden vector as a positive combination of two hint-safe words,
 * adding a third only when it materially improves the rounded playable fit.
 */
export function decomposeTarget(
  vocab: Vocab,
  answerRow: number,
  excludedRows: ReadonlySet<number> = new Set(),
): Decomposition | null {
  const dim = vocab.dim;
  const answerBase = answerRow * dim;
  let answerNorm2 = 0;
  for (let column = 0; column < dim; column++) {
    const value = vocab.bytes[answerBase + column] / 127;
    answerNorm2 += value * value;
  }

  const answerSimilarities = new Float32Array(vocab.words.length);
  const candidates: DecompositionCandidate[] = [];
  for (let row = 0; row < vocab.words.length; row++) {
    const base = row * dim;
    let targetDot = 0;
    let norm2 = 0;
    for (let column = 0; column < dim; column++) {
      const value = vocab.bytes[base + column] / 127;
      targetDot += value * (vocab.bytes[answerBase + column] / 127);
      norm2 += value * value;
    }
    answerSimilarities[row] = targetDot;
    if (
      row === answerRow ||
      excludedRows.has(row) ||
      !vocab.hints[row] ||
      related(vocab, row, answerRow) ||
      contradictsAnswerPolarity(vocab.words[answerRow], vocab.words[row]) ||
      targetDot < DECOMPOSITION_MIN_COMPONENT_SIM ||
      targetDot > DECOMPOSITION_MAX_COMPONENT_SIM
    ) {
      continue;
    }
    candidates.push({ row, targetDot, norm2 });
  }
  candidates.sort((left, right) => right.targetDot - left.targetDot || left.row - right.row);
  candidates.length = Math.min(candidates.length, DECOMPOSITION_SHORTLIST);
  if (candidates.length < 2) return null;

  const cross = new Map<string, number>();
  const rowDot = (left: number, right: number): number => {
    const key = left < right ? `${left}:${right}` : `${right}:${left}`;
    const cached = cross.get(key);
    if (cached !== undefined) return cached;
    let dot = 0;
    const leftBase = left * dim;
    const rightBase = right * dim;
    for (let column = 0; column < dim; column++) {
      dot += (vocab.bytes[leftBase + column] * vocab.bytes[rightBase + column]) / (127 * 127);
    }
    cross.set(key, dot);
    return dot;
  };

  const candidateByRow = new Map(candidates.map((candidate) => [candidate.row, candidate]));
  const evaluate = (rows: number[], rawCoefficients: number[]): DecompositionFit | null => {
    if (
      rawCoefficients.some(
        (coefficient) =>
          !Number.isFinite(coefficient) ||
          coefficient <= DECOMPOSITION_MIN_COEFFICIENT ||
          coefficient > DECOMPOSITION_MAX_COEFFICIENT,
      )
    ) {
      return null;
    }
    const coefficients = rawCoefficients.map((coefficient) => Math.max(0.1, Math.round(coefficient * 10) / 10));
    let targetDot = 0;
    let norm2 = 0;
    for (let left = 0; left < rows.length; left++) {
      const candidate = candidateByRow.get(rows[left])!;
      targetDot += coefficients[left] * candidate.targetDot;
      norm2 += coefficients[left] * coefficients[left] * candidate.norm2;
      for (let right = left + 1; right < rows.length; right++) {
        norm2 += 2 * coefficients[left] * coefficients[right] * rowDot(rows[left], rows[right]);
      }
    }
    if (norm2 <= 1e-9) return null;
    return { rows, coefficients, similarity: targetDot / Math.sqrt(norm2 * answerNorm2) };
  };

  const pairFits: DecompositionFit[] = [];
  for (let left = 0; left < candidates.length; left++) {
    const a = candidates[left];
    for (let right = left + 1; right < candidates.length; right++) {
      const b = candidates[right];
      if (related(vocab, a.row, b.row)) continue;
      const ab = rowDot(a.row, b.row);
      if (ab / Math.sqrt(a.norm2 * b.norm2) > DECOMPOSITION_MAX_PAIR_SIM) continue;
      const determinant = a.norm2 * b.norm2 - ab * ab;
      if (determinant <= 1e-8) continue;
      const fit = evaluate(
        [a.row, b.row],
        [
          (a.targetDot * b.norm2 - b.targetDot * ab) / determinant,
          (b.targetDot * a.norm2 - a.targetDot * ab) / determinant,
        ],
      );
      if (fit) pairFits.push(fit);
    }
  }
  pairFits.sort((left, right) => right.similarity - left.similarity);
  const bestPair = pairFits[0];
  if (!bestPair) return null;

  let bestTriple: DecompositionFit | null = null;
  for (const pair of pairFits.slice(0, 32)) {
    const [firstRow, secondRow] = pair.rows;
    const first = candidateByRow.get(firstRow)!;
    const second = candidateByRow.get(secondRow)!;
    const firstSecond = rowDot(firstRow, secondRow);
    for (const third of candidates) {
      if (pair.rows.includes(third.row)) continue;
      if (related(vocab, firstRow, third.row) || related(vocab, secondRow, third.row)) continue;
      const firstThird = rowDot(firstRow, third.row);
      const secondThird = rowDot(secondRow, third.row);
      if (
        firstThird / Math.sqrt(first.norm2 * third.norm2) > DECOMPOSITION_MAX_PAIR_SIM ||
        secondThird / Math.sqrt(second.norm2 * third.norm2) > DECOMPOSITION_MAX_PAIR_SIM
      ) {
        continue;
      }
      const coefficients = solveThree(
        [
          [first.norm2, firstSecond, firstThird],
          [firstSecond, second.norm2, secondThird],
          [firstThird, secondThird, third.norm2],
        ],
        [first.targetDot, second.targetDot, third.targetDot],
      );
      if (!coefficients) continue;
      const fit = evaluate([firstRow, secondRow, third.row], coefficients);
      if (fit && (!bestTriple || fit.similarity > bestTriple.similarity)) bestTriple = fit;
    }
  }

  const chosen =
    bestTriple && bestTriple.similarity >= bestPair.similarity + DECOMPOSITION_TRIPLE_MIN_GAIN
      ? bestTriple
      : bestPair;
  const similarity = Math.round(chosen.similarity * 1000) / 1000;
  return {
    terms: chosen.rows.map((row, index) => ({
      word: vocab.words[row],
      multiplier: chosen.coefficients[index],
      similarity: Math.round(answerSimilarities[row] * 1000) / 1000,
    })),
    similarity,
    similarityPercentile: percentile(answerSimilarities, similarity),
  };
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
    if (contradictsAnswerPolarity(vocab.words[answerRow], vocab.words[r])) continue;
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
  const fallbackCap = clueSimilarityCap(similarity);
  const progressFloor = Math.max(MIN_CLUE_SIM, similarity + MIN_CLUE_PROGRESS);
  const answerSimilarities = new Float32Array(vocab.words.length);

  let strict: Candidate | null = null;
  let relevant: Candidate | null = null;
  let relaxedStrict: Candidate | null = null;
  let relaxedRelevant: Candidate | null = null;
  for (let r = 0; r < vocab.words.length; r++) {
    const base = r * dim;
    let dot = 0;
    let simAnswer = 0;
    let simGuess = 0;
    let norm2 = 0;
    for (let j = 0; j < dim; j++) {
      const b = vocab.bytes[base + j];
      dot += delta[j] * b;
      simAnswer += target[j] * b;
      simGuess += guess[j] * b;
      norm2 += b * b;
    }
    const sim = simAnswer / 127;
    const guessSim = simGuess / 127;
    answerSimilarities[r] = sim;

    if (r === guessRow || r === answerRow || excludedRows.has(r)) continue;
    if (!vocab.hints[r]) continue;
    if (related(vocab, r, guessRow) || related(vocab, r, answerRow)) continue;
    if (contradictsAnswerPolarity(vocab.words[answerRow], vocab.words[r])) continue;
    if (sim > CLUE_SIM_CEILING) continue;

    const alpha = norm2 > 0 ? (dot * 127) / norm2 : 0;
    if (alpha <= 0.05) continue;
    const candidate = { row: r, alpha, score: norm2 > 0 ? (dot * dot) / norm2 : 0, dot, norm2 };
    const coherentWithGuess = guessSim >= MIN_CLUE_GUESS_SIM;
    if (sim >= MIN_CLUE_SIM && coherentWithGuess) {
      relevant = better({ ...candidate, score: sim }, relevant);
    } else if (sim >= MIN_CLUE_SIM && sim <= fallbackCap) {
      relaxedRelevant = better({ ...candidate, score: sim }, relaxedRelevant);
    }
    if (sim >= progressFloor && coherentWithGuess) {
      strict = better(candidate, strict);
    } else if (sim >= progressFloor && sim <= fallbackCap) {
      relaxedStrict = better(candidate, relaxedStrict);
    }
  }

  const similarityPercentile = percentile(answerSimilarities, similarity);
  const chosen = strict ?? relevant ?? relaxedStrict ?? relaxedRelevant;
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
  let relaxedPair: PairCandidate | null = null;
  const firstNorm2 = chosen.norm2 / (127 * 127);
  const firstDeltaDot = chosen.dot / 127;
  const singleFit = firstDeltaDot * chosen.alpha;
  for (let r = 0; r < vocab.words.length; r++) {
    if (r === guessRow || r === answerRow || r === chosen.row || excludedRows.has(r)) continue;
    if (!vocab.hints[r]) continue;
    if (contradictsAnswerPolarity(vocab.words[answerRow], vocab.words[r])) continue;
    const sim = answerSimilarities[r];
    if (sim < MIN_CLUE_SIM || sim > CLUE_SIM_CEILING) continue;
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
    let guessDotRaw = 0;
    for (let j = 0; j < dim; j++) {
      const secondByte = vocab.bytes[base + j];
      secondDeltaDotRaw += delta[j] * secondByte;
      secondNorm2Raw += secondByte * secondByte;
      crossRaw += vocab.bytes[firstBase + j] * secondByte;
      guessDotRaw += guess[j] * secondByte;
    }
    const coherentWithGuess = guessDotRaw / 127 >= MIN_CLUE_GUESS_SIM;
    if (!coherentWithGuess && sim > fallbackCap) continue;
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
    const currentPair = coherentWithGuess ? pair : relaxedPair;
    if (score <= singleFit || (currentPair && score <= currentPair.score)) continue;
    const candidatePair = { row: r, firstAlpha, secondAlpha, score };
    if (coherentWithGuess) pair = candidatePair;
    else relaxedPair = candidatePair;
  }

  pair ??= relaxedPair;
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
    let bestSimilarity = 0;
    for (const turn of round.turns) {
      if (turn.type === 'decomposition') continue;
      if (turn.concept) continue;
      const row = vocab.index.get(turn.word);
      if (row === undefined) {
        return { ok: false, error: { error: 'not_a_word', actionIndex: turn.actionIndex, detail: turn.word } };
      }
      const primarySimilarity = rowSimilarity(vocab, row, answerRows[round.index]!);
      bestSimilarity = Math.max(bestSimilarity, primarySimilarity);
      points += Math.max(0, Math.round(primarySimilarity * 100));
    }
    const bonus = round.solved ? (MAX_TURNS - round.turns.length + 1) * 200 : 0;
    const summary: RoundSummary = {
      index: round.index,
      answer: answers[round.index],
      solved: round.solved,
      givenUp: round.givenUp,
      turnsUsed: round.turns.length,
      score: points + bonus,
      bestSimilarity: round.solved ? 1 : Math.round(bestSimilarity * 1000) / 1000,
    };
    results.push(summary);
    score += summary.score;
  }

  const round = state.current;
  const answerRow = answerRows[round.index]!;
  const history: HistoryEntry[] = [];
  const usedRows = new Set<number>();
  let roundPoints = 0;
  let bestSimilarity = 0;
  for (const turn of round.turns) {
    if (turn.type === 'decomposition') {
      const decomposition = decomposeTarget(vocab, answerRow, usedRows);
      history.push({
        type: 'decomposition',
        turn: turn.turn,
        terms: decomposition?.terms ?? [],
        similarity: decomposition?.similarity ?? 0,
        similarityPercentile: decomposition?.similarityPercentile ?? 0,
      });
      for (const term of decomposition?.terms ?? []) {
        const row = vocab.index.get(term.word);
        if (row !== undefined) usedRows.add(row);
      }
      continue;
    }
    const guessRow = vocab.index.get(turn.word);
    if (guessRow === undefined) {
      return { ok: false, error: { error: 'not_a_word', actionIndex: turn.actionIndex, detail: turn.word } };
    }
    const concept = turn.concept ?? null;
    const conceptDefinition = concept ? conceptByKey(concept) : null;
    const conceptProjection = conceptDefinition ? projectConcept(vocab, answerRow, conceptDefinition) : null;
    if (!concept) usedRows.add(guessRow);
    const clue = concept ? null : nearestToDifference(vocab, guessRow, answerRow, usedRows);
    const isWin = !concept && matches(turn.word, answers[round.index]);
    const primarySimilarity = isWin ? 1 : rowSimilarity(vocab, guessRow, answerRow);
    const similarity = Math.round(primarySimilarity * 1000) / 1000;
    if (!concept) {
      bestSimilarity = Math.max(bestSimilarity, similarity);
      roundPoints += Math.max(0, Math.round(similarity * 100));
    }
    history.push({
      type: 'guess',
      turn: turn.turn,
      word: turn.word,
      similarity,
      similarityPercentile: isWin ? 1 : (clue?.similarityPercentile ?? 0),
      clue: concept ? '' : isWin ? answers[round.index] : (clue?.word ?? ''),
      multiplier: concept || isWin ? null : (clue?.multiplier ?? null),
      clueSimilarity: concept ? 0 : isWin ? 1 : (clue?.clueSimilarity ?? 0),
      concept,
      conceptScore: conceptProjection?.score ?? null,
      conceptPosition: conceptProjection?.position ?? null,
      conceptPositiveLabel: conceptDefinition?.positive.label ?? null,
      conceptNegativeLabel: conceptDefinition?.negative.label ?? null,
      secondClue: concept || isWin ? null : (clue?.secondWord ?? null),
      secondMultiplier: concept || isWin ? null : (clue?.secondMultiplier ?? null),
      secondClueSimilarity: concept || isWin ? null : (clue?.secondSimilarity ?? null),
      sumWord: concept ? '' : isWin ? answers[round.index] : (clue?.sumWord ?? ''),
      sumSimilarity: concept ? 0 : isWin ? 1 : (clue?.sumSimilarity ?? similarity),
      sumPercentile: concept ? 0 : isWin ? 1 : (clue?.sumPercentile ?? 0),
      suggestion: concept ? '' : isWin ? answers[round.index] : (clue?.suggestion ?? ''),
      suggestionSimilarity: concept ? 0 : isWin ? 1 : (clue?.suggestionSimilarity ?? similarity),
      suggestionPercentile: concept ? 0 : isWin ? 1 : (clue?.suggestionPercentile ?? 0),
    });
    const clueRow = clue ? vocab.index.get(clue.word) : undefined;
    const secondClueRow = clue?.secondWord ? vocab.index.get(clue.secondWord) : undefined;
    const sumRow = clue ? vocab.index.get(clue.sumWord) : undefined;
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
      bestSimilarity: round.solved ? 1 : Math.round(bestSimilarity * 1000) / 1000,
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
