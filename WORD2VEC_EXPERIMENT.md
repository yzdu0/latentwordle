# Word2Vec experiment

## Decision

Word2Vec Google News 300 is now the default embedding source. The GloVe path remains available for repeatable A/B comparisons and rollback.

The runtime representation did not change: vectors are still L2-normalized, quantized to signed 8-bit values, and scored with dot products. Only the offline vocabulary/vector source changed.

## Results

The initial results below motivated the switch. A later stratified audit found important limitations in the hint objective, especially near the answer and for gender-coded words; see [HINT_HELPFULNESS_INVESTIGATION.md](HINT_HELPFULNESS_INVESTIGATION.md).

Both models were quantized through the production seed path before measurement.

| Model | Vocabulary | WordSim-353 Spearman rho | Pairs covered | Hint coverage | Hints improving direct similarity | Median direct gain |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GloVe Wiki-Gigaword 300 | 34,143 | 0.619 | 336 | 100.0% | 100.0% | 41.1 points |
| Word2Vec Google News 300 | 32,348 | 0.689 | 333 | 100.0% | 100.0% | 40.4 points |

The hint figures use 240 deterministic answer/guess pairs and the production one-word clue constraints. Word2Vec's clue progress is effectively tied with GloVe, while its agreement with human relatedness judgments is materially higher. All 575 puzzle answers are present in the Word2Vec vocabulary.

WordSim-353 measures general semantic relatedness rather than game enjoyment, so this is evidence for trying Word2Vec, not a final human play-test. The Google News vocabulary is also more US- and news-centric: the filtered vocabulary is 5.3% smaller and contains fewer lowercase proper names.

## Reproduce

The pretrained archives are cached under `.cache/` and are not committed. Google News Word2Vec is about 1.6 GB.

```sh
npm run build:vocab:glove
node scripts/seed.ts --embedding=glove --output=.cache/dev-glove --sql=.cache/seed-glove.sql

npm run build:vocab:word2vec
node scripts/seed.ts --embedding=word2vec --output=.cache/dev-word2vec --sql=.cache/seed-word2vec.sql

# Download the CC BY 4.0 benchmark once:
curl -L -o .cache/wordsim353.zip https://www.gabrilovich.com/resources/data/wordsim353/wordsim353.zip
curl -L -o .cache/SimLex-999.zip https://fh295.github.io/SimLex-999.zip
unzip -oq .cache/SimLex-999.zip -d .cache
npm run compare:embeddings
```

`npm run seed` and `npm run seed:word2vec` now create the active Word2Vec bundle. `npm run seed:glove` is the rollback path; rebuild the corresponding vocabulary first when changing models.

Sources: [Gensim Google News Word2Vec release](https://github.com/piskvorky/gensim-data/releases/tag/word2vec-google-news-300), [WordSim-353](https://www.gabrilovich.com/resources/data/wordsim353/wordsim353.html).
