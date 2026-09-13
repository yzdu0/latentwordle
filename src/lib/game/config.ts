export const EMBEDDINGS = {
  glove: {
    model: 'glove-wiki-gigaword-300',
    dim: 300,
    format: 'text' as const,
    archive: 'glove-wiki-gigaword-300.gz',
    url: 'https://github.com/RaRe-Technologies/gensim-data/releases/download/glove-wiki-gigaword-300/glove-wiki-gigaword-300.gz',
  },
  word2vec: {
    model: 'word2vec-google-news-300',
    dim: 300,
    format: 'word2vec-binary' as const,
    archive: 'word2vec-google-news-300.gz',
    url: 'https://github.com/RaRe-Technologies/gensim-data/releases/download/word2vec-google-news-300/word2vec-google-news-300.gz',
  },
} as const;

export type EmbeddingKey = keyof typeof EMBEDDINGS;

// Word2Vec is the active experiment. The runtime remains model-agnostic and reads
// the model/dimension recorded in the generated seed bundle.
export const DEFAULT_EMBEDDING: EmbeddingKey = 'word2vec';
export const EMBEDDING = EMBEDDINGS[DEFAULT_EMBEDDING];

export const MIN_CLUE_SIM = 0.25;
export const MIN_CLUE_PROGRESS = 0.02;
export const CLUE_SIM_MARGIN = 0.35;
export const CLUE_SIM_FLOOR = 0.5;
export const CLUE_SIM_CEILING = 0.9;
export const DUAL_HINT_MAX_SIM = 0.75;
export const DUAL_HINT_MIN_GAIN = 0.05;
export const VARIANT_SIM_MIN = 0.4;
