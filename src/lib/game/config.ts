export const EMBEDDING = {
  model: 'glove-wiki-gigaword-300',
  dim: 300,
  url: 'https://github.com/RaRe-Technologies/gensim-data/releases/download/glove-wiki-gigaword-300/glove-wiki-gigaword-300.gz',
} as const;

export const MIN_CLUE_SIM = 0.25;
export const CLUE_SIM_MARGIN = 0.35;
export const CLUE_SIM_FLOOR = 0.5;
export const CLUE_SIM_CEILING = 0.9;
