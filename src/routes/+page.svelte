<script lang="ts">
  import { onMount } from 'svelte';
  import type { Action, GameRef, GameStart, GameView } from '$lib/game/types.ts';

  interface Stats {
    streak: number;
    max: number;
    lastDate: string | null;
    played: number;
    won: number;
    score: number;
    best: number;
  }

  const STORAGE_KEY = 'latent:game:v3';
  const STATS_KEY = 'latent:stats:v1';
  const EMPTY_STATS: Stats = { streak: 0, max: 0, lastDate: null, played: 0, won: 0, score: 0, best: 0 };
  const ERROR_TEXT: Record<string, string> = {
    not_a_word: 'Not a word I know — try another.',
    action_limit: 'No guesses left.',
    game_over: 'This game is over.',
    bad_request: 'That move did not make sense.',
    invalid_action: 'That move is not allowed right now.',
    store_error: 'Could not load the word data. Try again in a moment.',
    no_puzzle: 'No puzzle available for today.',
  };
  const RESET_CODES = new Set(['invalid_action', 'game_over', 'bad_request', 'action_limit']);

  let start = $state<GameStart | null>(null);
  let view = $state<GameView | null>(null);
  let actions = $state<Action[]>([]);
  let stats = $state<Stats>(EMPTY_STATS);
  let guessInput = $state('');
  let error = $state('');
  let busy = $state(true);
  let copied = $state(false);
  let confirmingGiveUp = $state(false);
  let dialog = $state<HTMLDialogElement | null>(null);
  let lastErrorCode = '';

  const roundDone = $derived(view ? view.roundEnded : false);
  const dayDone = $derived(view ? view.finished : false);
  const guessesLeft = $derived(view ? view.maxTurns - view.turnsUsed : 0);
  const roundResults = $derived(
    view ? [...view.results].sort((a, b) => a.index - b.index) : [],
  );
  const currentResult = $derived(roundResults.find((result) => result.index === view?.round) ?? null);
  const shareText = $derived.by(() => {
    if (!view) return '';
    const tag = view.game.kind === 'daily' ? view.game.date : 'random';
    const marks = roundResults.map((r) => (r.solved ? `🟩${r.turnsUsed}` : '🟥X')).join(' ');
    return `LatentGuess ${tag}\n${marks} · ${view.score} pts`;
  });

  const simTone = (similarity: number) => (similarity >= 0.6 ? 'good' : similarity >= 0.35 ? 'mid' : 'bad');

  function previousDate(date: string): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }

  function recordStats() {
    if (!view || view.game.kind !== 'daily' || !view.finished) return;
    if (stats.lastDate === view.game.date) return;
    const next = {
      ...stats,
      played: stats.played + 1,
      lastDate: view.game.date,
      score: stats.score + view.score,
      best: Math.max(stats.best, view.score),
    };
    const perfect = view.results.length > 0 && view.results.every((result) => result.solved);
    if (perfect) {
      next.won += 1;
      next.streak = stats.lastDate === previousDate(view.game.date) ? stats.streak + 1 : 1;
      next.max = Math.max(next.max, next.streak);
    } else {
      next.streak = 0;
    }
    stats = next;
    localStorage.setItem(STATS_KEY, JSON.stringify(next));
  }

  async function post(next: Action[]): Promise<boolean> {
    if (!start) return false;
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ game: start.game, actions: next }),
      });
      const data = (await res.json()) as { error?: string; view?: GameView };
      if (!res.ok) {
        lastErrorCode = data.error ?? '';
        error = ERROR_TEXT[lastErrorCode] ?? 'Something went wrong.';
        return false;
      }
      lastErrorCode = '';
      view = data.view as GameView;
      actions = next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ game: start.game, actions: next }));
      recordStats();
      return true;
    } catch {
      lastErrorCode = 'network';
      error = 'Network error.';
      return false;
    } finally {
      busy = false;
    }
  }

  async function init() {
    try {
      const res = await fetch('/api/puzzle/today');
      if (!res.ok) {
        error = "Could not load today's puzzle.";
        return;
      }
      const today = (await res.json()) as GameStart;
      start = today;

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        let parsed: { game?: GameRef; actions?: Action[] } | null = null;
        try {
          parsed = JSON.parse(saved) as { game?: GameRef; actions?: Action[] };
        } catch {
          parsed = null;
        }
        const savedGame = parsed?.game;
        const savedActions = parsed?.actions;
        const savedDate = savedGame?.kind === 'daily' ? savedGame.date : null;
        const todayDate = today.game.kind === 'daily' ? today.game.date : null;
        if (savedDate === todayDate && Array.isArray(savedActions)) {
          actions = savedActions;
        }
      }
      const restored = actions.length > 0;
      const ok = await post(actions);
      if (!ok && restored && RESET_CODES.has(lastErrorCode)) {
        actions = [];
        localStorage.removeItem(STORAGE_KEY);
        await post([]);
      }
    } finally {
      busy = false;
    }
  }

  async function submitGuess(event: SubmitEvent) {
    event.preventDefault();
    const word = guessInput.trim().toLowerCase();
    if (!word || busy || roundDone || dayDone) return;
    confirmingGiveUp = false;
    if (await post([...actions, { type: 'guess', word }])) guessInput = '';
  }

  async function giveUp() {
    if (busy || roundDone || dayDone) return;
    confirmingGiveUp = false;
    await post([...actions, { type: 'giveup' }]);
  }

  async function nextWord() {
    if (busy || !roundDone || dayDone) return;
    await post([...actions, { type: 'next' }]);
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(shareText);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      error = 'Could not copy to clipboard.';
    }
  }

  onMount(() => {
    const savedStats = localStorage.getItem(STATS_KEY);
    if (savedStats) {
      try {
        stats = { ...EMPTY_STATS, ...(JSON.parse(savedStats) as Partial<Stats>) };
      } catch {
        localStorage.removeItem(STATS_KEY);
      }
    }
    void init();
  });
</script>

<main>
  <header>
    <div class="brand-block">
      <h1 class="brand"><span class="brand-latent">Latent</span>Guess</h1>
      <p class="tagline">find the hidden word by meaning</p>
    </div>
    <div class="head-right">
      <button class="help" onclick={() => dialog?.showModal()}>How to play</button>
    </div>
  </header>

  {#if !view}
    <p class="muted loading">{error || 'Loading…'}</p>
  {:else}
    <div class="status">
      <span class="meta">
        Round {view.round + 1}/{view.rounds}
        {#if !roundDone}· {guessesLeft} {guessesLeft === 1 ? 'guess' : 'guesses'} left{/if}
      </span>
      <div class="progress" aria-hidden="true">
        <div class="progress-fill" style:width={`${(view.turnsUsed / view.maxTurns) * 100}%`}></div>
      </div>
      <span class="meta score">{view.score} pts</span>
    </div>

    {#if roundResults.length}
      <div class="rounds" aria-label="Finished words">
        {#each roundResults as result (result.index)}
          <span
            class="round-chip {result.solved ? 'good' : 'bad'}"
            title={`${result.answer} — ${result.solved
              ? `solved in ${result.turnsUsed}`
              : result.givenUp
                ? 'gave up'
                : 'out of guesses'} · ${result.score} pts`}
          >
            <strong>{result.answer}</strong>
            <span class="round-meta">
              {result.solved ? `${result.turnsUsed}/${view.maxTurns}` : result.givenUp ? 'gave up' : `X/${view.maxTurns}`}
            </span>
          </span>
        {/each}
      </div>
    {/if}

    {#if view.history.length}
      <p class="legend">
        Your guess and its similarity, a hint with a multiplier, and how accurately the hint lands. Tap a
        clue to try it.
      </p>
      <section class="board" aria-label="Guess history">
        {#each view.history as entry, i (i)}
          {#if entry.type === 'guess'}
            {@const guess = entry}
            <div class="row">
              <span class="word">{guess.word}</span>
              <span class="sim {simTone(guess.similarity)}" title="Direct similarity to the hidden word">
                {Math.max(0, Math.round(guess.similarity * 100))}%
              </span>
              <span class="arrow" aria-hidden="true">→</span>
              <button
                class="clue"
                onclick={() => (guessInput = guess.clue)}
                title={`Use "${guess.clue}" as your next guess`}
              >
                {#if guess.multiplier !== null}<span class="mult">{guess.multiplier.toFixed(1)} ×</span>{/if}{guess.clue}
              </button>
              <span
                class="sum"
                title={`Closest word to the vector sum: "${guess.sumWord}" — ${Math.round(
                  guess.sumSimilarity * 100,
                )}% similar to the hidden word`}
              >
                {Math.max(0, Math.round(guess.sumSimilarity * 100))}%
              </span>
            </div>
          {:else}
            <div class="row giveup-row">
              <span class="muted">gave up</span>
            </div>
          {/if}
        {/each}
      </section>
    {:else if !roundDone}
      <p class="empty">Guess any word to begin. Every guess shows how close you are and which way to move.</p>
    {/if}

    {#if dayDone}
      <section class="over">
        <p class="answer-label">Day complete</p>
        <p class="final-score total">{view.score} pts</p>
        <div class="over-actions">
          <button class="primary" onclick={share}>{copied ? 'Copied' : 'Share result'}</button>
          {#if view.game.kind === 'daily'}
            <span class="muted">streak {stats.streak} · best {stats.best} pts</span>
          {/if}
        </div>
      </section>
    {:else if roundDone}
      <section class="over">
        <p class="answer-label">
          {currentResult?.solved ? 'Solved' : currentResult?.givenUp ? 'Gave up' : 'Out of guesses'}
        </p>
        <p class="answer"><strong>{view.roundAnswer}</strong></p>
        <p class="final-score">{currentResult?.score ?? 0} pts for this word</p>
        <div class="over-actions">
          <button class="primary" onclick={nextWord}>Next word</button>
        </div>
      </section>
    {:else}
      <form class="entry" onsubmit={submitGuess}>
        <input
          bind:value={guessInput}
          placeholder="guess a word"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          aria-label="Guess a word"
          disabled={busy}
        />
        <button class="primary" type="submit" disabled={busy || !guessInput.trim()}>Guess</button>
      </form>
      {#if error}<p class="error">{error}</p>{/if}
      <div class="give-up">
        {#if confirmingGiveUp}
          <span class="muted">Give up on this word?</span>
          <button class="help" onclick={giveUp}>yes, skip it</button>
          <button class="help" onclick={() => (confirmingGiveUp = false)}>cancel</button>
        {:else}
          <button class="help" onclick={() => (confirmingGiveUp = true)}>give up</button>
        {/if}
      </div>
    {/if}
  {/if}

  <footer class="foot">hints from GloVe · Wikipedia + Gigaword</footer>

  <dialog bind:this={dialog} aria-labelledby="howto-title">
    <div class="sheet">
      <div class="sheet-head">
        <h2 id="howto-title">How to play</h2>
        <button class="close" onclick={() => dialog?.close()} aria-label="Close">×</button>
      </div>
      <p>Find five hidden words a day — 10 guesses each. Every guess gives three signals:</p>
      <ul>
        <li>
          <strong>A percentage</strong> — how similar your word is to the hidden word.
        </li>
        <li>
          <strong>A hint</strong> — a word and how much of it to take, like <strong>0.5 × summer</strong>.
          Move half a step toward summer, not all the way.
        </li>
        <li>
          <strong>A hint score</strong> — the small percentage after the hint: how close the hint's vector
          sum lands to the hidden word. Higher means a better-aimed hint.
        </li>
      </ul>
      <p>
        Example: if the hidden word were <em>winter</em>, guessing <em>snow</em> might answer
        <strong>0.5 × summer</strong>. Tap a hint to try it, or use it as inspiration.
      </p>
      <p>
        Hints never name the hidden word or its close variants, and they get more oblique the further
        away you are. Guess the exact word to move on to the next one.
      </p>
      <p>
        <strong>Scoring:</strong> every guess earns its similarity percentage, and solving early adds a
        bonus of up to 2,000 points (2,000 for the first guess, then 1,800, and so on down to 200).
        Stuck on a word? <strong>Give up</strong> to skip it and keep the points you earned. After all
        five words, share your day.
      </p>
      <h3>How similarity works</h3>
      <p>
        Every word becomes <strong>300 numbers</strong> — its vector — learned by <strong>GloVe</strong> from
        about 6 billion words of English (the 2014 Wikipedia dump plus the Gigaword news archive). A vector
        records the kinds of sentences the word tends to appear in.
      </p>
      <p>
        Two words are <strong>similar</strong> when their vectors point in the same direction. The percentage
        shown next to a guess is their <strong>cosine similarity</strong>:
      </p>
      <ul>
        <li>
          <strong>100%</strong> — the same direction: the word itself, or one used in nearly identical
          sentences.
        </li>
        <li>
          <strong>0%</strong> — unrelated directions: the words share almost no context. Slightly negative
          values are shown as 0%.
        </li>
      </ul>
      <p>
        Similarity is about <strong>usage, not spelling or dictionary meaning</strong>. <em>Sea</em> is close
        to <em>ocean</em> because they appear in similar sentences. <em>Hot</em> and <em>cold</em> are also
        fairly close — they are opposites, but they show up in the same kinds of sentences. A word with several
        meanings sits between all of them.
      </p>
      <p class="source">
        So a high percentage means “used the way the hidden word is used”, not “defined the same way”. The
        percentages reflect the training text, including its quirks and biases.
      </p>
      <button class="primary done" onclick={() => dialog?.close()}>Got it</button>
    </div>
  </dialog>
</main>

<style>
  main {
    max-width: 600px;
    margin: 0 auto;
    padding: 40px 22px 72px;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }

  .brand-block {
    min-width: 0;
  }

  .brand {
    margin: 0;
    font-size: clamp(30px, 8vw, 40px);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1.05;
  }

  .brand-latent {
    color: var(--brand);
  }

  .tagline {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--muted);
  }

  .head-right {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-top: 8px;
    flex-shrink: 0;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }

  .meta {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .progress {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: var(--track);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--brand), var(--accent));
    transition: width 300ms ease;
  }

  .score {
    font-weight: 600;
    color: var(--text);
  }

  .rounds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }

  .round-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 8px;
    font-size: 12px;
    background: var(--track);
  }

  .round-chip strong {
    font-weight: 600;
  }

  .round-chip.good {
    background: color-mix(in srgb, var(--good) 14%, transparent);
    color: var(--good);
  }

  .round-chip.bad {
    background: color-mix(in srgb, var(--bad) 12%, transparent);
    color: var(--bad);
  }

  .round-meta {
    color: var(--muted);
  }

  .help {
    border: 0;
    background: none;
    padding: 0;
    font-size: 13px;
    color: var(--muted);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .help:hover:not(:disabled) {
    color: var(--text);
  }

  .help:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .legend {
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 10px;
  }

  .empty {
    margin: 30px 0 0;
    text-align: center;
    color: var(--muted);
    font-size: 14px;
  }

  .board {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    transition:
      box-shadow 200ms ease,
      transform 200ms ease;
    animation: rise 260ms ease both;
  }

  .row:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-1px);
  }

  .giveup-row {
    justify-content: center;
    font-size: 13px;
    background: transparent;
    box-shadow: none;
    animation: none;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .word {
    font-weight: 600;
    font-size: 15px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sim {
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    color: var(--muted);
  }

  .sim.good {
    color: var(--good);
  }

  .sim.mid {
    color: var(--mid);
  }

  .sim.bad {
    color: var(--bad);
  }

  .arrow {
    color: var(--muted);
    flex-shrink: 0;
  }

  .clue {
    margin-left: auto;
    border: 0;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    padding: 5px 12px;
    border-radius: 8px;
    font-weight: 600;
    color: var(--accent);
    flex-shrink: 0;
    transition: background 160ms ease;
  }

  .clue:hover {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .mult {
    color: var(--muted);
    font-weight: 600;
    margin-right: 2px;
  }

  .sum {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    flex-shrink: 0;
  }

  .entry {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 24px;
  }

  .entry input {
    flex: 1;
    min-width: 0;
    padding: 13px 18px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    outline: none;
    transition: box-shadow 160ms ease;
  }

  .entry input:focus {
    box-shadow: var(--shadow-md);
  }

  .entry input::placeholder {
    color: var(--muted);
  }

  .give-up {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-top: 16px;
    font-size: 13px;
  }

  .entry button,
  .over button {
    border: 0;
    border-radius: var(--radius);
    padding: 13px 22px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    font-weight: 600;
    transition:
      filter 160ms ease,
      box-shadow 160ms ease;
  }

  .entry button:hover:not(:disabled),
  .over button:hover:not(:disabled) {
    box-shadow: var(--shadow-md);
  }

  button.primary {
    background: var(--text);
    color: var(--bg);
  }

  button.primary:hover:not(:disabled) {
    filter: brightness(1.2);
  }

  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  button:focus-visible {
    outline: none;
  }

  .help:focus-visible,
  .clue:focus-visible,
  .close:focus-visible {
    color: var(--text);
  }

  .entry button:focus-visible,
  .over button:focus-visible {
    filter: brightness(0.9);
  }

  .over {
    margin-top: 30px;
    padding: 24px;
    background: var(--surface);
    border-radius: 18px;
    box-shadow: var(--shadow-md);
    text-align: center;
  }

  .answer-label {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
  }

  .answer {
    margin: 8px 0 18px;
  }

  .answer strong {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .final-score {
    margin: 0 0 18px;
    font-size: 15px;
    font-weight: 600;
    color: var(--brand);
  }

  .final-score.total {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .over-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .over-actions .muted {
    font-size: 13px;
  }

  .error {
    color: var(--bad);
    font-size: 13px;
    margin: 12px 0 0;
    text-align: center;
  }

  .loading {
    padding: 28px 0;
  }

  .muted {
    color: var(--muted);
  }

  .foot {
    margin-top: 64px;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    opacity: 0.75;
  }

  dialog {
    width: min(520px, calc(100vw - 40px));
    padding: 0;
    border: 0;
    border-radius: 18px;
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-md);
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.45);
  }

  .sheet {
    padding: 20px 22px 22px;
    max-height: 82vh;
    overflow: auto;
  }

  .sheet-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .sheet h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .sheet h3 {
    margin: 16px 0 4px;
    font-size: 14px;
    font-weight: 700;
  }

  .sheet p {
    font-size: 14px;
    line-height: 1.55;
    margin: 10px 0;
  }

  .sheet ul {
    margin: 10px 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    line-height: 1.55;
  }

  .source {
    color: var(--muted);
    font-size: 13px;
  }

  .close {
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 20px;
    line-height: 1;
    padding: 0 4px;
  }

  .close:hover {
    color: var(--text);
  }

  .done {
    width: 100%;
    margin-top: 8px;
  }

  @media (max-width: 460px) {
    header {
      flex-direction: column;
      gap: 10px;
    }

    .head-right {
      padding-top: 0;
    }

    .brand {
      font-size: 32px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .row,
    .progress-fill,
    .entry input,
    .entry button,
    .over button,
    .clue {
      animation: none;
      transition: none;
    }
  }
</style>
