<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import LevelMeter from '#lib/components/shell/level-meter.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { countdown, formatNumber, plural } from '#lib/fixtures/owner/format.js';
  import { adoption } from '#lib/owner/adoption.svelte.js';
  import { STATUS, avatarOf, nextLevelXp } from '#lib/owner/agents.js';
  import { getAgents, getLevels } from '#lib/owner/owner.remote.js';

  const agents = $derived(await getAgents());
  const levels = $derived(await getLevels());
</script>

<svelte:head><title>Agents · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Agents</h1>
  {#if agents.length > 0}
    <Button href="/agents/adopt"><PlusIcon />Adopt agent</Button>
  {/if}
</div>

{#if adoption.waiting}
  <a
    href="/agents/adopt"
    class="mt-6 flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring"
  >
    <LoaderCircleIcon class="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
    <span class="min-w-0 flex-1 truncate">Waiting for an agent to confirm <span class="font-mono">{adoption.waiting.token}</span></span>
    <span class="font-mono text-muted-foreground tabular-nums">{countdown(adoption.left)}</span>
  </a>
{/if}

{#if agents.length === 0}
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
    <div class="hidden grid-cols-[minmax(0,1fr)_13rem_11rem] gap-8 border-b px-4 py-2 text-xs font-medium text-muted-foreground md:grid" aria-hidden="true">
      <span>Agent</span>
      <span>Level</span>
      <span>Delivered today</span>
    </div>
    <ul class="divide-y">
      {#each agents as agent (agent.id)}
        {@const { delivery, daily_event_cap: cap, delivered_today: delivered } = agent.delivery}
        <li>
          <a
            href="/agents/{agent.id}"
            class="grid grid-cols-1 gap-x-8 gap-y-3 px-4 py-3.5 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset md:grid-cols-[minmax(0,1fr)_13rem_11rem] md:items-center"
          >
            <div class="flex min-w-0 items-center gap-3">
              <AgentAvatar agent={avatarOf(agent)} class="size-10" />
              <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="max-w-full truncate font-medium">{agent.name}</span>
                {#if agent.status !== 'active'}
                  <Badge variant={STATUS[agent.status].variant}>{STATUS[agent.status].label}</Badge>
                {/if}
                {#if agent.held > 0}
                  <Badge variant="warning">{plural(agent.held, { one: '# held', other: '# held' })}</Badge>
                {/if}
                {#if delivery.kind === 'webhook' && delivery.status !== 'active'}
                  <Badge variant="warning">{delivery.status === 'paused' ? 'Delivery paused' : 'Delivery disabled'}</Badge>
                {/if}
              </div>
            </div>
            <LevelMeter {agent} next={nextLevelXp(levels, agent)} />
            <div class="flex items-baseline justify-between gap-3 text-sm tabular-nums md:block">
              <span class="text-muted-foreground md:sr-only">Delivered today</span>
              <span>
                {formatNumber(delivered)}
                {#if cap !== null}
                  <span class="text-muted-foreground">/ {formatNumber(cap)}</span>
                {/if}
              </span>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  </div>
{/if}
