<script lang="ts">
  import { Progress } from '#lib/components/ui/progress/index.js';
  import type { Agent } from '#lib/fixtures/owner/data.js';
  import { formatNumber, levelName } from '#lib/fixtures/owner/format.js';
  import { levelProgress } from '#lib/fixtures/owner/store.svelte.js';

  /** Level and XP toward the next level, used in the agents list and on the Level tab. */
  let { agent, size = 'sm' }: { agent: Agent; size?: 'sm' | 'lg' } = $props();

  const progress = $derived(levelProgress(agent));
</script>

<div class="flex min-w-0 flex-col gap-1.5">
  <div class="flex items-baseline justify-between gap-3 tabular-nums">
    <span class={size === 'lg' ? 'text-lg font-semibold tracking-tight' : 'text-sm font-medium'}>{levelName(agent.level)}</span>
    <span class="truncate text-xs text-muted-foreground">
      {#if progress.next}
        {formatNumber(progress.xp)} / {formatNumber(progress.next.xp)} XP
      {:else}
        {formatNumber(progress.xp)} XP
      {/if}
    </span>
  </div>
  <Progress
    variant="brand"
    value={progress.next ? progress.xp : 1}
    max={progress.next?.xp ?? 1}
    class={size === 'lg' ? 'h-2' : undefined}
    aria-label={progress.next ? `${formatNumber(progress.xp)} of ${formatNumber(progress.next.xp)} XP to ${levelName(progress.next.level)}` : 'Highest level'}
  />
</div>
