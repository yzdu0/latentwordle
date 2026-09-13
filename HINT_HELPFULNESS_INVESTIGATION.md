# Hint helpfulness: GloVe vs Word2Vec

## Executive finding

Word2Vec is the better base embedding, but changing the embedding does not fix the hint design. It produces stronger and often more legible semantic associations than GloVe, while also producing more visibly contradictory gender clues. The contradiction is primarily caused by the selector and equation semantics, not by Word2Vec treating gendered words as neutral.

I would keep Word2Vec for a further iteration, but would not treat the model switch alone as a hint-quality fix.

Implementation follow-up: the engine now rejects explicitly opposite-gender component and landing words for
gender-coded answers. This is a narrow output guardrail for the measured failure mode, not a claim that the embedding
itself has been debiased.

## Broad model results

All measurements use the quantized bundles consumed by the game. The hint audit uses 400 deterministic answer/guess pairs, stratified into four starting-similarity bands, with 100 pairs per band.

| Measure | GloVe | Word2Vec | Reading |
| --- | ---: | ---: | --- |
| WordSim-353 relatedness rho | 0.619 | **0.689** | Word2Vec better matches human semantic relatedness |
| SimLex-999 genuine-similarity rho | 0.373 | **0.448** | Word2Vec is also better when association is explicitly separated from similarity |
| Clue available | 100% | 100% | Tie |
| Visible clue directly warmer | **96.5%** | 96.0% | Essentially tied |
| Median direct clue gain | 27.4 points | **30.4 points** | Word2Vec makes a larger single-step improvement |
| Median five-step gain from repeatedly following the clue | **50.9 points** | 49.6 points | Essentially tied |
| Median external frequency rank of clue | 6,684 | **6,551** | Similar clue familiarity |
| Clues outside the top 20,000 words | 16.0% | **15.0%** | Similar long-tail rate |

Word2Vec's advantage is clearest in the middle of a game:

| Starting similarity | GloVe median gain | Word2Vec median gain |
| --- | ---: | ---: |
| Below 10% | **42.9** | 42.8 |
| 10–25% | 29.8 | **34.4** |
| 25–45% | 23.2 | **25.9** |
| Above 45% | 7.3 | **7.9** |

Some paired examples show the qualitative improvement:

- `radiation <- lemon + nuclear` in Word2Vec, versus `radiation <- lemon + detection` in GloVe.
- `coffee <- clearing + sip` versus `coffee <- clearing + wine`.
- `king <- greater + palace` versus `king <- greater + nephew`.
- `dude <- gentlemen + kid` versus `dude <- gentlemen + ranch`.

Neither model is consistently human-readable. Examples such as `clock <- family + scoreboard`, `hotel <- brittany + occupancy`, and `fed <- pumped + feeding` improve cosine similarity but do not always communicate a clean conceptual instruction.

## Failure near the answer

For hot guesses, 14% of GloVe clues and 16% of Word2Vec clues were not directly warmer than the guess. This comes from the selector's fallback path. When no candidate clears `current similarity + 0.02`, it can return any candidate between the fixed 0.25 floor and the similarity cap—even when that candidate is worse than the current guess.

A close player can therefore receive a clue that numerically moves backward. The safer behavior is to show no word clue, or a “very close” message, when monotonic progress cannot be guaranteed.

## The `mama` case

Word2Vec's nearest neighborhood for `mama` is substantially more coherent than GloVe's:

- Word2Vec: `momma`, `daddy`, `mamma`, `mommy`, `mom`, `papa`, `mamas`, `grandma`, `mother`, `auntie`.
- GloVe: `daddy`, `papa`, `momma`, `hey`, `mamma`, `grandma`, `mom`, `grandpa`, `wanna`, `aunt`.

However, the production selector generates these Word2Vec equations:

- `mama ≈ girl + daddy`
- `mama ≈ mother + daddy`
- `mama ≈ mom + daddy`
- `mama ≈ lady + daddy`
- `mama ≈ daughter + dude`
- `mama ≈ sister + dude + sir`

GloVe is not immune: it frequently returns `papa` for the same female-coded guesses.

This does not mean that Word2Vec has erased gender. Standard gender-pair offsets remain aligned in the vector space. Rather, cosine similarity strongly captures shared context, register, and family role. In Word2Vec:

- `similarity(mama, daddy) = 0.756`
- `similarity(mama, mother) = 0.610`
- `similarity(mama, father) = 0.475`
- `similarity(mother, daddy) = 0.593`

For `mother -> mama`, `daddy` qualifies because it is more similar to `mama` than to `mother`; it strongly represents the informal/child-language family register. The model still contains a female–male distinction, but the selector exposes the shared-register component as though the entire word `daddy` were an instruction.

## Gender audit

Across 1,768 gender-coded puzzle-answer/guess cases, the primary clue was an explicitly opposite-gender term in:

- GloVe: 181 cases (10.2%)
- Word2Vec: 266 cases (15.0%)

This is a lower bound. It counts a controlled lexicon such as `man`, `father`, `daddy`, `brother`, `woman`, and `mother`; it does not count names or looser terms such as `dude` and `sir` unless they are explicitly listed.

## Root cause in the hint objective

The current selector scores a candidate word vector `c` against the residual `a - g` and displays:

```text
answer ≈ guess + alpha × clue
```

A raw word vector is not a human-readable semantic operation. Its direction depends on the embedding origin and bundles together gender, register, topic, frequency, syntax, and every other learned association. A candidate can reduce the numerical residual for one hidden component while contradicting an obvious surface attribute.

The engine already computes a real `suggestion`/landing word after the vector addition, but the UI currently displays only the component equation. Consequently the player sees `mother + daddy`, not the word the engine believes that combination lands on.

## Recommendations

1. Keep Word2Vec as the experimental base; it wins both human semantic benchmarks and gives larger middle-game clue gains.
2. Replace the raw component equation as the main instruction with a real stepping-stone word: “Try: X”. Rank the movement `X - guess` against `answer - guess`, with a mandatory direct-similarity improvement.
3. Never use the fallback when it moves backward. For a hot guess with no safe clue, say “very close” or omit the word hint.
4. Add semantic-polarity guardrails for high-confidence attributes such as gender and sentiment. This should be a penalty/constraint on the displayed stepping stone, not an attempt to remove those distinctions from the embedding.
5. Keep the equation as optional technical detail, ideally including the computed landing word, rather than presenting component words as literal natural-language addition.
6. Add a small human-rated hint set. Cosine gain measures navigability, but it cannot determine whether a clue feels coherent, misleading, offensive, or overly revealing.

## Reproduce

```sh
# The ignored .cache directory must contain the WordSim-353 ZIP and extracted
# SimLex-999 dataset described in WORD2VEC_EXPERIMENT.md.
npm run compare:embeddings
npm run spike:hint-audit
```

The comparison script reports semantic benchmarks, stratified clue progress, frequency, multi-step behavior, and the gender audit. The targeted audit runs the full production selector for `mama`.

References: [WordSim-353](https://www.gabrilovich.com/resources/data/wordsim353/wordsim353.html), [SimLex-999](https://fh295.github.io/simlex.html).
