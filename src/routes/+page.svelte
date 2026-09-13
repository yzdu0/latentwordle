<script lang="ts">
    import { onMount } from "svelte";
    import { dev } from "$app/environment";
    import { base } from "$app/paths";
    import { CONCEPTS } from "$lib/game/concepts.ts";
    import { DECOMPOSITION_UNLOCK_TURN } from "$lib/game/rules.ts";
    import type {
        Action,
        GameRef,
        GameStart,
        GameView,
    } from "$lib/game/types.ts";
    import type { ConceptKey } from "$lib/game/concepts.ts";

    interface Stats {
        streak: number;
        max: number;
        lastDate: string | null;
        played: number;
        won: number;
        score: number;
        best: number;
    }

    interface ScoreHistogram {
        date: string;
        bucketSize: number;
        bins: number[];
        total: number;
    }

    const LEGACY_STORAGE_KEY = "latent:game:v3";
    const STORAGE_PREFIX = "latent:game:v4";
    const STATS_KEY = "latent:stats:v1";
    const TUTORIAL_KEY = "latent:tutorial:v1";
    const TUTORIAL_LAST_STEP = 2;
    const SUBMISSION_ID_RE = /^[a-zA-Z0-9_-]{16,128}$/;
    const EMPTY_STATS: Stats = {
        streak: 0,
        max: 0,
        lastDate: null,
        played: 0,
        won: 0,
        score: 0,
        best: 0,
    };
    const ERROR_TEXT: Record<string, string> = {
        not_a_word: "Not a word I know. Try another.",
        action_limit: "No guesses left.",
        game_over: "This game is over.",
        bad_request: "That move did not make sense.",
        invalid_action: "That move is not allowed right now.",
        store_error: "Could not load the word data. Try again in a moment.",
        no_puzzle: "No puzzle available for today.",
    };
    const RESET_CODES = new Set([
        "invalid_action",
        "game_over",
        "bad_request",
        "action_limit",
    ]);

    let start = $state<GameStart | null>(null);
    let view = $state<GameView | null>(null);
    let actions = $state<Action[]>([]);
    let submissionId = $state("");
    let stats = $state<Stats>(EMPTY_STATS);
    let guessInput = $state("");
    let conceptGuess = $state<ConceptKey | "">("");
    let error = $state("");
    let busy = $state(true);
    let copied = $state(false);
    let dialog = $state<HTMLDialogElement | null>(null);
    let tutorialDialog = $state<HTMLDialogElement | null>(null);
    let tutorialStep = $state(0);
    let lastErrorCode = "";
    let playableDates = $state<string[]>([]);
    let selectedDate = $state("");
    let archiveOpen = $state(false);
    let nextGameIn = $state("");
    let histogram = $state<ScoreHistogram | null>(null);
    let histogramLoading = $state(false);

    const roundDone = $derived(view ? view.roundEnded : false);
    const dayDone = $derived(view ? view.finished : false);
    const hardMode = $derived(view?.game.kind === "hard");
    const decompositionReady = $derived(
        view ? view.turnsUsed >= DECOMPOSITION_UNLOCK_TURN : false,
    );
    const quickHintWord = $derived.by(() => {
        if (!view) return "";
        const guessedWords = new Set(
            view.history
                .filter((entry) => entry.type === "guess")
                .map((entry) => entry.word),
        );
        for (let index = view.history.length - 1; index >= 0; index -= 1) {
            const entry = view.history[index];
            if (entry.type === "guess" && entry.clue) {
                const candidates = [
                    { word: entry.clue, similarity: entry.clueSimilarity },
                    ...(entry.secondClue
                        ? [
                              {
                                  word: entry.secondClue,
                                  similarity:
                                      entry.secondClueSimilarity ?? 0,
                              },
                          ]
                        : []),
                ]
                    .filter((candidate) => !guessedWords.has(candidate.word))
                    .sort((a, b) => b.similarity - a.similarity);
                if (candidates[0]) return candidates[0].word;
            }
            if (entry.type === "decomposition") {
                const candidate = [...entry.terms]
                    .filter((term) => !guessedWords.has(term.word))
                    .sort((a, b) => b.similarity - a.similarity)[0];
                if (candidate) return candidate.word;
            }
        }
        return "";
    });
    const guessesLeft = $derived(view ? view.maxTurns - view.turnsUsed : 0);
    const roundResults = $derived(
        view ? [...view.results].sort((a, b) => a.index - b.index) : [],
    );
    const currentResult = $derived(
        roundResults.find((result) => result.index === view?.round) ?? null,
    );
    const histogramMax = $derived(
        histogram ? Math.max(1, ...histogram.bins) : 1,
    );
    const userScoreBucket = $derived(
        histogram && view
            ? Math.max(
                  0,
                  Math.min(
                      histogram.bins.length - 1,
                      Math.floor(view.score / histogram.bucketSize),
                  ),
              )
            : -1,
    );
    const SHARE_CACHE_VERSION = 2;
    const shareLink = $derived(
        typeof window === "undefined"
            ? `${base}/?v=${SHARE_CACHE_VERSION}`
            : new URL(
                  `${base}/?v=${SHARE_CACHE_VERSION}`,
                  window.location.origin,
              ).toString(),
    );
    const shareText = $derived.by(() => {
        const gameView = view;
        if (!gameView) return "";
        const gameLabel =
            gameView.game.kind === "daily"
                ? `Daily ${gameView.game.date}`
                : gameView.game.kind === "hard"
                  ? `Hard ${gameView.game.date}`
                  : `Random #${gameView.game.seed}`;
        const solved = roundResults.filter((result) => result.solved).length;
        const scorecard = roundResults
            .map((result) => {
                if (result.solved)
                    return `🟩 ${result.turnsUsed}/${gameView.maxTurns}`;
                return `${result.bestSimilarity > 0.5 ? "🟧" : "🟥"} X/${gameView.maxTurns}`;
            })
            .join("\n");
        return [
            `LatentGuess: ${gameLabel}`,
            `ζ ${solved}/${gameView.rounds} words found`,
            "",
            scorecard,
            "",
            `${gameView.score.toLocaleString("en-US")} points`,
            "",
            "Can you find ζ?",
            shareLink,
        ].join("\n");
    });

    const simTone = (similarity: number) =>
        similarity >= 0.6 ? "good" : similarity >= 0.35 ? "mid" : "bad";
    const signedPercent = (similarity: number) =>
        `${Math.round(similarity * 100)}%`;

    function previousDate(date: string): string {
        return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000)
            .toISOString()
            .slice(0, 10);
    }

    function gameStorageKey(game: GameRef): string {
        const key = game.kind === "random" ? game.seed : game.date;
        return `${STORAGE_PREFIX}:${game.kind}:${key}`;
    }

    function sameGame(a: GameRef | undefined, b: GameRef): boolean {
        if (!a) return false;
        if (a.kind === "daily" && b.kind === "daily") return a.date === b.date;
        if (a.kind === "hard" && b.kind === "hard") return a.date === b.date;
        if (a.kind === "random" && b.kind === "random")
            return a.seed === b.seed;
        return false;
    }

    function datesThrough(today: string): string[] {
        const day = Date.parse(`${today}T00:00:00Z`);
        return Array.from({ length: 4 }, (_, index) =>
            new Date(day - index * 86_400_000).toISOString().slice(0, 10),
        );
    }

    function updateCountdown(): void {
        const now = new Date();
        const next = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() + 1,
        );
        const seconds = Math.max(0, Math.floor((next - now.getTime()) / 1_000));
        const hours = Math.floor(seconds / 3_600);
        const minutes = Math.floor((seconds % 3_600) / 60);
        const remainingSeconds = seconds % 60;
        nextGameIn = [hours, minutes, remainingSeconds]
            .map((part) => String(part).padStart(2, "0"))
            .join(":");
    }

    function histogramLabel(index: number, bucketSize: number): string {
        const start = index * bucketSize;
        return start === 0 ? "0" : `${start / 1_000}k`;
    }

    function histogramBarHeight(count: number): number {
        return count > 0 ? Math.max(8, (count / histogramMax) * 100) : 0;
    }

    function createSubmissionId(): string {
        if (globalThis.crypto?.randomUUID)
            return globalThis.crypto.randomUUID();
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function recordStats() {
        if (dev) return;
        if (!view || view.game.kind !== "daily" || !view.finished) return;
        if (playableDates[0] && view.game.date !== playableDates[0]) return;
        if (stats.lastDate === view.game.date) return;
        const next = {
            ...stats,
            played: stats.played + 1,
            lastDate: view.game.date,
            score: stats.score + view.score,
            best: Math.max(stats.best, view.score),
        };
        const perfect =
            view.results.length > 0 &&
            view.results.every((result) => result.solved);
        if (perfect) {
            next.won += 1;
            next.streak =
                stats.lastDate === previousDate(view.game.date)
                    ? stats.streak + 1
                    : 1;
            next.max = Math.max(next.max, next.streak);
        } else {
            next.streak = 0;
        }
        stats = next;
        localStorage.setItem(STATS_KEY, JSON.stringify(next));
    }

    async function loadHistogram(game: GameRef): Promise<void> {
        histogram = null;
        if (game.kind !== "daily") return;
        histogramLoading = true;
        try {
            const res = await fetch(
                `${base}/api/stats/scores?date=${encodeURIComponent(game.date)}`,
            );
            if (!res.ok) return;
            const data = (await res.json()) as Partial<ScoreHistogram>;
            if (
                data.date === game.date &&
                typeof data.bucketSize === "number" &&
                Array.isArray(data.bins) &&
                data.bins.every((count) => typeof count === "number") &&
                typeof data.total === "number"
            ) {
                histogram = data as ScoreHistogram;
            }
        } catch {
            histogram = null;
        } finally {
            histogramLoading = false;
        }
    }

    async function post(next: Action[]): Promise<boolean> {
        if (!start) return false;
        busy = true;
        error = "";
        try {
            const res = await fetch(`${base}/api/score`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    game: start.game,
                    actions: next,
                    submissionId,
                }),
            });
            const data = (await res.json()) as {
                error?: string;
                view?: GameView;
            };
            if (!res.ok) {
                lastErrorCode = data.error ?? "";
                error = ERROR_TEXT[lastErrorCode] ?? "Something went wrong.";
                return false;
            }
            lastErrorCode = "";
            view = data.view as GameView;
            actions = next;
            localStorage.setItem(
                gameStorageKey(start.game),
                JSON.stringify({
                    game: start.game,
                    actions: next,
                    submissionId,
                }),
            );
            recordStats();
            if (view.finished) await loadHistogram(view.game);
            return true;
        } catch {
            lastErrorCode = "network";
            error = "Network error.";
            return false;
        } finally {
            busy = false;
        }
    }

    async function init(date?: string) {
        archiveOpen = false;
        busy = true;
        error = "";
        histogram = null;
        actions = [];
        submissionId = "";
        guessInput = "";
        conceptGuess = "";
        try {
            const query = date ? `?date=${encodeURIComponent(date)}` : "";
            const res = await fetch(`${base}/api/puzzle/today${query}`);
            if (!res.ok) {
                error = "Could not load that daily game.";
                return;
            }
            const today = (await res.json()) as GameStart;
            start = today;
            if (today.game.kind === "daily") {
                selectedDate = today.game.date;
                if (playableDates.length === 0)
                    playableDates = datesThrough(today.game.date);
            }

            const currentStorageKey = gameStorageKey(today.game);
            const saved =
                localStorage.getItem(currentStorageKey) ??
                localStorage.getItem(LEGACY_STORAGE_KEY);
            if (saved) {
                let parsed: {
                    game?: GameRef;
                    actions?: Action[];
                    submissionId?: unknown;
                } | null = null;
                try {
                    parsed = JSON.parse(saved) as {
                        game?: GameRef;
                        actions?: Action[];
                        submissionId?: unknown;
                    };
                } catch {
                    parsed = null;
                }
                const savedGame = parsed?.game;
                const savedActions = parsed?.actions;
                const savedSubmissionId = parsed?.submissionId;
                if (
                    sameGame(savedGame, today.game) &&
                    Array.isArray(savedActions)
                ) {
                    actions = savedActions;
                    if (
                        typeof savedSubmissionId === "string" &&
                        SUBMISSION_ID_RE.test(savedSubmissionId)
                    ) {
                        submissionId = savedSubmissionId;
                    }
                }
            }
            if (!submissionId) submissionId = createSubmissionId();
            const restored = actions.length > 0;
            const ok = await post(actions);
            if (!ok && restored && RESET_CODES.has(lastErrorCode)) {
                actions = [];
                localStorage.removeItem(currentStorageKey);
                await post([]);
            }
        } finally {
            busy = false;
        }
    }

    async function initHard() {
        if (busy) return;
        archiveOpen = false;
        busy = true;
        error = "";
        histogram = null;
        actions = [];
        submissionId = "";
        guessInput = "";
        conceptGuess = "";
        const hardDate = selectedDate || playableDates[0];
        if (!hardDate) {
            busy = false;
            return;
        }
        const hardStart: GameStart = {
            game: { kind: "hard", date: hardDate },
            maxTurns: start?.maxTurns ?? 10,
            rounds: start?.rounds ?? 5,
        };
        start = hardStart;
        const storageKey = gameStorageKey(hardStart.game);
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as {
                    game?: GameRef;
                    actions?: Action[];
                    submissionId?: unknown;
                };
                if (
                    sameGame(parsed.game, hardStart.game) &&
                    Array.isArray(parsed.actions)
                ) {
                    actions = parsed.actions;
                    if (
                        typeof parsed.submissionId === "string" &&
                        SUBMISSION_ID_RE.test(parsed.submissionId)
                    ) {
                        submissionId = parsed.submissionId;
                    }
                }
            } catch {
                localStorage.removeItem(storageKey);
            }
        }
        if (!submissionId) submissionId = createSubmissionId();
        const restored = actions.length > 0;
        const ok = await post(actions);
        if (!ok && restored && RESET_CODES.has(lastErrorCode)) {
            actions = [];
            localStorage.removeItem(storageKey);
            await post([]);
        }
        busy = false;
    }

    async function submitGuess(event: SubmitEvent) {
        event.preventDefault();
        const word = guessInput.trim().toLowerCase();
        if ((!word && !conceptGuess) || busy || roundDone || dayDone) return;
        if (conceptGuess) {
            if (
                await post([
                    ...actions,
                    { type: "concept", concept: conceptGuess },
                ])
            ) {
                conceptGuess = "";
            }
            return;
        }
        if (await post([...actions, { type: "guess", word }])) {
            guessInput = "";
            conceptGuess = "";
        }
    }

    async function quickGuess(word: string): Promise<void> {
        if (busy || roundDone || dayDone || hasGuessed(word)) return;
        conceptGuess = "";
        guessInput = word;
        if (await post([...actions, { type: "guess", word }])) {
            guessInput = "";
        }
    }

    function hasGuessed(word: string): boolean {
        return (
            view?.history.some(
                (entry) => entry.type === "guess" && entry.word === word,
            ) ?? false
        );
    }

    async function selectDate(date: string): Promise<void> {
        archiveOpen = false;
        if (busy || date === selectedDate) return;
        await init(date);
    }

    async function giveUp() {
        if (busy || roundDone || dayDone) return;
        await post([...actions, { type: "giveup" }]);
    }

    async function requestDecomposition() {
        if (busy || roundDone || dayDone || !decompositionReady) return;
        await post([...actions, { type: "decomposition" }]);
    }

    async function nextWord() {
        if (busy || !roundDone || dayDone) return;
        await post([...actions, { type: "next" }]);
    }

    async function share() {
        try {
            await navigator.clipboard.writeText(shareText);
            copied = true;
            setTimeout(() => (copied = false), 1500);
        } catch {
            error = "Could not copy to clipboard.";
        }
    }

    function rememberTutorial(): void {
        try {
            localStorage.setItem(TUTORIAL_KEY, "complete");
        } catch {
            // The walkthrough can still be dismissed when storage is unavailable.
        }
    }

    function dismissTutorial(): void {
        rememberTutorial();
        tutorialDialog?.close();
    }

    function advanceTutorial(): void {
        if (tutorialStep < TUTORIAL_LAST_STEP) {
            tutorialStep += 1;
            return;
        }
        dismissTutorial();
    }

    function showFirstVisitTutorial(): void {
        try {
            if (localStorage.getItem(TUTORIAL_KEY) === "complete") return;
        } catch {
            // Show the walkthrough if storage cannot be read.
        }
        tutorialStep = 0;
        requestAnimationFrame(() => tutorialDialog?.showModal());
    }

    onMount(() => {
        const savedStats = localStorage.getItem(STATS_KEY);
        if (savedStats) {
            try {
                stats = {
                    ...EMPTY_STATS,
                    ...(JSON.parse(savedStats) as Partial<Stats>),
                };
            } catch {
                localStorage.removeItem(STATS_KEY);
            }
        }
        updateCountdown();
        const countdownTimer = window.setInterval(updateCountdown, 1_000);
        void init();
        showFirstVisitTutorial();
        return () => window.clearInterval(countdownTimer);
    });
</script>

<svelte:head>
    <title>LatentGuess - Vector word guessing</title>
    <link rel="canonical" href="https://nphard.app/latent/" />
    <meta
        name="description"
        content="Find the hidden word using meaning and semantics as clues."
    />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://nphard.app/latent/" />
    <meta property="og:title" content="LatentGuess: Vector word guessing" />
    <meta
        property="og:description"
        content="Find the hidden word using meaning and semantics as clues."
    />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="LatentGuess: Vector word guessing" />
    <meta
        name="twitter:description"
        content="Find ζ, the hidden word. Follow hints in meaning and semantics."
    />
</svelte:head>

<main>
    <header>
        <div class="brand-block">
            <h1 class="brand"><span class="brand-latent">Latent</span>Guess</h1>
            <p class="tagline">
                Find the hidden word <span class="hidden-symbol">ζ / zeta.</span
                >
            </p>
        </div>
        <div class="head-right">
            <button class="help" onclick={() => dialog?.showModal()}
                >How to play</button
            >
        </div>
    </header>

    <div class="daily-controls">
        <details class="archive-menu" bind:open={archiveOpen}>
            <summary>Archive</summary>
            <div class="archive-panel">
                {#if playableDates.length}
                    <label class="archive-picker">
                        <span>Daily game</span>
                        <input
                            type="date"
                            aria-label="Choose a daily game"
                            value={selectedDate}
                            min={playableDates.at(-1)}
                            max={playableDates[0]}
                            disabled={busy}
                            onchange={(event) =>
                                void selectDate(event.currentTarget.value)}
                        />
                    </label>
                {/if}
                <button
                    class="archive-mode"
                    onclick={() =>
                        hardMode
                            ? void init(selectedDate || undefined)
                            : void initHard()}
                    disabled={busy}
                >
                    {hardMode ? "Main game" : "Hard mode"}
                </button>
            </div>
        </details>
        <p class="countdown">
            Next game in <strong>{nextGameIn || "00:00:00"}</strong> UTC
        </p>
    </div>

    {#if !view}
        <p class="muted loading">{error || "Loading…"}</p>
    {:else}
        <div class="status">
            <span class="meta">
                Round {view.round + 1}/{view.rounds}
                {#if !roundDone}, {guessesLeft}
                    {guessesLeft === 1 ? "guess" : "guesses"} left{/if}
            </span>
            <div class="progress" aria-hidden="true">
                <div
                    class="progress-fill"
                    style:width={`${(view.turnsUsed / view.maxTurns) * 100}%`}
                ></div>
            </div>
            <span class="meta score">{view.score} pts</span>
        </div>
        {#if hardMode}
            <p class="hard-description">
                This is the same as the main game, except the hidden words may
                be more niche. Engine output is a result of machine learning, and may have bias or inaccuracies.
            </p>
        {/if}

        {#if roundResults.length}
            <div class="rounds" aria-label="Finished words">
                {#each roundResults as result (result.index)}
                    <span
                        class="round-chip {result.solved ? 'good' : 'bad'}"
                        title={`${result.answer}: ${
                            result.solved
                                ? `solved in ${result.turnsUsed}`
                                : result.givenUp
                                  ? "gave up"
                                  : "out of guesses"
                        }, ${result.score} pts`}
                    >
                        <strong>{result.answer}</strong>
                        <span class="round-meta">
                            {result.solved
                                ? `${result.turnsUsed}/${view.maxTurns}`
                                : result.givenUp
                                  ? "gave up"
                                  : `X/${view.maxTurns}`}
                        </span>
                    </span>
                {/each}
            </div>
        {/if}

        {#if view.history.length}
            <section class="board" aria-label="Guess history">
                {#each view.history as entry, i (i)}
                    {#if entry.type === "guess"}
                        {@const guess = entry}
                        <div class="row">
                            {#if guess.concept}
                                {@const positivePosition =
                                    guess.conceptPosition ?? 0.5}
                                {@const positivePercent = Math.round(
                                    positivePosition * 100,
                                )}
                                {@const negativePercent = 100 - positivePercent}
                                <div
                                    class="equation concept-equation"
                                    aria-label={`${guess.concept} axis for the hidden word: ${positivePercent}% toward ${guess.conceptPositiveLabel}, ${negativePercent}% toward ${guess.conceptNegativeLabel}`}
                                >
                                    <span class="concept-function"
                                        >A<sub>{guess.concept}</sub>(<span
                                            title="Hidden word">ζ</span
                                        >)</span
                                    >
                                    <span
                                        class="operator result"
                                        aria-hidden="true">=</span
                                    >
                                    <span class="axis-score"
                                        >{guess.conceptScore !== null &&
                                        guess.conceptScore >= 0
                                            ? "+"
                                            : ""}{signedPercent(
                                            guess.conceptScore ?? 0,
                                        )}</span
                                    >
                                    <span class="operator" aria-hidden="true"
                                        >→</span
                                    >
                                    <span
                                        class="term concept-pole"
                                        class:leading={positivePercent >=
                                            negativePercent}
                                    >
                                        <span
                                            >{guess.conceptPositiveLabel ??
                                                "positive"}</span
                                        ><span class="term-sim"
                                            >{positivePercent}%</span
                                        >
                                    </span>
                                    <span class="operator" aria-hidden="true"
                                        >/</span
                                    >
                                    <span
                                        class="term concept-pole"
                                        class:leading={negativePercent >
                                            positivePercent}
                                    >
                                        <span
                                            >{guess.conceptNegativeLabel ??
                                                "negative"}</span
                                        ><span class="term-sim"
                                            >{negativePercent}%</span
                                        >
                                    </span>
                                </div>
                            {:else if guess.clue}
                                <div
                                    class="equation"
                                    aria-label={`Hidden word approximately equals ${guess.word} at ${signedPercent(guess.similarity)} plus ${guess.multiplier?.toFixed(1) ?? "1.0"} times ${guess.clue} at ${signedPercent(guess.clueSimilarity)}${guess.secondClue ? ` plus ${guess.secondMultiplier?.toFixed(1) ?? "1.0"} times ${guess.secondClue} at ${signedPercent(guess.secondClueSimilarity ?? 0)}` : ""}`}
                                >
                                    <span
                                        class="hidden-word"
                                        title="Hidden word">ζ</span
                                    >
                                    <span
                                        class="operator result"
                                        aria-hidden="true">≈</span
                                    >
                                    <span
                                        class="term guess-term {simTone(
                                            guess.similarity,
                                        )}"
                                    >
                                        <span>{guess.word}</span><span
                                            class="term-sim"
                                            >{signedPercent(
                                                guess.similarity,
                                            )}</span
                                        >
                                    </span>
                                    <span class="operator" aria-hidden="true"
                                        >+</span
                                    >
                                    <span
                                        class="term clue {simTone(
                                            guess.clueSimilarity,
                                        )}"
                                    >
                                        <span
                                            >{#if guess.multiplier !== null}<span
                                                    class="mult"
                                                    >{guess.multiplier.toFixed(
                                                        1,
                                                    )} ×</span
                                                >{/if}{guess.clue}</span
                                        ><span class="term-sim"
                                            >{signedPercent(
                                                guess.clueSimilarity,
                                            )}</span
                                        >
                                    </span>
                                    {#if guess.secondClue}
                                        <span
                                            class="operator"
                                            aria-hidden="true">+</span
                                        >
                                        <span
                                            class="term clue second {simTone(
                                                guess.secondClueSimilarity ?? 0,
                                            )}"
                                        >
                                            <span
                                                >{#if guess.secondMultiplier !== null}<span
                                                        class="mult"
                                                        >{guess.secondMultiplier.toFixed(
                                                            1,
                                                        )} ×</span
                                                    >{/if}{guess.secondClue}</span
                                            ><span class="term-sim"
                                                >{signedPercent(
                                                    guess.secondClueSimilarity ??
                                                        0,
                                                )}</span
                                            >
                                        </span>
                                    {/if}
                                </div>
                            {:else}
                                <span class="equation">
                                    <span
                                        class="hidden-word"
                                        title="Hidden word">ζ</span
                                    >
                                    <span
                                        class="operator result"
                                        aria-hidden="true">≈</span
                                    >
                                    <span
                                        class="term guess-term {simTone(
                                            guess.similarity,
                                        )}"
                                    >
                                        <span>{guess.word}</span><span
                                            class="term-sim"
                                            >{signedPercent(
                                                guess.similarity,
                                            )}</span
                                        >
                                    </span>
                                </span>
                            {/if}
                        </div>
                    {:else if entry.type === "decomposition"}
                        <div class="row decomposition-row">
                            {#if entry.terms.length}
                                <div
                                    class="equation decomposition-equation"
                                    aria-label={`Hidden word approximately equals ${entry.terms.map((term) => `${term.multiplier.toFixed(1)} times ${term.word}`).join(" plus ")}; combined fit ${signedPercent(entry.similarity)}`}
                                >
                                    <span
                                        class="hidden-word"
                                        title="Hidden word">ζ</span
                                    >
                                    <span
                                        class="operator result"
                                        aria-hidden="true">≈</span
                                    >
                                    {#each entry.terms as term, termIndex}
                                        {#if termIndex > 0}<span
                                                class="operator"
                                                aria-hidden="true">+</span
                                            >{/if}
                                        <span
                                            class="term decomposition-term {simTone(
                                                term.similarity,
                                            )}"
                                        >
                                            <span
                                                ><span class="mult"
                                                    >{term.multiplier.toFixed(
                                                        1,
                                                    )} ×</span
                                                >{term.word}</span
                                            >
                                            <span class="term-sim"
                                                >{signedPercent(
                                                    term.similarity,
                                                )}</span
                                            >
                                        </span>
                                    {/each}
                                    <span
                                        class="combination-fit {simTone(
                                            entry.similarity,
                                        )}"
                                        >fit {signedPercent(
                                            entry.similarity,
                                        )}</span
                                    >
                                </div>
                            {:else}
                                <span class="muted"
                                    >No safe decomposition found.</span
                                >
                            {/if}
                        </div>
                    {:else}
                        <div class="row giveup-row">
                            <span class="muted">gave up</span>
                        </div>
                    {/if}
                {/each}
            </section>
        {:else if !roundDone}
            <p class="empty">Guess any word to begin.</p>
        {/if}

        {#if dayDone}
            <section class="over">
                <p class="answer-label">
                    {hardMode ? "Hard mode complete" : "Day complete"}
                </p>
                <p class="final-score total">{view.score} pts</p>
                <div class="over-actions">
                    <button class="primary" onclick={share}
                        >{copied ? "Copied" : "Share result"}</button
                    >
                    {#if view.game.kind === "daily"}
                        <span class="muted"
                            >streak {stats.streak} | best {stats.best} pts</span
                        >
                    {/if}
                </div>
            </section>
            <section
                class="score-distribution"
                aria-labelledby="score-distribution-title"
            >
                <h2 id="score-distribution-title">Scores</h2>
                {#if histogramLoading}
                    <p class="distribution-empty">Loading…</p>
                {:else if histogram && histogram.total > 0}
                    <div class="histogram-scroll">
                        <div
                            class="histogram"
                            role="img"
                            aria-label={`Histogram of ${histogram.total} player scores. Your score is ${view.score} points.`}
                        >
                            {#each histogram.bins as count, index}
                                <div
                                    class="histogram-column"
                                    class:mine={index === userScoreBucket}
                                >
                                    <span class="histogram-count"
                                        >{count || ""}</span
                                    >
                                    <div class="histogram-track">
                                        <span
                                            class="histogram-bar"
                                            style:height={`${histogramBarHeight(count)}%`}
                                        ></span>
                                    </div>
                                    <span class="histogram-label"
                                        >{histogramLabel(
                                            index,
                                            histogram.bucketSize,
                                        )}</span
                                    >
                                </div>
                            {/each}
                        </div>
                    </div>
                {:else}
                    <p class="distribution-empty">No scores yet.</p>
                {/if}
            </section>
        {:else if roundDone}
            <section class="over">
                <p class="answer-label">
                    {currentResult?.solved
                        ? "Solved"
                        : currentResult?.givenUp
                          ? "Gave up"
                          : "Out of guesses"}
                </p>
                <p class="answer"><strong>{view.roundAnswer}</strong></p>
                <p class="final-score">
                    {currentResult?.score ?? 0} pts for this word
                </p>
                <div class="over-actions">
                    <button class="primary" onclick={nextWord}>Next word</button
                    >
                </div>
            </section>
        {:else}
            <form class="entry" onsubmit={submitGuess}>
                <input
                    bind:value={guessInput}
                    oninput={() => (conceptGuess = "")}
                    placeholder={conceptGuess
                        ? `concept: ${CONCEPTS.find((concept) => concept.key === conceptGuess)?.label ?? conceptGuess}`
                        : guessesLeft === 1
                          ? "guess a word - 1 left"
                          : `guess a word - ${guessesLeft} left`}
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    aria-label="Guess a word"
                    disabled={busy}
                />
                <select
                    class="concept-picker"
                    bind:value={conceptGuess}
                    onchange={() => (guessInput = "")}
                    aria-label="Choose an abstract concept guess"
                    disabled={busy}
                >
                    <option value="">concepts…</option>
                    {#each CONCEPTS as concept}
                        <option value={concept.key}>{concept.label}</option>
                    {/each}
                </select>
                <button
                    class="primary guess-button"
                    type="submit"
                    disabled={busy || (!guessInput.trim() && !conceptGuess)}
                    >Guess</button
                >
            </form>
            {#if error}<p class="error">{error}</p>{/if}
            <div class="probe-actions">
                <button
                    class="help decomposition-button"
                    disabled={busy || !decompositionReady}
                    title={decompositionReady
                        ? "Spend one guess to express the hidden word as a combination of clue words"
                        : `Available after ${DECOMPOSITION_UNLOCK_TURN} guesses`}
                    onclick={requestDecomposition}
                    >decompose ζ (auto guess)</button
                >
                <button
                    class="help quick-hint-button"
                    disabled={busy || !quickHintWord || roundDone || dayDone}
                    title={quickHintWord
                        ? `Use ${quickHintWord} as your next guess`
                        : "Make a word guess to receive a hint first"}
                    onclick={() => void quickGuess(quickHintWord)}
                    >{quickHintWord
                        ? `guess “${quickHintWord}”`
                        : "guess a hint word"}</button
                >
                <button class="help" onclick={giveUp}>give up</button>
            </div>
        {/if}
    {/if}

    <p class="bias-note">Engine results may reflect biases in the training data.</p>
    <footer class="site-links" aria-label="More from us">
        <span>More from us:</span>
        <a href="https://nphard.app/HillClimb" target="_blank" rel="noreferrer"
            >HillClimb</a
        >
        <span aria-hidden="true">|</span>
        <a
            href="https://docs.google.com/forms/d/e/1FAIpQLSdS2u20JFA6PcRlVbywI-8FJqxlALw5zMEcePkZXdVNDRZbig/viewform?usp=publish-editor"
            target="_blank"
            rel="noreferrer">Feedback</a
        >
        <span class="coming-soon">More coming to this game soon.</span>
    </footer>

    <dialog
        class="tutorial-dialog"
        bind:this={tutorialDialog}
        aria-labelledby="tutorial-title"
        oncancel={rememberTutorial}
    >
        <div class="sheet tutorial-sheet">
            <div class="sheet-head tutorial-head">
                <span class="tutorial-progress"
                    >{tutorialStep + 1}/{TUTORIAL_LAST_STEP + 1}</span
                >
                <button
                    class="close"
                    onclick={dismissTutorial}
                    aria-label="Skip walkthrough">×</button
                >
            </div>

            {#if tutorialStep === 0}
                <div class="tutorial-copy">
                    <h2 id="tutorial-title">Guess any word</h2>
                    <p>
                        The objective is to find the hidden word <strong>ζ</strong> by trying words
                        with related meanings. You have ten guesses per word, and each guess will provide feedback.

                        <br><br>
                        For example, say our first guess is <strong>"holiday"</strong>
                    </p>
                </div>
            {:else if tutorialStep === 1}
                <div class="tutorial-copy">
                    <h2 id="tutorial-title">Read the feedback</h2>
                    <p>
                        After each guess, the game will show an equation that approximates the hidden word as a combination of your guess and one or two other words.
                        <br><br>
                        The first equation suggests the hidden word is a combination of "holiday" and some "snow".

                    </p>
                    <div class="tutorial-examples">
                        <article class="tutorial-example">
                            <div class="tutorial-example-head">
                                <span>First guess</span>
                                <strong>holiday</strong>
                            </div>
                            <div class="tutorial-equation">
                                <span class="tutorial-zeta">ζ</span>
                                <span>≈</span>
                                <span class="tutorial-term">holiday | 38%</span>
                                <span>+</span>
                                <span class="tutorial-hint">0.4 × snow | 62%</span>
                            </div>
                            <p><strong>Snow</strong> points toward a colder area.</p>
                        </article>
                        <article class="tutorial-example">
                            <div class="tutorial-example-head">
                                <span>Next guess</span>
                                <strong>cold</strong>
                            </div>
                            <div class="tutorial-equation">
                                <span class="tutorial-zeta">ζ</span>
                                <span>≈</span>
                                <span class="tutorial-term">cold | 67%</span>
                                <span>+</span>
                                <span class="tutorial-hint">0.3 × season | 58%</span>
                            </div>
                        </article>
                    </div>
                    <p class="tutorial-note">
                        The percentages next to each word measure its similarity against the hidden word.
                    </p>
                </div>
            {:else}
                <div class="tutorial-copy">
                    <h2 id="tutorial-title">Try auto guess</h2>
                    <p>
                        After four guesses, this button unlocks. Spend one guess
                        and the engine will build its own two or three word
                        combination aimed at ζ.
                    </p>
                    <div class="tutorial-auto-wrap">
                        <button
                            class="help decomposition-button tutorial-auto"
                            type="button"
                            disabled
                            >decompose ζ (auto guess)</button
                        >
                        <span>Available after 4 guesses</span>
                    </div>
                    <p class="tutorial-note">
                        This attacks the answer
                        from a fresh direction. Generally, the combination is also a better hint of hidden word than any previous equations.
                    </p>
                </div>
            {/if}

            <div class="tutorial-actions">
                {#if tutorialStep > 0}
                    <button
                        class="help tutorial-back"
                        onclick={() => (tutorialStep -= 1)}>Back</button
                    >
                {:else}
                    <button class="help tutorial-back" onclick={dismissTutorial}
                        >Skip</button
                    >
                {/if}
                <button class="primary tutorial-next" onclick={advanceTutorial}>
                    {tutorialStep === TUTORIAL_LAST_STEP
                        ? "Start playing"
                        : tutorialStep === 1
                          ? "Show auto guess"
                          : "Next"}
                </button>
            </div>
        </div>
    </dialog>

    <dialog bind:this={dialog} aria-labelledby="howto-title">
        <div class="sheet">
            <div class="sheet-head">
                <h2 id="howto-title">How to play</h2>
                <button
                    class="close"
                    onclick={() => dialog?.close()}
                    aria-label="Close">×</button
                >
            </div>
            <p>
                Warning: Depending on the seed, this game may be DIFFICULT. We
                are working on features to make it easier.
                <br /><br />
                Your goal is to find five hidden words. You get 10 guesses for each
                word.
            </p>
            <ul>
                <li>
                    Similarity: The percentage shows how close your guess (or
                    another word) is in meaning to the hidden word. Higher is
                    better.
                </li>
                <li>
                    Word equation: After making a guess, an equation combining
                    your guess with one or two other words is displayed. This is
                    a clue for which direction to explore.
                </li>
                <li>
                    Decompose / auto guess: After four guesses, spend one more
                    to let the engine build the hidden word from two, or
                    occasionally three, clue words. The fit percentage measures
                    the complete combination.
                </li>
                <li>
                    Concept guesses: These show where the hidden word falls
                    between two opposite ideas, such as singular ↔ plural. The
                    percentages show which side the hidden word is closer to.
                </li>
            </ul>
            <p>
                For example, the game learns the idea of plurality from patterns
                like cat → cats, dog → dogs, and house → houses.
            </p>

            <br /><br /><br />
            <h3>More detail</h3>
            <p>
                Example: hidden word <em>winter</em>, guess <em>holiday</em> →
                <strong>X = holiday + 0.4 × snow + 0.3 × season</strong>. The
                game will display the similarity of <em>holiday</em>,
                <em>snow</em>, and <em>season</em> to the hidden word
                <em>winter</em>.
            </p>
            <p>
                Guessing the hidden word, or a close form of it like <em
                    >employed</em
                >
                for <em>employment</em>, solves the round. Each word guess
                scores its similarity, and solving early adds up to 2,000
                points. Concept probes consume a guess but add no similarity
                points. Decomposition probes also consume a guess and add no
                points, but produce a combination chosen independently of your
                previous word. Give up to skip a word, then share your five
                results.
                <br />
                <br />
                Similarity does <em>not</em> directly measure meaning or define
                a category; it measures how similarly words are used in the
                training corpus. This is a limitation, and results may reflect
                biases in that training data. For example, a very
                common concrete noun may not be close to
                <em>tangible</em> if those words rarely appear together.
                Additionally opposite meanings can have very high similarity
                scores if they are often used together for contrast e.g.
                <em>hot</em>
                and <em>cold</em>.
            </p>
            <h3>How it works</h3>
            <p>
                Words are 300-dimension vectors from <strong>Word2Vec</strong>.
                Similar vectors represent words used in similar contexts.
            </p>
            <p>
                Hints use vector arithmetic: the app builds the arrow from your
                guess to the hidden word X and picks a relevant word with a
                positive projection along it. The display shows this as
                <strong>X = your guess + the hint path</strong>. It can then fit
                a distinct second word against the remaining error and refit
                both positive coefficients together. The two-word form is shown
                only when its nearest real-word landing is significantly closer
                than the best one-word result. Hints come from a curated pool,
                are at least 25% related to the answer, and prefer words at
                least 30% related to your guess. Every candidate is capped at
                your guess's answer similarity plus 30 percentage points
                (within a 50–90% range). If none meet the preference, the engine
                uses the best otherwise-safe fallback under the same cap. Hints
                avoid word-form repeats and never name the hidden word.
            </p>
            <a class="help method-link" href={`${base}/about`}>How it works</a>
            <button class="primary done" onclick={() => dialog?.close()}
                >Got it</button
            >
        </div>
    </dialog>
</main>

<style>
    main {
        max-width: 700px;
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
        font-size: clamp(38px, 9.6vw, 53px);
        font-weight: 900;
        letter-spacing: -0.045em;
        line-height: 1.05;
    }

    .brand-latent {
        color: var(--logo-color);
        background: var(--title-gradient);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    .tagline {
        margin: 6px 0 0;
        font-size: 18px;
        line-height: 1.4;
        color: var(--muted);
    }

    .hidden-symbol {
        color: inherit;
        font-weight: 800;
    }

    .head-right {
        display: flex;
        align-items: center;
        gap: 14px;
        padding-top: 8px;
        flex-shrink: 0;
    }

    .daily-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 18px;
    }

    .archive-menu {
        position: relative;
        z-index: 5;
    }

    .archive-menu summary {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 10px;
        background: var(--track);
        color: var(--text);
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        list-style: none;
        box-shadow: var(--shadow-sm);
    }

    .archive-menu summary::-webkit-details-marker {
        display: none;
    }

    .archive-menu summary::after {
        content: "⌄";
        color: var(--muted);
        font-size: 16px;
        line-height: 1;
        transform: translateY(-1px);
    }

    .archive-menu[open] summary::after {
        content: "⌃";
    }

    .archive-menu summary:hover {
        background: color-mix(in srgb, var(--brand) 18%, var(--track));
    }

    .archive-panel {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        display: grid;
        gap: 10px;
        min-width: 250px;
        padding: 12px;
        border: 1px solid color-mix(in srgb, var(--muted) 20%, transparent);
        border-radius: 12px;
        background: var(--surface);
        box-shadow: var(--shadow-md);
    }

    .archive-picker {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 9px 7px 11px;
        border-radius: 10px;
        background: var(--track);
        color: var(--muted);
        font-size: 14px;
        font-weight: 700;
        box-shadow: var(--shadow-sm);
    }

    .archive-picker input {
        max-width: 190px;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text);
        font-weight: 700;
        cursor: pointer;
    }

    .archive-picker:focus-within {
        background: color-mix(in srgb, var(--brand) 28%, var(--surface));
    }

    .archive-mode {
        width: 100%;
        padding: 9px 11px;
        border: 0;
        border-radius: 9px;
        background: var(--button-bg);
        color: var(--button-text);
        font-size: 14px;
        font-weight: 700;
        text-align: left;
        cursor: pointer;
    }

    .archive-mode:hover:not(:disabled) {
        background: var(--button-hover);
    }

    .archive-mode:disabled {
        opacity: 0.55;
        cursor: default;
    }

    .countdown {
        margin: 0;
        color: var(--muted);
        font-size: 15px;
        white-space: nowrap;
    }

    .countdown strong {
        color: var(--text);
        font-variant-numeric: tabular-nums;
    }

    .status {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
    }

    .hard-description {
        margin: -8px 0 18px;
        color: var(--muted);
        font-size: 14px;
    }

    .meta {
        margin: 0;
        font-size: 16px;
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
        font-size: 14px;
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
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius);
        background: var(--button-bg);
        padding: 9px 13px;
        font-size: 16px;
        color: var(--button-text);
        font-weight: 700;
        text-decoration: none;
        border: 0;
        box-shadow: var(--shadow-sm);
        transition:
            filter 160ms ease,
            box-shadow 160ms ease;
    }

    .help:hover:not(:disabled) {
        color: var(--button-text);
        background: var(--button-hover);
        box-shadow: var(--shadow-md);
    }

    .help:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .empty {
        margin: 30px 0 0;
        text-align: center;
        color: var(--muted);
        font-size: 17px;
    }

    .board {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .row {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 9px 11px;
        background: var(--surface);
        border-radius: var(--radius);
        border: 1px solid color-mix(in srgb, var(--text) 7%, transparent);
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
        display: flex;
        justify-content: center;
        padding: 10px 14px;
        font-size: 16px;
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

    .equation {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        gap: 5px;
        flex-wrap: wrap;
    }

    .operator {
        color: var(--muted);
        flex-shrink: 0;
        font-weight: 600;
    }

    .operator.result {
        margin-inline: 2px;
        color: var(--text);
    }

    .hidden-word {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        background: var(--text);
        color: var(--surface);
        font-size: 17px;
        font-weight: 800;
    }

    .concept-function {
        color: var(--text);
        font-size: 16px;
        font-weight: 750;
        white-space: nowrap;
    }

    .concept-function sub {
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
    }

    .axis-score {
        color: var(--text);
        font-size: 14px;
        font-weight: 750;
        font-variant-numeric: tabular-nums;
    }

    .concept-pole {
        background: var(--track);
        color: var(--muted);
    }

    .concept-pole.leading {
        background: color-mix(in srgb, var(--accent) 13%, transparent);
        color: var(--accent);
    }

    .term {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 7px;
        border-radius: 6px;
        font-size: 16px;
        font-weight: 650;
        flex-shrink: 0;
    }

    .guess-term {
        background: var(--track);
        color: var(--text);
    }

    .clue {
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        color: var(--accent);
    }

    .clue.second {
        background: color-mix(in srgb, var(--brand) 12%, transparent);
        color: var(--brand);
    }

    .decomposition-row {
        border-color: color-mix(in srgb, var(--brand) 22%, transparent);
    }

    .decomposition-term {
        background: color-mix(in srgb, var(--brand) 12%, transparent);
        color: var(--brand);
    }

    .combination-fit {
        margin-left: auto;
        padding: 4px 7px;
        border-radius: 6px;
        background: var(--track);
        color: var(--muted);
        font-size: 13px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
    }

    .combination-fit.good {
        color: var(--good);
    }

    .combination-fit.mid {
        color: var(--mid);
    }

    .combination-fit.bad {
        color: var(--bad);
    }

    .term-sim {
        padding-left: 5px;
        border-left: 1px solid color-mix(in srgb, currentColor 24%, transparent);
        font-size: 13px;
        font-weight: 750;
        font-variant-numeric: tabular-nums;
    }

    .term.good .term-sim {
        color: var(--good);
    }

    .term.mid .term-sim {
        color: var(--mid);
    }

    .term.bad .term-sim {
        color: var(--bad);
    }

    .mult {
        color: var(--muted);
        font-weight: 600;
        margin-right: 2px;
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
        border: 1px solid color-mix(in srgb, var(--text) 24%, transparent);
        border-radius: var(--radius);
        background: var(--surface);
        box-shadow: 0 1px 3px color-mix(in srgb, var(--text) 10%, transparent);
        outline: none;
        transition: box-shadow 160ms ease;
    }

    .concept-picker {
        min-width: 132px;
        padding: 12px 10px;
        border: 1px solid color-mix(in srgb, var(--text) 24%, transparent);
        border-radius: var(--radius);
        background: var(--surface);
        box-shadow: 0 1px 3px color-mix(in srgb, var(--text) 10%, transparent);
        color: var(--muted);
        outline: none;
    }

    .concept-picker:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
    }

    .entry input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
    }

    .entry input::placeholder {
        color: var(--muted);
    }

    .probe-actions {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-top: 16px;
        font-size: 16px;
    }

    .decomposition-button {
        color: var(--brand);
    }

    .quick-hint-button {
        color: var(--accent);
    }

    .site-links {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 34px;
        color: var(--muted);
        font-size: 15px;
    }

    .bias-note {
        max-width: 680px;
        margin: 28px auto 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.4;
        text-align: center;
    }

    .site-links a {
        color: var(--accent);
        font-weight: 700;
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .coming-soon {
        flex-basis: 100%;
        text-align: center;
        margin-top: 2px;
    }

    .entry button,
    .over button {
        border: 0;
        border-radius: var(--radius);
        padding: 13px 22px;
        background: var(--button-bg);
        color: var(--button-text);
        box-shadow: var(--shadow-sm);
        font-weight: 600;
        transition:
            filter 160ms ease,
            box-shadow 160ms ease;
    }

    .entry button:hover:not(:disabled),
    .over button:hover:not(:disabled) {
        background: var(--button-hover);
        box-shadow: var(--shadow-md);
    }

    button.primary {
        background: var(--button-bg);
        color: var(--button-text);
    }

    button.primary:hover:not(:disabled) {
        background: var(--button-hover);
    }

    button.guess-button {
        background: var(--logo-color);
        color: #171717;
    }

    button.guess-button:hover:not(:disabled) {
        background: var(--logo-hover);
    }

    button:disabled {
        opacity: 0.45;
        cursor: default;
    }

    button:focus-visible {
        outline: none;
    }

    .help:focus-visible,
    .close:focus-visible {
        color: var(--button-text);
        background: var(--button-hover);
    }

    .entry button:focus-visible,
    .over button:focus-visible,
    .concept-picker:focus-visible {
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

    .score-distribution {
        margin-top: 26px;
        padding-top: 20px;
        border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
    }

    .score-distribution h2 {
        margin: 0 0 12px;
        font-size: 18px;
    }

    .distribution-empty {
        margin: 0;
        color: var(--muted);
        font-size: 15px;
    }

    .histogram-scroll {
        overflow-x: auto;
        padding-bottom: 4px;
    }

    .histogram {
        display: grid;
        grid-template-columns: repeat(11, minmax(36px, 1fr));
        align-items: end;
        gap: 7px;
        min-width: 520px;
    }

    .histogram-column {
        display: grid;
        grid-template-rows: 20px 140px 22px;
        gap: 4px;
        min-width: 0;
    }

    .histogram-count,
    .histogram-label {
        color: var(--muted);
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        text-align: center;
    }

    .histogram-track {
        display: flex;
        align-items: flex-end;
        justify-content: center;
        overflow: hidden;
        border-bottom: 1px solid
            color-mix(in srgb, var(--text) 14%, transparent);
    }

    .histogram-bar {
        display: block;
        width: 72%;
        min-height: 0;
        border-radius: 7px 7px 0 0;
        background: var(--accent);
        transition: height 300ms ease;
    }

    .histogram-column.mine .histogram-bar {
        background: var(--brand);
    }

    .histogram-column.mine .histogram-label {
        color: var(--text);
        font-weight: 800;
    }

    .answer-label {
        margin: 0;
        font-size: inherit;
        font-weight: 600;
        color: var(--muted);
    }

    .answer {
        margin: 8px 0 18px;
    }

    .answer strong {
        font-size: 36px;
        font-weight: 800;
        letter-spacing: -0.02em;
    }

    .final-score {
        margin: 0 0 18px;
        font-size: 18px;
        font-weight: 600;
        color: var(--brand);
    }

    .final-score.total {
        font-size: 34px;
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
        font-size: 16px;
    }

    .error {
        color: var(--bad);
        font-size: 16px;
        margin: 12px 0 0;
        text-align: center;
    }

    .loading {
        padding: 28px 0;
    }

    .muted {
        color: var(--muted);
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
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.01em;
    }

    .sheet h3 {
        margin: 16px 0 4px;
        font-size: 17px;
        font-weight: 700;
    }

    .sheet p {
        font-size: 17px;
        line-height: 1.55;
        margin: 10px 0;
    }

    .sheet ul {
        margin: 10px 0;
        padding-left: 18px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 17px;
        line-height: 1.55;
    }

    .tutorial-dialog {
        width: min(560px, calc(100vw - 32px));
    }

    .tutorial-sheet {
        padding: 18px 22px 22px;
    }

    .tutorial-head {
        min-height: 34px;
        margin-bottom: 4px;
    }

    .tutorial-progress,
    .tutorial-kicker {
        color: var(--accent);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
    }

    .tutorial-copy h2 {
        margin-top: 6px;
        font-size: 28px;
    }

    .tutorial-entry {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 20px 0 12px;
        padding: 7px 7px 7px 16px;
        border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
        border-radius: var(--radius);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
        color: var(--text);
        font-size: 17px;
    }

    .tutorial-entry > span:first-child {
        flex: 1;
    }

    .tutorial-guess-button {
        padding: 9px 16px;
        border-radius: calc(var(--radius) - 3px);
        background: var(--button-bg);
        color: var(--button-text);
        font-weight: 750;
    }

    .tutorial-examples {
        display: grid;
        gap: 10px;
        margin: 16px 0 10px;
    }

    .tutorial-example {
        padding: 12px;
        border: 1px solid color-mix(in srgb, var(--text) 9%, transparent);
        border-radius: var(--radius);
        background: var(--surface);
        box-shadow: var(--shadow-sm);
    }

    .tutorial-example-head {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 8px;
        margin-bottom: 9px;
        color: var(--muted);
        font-size: 13px;
    }

    .tutorial-example-head strong {
        color: var(--text);
        font-size: 16px;
    }

    .tutorial-score {
        padding: 3px 7px;
        border-radius: 999px;
        background: var(--track);
        font-weight: 800;
        font-variant-numeric: tabular-nums;
    }

    .tutorial-score.mid {
        color: var(--mid);
    }

    .tutorial-score.good {
        color: var(--good);
    }

    .tutorial-equation {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
        color: var(--muted);
        font-size: 14px;
    }

    .tutorial-zeta {
        display: grid;
        place-items: center;
        width: 25px;
        height: 25px;
        border-radius: 6px;
        background: var(--text);
        color: var(--surface);
        font-size: 16px;
        font-weight: 800;
    }

    .tutorial-term,
    .tutorial-hint {
        padding: 4px 7px;
        border-radius: 6px;
        background: var(--track);
        color: var(--text);
        font-weight: 700;
    }

    .tutorial-hint {
        background: color-mix(in srgb, var(--accent) 12%, transparent);
        color: var(--accent);
    }

    .tutorial-example p,
    .sheet p.tutorial-note {
        margin: 9px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.4;
    }

    .tutorial-auto-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        margin: 24px 0 16px;
        padding: 22px 16px;
        border-radius: var(--radius);
        background: color-mix(in srgb, var(--accent) 8%, var(--surface));
    }

    .tutorial-auto-wrap span {
        color: var(--muted);
        font-size: 13px;
        font-weight: 650;
    }

    .tutorial-auto:disabled {
        opacity: 1;
        cursor: default;
    }

    .tutorial-actions {
        display: flex;
        gap: 10px;
        margin-top: 22px;
    }

    .tutorial-actions button {
        min-height: 44px;
        border-radius: var(--radius);
    }

    .tutorial-back {
        flex: 0 0 92px;
    }

    .tutorial-next {
        flex: 1;
    }

    .close {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: var(--button-bg);
        color: var(--button-text);
        font-size: 24px;
        line-height: 1;
        padding: 0;
        border: 0;
        box-shadow: var(--shadow-sm);
    }

    .close:hover {
        color: var(--button-text);
        background: var(--button-hover);
        box-shadow: var(--shadow-md);
    }

    .method-link {
        width: 100%;
        margin-top: 8px;
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

        .daily-controls {
            align-items: flex-start;
            flex-direction: column;
        }

        .archive-picker {
            width: 100%;
        }

        .archive-menu {
            width: 100%;
        }

        .archive-menu summary {
            width: 100%;
            box-sizing: border-box;
            justify-content: space-between;
        }

        .archive-panel {
            position: static;
            min-width: 0;
            width: 100%;
            box-sizing: border-box;
        }

        .archive-picker input {
            flex: 1;
            max-width: none;
        }

        .brand {
            font-size: 38px;
        }

        .entry {
            flex-wrap: wrap;
        }

        .concept-picker {
            flex: 1;
            min-width: 0;
        }

        .entry button {
            flex: 0 0 auto;
        }

        .tutorial-sheet {
            padding: 16px 16px 18px;
        }

        .tutorial-copy h2 {
            font-size: 25px;
        }

        .tutorial-example-head {
            grid-template-columns: 1fr auto;
        }

        .tutorial-example-head > span:first-child {
            grid-column: 1 / -1;
        }

        .tutorial-actions {
            position: sticky;
            bottom: -18px;
            padding: 10px 0 0;
            background: var(--surface);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .row,
        .progress-fill,
        .entry input,
        .entry button,
        .over button {
            animation: none;
            transition: none;
        }
    }
</style>
