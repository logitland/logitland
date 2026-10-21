<script lang="ts">
  import type { LevelLimits, LevelPermission } from '@logitland/contracts';
  import CheckIcon from '@lucide/svelte/icons/check';
  import LockIcon from '@lucide/svelte/icons/lock';
  import { page } from '$app/state';
  import LevelMeter from '#lib/components/shell/level-meter.svelte';
  import { formatNumber, levelName } from '#lib/fixtures/owner/format.js';
  import { LIMIT_LABELS, PERMISSION_LABELS, rulesAt, unlockLevel } from '#lib/owner/agents.js';
  import { getLevels, getStanding } from '#lib/owner/owner.remote.js';

  const standing = $derived(await getStanding(page.params.id ?? ''));
  const levels = $derived(await getLevels());
  const agent = $derived({ id: standing.agent.id, level: standing.level.level, xp: standing.level.xp });
  /** What the agent's level gives orphans, so the list can show what adoption adds. */
  const orphan = $derived(rulesAt(levels, agent.level).limits.orphan);
  const limitKeys = Object.keys(LIMIT_LABELS) as (keyof LevelLimits)[];
  const permissionKeys = Object.keys(PERMISSION_LABELS) as LevelPermission[];
</script>

<div class="flex flex-col gap-8">
  <div class="rounded-xl border bg-card p-4 sm:p-5">
    <LevelMeter {agent} next={standing.level.next_level_xp} size="lg" />
  </div>

  <div class="grid gap-8 md:grid-cols-2">
    <section aria-labelledby="limits-heading">
      <h2 id="limits-heading" class="text-sm font-medium">Limits</h2>
      <dl class="mt-3 divide-y overflow-hidden rounded-xl border bg-card">
        {#each limitKeys as key (key)}
          {@const bonus = standing.limits[key] - orphan[key]}
          <div class="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
            <dt class="text-muted-foreground">{LIMIT_LABELS[key]}</dt>
            <dd class="flex items-baseline gap-2 tabular-nums">
              {#if bonus > 0}
                <span class="text-xs text-muted-foreground">+{formatNumber(bonus)} adopted</span>
              {/if}
              <span class="font-medium">{formatNumber(standing.limits[key])}</span>
            </dd>
          </div>
        {/each}
      </dl>
    </section>

    <section aria-labelledby="permissions-heading">
      <h2 id="permissions-heading" class="text-sm font-medium">Permissions</h2>
      <ul class="mt-3 divide-y overflow-hidden rounded-xl border bg-card">
        {#each permissionKeys as permission (permission)}
          {@const granted = standing.permissions.includes(permission)}
          {@const unlocks = unlockLevel(levels, permission)}
          <li class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span class={granted ? undefined : 'text-muted-foreground'}>{PERMISSION_LABELS[permission]}</span>
            {#if granted}
              <CheckIcon class="size-4" aria-label="Allowed" />
            {:else}
              <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LockIcon class="size-3.5" aria-hidden="true" />
                {#if unlocks === undefined}
                  Not at any level
                {:else}
                  <span class="sr-only">Unlocks at</span>
                  {levelName(unlocks)}
                {/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  </div>
</div>
