<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import LockIcon from '@lucide/svelte/icons/lock';
  import { page } from '$app/state';
  import LevelMeter from '#lib/components/shell/level-meter.svelte';
  import { ADOPTED_BONUS, LEVELS, LIMIT_LABELS, PERMISSION_LABELS, levelRules, type Limits, type Permission } from '#lib/fixtures/owner/data.js';
  import { formatNumber, levelName } from '#lib/fixtures/owner/format.js';
  import { dashboard, limitsFor } from '#lib/fixtures/owner/store.svelte.js';

  const agent = $derived(dashboard.agent(page.params.id ?? ''));
  const limits = $derived(agent ? limitsFor(agent) : undefined);
  const limitKeys = Object.keys(LIMIT_LABELS) as (keyof Limits)[];
  const permissionKeys = Object.keys(PERMISSION_LABELS) as Permission[];

  /** The lowest level that grants a permission, if any level does. */
  const unlockLevel = (permission: Permission) => LEVELS.findIndex((rule) => rule.permissions.includes(permission));
</script>

{#if agent && limits}
  <div class="flex flex-col gap-8">
    <div class="rounded-xl border bg-card p-4 sm:p-5">
      <LevelMeter {agent} size="lg" />
    </div>

    <div class="grid gap-8 md:grid-cols-2">
      <section aria-labelledby="limits-heading">
        <h2 id="limits-heading" class="text-sm font-medium">Limits</h2>
        <dl class="mt-3 divide-y overflow-hidden rounded-xl border bg-card">
          {#each limitKeys as key (key)}
            <div class="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
              <dt class="text-muted-foreground">{LIMIT_LABELS[key]}</dt>
              <dd class="flex items-baseline gap-2 tabular-nums">
                {#if agent.adoptedAt !== null && ADOPTED_BONUS[key] > 0}
                  <span class="text-xs text-muted-foreground">+{formatNumber(ADOPTED_BONUS[key])} adopted</span>
                {/if}
                <span class="font-medium">{formatNumber(limits[key])}</span>
              </dd>
            </div>
          {/each}
        </dl>
      </section>

      <section aria-labelledby="permissions-heading">
        <h2 id="permissions-heading" class="text-sm font-medium">Permissions</h2>
        <ul class="mt-3 divide-y overflow-hidden rounded-xl border bg-card">
          {#each permissionKeys as permission (permission)}
            {@const granted = levelRules(agent.level).permissions.includes(permission)}
            <li class="flex items-center justify-between gap-4 px-4 py-3 text-sm">
              <span class={granted ? undefined : 'text-muted-foreground'}>{PERMISSION_LABELS[permission]}</span>
              {#if granted}
                <CheckIcon class="size-4" aria-label="Allowed" />
              {:else}
                <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LockIcon class="size-3.5" aria-hidden="true" /><span class="sr-only">Unlocks at</span>
                  {levelName(unlockLevel(permission))}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    </div>
  </div>
{/if}
