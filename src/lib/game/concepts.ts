export type ConceptKey = 'abstraction' | 'emotion' | 'motion' | 'plurality' | 'relation';

export interface ConceptDefinition {
  key: ConceptKey;
  label: string;
  words: readonly string[];
}

export const CONCEPTS: readonly ConceptDefinition[] = [
  { key: 'abstraction', label: 'abstraction', words: ['abstract', 'specific', 'tangible', 'physical'] },
  { key: 'emotion', label: 'emotion', words: ['happy', 'sad', 'angry', 'afraid'] },
  { key: 'motion', label: 'motion', words: ['motion', 'stillness'] },
  { key: 'plurality', label: 'plurality', words: ['plural', 'singular'] },
  { key: 'relation', label: 'relation', words: ['relation', 'isolation'] },
];

export function conceptByKey(key: string): ConceptDefinition | null {
  return CONCEPTS.find((concept) => concept.key === key) ?? null;
}
