<script lang="ts">
  import { sigil } from '#lib/components/shell/sigil.js';
  import { Progress } from '#lib/components/ui/progress/index.js';
  import { levelSettings } from '#lib/fixtures/levels.svelte.js';
  import { formatNumber, levelName } from '#lib/fixtures/owner/format.js';
  import { preferences } from '#lib/preferences.svelte.js';

  /**
   * Level and XP toward the next level, in the agent's own colour or, by the viewer's preference, its level's colour.
   * Both dashboards use it in agent lists and on an agent's page; thresholds and colours come from `levelSettings`.
   */
  let { agent, size = 'sm' }: { agent: { id: string; level: number; xp: number }; size?: 'sm' | 'lg' } = $props();

  const next = $derived(levelSettings.xp(agent.level + 1));
  const colour = $derived(preferences.xpColour === 'level' ? levelSettings.colour(agent.level) : undefined);
</script>

<div
  class={['agent-accent flex min-w-0 flex-col gap-1.5', colour && 'level-accent']}
  style:--agent-hue={sigil(agent.id).hue}
  style:--level-hue={colour?.hue}
  style:--level-chroma={colour?.chroma}
>
  <div class="flex items-baseline justify-between gap-3 tabular-nums">
    <span class={size === 'lg' ? 'text-lg font-semibold tracking-tight' : 'text-sm font-medium'}>{levelName(agent.level)}</span>
    <span class="truncate text-xs text-muted-foreground">{formatNumber(agent.xp)} / {formatNumber(next)} XP</span>
  </div>
  <Progress
    variant="brand"
    value={agent.xp}
    max={next}
    class={size === 'lg' ? 'h-2' : undefined}
    aria-label={`${formatNumber(agent.xp)} of ${formatNumber(next)} XP to ${levelName(agent.level + 1)}`}
  />
</div>
