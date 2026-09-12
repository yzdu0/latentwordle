<script lang="ts">
  import { onMount } from 'svelte';
  import AxisCard from '$lib/components/AxisCard.svelte';
  import { matchTone, TONE_EMOJI } from '$lib/game/presentation.ts';
  import type { Action, AxisResult, GameRef, GameStart, GameView } from '$lib/game/types.ts';

  interface Stats {
    streak: number;
    max: number;
    lastDate: string | null;
    played: number;
    won: number;
  }

  const STORAGE_KEY = 'latent:game:v1';
  const STATS_KEY = 'latent:stats:v1';
  const EMPTY_STATS: Stats = { streak: 0, max: 0, lastDate: null, played: 0, won: 0 };
  const ERROR_TEXT: Record<string, string> = {
    not_a_word: 'Not a word I know — try another.',
    unknown_concept: 'That concept is not available yet.',
    duplicate_concept: 'That concept is already on the board.',
    action_limit: 'No turns left.',
    game_over: 'This game is over.',
    bad_request: 'That move did not make sense.',
  };

  let start = $state<GameStart | null>(null);
  let view = $state<GameView | null>(null);
  let actions = $state<Action[]>([]);
  let stats = $state<Stats>(EMPTY_STATS);
  let guessInput = $state('');
  let swapSlot = $state<number | null>(null);
  let swapInput = $state('');
  let error = $state('');
  let busy = $state(true);
  let copied = $state(false);
  let dialog = $state<HTMLDialogElement | null>(null);

  const ended = $derived(view ? view.solved || view.revealed : false);
  const turnsLeft = $derived(view ? view.maxTurns - view.turnsUsed : 0);
  const latestResults = $derived.by(() => {
    if (!view) return null as AxisResult[] | null;
    for (let i = view.history.length - 1; i >= 0; i--) {
      const entry = view.history[i];
      if (entry.type === 'guess') return entry.results;
    }
    return null as AxisResult[] | null;
  });
  const shareText = $derived.by(() => {
    if (!view) return '';
    const tag = view.game.kind === 'daily' ? view.game.date : 'random';
    const lines = [`Latent ${tag} — ${view.solved ? view.turnsUsed : 'X'}/${view.maxTurns}`];
    for (const entry of view.history) {
      if (entry.type === 'guess') {
        lines.push(entry.results.map((r) => TONE_EMOJI[matchTone(r.match)]).join(''));
      } else {
        lines.push('↺');
      }
    }
    return lines.join('\n');
  });

  const cellTone = (match: number) => matchTone(match);

  function previousDate(date: string): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }

  function recordStats() {
    if (!view || view.game.kind !== 'daily') return;
    if (!(view.solved || view.revealed) || stats.lastDate === view.game.date) return;
    const next = { ...stats, played: stats.played + 1, lastDate: view.game.date };
    if (view.solved) {
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
        error = ERROR_TEXT[data.error ?? ''] ?? 'Something went wrong.';
        return false;
      }
      view = data.view as GameView;
      actions = next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ game: start.game, actions: next }));
      recordStats();
      return true;
    } catch {
      error = 'Network error.';
      return false;
    } finally {
      busy = false;
    }
  }

  async function fetchStart(game: GameRef): Promise<GameStart | null> {
    const url =
      game.kind === 'daily'
        ? `/api/puzzle/today?date=${encodeURIComponent(game.date)}`
        : `/api/puzzle/random?seed=${game.seed}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as GameStart;
  }

  async function newGame() {
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/puzzle/random');
      if (!res.ok) {
        error = 'Could not start a new game.';
        return;
      }
      start = (await res.json()) as GameStart;
      view = null;
      actions = [];
      guessInput = '';
      swapSlot = null;
      swapInput = '';
      localStorage.removeItem(STORAGE_KEY);
      await post([]);
    } finally {
      busy = false;
    }
  }

  async function init() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        let parsed: { game?: GameRef; actions?: Action[] } | null = null;
        try {
          parsed = JSON.parse(saved) as { game?: GameRef; actions?: Action[] };
        } catch {
          parsed = null;
        }
        if (parsed?.game) {
          const restored = await fetchStart(parsed.game);
          if (restored) {
            start = restored;
            actions = Array.isArray(parsed.actions) ? parsed.actions : [];
            await post(actions);
            return;
          }
        }
        localStorage.removeItem(STORAGE_KEY);
      }
      await newGame();
    } finally {
      busy = false;
    }
  }

  async function submitGuess(event: SubmitEvent) {
    event.preventDefault();
    const word = guessInput.trim().toLowerCase();
    if (!word || busy || ended) return;
    if (await post([...actions, { type: 'guess', word }])) guessInput = '';
  }

  async function submitSwap(event: SubmitEvent) {
    event.preventDefault();
    if (swapSlot === null || busy) return;
    const concept = swapInput.trim().toLowerCase();
    if (!concept) return;
    if (await post([...actions, { type: 'swap', slot: swapSlot, concept }])) {
      swapInput = '';
      swapSlot = null;
    }
  }

  function beginSwap(slot: number) {
    if (busy || ended) return;
    swapSlot = slot;
    swapInput = '';
    error = '';
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
    <h1>Latent</h1>
    <div class="head-right">
      {#if view}
        <p class="meta">
          {#if ended}
            {view.solved ? `solved in ${view.turnsUsed}` : 'out of turns'}
          {:else}
            {turnsLeft} {turnsLeft === 1 ? 'turn' : 'turns'} left
          {/if}
        </p>
      {/if}
      <button class="help" onclick={newGame} disabled={busy}>New game</button>
      <button class="help" onclick={() => dialog?.showModal()}>How to play</button>
    </div>
  </header>

  {#if !view}
    <p class="muted loading">{error || 'Loading…'}</p>
  {:else}
    <section class="axes" aria-label="Concepts">
      {#each view.concepts as concept, i (concept)}
        <AxisCard
          label={concept}
          result={latestResults?.[i] ?? null}
          disabled={ended || busy}
          onswap={() => beginSwap(i)}
        />
      {/each}
    </section>

    {#if view.history.length}
      <p class="legend">
        Each concept is a scale — the tick is the hidden word, the dot is your guess. Aim for the tick.
      </p>
      <section class="board" aria-label="Guess history">
        {#each view.history as entry (entry.turn)}
          {#if entry.type === 'guess'}
            <div class="row">
              <span class="word">{entry.word}</span>
              <span class="cells">
                {#each entry.results as result}
                  <span class="cell {cellTone(result.match)}">{result.match}</span>
                {/each}
              </span>
            </div>
          {:else}
            <div class="row swap">
              <span>↺ {entry.concept} <span class="muted">replaces {entry.from}</span></span>
            </div>
          {/if}
        {/each}
      </section>
    {/if}

    {#if ended}
      <section class="over">
        <p class="answer">
          {#if view.solved}
            Found it.
          {:else}
            The word was
          {/if}
          <strong>{view.answer}</strong>
        </p>
        <div class="over-actions">
          <button class="primary" onclick={share}>{copied ? 'Copied' : 'Share'}</button>
          <button class="ghost" onclick={newGame}>New game</button>
          {#if view.game.kind === 'daily'}
            <span class="muted">{stats.streak} streak · best {stats.max}</span>
          {/if}
        </div>
      </section>
    {:else}
      {#if swapSlot !== null}
        <form class="entry" onsubmit={submitSwap}>
          <span class="slot">replace <strong>{view.concepts[swapSlot]}</strong></span>
          <input
            bind:value={swapInput}
            placeholder="new concept"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            aria-label="New concept"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !swapInput.trim()}>Swap</button>
          <button
            type="button"
            class="ghost"
            onclick={() => {
              swapSlot = null;
              swapInput = '';
            }}>Cancel</button
          >
        </form>
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
          <button type="submit" disabled={busy || !guessInput.trim()}>Guess</button>
        </form>
      {/if}
      {#if error}<p class="error">{error}</p>{/if}
    {/if}
  {/if}

  <dialog bind:this={dialog} aria-labelledby="howto-title">
    <div class="sheet">
      <div class="sheet-head">
        <h2 id="howto-title">How to play</h2>
        <button class="close" onclick={() => dialog?.close()} aria-label="Close">×</button>
      </div>
      <p>Find the hidden word in 10 turns. Every guess is scored on five concepts.</p>
      <p>
        Each concept is a scale from “none of it” to “a lot of it”. The <strong>tick</strong> marks the
        hidden word’s position. Your <strong>dot</strong> is your guess.
      </p>
      <ul>
        <li>
          The number is your match: <strong>100</strong> means your word sits exactly where the hidden word
          sits on that concept.
        </li>
        <li>
          Dot <strong>left</strong> of the tick: your word has <strong>less</strong> of that concept than the
          hidden word. Dot <strong>right</strong>: more.
        </li>
        <li>Aim your next guess toward the tick.</li>
      </ul>
      <p class="example">
        For example, if the water dot sits left of the tick, the hidden word is wetter than your guess — try
        something more aquatic.
      </p>
      <p>
        A turn is either a guess or a concept swap. Press <strong>↺</strong> on a concept to replace it with a
        word of your own. The swap costs one turn, and the new concept is applied to every guess you have
        already made — perfect for testing theories and narrowing the answer down.
      </p>
      <p>
        Guessing the exact hidden word wins. A close synonym can score 100 on every concept and still not be
        the answer.
      </p>
      <p class="colors">
        Colors: <span class="sample good">85+</span>
        <span class="sample mid">60–84</span>
        <span class="sample bad">under 60</span>
      </p>
      <button class="primary done" onclick={() => dialog?.close()}>Got it</button>
    </div>
  </dialog>
</main>

<style>
  main {
    max-width: 620px;
    margin: 0 auto;
    padding: 32px 20px 64px;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  h1 {
    font-size: 18px;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .meta {
    margin: 0;
    font-size: 13px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .axes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(104px, 1fr));
    gap: 8px;
  }

  .legend {
    font-size: 12px;
    color: var(--muted);
    margin: 16px 0 8px;
  }

  .board {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .word {
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cells {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .cell {
    width: 34px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 3px 0;
    border-radius: 5px;
    color: #fff;
    background: var(--bad);
  }

  .cell.good {
    background: var(--good);
  }

  .cell.mid {
    background: var(--mid);
  }

  .row.swap {
    background: none;
    border-style: dashed;
    color: var(--muted);
    font-size: 13px;
    padding: 6px 12px;
  }

  .entry {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 20px;
  }

  .entry input {
    flex: 1;
    min-width: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    outline: none;
  }

  .entry input:focus {
    border-color: var(--accent);
  }

  button {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 8px;
    padding: 10px 16px;
  }

  button.primary {
    background: var(--text);
    color: var(--bg);
    border-color: var(--text);
    font-weight: 500;
  }

  button.ghost {
    border-color: transparent;
    color: var(--muted);
    padding: 10px 8px;
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .slot {
    font-size: 13px;
    color: var(--muted);
    white-space: nowrap;
  }

  .over {
    margin-top: 24px;
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  .answer {
    margin: 0 0 12px;
  }

  .answer strong {
    font-weight: 600;
  }

  .over-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .over-actions .muted {
    font-size: 13px;
  }

  .error {
    color: var(--bad);
    font-size: 13px;
    margin: 10px 0 0;
  }

  .loading {
    padding: 24px 0;
  }

  .muted {
    color: var(--muted);
  }

  .head-right {
    display: flex;
    align-items: baseline;
    gap: 14px;
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

  .help:hover {
    color: var(--text);
  }

  dialog {
    width: min(520px, calc(100vw - 40px));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
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
    font-size: 16px;
    font-weight: 600;
  }

  .sheet p,
  .sheet ul {
    font-size: 14px;
    line-height: 1.55;
    color: var(--text);
    margin: 10px 0;
  }

  .sheet ul {
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .example {
    color: var(--muted);
    border-left: 2px solid var(--border);
    padding-left: 12px;
  }

  .colors {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }

  .sample {
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 5px;
    background: var(--bad);
  }

  .sample.good {
    background: var(--good);
  }

  .sample.mid {
    background: var(--mid);
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
</style>
