<script lang="ts">
  import { base } from '$app/paths';
</script>

<svelte:head>
  <title>How it works</title>
  <link rel="canonical" href="https://nphard.app/latent/about" />
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
      The vocabulary comes from <strong>Word2Vec Google News 300</strong>. Each word has a 300-number vector learned
      from the contexts in which it appeared in the Google News corpus. Words used in similar contexts tend to point
      in similar directions.
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
      a percentage. A percentile is also calculated by ranking that similarity against every vocabulary word. These
      results may reflect biases in the training data.
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
      and not be the guess, answer, a used word, or a close morphological variant. It must be at least
      <code>25%</code> similar to the answer, with answer similarity capped at <code>90%</code>. The engine prefers
      candidates that are also at least <code>20%</code> similar to the guess.
    </p>
    <div class="formula"><code>s(c, g) ≥ 0.20</code></div>
    <p>
      The preferred candidate makes at least <code>0.02</code> progress over the guess. Among those candidates, the
      engine chooses the strongest directional projection. If no otherwise-safe candidate meets the <code>20%</code>
      guess-similarity preference, the engine relaxes that preference and returns the best eligible fallback, using
      the original dynamic answer-similarity cap:
    </p>
    <div class="formula"><code>fallback cap = clamp(s(g, a) + 0.35, 0.50, 0.90)</code></div>
    <p>The coefficient shown in the UI is rounded to one decimal place.</p>
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
      The second word follows the same answer-similarity limits, <code>20%</code> guess-similarity preference, and
      fallback cap. It must also be sufficiently distinct from the first (cosine similarity no greater than
      <code>0.75</code>) and have a coefficient between <code>0.05</code> and <code>2.0</code>.
    </p>
  </section>

  <section>
    <h2>6. Decomposition guesses</h2>
    <p>
      After four guesses, a decomposition can spend one turn to ask the engine for a semantic recipe for the hidden
      word. Unlike a normal hint, it does not have to preserve a player-supplied guess:
    </p>
    <div class="formula"><code>ζ ≈ αc + βd (+ γe)</code></div>
    <p>
      The engine shortlists answer-related words from the curated hint pool, rejects the answer, used words, close
      word-form variants, overly similar components, then solves for
      positive least-squares coefficients. The displayed coefficients are rounded to one decimal place before the fit
      is measured.
    </p>
    <p>
      Two words are preferred. A third is included only when it raises cosine fit by at least five percentage points.
      The displayed <strong>fit</strong> is the cosine similarity between the complete recipe and the hidden word—not
      the similarity of any individual ingredient. Decompositions award no similarity points, but they use a turn and
      therefore reduce the remaining solve bonus.
    </p>
  </section>

  <section>
    <h2>7. Concept guesses</h2>
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
      <em>sad</em>, <em>angry</em>, and <em>afraid</em>.
    </p>
    <div class="formula"><code>u_C = normalize(mean(v(abstract examples)) − mean(v(tangible examples)))</code></div>
    <p>
      The hidden word is projected onto the direction with <code>r = ⟨v(ζ), u_C⟩</code>. 
    </p>
    <ul>
      <li><strong>abstraction:</strong> abstract ↔ tangible</li>
      <li><strong>emotion:</strong> emotional ↔ neutral</li>
      <li><strong>motion:</strong> moving ↔ still</li>
      <li><strong>plurality:</strong> plural ↔ singular</li>
      <li><strong>relation:</strong> connected ↔ isolated</li>
    </ul>
    <p>
      
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
    background: var(--button-bg);
    color: var(--button-text);
    font-weight: 700;
    text-decoration: none;
    box-shadow: var(--shadow-sm);
  }

  .back:hover {
    background: var(--button-hover);
    box-shadow: var(--shadow-md);
  }

  .back:focus-visible {
    outline: none;
    background: var(--button-hover);
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
