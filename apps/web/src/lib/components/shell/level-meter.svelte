<script lang="ts">
  import { sigil } from '#lib/components/shell/sigil.js';
  import { Progress } from '#lib/components/ui/progress/index.js';
  import { formatNumber, levelName } from '#lib/fixtures/owner/format.js';

  /**
   * Level and XP toward the next level, in the agent's own colour. Both dashboards use it in agent lists and on an
   * agent's page; `levels` is the XP each level starts at (index = level), from whichever store owns the levels.
   */
  let {
    agent,
    levels,
    size = 'sm',
  }: { agent: { id: string; level: number; xp: number }; levels: readonly { xp: number }[]; size?: 'sm' | 'lg' } = $props();

  const next = $derived(levels[agent.level + 1]);
</script>

<div class="agent-accent flex min-w-0 flex-col gap-1.5" style:--agent-hue={sigil(agent.id).hue}>
  <div class="flex items-baseline justify-between gap-3 tabular-nums">
    <span class={size === 'lg' ? 'text-lg font-semibold tracking-tight' : 'text-sm font-medium'}>{levelName(agent.level)}</span>
    <span class="truncate text-xs text-muted-foreground">
      {#if next}
        {formatNumber(agent.xp)} / {formatNumber(next.xp)} XP
      {:else}
        {formatNumber(agent.xp)} XP
      {/if}
    </span>
  </div>
  <Progress
    variant="brand"
    value={next ? agent.xp : 1}
    max={next?.xp ?? 1}
    class={size === 'lg' ? 'h-2' : undefined}
    aria-label={next ? `${formatNumber(agent.xp)} of ${formatNumber(next.xp)} XP to ${levelName(agent.level + 1)}` : 'Highest level'}
  />
</div>
