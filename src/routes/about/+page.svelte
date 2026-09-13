<script lang="ts">
  import { base } from '$app/paths';
</script>

<svelte:head>
  <title>How it works</title>
  <meta
    name="description"
    content="The word embeddings, vector arithmetic, hint selection, and scoring used by LatentGuess."
  />
</svelte:head>

<main class="method-page">
  <header class="method-header">
    <a class="back" href={`${base}/`}>← Back to game</a>
    <h1>How it works</h1>
    <p>
      LatentGuess treats every word as a point in a 300-dimensional semantic space. The game asks which hidden
      word best explains the vector movement suggested by your guesses.
    </p>
  </header>

  <section>
    <h2>1. The word vectors</h2>
    <p>
      The vocabulary comes from <strong>GloVe Wiki-Gigaword 300</strong>. Each word has a 300-number vector learned
      from the contexts in which it appeared in a large text corpus. Words used in similar contexts tend to point in
      similar directions; this is a statistical property, not a dictionary definition.
    </p>
    <p>
      During preparation, vectors are L2-normalized and quantized to signed 8-bit integers. At runtime, a stored
      component <code>b</code> is reconstructed as <code>b / 127</code>. This saves space, with a small precision loss.
    </p>
  </section>

  <section>
    <h2>2. Similarity</h2>
    <p>
      For a guess vector <code>g</code> and answer vector <code>a</code>, the displayed similarity is their dot
      product:
    </p>
    <div class="formula"><code>s(g, a) = gᵀa = ∑ gᵢaᵢ</code></div>
    <p>
      Because the vectors were normalized, this dot product is cosine similarity. The implementation computes the
      equivalent integer expression <code>∑ bᵍᵢbᵃᵢ / 127²</code>, rounds it to three decimals, and displays it as
      a percentage. A percentile is also calculated by ranking that similarity against every vocabulary word.
    </p>
    <p>
      A guess solves the round when it exactly matches the answer, or when it is a close word-form variant: a shared
      stem or a short prefix variation with similarity at least <code>0.40</code>.
    </p>
  </section>

  <section>
    <h2>3. How a one-word hint is chosen</h2>
    <p>
      Let <code>g</code> be your guess and <code>a</code> the hidden word. The direction from the guess to the answer
      is:
    </p>
    <div class="formula"><code>Δ = a − g</code></div>
    <p>
      For each eligible hint word <code>c</code>, the engine measures both its answer similarity
      <code>cᵀa</code> and how strongly it projects onto that direction. Its least-squares coefficient is:
    </p>
    <div class="formula"><code>α = (Δᵀc) / (cᵀc)</code></div>
    <p>
      A candidate must be a positive directional step (<code>α &gt; 0.05</code>), come from the curated hint pool,
      and not be the guess, answer, a used word, or a close morphological variant. It must also be at least
      <code>25%</code> similar to the answer. The upper similarity limit is:
    </p>
    <div class="formula"><code>cap = clamp(s(g, a) + 0.35, 0.50, 0.90)</code></div>
    <p>
      The preferred candidate makes at least <code>0.02</code> progress over the guess while staying below that cap.
      Among those candidates, the engine chooses the strongest directional projection. If none qualifies, it falls
      back to the most answer-relevant candidate within the same range. The coefficient shown in the UI is rounded
      to one decimal place.
    </p>
  </section>

  <section>
    <h2>4. The displayed path</h2>
    <p>
      The hidden word is represented by <code>ζ</code>:
    </p>
    <div class="formula"><code>ζ ≈ g + αc</code></div>
    <p>
      
    </p>
  </section>

  <section>
    <h2>5. Two hints could be used</h2>
    <p>
      The engine can fit a second word <code>d</code> to the same residual direction. It solves the two-variable
      least-squares system for positive coefficients:
    </p>
    <div class="formula"><code>ζ ≈ g + αc + βd</code></div>
    <p>
      The second word must be answer-relevant (at least <code>25%</code> and below the same cap), sufficiently distinct
      from the first (cosine similarity no greater than <code>0.75</code>), and have a coefficient between
      <code>0.05</code> and <code>2.0</code>. 
    </p>
  </section>

  <section>
    <h2>6. Concept guesses</h2>
    <p>
      Concept guesses use directions in the embedding space, not similarity to a concept's name. Each direction has a
      positive pole and a negative pole. Most are made by averaging several normalized contrast vectors:
    </p>
    <div class="formula"><code>u_C = normalize(mean(normalize(v(pᵢ) − v(nᵢ))))</code></div>
    <p>
      For example, plurality combines <code>cats − cat</code>, <code>dogs − dog</code>,
      <code>houses − house</code>, and many more plural–singular offsets. This reinforces the shared grammatical change
      while reducing the subject matter contributed by any one pair. Motion and relation use the same method.
    </p>
    <p>
      Abstractness and emotionality are category-like rather than one repeated word relationship, so they use the
      direction between broad example centroids. The emotion pole includes varied examples such as <em>happy</em>,
      <em>sad</em>, <em>angry</em>, and <em>afraid</em>. The abstract and tangible examples were selected using human
      concreteness ratings, and the ambiguous label <em>concrete</em> is not used as an anchor:
    </p>
    <div class="formula"><code>u_C = normalize(mean(v(abstract examples)) − mean(v(tangible examples)))</code></div>
    <p>
      The hidden word is projected onto the direction with <code>r = ⟨v(ζ), u_C⟩</code>. The result is calibrated against
      the average locations of both anchor sets and displayed as <code>A_C(ζ)</code>. The two pole percentages add to
      100%, and the signed axis score runs from −100% at the negative pole to +100% at the positive pole.
    </p>
    <ul>
      <li><strong>abstraction:</strong> abstract ↔ tangible</li>
      <li><strong>emotion:</strong> emotional ↔ neutral</li>
      <li><strong>motion:</strong> moving ↔ still</li>
      <li><strong>plurality:</strong> plural ↔ singular</li>
      <li><strong>relation:</strong> connected ↔ isolated</li>
    </ul>
    <p>
      These are model measurements, not category facts or probabilities. GloVe has one vector per spelling, so it cannot
      choose between senses of an overloaded word. It also learns from co-occurrence: a physical object can score less
      tangible than expected when its name rarely appears in the same contexts as the anchor examples. Averaging many
      contrasts makes the probe more stable, but it cannot remove those limitations.
    </p>
  </section>


</main>

<style>
  .method-page {
    width: min(780px, calc(100% - 44px));
    margin: 0 auto;
    padding: 38px 0 72px;
  }

  .method-header {
    margin-bottom: 34px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    margin-bottom: 22px;
    padding: 9px 13px;
    border-radius: var(--radius);
    background: var(--brand);
    color: var(--text);
    font-weight: 700;
    text-decoration: none;
    box-shadow: var(--shadow-sm);
  }

  .back:hover {
    filter: brightness(1.05);
    box-shadow: var(--shadow-md);
  }

  .back:focus-visible {
    outline: none;
    background: color-mix(in srgb, var(--brand) 72%, var(--surface));
  }

  h1 {
    margin: 0 0 12px;
    font-size: clamp(32px, 6vw, 48px);
    line-height: 1.08;
    letter-spacing: -0.04em;
  }

  h2 {
    margin: 34px 0 10px;
    font-size: 24px;
    line-height: 1.2;
  }

  p,
  li {
    color: var(--text);
    line-height: 1.6;
  }

  p {
    margin: 12px 0;
  }

  ul {
    padding-left: 26px;
  }

  code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--track);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9em;
  }

  .formula {
    margin: 18px 0;
    padding: 14px 16px;
    overflow-x: auto;
    border-left: 4px solid var(--brand);
    background: var(--track);
  }

  .formula code {
    padding: 0;
    background: none;
    font-size: 1em;
    white-space: nowrap;
  }

  @media (max-width: 460px) {
    .method-page {
      width: min(100% - 32px, 780px);
      padding-top: 24px;
    }

    h2 {
      font-size: 22px;
    }
  }
</style>
