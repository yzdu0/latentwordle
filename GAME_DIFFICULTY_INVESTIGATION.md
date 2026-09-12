# LatentGuess difficulty investigation

Date: 2026-09-12

## Executive finding

The current least-squares calculation is mathematically consistent, but its objective is poorly aligned with the player-facing meaning of a hint. It deliberately rewards both positive and negative projections, so words almost identical to the guess often win with a large negative multiplier. The UI then invites the player to submit the hint word by itself, even though the calculation describes adding a scaled vector to the current guess.

Restoring the former 0.25 hint-to-answer similarity floor is the highest-value immediate change. In a fixed sample of 240 random guess/answer pairs, it changed the negative-multiplier rate from 49.6% to 0% and changed the rate at which clicking the hint improved direct similarity from 60.0% to 99.6%.

## How the current selector works

For guess vector `g`, target vector `t`, and candidate hint vector `v`, the code solves

`alpha = dot(t - g, v) / dot(v, v)`

and ranks candidates by

`dot(t - g, v)^2 / dot(v, v)`.

Because the dot product is squared, a large negative projection is worth exactly as much as a large positive projection. This explains the common election example. The quantized GloVe cosine similarity between `election` and `elections` is 0.895. For the played answer `dude`, `elections` has similarity -0.055. Therefore its projection on `dude - election` is approximately `-0.055 - 0.895 = -0.950`, producing `-0.9 x elections` after display rounding.

This is a predictable property of the objective, not a rare embedding accident. A near-copy of the guess is usually an excellent vector to subtract in Euclidean space, but “subtract elections” is not an interpretable semantic instruction for a human.

## Played observations

### Answer: dude (gave up after seven probes)

| Guess | Direct similarity | Hint | Displayed hint accuracy |
|---|---:|---|---:|
| election | 0% | -0.9 x elections | 4% |
| water | 1% | 0.6 x slacker | 9% |
| slacker | 47% | 0.3 x somebody | 25% |
| somebody | 33% | -0.6 x else | 23% |
| lazy | 35% | -0.3 x incompetent | 9% |
| worker | 7% | -0.7 x workers | 6% |
| loser | 13% | -0.6 x losers | 4% |

`slacker` was an excellent association, but following the next clickable hint (`somebody`) reduced similarity from 47% to 33%. Several other hints were guess variants or hard-to-interpret negative concepts.

### Answer: moron (gave up after four probes)

| Guess | Direct similarity | Hint | Displayed hint accuracy |
|---|---:|---|---:|
| election | 0% | -1.0 x elections | 2% |
| elections | 0% | -1.0 x election | 3% |
| water | 0% | -0.7 x supply | 2% |
| person | 4% | -0.7 x persons | 0% |

The first two clickable hints form a two-word loop. The relevant broad category `person` scores only 4% in this embedding, giving the player little usable feedback.

### Answer: steam (solved in six guesses)

| Guess | Direct similarity | Hint | Displayed hint accuracy |
|---|---:|---|---:|
| animal | 6% | -0.7 x animals | 0% |
| music | 7% | -0.7 x composer | 7% |
| house | 14% | -0.6 x senate | 17% |
| home | 9% | 0.6 x locomotives | 14% |
| train | 31% | 0.5 x boilers | 39% |
| steam | 100% | solved | 100% |

The positive clues did become useful: `locomotives` suggested `train`, and `boilers` suggested `steam`. But the displayed “hint accuracy” understates how useful the clue word itself is. `locomotives` is directly 60% similar to `steam` and `boilers` is 57%, while their displayed vector-sum accuracies were only 14% and 39%.

## Corpus audit

The audit used the checked-in local GloVe bundle and 240 deterministic random pairs, drawing guesses from the intended hint-eligible pool.

| Measure | Current selector | Current + 0.25 floor | Previous full selector |
|---|---:|---:|---:|
| Negative multiplier | 49.6% | 0.0% | 0.0% |
| Clicking hint improves direct similarity | 60.0% | 99.6% | 100.0% |
| Clicking hint worsens direct similarity | 39.2% | 0.4% | 0.0% |
| Hint is a simple prefix/morphological variant of guess | 15.4% | not measured | 0.0% |
| Hint is outside the intended hint pool | 15.8% | not measured | 0.0% |

For 400 answers probed from the guess `election`, 96.0% of multipliers were negative and 84.5% of clues were election-family prefix variants. In an 80-answer click-the-hint simulation starting with `election`, the current selector's median similarity began at 0.165 and ended at 0.161; the previous selector ended at 0.527. The current chains usually entered `election -> elections -> election` immediately.

The computed nearest word to the vector sum improved on the guess in 72.5% of random pairs, but not reliably enough to promise forward motion. Its median answer similarity was 0.164, compared with 0.035 for the random guess and 0.348 for the clue word itself.

## Other difficulty sources

1. **The clickable action does not match the equation.** The equation is `g + alpha*v`, but clicking submits `v`, not the nearest word to the sum. The button title explicitly calls `v` the next guess.

2. **The sum word is effectively hidden.** It is present only in a hover title. That is difficult to discover and unavailable on many touch devices. The UI shows only its similarity percentage.

3. **The current implementation ignores the hint mask.** The seed builds a 17,134-word hint pool, but the current selector searches all 34,156 vocabulary entries. This produces rarer and less interpretable hints.

4. **Answer quality is uneven.** Only 38 of 3,501 answers are curated. The generated list accepts a WordNet noun sense and concreteness as low as 1.5/5, so it contains ambiguous dominant non-nouns such as `national`, `former`, `make`, and `well`, plus abusive/offensive terms near the end of the list. Only 73% of answers have concreteness at least 3.0. This makes some rounds intrinsically unfair regardless of hint quality.

5. **Raw cosine percentages are poorly calibrated.** Negative values are displayed as 0%, collapsing distinct guesses into the same visible score. Cosine values also do not have an intuitive percentage interpretation, and different target words have differently dense neighborhoods.

6. **A single isolated GloVe vector is polysemous.** For example, `house` includes home/building, legislature, dynasty, and music senses. A negative `senate` hint can technically remove the legislature sense, but that is much harder to use than a positive stepping stone.

## Recommendations, in order

### 1. Restore the previous guardrails immediately

Restore `MIN_CLUE_SIM = 0.25`, use only `vocab.hints`, exclude answer/guess morphological variants, and prefer positive projection rather than squared projection. Keep the previous dynamic upper cap so clues become more direct as the guess improves.

This is a small, low-risk correction supported by the strongest result in the audit. If negative hints are still desired later, add them back only as a separately designed mechanic.

### 2. Make the hint contract internally consistent

Choose one of these designs:

- **Recommended: clickable stepping-stone.** Return a real next word `c` whose direct answer similarity is guaranteed to exceed the current guess by a small margin. Rank candidates by alignment of `c - g` with `t - g`, subject to a dynamic similarity band and the curated hint pool. Display “Try: c”; remove the multiplier.
- **Keep vector arithmetic.** Display the complete result, for example `water + 0.6 x slacker ~= drinking`, and make `drinking`—not `slacker`—the clickable next guess. Add a monotonic-improvement constraint because the current nearest-sum word improves only 72.5% of the time.

A practical stepping-stone score is:

`score(c) = cosine(c - g, t - g)`

with constraints such as:

- `sim(c,t) >= max(0.20, sim(g,t) + 0.05)`
- `sim(c,t) <= min(0.88, max(0.55, sim(g,t) + 0.25))`
- hint-eligible, not a guess/answer variant, and not used earlier in the round.

The lower bound guarantees visible progress; the upper bound controls how much is revealed. A prototype of this rule improved direct similarity in 100% of the 240 sampled pairs, with median next-word similarity 0.531.

### 3. Rebuild and audit the answer pool

Use the curated list as the quality bar. Raise minimum concreteness to roughly 3.0, lower the frequency-rank ceiling from 8,000 to around 5,000, remove words whose dominant everyday use is not a noun, and manually review the final pool for ambiguity, offensiveness, inflections, and corpus artifacts. A smaller excellent pool is preferable to 3,500 inconsistent answers.

### 4. Calibrate feedback for players

Show semantic percentile or neighborhood rank rather than presenting raw cosine as a literal percentage. For example, “warmer than 94% of words” is more interpretable and comparable between targets. If raw cosine remains, show negative values rather than clipping every negative score to 0%.

### 5. Add controlled difficulty ramps

Possible low-complexity options:

- Increase the clue-similarity cap by turn number.
- Offer two or three diverse positive clues after several weak guesses.
- Add a broad category or part-of-speech hint halfway through the round.
- Allow more than 10 guesses for uncurated/random mode.
- Detect two-word cycles and repeated morphological families, then force a different clue.

### 6. Evaluate embedding changes only after fixing selection

Mean-centering or removing the top principal components can reduce GloVe anisotropy, and a newer embedding model may improve neighborhoods. Neither fixes the central signed-objective/UI mismatch. Any model change should be evaluated on a small human-rated benchmark of clue usefulness, not only residual error or cosine similarity.

## Suggested acceptance tests

- Across at least 1,000 representative pairs, negative hints are under 1% (or exactly 0% if disabled).
- A clickable hint improves displayed closeness at least 95% of the time.
- No clue is a morphological variant of the guess or answer.
- No clue falls outside the approved hint vocabulary.
- No click-the-hint chain repeats a word within a round.
- Every production answer passes a manual content/ambiguity review.
- Mobile users can see the same information currently stored in hover-only titles.

## Implementation status

Implemented after this investigation:

- Restored the 0.25 minimum clue relevance, dynamic similarity cap, curated hint mask, and guess/answer variant exclusions.
- Constrained the least-squares hint to positive projections and used the displayed rounded multiplier for the displayed landing calculation.
- Excluded earlier guesses, hints, and landings from later hint selection to prevent immediate loops.
- Added target-relative vocabulary percentiles and stopped clipping negative cosine values to 0% in the UI.
- Made the full `guess + multiplier x hint ~= landing` relationship visible on both desktop and mobile.
- Added an optional second hint term. The engine jointly refits both positive coefficients, requires distinct hint words, rejects component variants as landings, and uses the pair only when its playable landing is at least five similarity points warmer than the best one-word route.
- Added a single Try action that chooses the warmer of the hint word and landing word.
- Tightened generated answers to common, concrete, unambiguous nouns; expanded the blocklist; rebuilt the answer list, vocabulary, and local embedding bundle.
- Added regression coverage for positive-only hints, dynamic caps, hint eligibility, variant rejection, and excluded-word repetition.
