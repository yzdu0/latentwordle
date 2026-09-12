<script lang="ts">
  import { matchTone, meterPosition } from '$lib/game/presentation.ts';
  import type { Direction } from '$lib/game/types.ts';

  interface Props {
    match: number | null;
    dir: Direction;
  }

  let { match, dir }: Props = $props();

  const tone = $derived(match === null ? '' : matchTone(match));
  const position = $derived(match === null ? 50 : meterPosition(match, dir));
  const label = $derived(
    match === null
      ? 'not scored yet'
      : dir === 'over'
        ? `${match} out of 100; your word has more of this concept than the hidden word`
        : dir === 'under'
          ? `${match} out of 100; your word has less of this concept than the hidden word`
          : `${match} out of 100; your word is level with the hidden word`,
  );
</script>

<div class="meter" role="img" aria-label={label}>
  <div class="tick"></div>
  {#if match !== null}
    <div class="dot {tone}" style:left={`${position}%`}></div>
  {/if}
</div>

<style>
  .meter {
    position: relative;
    height: 12px;
  }

  .meter::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 4px;
    transform: translateY(-50%);
    background: var(--track);
    border-radius: 2px;
  }

  .tick {
    position: absolute;
    left: 50%;
    top: 1px;
    bottom: 1px;
    width: 1px;
    background: var(--muted);
    opacity: 0.6;
  }

  .dot {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background: var(--bad);
    transition:
      left 240ms ease,
      background 240ms ease;
  }

  .dot.good {
    background: var(--good);
  }

  .dot.mid {
    background: var(--mid);
  }
</style>
