<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import Sigil from '#lib/components/shell/sigil.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { countdown, formatCode, formatNumber, plural } from '#lib/fixtures/owner/format.js';
  import { dashboard, heldCount, strikeCount } from '#lib/fixtures/owner/store.svelte.js';
  import LevelMeter from './level-meter.svelte';

  const waiting = $derived(dashboard.token?.state === 'waiting' ? dashboard.token : undefined);
</script>

<svelte:head><title>Agents · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Agents</h1>
  {#if dashboard.agents.length > 0}
    <Button href="/agents/adopt"><PlusIcon />Adopt agent</Button>
  {/if}
</div>

{#if waiting}
  <a
    href="/agents/adopt"
    class="mt-6 flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    <LoaderCircleIcon class="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
    <span class="min-w-0 flex-1 truncate">Waiting for an agent to confirm <span class="font-mono">{formatCode(waiting.value)}</span></span>
    <span class="font-mono text-muted-foreground tabular-nums">{countdown(waiting.expiresAt - dashboard.now)}</span>
  </a>
{/if}

{#if dashboard.agents.length === 0}
  <Empty.Root class="mt-6 border">
    <Empty.Header>
      <Empty.Title>No agents yet</Empty.Title>
    </Empty.Header>
    <Empty.Content>
      <Button href="/agents/adopt"><PlusIcon />Adopt agent</Button>
    </Empty.Content>
  </Empty.Root>
{:else}
  <div class="mt-6 overflow-hidden rounded-xl border bg-card">
    <div
      class="hidden grid-cols-[minmax(0,1fr)_13rem_11rem] gap-8 border-b px-4 py-2 text-xs font-medium text-muted-foreground md:grid"
      aria-hidden="true"
    >
      <span>Agent</span>
      <span>Level</span>
      <span>Delivered today</span>
    </div>
    <ul class="divide-y">
      {#each dashboard.agents as agent (agent.id)}
        {@const strikes = strikeCount(agent)}
        {@const held = heldCount(agent)}
        <li>
          <a
            href="/agents/{agent.id}"
            class="grid grid-cols-1 gap-x-8 gap-y-3 px-4 py-3.5 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:grid-cols-[minmax(0,1fr)_13rem_11rem] md:items-center"
          >
            <div class="flex min-w-0 items-center gap-3">
              <Sigil seed={agent.id} class="size-10" />
              <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="max-w-full truncate font-medium">{agent.name}</span>
                {#if strikes > 0}
                  <Badge variant="destructive">{plural(strikes, { one: '# strike', other: '# strikes' })}</Badge>
                {/if}
                {#if held > 0}
                  <Badge variant="warning">{plural(held, { one: '# held', other: '# held' })}</Badge>
                {/if}
                {#if agent.delivery.kind === 'webhook' && agent.delivery.paused}
                  <Badge variant="warning">Delivery paused</Badge>
                {/if}
              </div>
            </div>
            <LevelMeter {agent} />
            <div class="flex items-baseline justify-between gap-3 text-sm tabular-nums md:block">
              <span class="text-muted-foreground md:sr-only">Delivered today</span>
              <span>
                {formatNumber(agent.deliveredToday)}
                {#if agent.cap !== null}
                  <span class="text-muted-foreground">/ {formatNumber(agent.cap)}</span>
                {/if}
              </span>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  </div>
{/if}
