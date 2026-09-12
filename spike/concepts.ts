import fs from 'node:fs';
import path from 'node:path';

interface ConceptSpec {
  label: string;
  pairs: readonly (readonly [string, string])[];
  poleWords?: {
    positive: readonly string[];
    negative: readonly string[];
  };
  positiveTests: readonly string[];
  negativeTests: readonly string[];
}

const ROOT = path.resolve(import.meta.dirname, '..');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache/dev/index.json'), 'utf8')) as {
  dim: number;
  words: string[];
};
const vectorBytes = fs.readFileSync(path.join(ROOT, '.cache/dev/vectors.bin'));
const bytes = new Int8Array(vectorBytes.buffer, vectorBytes.byteOffset, vectorBytes.byteLength);
const rowByWord = new Map(index.words.map((word, row) => [word, row]));

const concepts: readonly ConceptSpec[] = [
  {
    label: 'abstraction',
    pairs: [
      ['abstract', 'tangible'],
      ['conceptual', 'physical'],
      ['theoretical', 'practical'],
      ['intangible', 'material'],
      ['idea', 'object'],
      ['symbolic', 'literal'],
    ],
    poleWords: {
      positive: ['idea', 'justice', 'freedom', 'belief', 'theory', 'knowledge', 'meaning', 'principle', 'concept', 'faith', 'hope', 'purpose', 'responsibility', 'democracy', 'possibility', 'reputation', 'existence', 'tradition', 'honor', 'value', 'risk', 'chance', 'experience', 'concern', 'commitment', 'reality', 'doubt', 'desire', 'intention', 'soul'],
      negative: ['house', 'cup', 'water', 'building', 'television', 'book', 'food', 'car', 'island', 'road', 'river', 'village', 'key', 'radio', 'body', 'hospital', 'gold', 'hand', 'airport', 'room', 'computer', 'wall', 'ball', 'rock', 'plant', 'phone', 'paper', 'train', 'beach', 'blood'],
    },
    positiveTests: ['theory', 'justice', 'freedom', 'belief', 'logic', 'philosophy', 'democracy', 'meaning', 'principle', 'knowledge'],
    negativeTests: ['apple', 'chair', 'table', 'stone', 'car', 'dog', 'bottle', 'house', 'tree', 'hammer'],
  },
  {
    label: 'emotion',
    pairs: [
      ['emotional', 'neutral'],
      ['passionate', 'indifferent'],
      ['expressive', 'reserved'],
      ['sentimental', 'objective'],
      ['excited', 'unmoved'],
    ],
    poleWords: {
      positive: ['happy', 'sad', 'angry', 'afraid', 'emotional', 'passionate', 'excited', 'joy', 'fear', 'anger', 'sadness', 'happiness', 'grief', 'anxiety', 'love', 'hatred', 'delight', 'rage', 'sorrow', 'terrified'],
      negative: ['neutral', 'indifferent', 'objective', 'factual', 'technical', 'ordinary', 'calm', 'reserved', 'unmoved', 'clinical', 'table', 'number', 'road', 'document', 'machine', 'building', 'water', 'metal', 'software', 'vehicle'],
    },
    positiveTests: ['emotion', 'feeling', 'feelings', 'despair', 'pleasure', 'agony', 'excitement', 'envy', 'guilt', 'shame', 'panic'],
    negativeTests: ['method', 'system', 'process', 'object', 'law', 'information', 'technology', 'equipment', 'floor', 'river'],
  },
  {
    label: 'motion',
    pairs: [
      ['moving', 'stationary'],
      ['dynamic', 'static'],
      ['active', 'idle'],
      ['running', 'still'],
      ['mobile', 'fixed'],
    ],
    positiveTests: ['run', 'walk', 'drive', 'fly', 'dance', 'travel', 'jump', 'move', 'swim', 'falling'],
    negativeTests: ['resting', 'motionless', 'stable', 'stopped', 'immobile', 'inactive', 'steady', 'unchanged'],
  },
  {
    label: 'plurality',
    pairs: [
      ['cats', 'cat'],
      ['dogs', 'dog'],
      ['houses', 'house'],
      ['books', 'book'],
      ['trees', 'tree'],
      ['cars', 'car'],
      ['years', 'year'],
      ['players', 'player'],
      ['groups', 'group'],
      ['companies', 'company'],
      ['members', 'member'],
      ['teams', 'team'],
      ['plans', 'plan'],
      ['votes', 'vote'],
      ['songs', 'song'],
      ['roads', 'road'],
      ['rivers', 'river'],
      ['rooms', 'room'],
      ['systems', 'system'],
      ['markets', 'market'],
    ],
    positiveTests: ['birds', 'workers', 'schools', 'games', 'cities', 'friends', 'days', 'countries', 'students', 'words'],
    negativeTests: ['bird', 'worker', 'school', 'game', 'city', 'friend', 'day', 'country', 'student', 'word'],
  },
  {
    label: 'relation',
    pairs: [
      ['connected', 'isolated'],
      ['together', 'apart'],
      ['related', 'unrelated'],
      ['attached', 'detached'],
      ['social', 'solitary'],
    ],
    positiveTests: ['relationship', 'connection', 'association', 'community', 'cooperation', 'linked', 'shared', 'collective', 'partnership', 'network'],
    negativeTests: ['isolation', 'alone', 'separate', 'independent', 'remote', 'lonely', 'individual', 'disconnected', 'autonomous', 'private'],
  },
];

function vector(word: string): Float64Array | null {
  const row = rowByWord.get(word);
  if (row === undefined) return null;
  const result = new Float64Array(index.dim);
  const base = row * index.dim;
  for (let dimension = 0; dimension < index.dim; dimension++) result[dimension] = bytes[base + dimension] / 127;
  return result;
}

function dot(a: Float64Array, b: Float64Array): number {
  let result = 0;
  for (let i = 0; i < a.length; i++) result += a[i] * b[i];
  return result;
}

function normalized(input: Float64Array): Float64Array {
  const norm = Math.sqrt(dot(input, input));
  return Float64Array.from(input, (value) => value / norm);
}

function mean(vectors: readonly Float64Array[]): Float64Array {
  const result = new Float64Array(index.dim);
  for (const value of vectors) for (let i = 0; i < result.length; i++) result[i] += value[i] / vectors.length;
  return result;
}

function difference(positive: Float64Array, negative: Float64Array): Float64Array {
  return Float64Array.from(positive, (value, i) => value - negative[i]);
}

function auc(positives: readonly number[], negatives: readonly number[]): number {
  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) wins += positive > negative ? 1 : positive === negative ? 0.5 : 0;
  }
  return wins / (positives.length * negatives.length);
}

for (const concept of concepts) {
  const pairs = concept.pairs.flatMap(([positive, negative]) => {
    const positiveVector = vector(positive);
    const negativeVector = vector(negative);
    if (!positiveVector || !negativeVector) {
      console.error(`missing ${concept.label} pair: ${positive}/${negative}`);
      return [];
    }
    return [{ positive, negative, positiveVector, negativeVector }];
  });
  const positiveAnchors = pairs.map((pair) => pair.positiveVector);
  const negativeAnchors = pairs.map((pair) => pair.negativeVector);
  const centroidAxis = normalized(difference(mean(positiveAnchors), mean(negativeAnchors)));
  const pairAxis = normalized(mean(pairs.map((pair) => normalized(difference(pair.positiveVector, pair.negativeVector)))));

  const tests = (words: readonly string[], axis: Float64Array) => words.flatMap((word) => {
    const value = vector(word);
    return value ? [{ word, score: dot(value, axis) }] : [];
  });
  const centroidPositive = tests(concept.positiveTests, centroidAxis);
  const centroidNegative = tests(concept.negativeTests, centroidAxis);
  const pairPositive = tests(concept.positiveTests, pairAxis);
  const pairNegative = tests(concept.negativeTests, pairAxis);
  const naivePositive = concept.positiveTests.flatMap((word) => {
    const value = vector(word);
    return value ? [{ word, score: dot(value, positiveAnchors[0]) - dot(value, negativeAnchors[0]) }] : [];
  });
  const naiveNegative = concept.negativeTests.flatMap((word) => {
    const value = vector(word);
    return value ? [{ word, score: dot(value, positiveAnchors[0]) - dot(value, negativeAnchors[0]) }] : [];
  });

  const pairCosines: number[] = [];
  const normalizedOffsets = pairs.map((pair) => normalized(difference(pair.positiveVector, pair.negativeVector)));
  for (let i = 0; i < normalizedOffsets.length; i++) {
    for (let j = i + 1; j < normalizedOffsets.length; j++) pairCosines.push(dot(normalizedOffsets[i], normalizedOffsets[j]));
  }
  const coherence = pairCosines.reduce((sum, value) => sum + value, 0) / pairCosines.length;
  console.log(`\n${concept.label} (${pairs.length}/${concept.pairs.length} pairs, coherence ${coherence.toFixed(3)})`);
  console.log(`  naive AUC ${(auc(naivePositive.map((entry) => entry.score), naiveNegative.map((entry) => entry.score)) * 100).toFixed(0)}%`);
  console.log(`  centroid AUC ${(auc(centroidPositive.map((entry) => entry.score), centroidNegative.map((entry) => entry.score)) * 100).toFixed(0)}%`);
  console.log(`  paired AUC ${(auc(pairPositive.map((entry) => entry.score), pairNegative.map((entry) => entry.score)) * 100).toFixed(0)}%`);
  if (concept.poleWords) {
    const positives = concept.poleWords.positive.flatMap((word) => vector(word) ?? []);
    const negatives = concept.poleWords.negative.flatMap((word) => vector(word) ?? []);
    const broadAxis = normalized(difference(mean(positives), mean(negatives)));
    const broadPositive = tests(concept.positiveTests, broadAxis);
    const broadNegative = tests(concept.negativeTests, broadAxis);
    console.log(`  broad-pole AUC ${(auc(broadPositive.map((entry) => entry.score), broadNegative.map((entry) => entry.score)) * 100).toFixed(0)}%`);

    if (concept.label !== 'abstraction') {
      const sampleWords = ['shark', 'table', 'joy', 'fear', 'grief', 'love'];
      const positiveMean = positives.reduce((sum, value) => sum + dot(value, broadAxis), 0) / positives.length;
      const negativeMean = negatives.reduce((sum, value) => sum + dot(value, broadAxis), 0) / negatives.length;
      const midpoint = (positiveMean + negativeMean) / 2;
      const span = positiveMean - negativeMean;
      console.log(`  calibrated samples ${tests(sampleWords, broadAxis).map(({ word, score }) => {
        const calibrated = Math.max(-1, Math.min(1, (2 * (score - midpoint)) / span));
        return `${word}:${calibrated.toFixed(2)}`;
      }).join(' ')}`);
      continue;
    }

    const anchorSet = new Set([...concept.poleWords.positive, ...concept.poleWords.negative]);
    const rated = fs.readFileSync(path.join(ROOT, '.cache/concreteness.csv'), 'utf8')
      .split(/\r\n|\r|\n/)
      .flatMap((line) => {
        const comma = line.lastIndexOf(',');
        if (comma < 0) return [];
        const word = line.slice(0, comma);
        const rating = Number(line.slice(comma + 1));
        const value = vector(word);
        return value && !anchorSet.has(word)
          ? [{
              word,
              rating,
              broadScore: dot(value, broadAxis),
              directScore: dot(value, positiveAnchors[0]) - dot(value, negativeAnchors[0]),
              pairedScore: dot(value, pairAxis),
            }]
          : [];
      });
    const ratedPositive = rated.filter((entry) => entry.rating <= 2);
    const ratedNegative = rated.filter((entry) => entry.rating >= 4);
    const ratedAuc = (key: 'broadScore' | 'directScore' | 'pairedScore') => auc(
      ratedPositive.map((entry) => entry[key]),
      ratedNegative.map((entry) => entry[key]),
    );
    console.log(`  direct held-out ratings AUC ${(ratedAuc('directScore') * 100).toFixed(0)}%`);
    console.log(`  six-pair held-out ratings AUC ${(ratedAuc('pairedScore') * 100).toFixed(0)}%`);
    console.log(`  broad-pole held-out ratings AUC ${(ratedAuc('broadScore') * 100).toFixed(0)}% (${ratedPositive.length}/${ratedNegative.length} words)`);
  }
  console.log(`  positive ${pairPositive.map(({ word, score }) => `${word}:${score.toFixed(2)}`).join(' ')}`);
  console.log(`  negative ${pairNegative.map(({ word, score }) => `${word}:${score.toFixed(2)}`).join(' ')}`);
}
