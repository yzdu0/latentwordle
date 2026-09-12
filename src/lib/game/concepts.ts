export type ConceptKey = 'abstraction' | 'emotion' | 'motion' | 'plurality' | 'relation';

export interface ConceptPole {
  label: string;
  words: readonly string[];
}

export interface ConceptDefinition {
  key: ConceptKey;
  label: string;
  method: 'centroids' | 'paired-offsets';
  positive: ConceptPole;
  negative: ConceptPole;
  pairs?: readonly (readonly [positive: string, negative: string])[];
}

export const CONCEPTS: readonly ConceptDefinition[] = [
  {
    key: 'abstraction',
    label: 'abstraction',
    method: 'centroids',
    positive: {
      label: 'abstract',
      // Broad, human-rated examples prevent any one polysemous label from defining this axis.
      words: [
        'idea', 'justice', 'freedom', 'belief', 'theory', 'knowledge', 'meaning', 'principle', 'concept', 'faith',
        'hope', 'purpose', 'responsibility', 'democracy', 'possibility', 'reputation', 'existence', 'tradition',
        'honor', 'value', 'risk', 'chance', 'experience', 'concern', 'commitment', 'reality', 'doubt', 'desire',
        'intention', 'soul',
      ],
    },
    negative: {
      label: 'tangible',
      words: [
        'house', 'cup', 'water', 'building', 'television', 'book', 'food', 'car', 'island', 'road', 'river',
        'village', 'key', 'radio', 'body', 'hospital', 'gold', 'hand', 'airport', 'room', 'computer', 'wall', 'ball',
        'rock', 'plant', 'phone', 'paper', 'train', 'beach', 'blood',
      ],
    },
  },
  {
    key: 'emotion',
    label: 'emotion',
    method: 'centroids',
    positive: {
      label: 'emotional',
      words: [
        'happy', 'sad', 'angry', 'afraid', 'emotional', 'passionate', 'excited', 'joy', 'fear', 'anger', 'sadness',
        'happiness', 'grief', 'anxiety', 'love', 'hatred', 'delight', 'rage', 'sorrow', 'terrified',
      ],
    },
    negative: {
      label: 'neutral',
      words: [
        'neutral', 'indifferent', 'objective', 'factual', 'technical', 'ordinary', 'calm', 'reserved', 'unmoved',
        'clinical', 'table', 'number', 'road', 'document', 'machine', 'building', 'water', 'metal', 'software', 'vehicle',
      ],
    },
  },
  {
    key: 'motion',
    label: 'motion',
    method: 'paired-offsets',
    positive: { label: 'moving', words: ['moving', 'dynamic', 'active', 'running', 'mobile'] },
    negative: { label: 'still', words: ['stationary', 'static', 'idle', 'still', 'fixed'] },
    pairs: [
      ['moving', 'stationary'],
      ['dynamic', 'static'],
      ['active', 'idle'],
      ['running', 'still'],
      ['mobile', 'fixed'],
    ],
  },
  {
    key: 'plurality',
    label: 'plurality',
    method: 'paired-offsets',
    positive: {
      label: 'plural',
      words: ['cats', 'dogs', 'houses', 'books', 'trees', 'cars', 'years', 'players', 'groups', 'companies', 'members', 'teams', 'plans', 'votes', 'songs', 'roads', 'rivers', 'rooms', 'systems', 'markets'],
    },
    negative: {
      label: 'singular',
      words: ['cat', 'dog', 'house', 'book', 'tree', 'car', 'year', 'player', 'group', 'company', 'member', 'team', 'plan', 'vote', 'song', 'road', 'river', 'room', 'system', 'market'],
    },
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
  },
  {
    key: 'relation',
    label: 'relation',
    method: 'paired-offsets',
    positive: { label: 'connected', words: ['connected', 'together', 'related', 'attached', 'social'] },
    negative: { label: 'isolated', words: ['isolated', 'apart', 'unrelated', 'detached', 'solitary'] },
    pairs: [
      ['connected', 'isolated'],
      ['together', 'apart'],
      ['related', 'unrelated'],
      ['attached', 'detached'],
      ['social', 'solitary'],
    ],
  },
];

export function conceptByKey(key: string): ConceptDefinition | null {
  return CONCEPTS.find((concept) => concept.key === key) ?? null;
}
