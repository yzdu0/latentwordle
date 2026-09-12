import type { ConceptDefinition } from '$lib/game/concepts.ts';
import type { Vocab } from './store.ts';

export interface ConceptProjection {
  /** Signed location on the axis: -1 is the negative pole and +1 is the positive pole. */
  score: number;
  /** The same location expressed from 0 at the negative pole to 1 at the positive pole. */
  position: number;
}

function rowToVector(vocab: Vocab, row: number): Float64Array {
  const vector = new Float64Array(vocab.dim);
  const base = row * vocab.dim;
  for (let dimension = 0; dimension < vocab.dim; dimension++) {
    vector[dimension] = vocab.bytes[base + dimension] / 127;
  }
  return vector;
}

function dot(a: Float64Array, b: Float64Array): number {
  let result = 0;
  for (let dimension = 0; dimension < a.length; dimension++) result += a[dimension] * b[dimension];
  return result;
}

function normalize(vector: Float64Array): Float64Array | null {
  const norm = Math.sqrt(dot(vector, vector));
  if (norm < 1e-9) return null;
  return Float64Array.from(vector, (value) => value / norm);
}

function mean(vectors: readonly Float64Array[], dim: number): Float64Array | null {
  if (vectors.length === 0) return null;
  const result = new Float64Array(dim);
  for (const vector of vectors) {
    for (let dimension = 0; dimension < dim; dimension++) result[dimension] += vector[dimension] / vectors.length;
  }
  return result;
}

function difference(positive: Float64Array, negative: Float64Array): Float64Array {
  return Float64Array.from(positive, (value, dimension) => value - negative[dimension]);
}

function rowsFor(vocab: Vocab, words: readonly string[]): number[] {
  return words.flatMap((word) => {
    const row = vocab.index.get(word);
    return row === undefined ? [] : [row];
  });
}

function buildAxis(vocab: Vocab, definition: ConceptDefinition): Float64Array | null {
  if (definition.method === 'paired-offsets') {
    const offsets = (definition.pairs ?? []).flatMap(([positive, negative]) => {
      const positiveRow = vocab.index.get(positive);
      const negativeRow = vocab.index.get(negative);
      if (positiveRow === undefined || negativeRow === undefined) return [];
      const offset = normalize(difference(rowToVector(vocab, positiveRow), rowToVector(vocab, negativeRow)));
      return offset ? [offset] : [];
    });
    const averageOffset = mean(offsets, vocab.dim);
    return averageOffset ? normalize(averageOffset) : null;
  }

  const positives = rowsFor(vocab, definition.positive.words).map((row) => rowToVector(vocab, row));
  const negatives = rowsFor(vocab, definition.negative.words).map((row) => rowToVector(vocab, row));
  const positiveCentroid = mean(positives, vocab.dim);
  const negativeCentroid = mean(negatives, vocab.dim);
  return positiveCentroid && negativeCentroid
    ? normalize(difference(positiveCentroid, negativeCentroid))
    : null;
}

export function projectConcept(
  vocab: Vocab,
  targetRow: number,
  definition: ConceptDefinition,
): ConceptProjection | null {
  const axis = buildAxis(vocab, definition);
  if (!axis) return null;

  const positiveRows = rowsFor(vocab, definition.positive.words);
  const negativeRows = rowsFor(vocab, definition.negative.words);
  if (positiveRows.length === 0 || negativeRows.length === 0) return null;

  const positiveProjection = positiveRows.reduce((sum, row) => sum + dot(rowToVector(vocab, row), axis), 0) / positiveRows.length;
  const negativeProjection = negativeRows.reduce((sum, row) => sum + dot(rowToVector(vocab, row), axis), 0) / negativeRows.length;
  const poleSpan = positiveProjection - negativeProjection;
  if (poleSpan < 1e-9) return null;

  const targetProjection = dot(rowToVector(vocab, targetRow), axis);
  const midpoint = (positiveProjection + negativeProjection) / 2;
  const score = Math.max(-1, Math.min(1, (2 * (targetProjection - midpoint)) / poleSpan));
  return {
    score: Math.round(score * 1000) / 1000,
    position: Math.round(((score + 1) / 2) * 1000) / 1000,
  };
}
