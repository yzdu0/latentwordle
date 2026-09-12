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
    <div class="formula"><code>s(g, a) = g · a = ∑ gᵢaᵢ</code></div>
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
      <code>c · a</code> and how strongly it projects onto that direction. Its least-squares coefficient is:
    </p>
    <div class="formula"><code>α = (Δ · c) / (c · c)</code></div>
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
      A concept is intended to help narrow down the hidden word via comparisons. For now, this is naively implemented; maybe in the future I will find a better way to do so?
    </p>
    <ul>
      <li><strong>abstraction:</strong> abstract, specific, tangible, physical</li>
      <li><strong>emotion:</strong> happy, sad, angry, afraid</li>
      <li><strong>motion:</strong> motion, stillness</li>
      <li><strong>plurality:</strong> plural, singular</li>
      <li><strong>relation:</strong> relation, isolation</li>
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
