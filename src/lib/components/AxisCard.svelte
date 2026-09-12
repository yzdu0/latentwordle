<script lang="ts">
  import type { AxisResult } from '$lib/game/types.ts';
  import AxisMeter from './AxisMeter.svelte';

  interface Props {
    label: string;
    result: AxisResult | null;
    disabled?: boolean;
    onswap: () => void;
  }

  let { label, result, disabled = false, onswap }: Props = $props();

  const hint = $derived(
    !result
      ? ''
      : result.dir === 'over'
        ? `Your word is more ${label} than the hidden word — aim for less.`
        : result.dir === 'under'
          ? `Your word is less ${label} than the hidden word — aim for more.`
          : `Your word is level with the hidden word on ${label}.`,
  );
</script>

<div class="card">
  <div class="head">
    <span class="label">{label}</span>
    <button
      class="swap"
      onclick={onswap}
      {disabled}
      aria-label={`Replace ${label} with your own concept`}
      title="Replace this concept"
    >
      ↺
    </button>
  </div>
  {#if result}
    <div class="value" title={hint}>
      <span class="match">{result.match}</span>
      {#if result.dir === 'same'}
        <span class="level">level</span>
      {/if}
    </div>
    <AxisMeter match={result.match} dir={result.dir} />
  {:else}
    <div class="value idle">–</div>
    <AxisMeter match={null} dir="same" />
  {/if}
</div>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px 12px;
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }

  .label {
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .swap {
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 14px;
    line-height: 1;
    padding: 2px;
    border-radius: 4px;
  }

  .swap:hover:not(:disabled) {
    color: var(--text);
    background: var(--track);
  }

  .swap:disabled {
    opacity: 0;
    cursor: default;
  }

  .value {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 6px 0 6px;
    font-variant-numeric: tabular-nums;
  }

  .match {
    font-size: 20px;
    font-weight: 600;
  }

  .level {
    font-size: 11px;
    color: var(--muted);
  }

  .value.idle {
    color: var(--muted);
  }
</style>
