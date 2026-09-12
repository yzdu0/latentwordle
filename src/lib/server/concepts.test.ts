import { describe, expect, it } from 'vitest';
import { CONCEPTS, type ConceptDefinition } from '$lib/game/concepts.ts';
import { l2normalize, quantize } from '$lib/game/scoring.ts';
import { stem } from '$lib/game/morphology.ts';
import type { Vocab } from './store.ts';
import { projectConcept } from './concepts.ts';

function vocabOf(entries: Record<string, number[]>): Vocab {
  const words = Object.keys(entries);
  const dim = entries[words[0]].length;
  const bytes = new Int8Array(words.length * dim);
  words.forEach((word, row) => bytes.set(quantize(l2normalize(entries[word])), row * dim));
  return {
    dim,
    words,
    index: new Map(words.map((word, row) => [word, row])),
    bytes,
    hints: new Uint8Array(words.length),
    stems: words.map(stem),
  };
}

describe('projectConcept', () => {
  it('averages paired offsets while cancelling pair-specific subject matter', () => {
    const vocab = vocabOf({
      cats: [1, 1],
      cat: [-1, 1],
      dogs: [1, -1],
      dog: [-1, -1],
      target: [1, 0],
    });
    const definition: ConceptDefinition = {
      key: 'plurality',
      label: 'plurality',
      method: 'paired-offsets',
      positive: { label: 'plural', words: ['cats', 'dogs'] },
      negative: { label: 'singular', words: ['cat', 'dog'] },
      pairs: [['cats', 'cat'], ['dogs', 'dog']],
    };

    expect(projectConcept(vocab, vocab.index.get('target')!, definition)).toEqual({ score: 1, position: 1 });
  });

  it('builds a broad axis from two pole centroids', () => {
    const vocab = vocabOf({
      idea: [1, 0.2],
      belief: [1, -0.2],
      chair: [-1, 0.2],
      stone: [-1, -0.2],
      target: [-1, 0],
    });
    const definition: ConceptDefinition = {
      key: 'abstraction',
      label: 'abstraction',
      method: 'centroids',
      positive: { label: 'abstract', words: ['idea', 'belief'] },
      negative: { label: 'tangible', words: ['chair', 'stone'] },
    };

    expect(projectConcept(vocab, vocab.index.get('target')!, definition)).toEqual({ score: -1, position: 0 });
  });

  it('keeps every paired axis aligned with its displayed poles', () => {
    for (const concept of CONCEPTS) {
      for (const [positive, negative] of concept.pairs ?? []) {
        expect(concept.positive.words).toContain(positive);
        expect(concept.negative.words).toContain(negative);
      }
    }
  });
});
