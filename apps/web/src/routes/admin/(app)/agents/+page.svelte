<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search';
  import AgentAvatar from '#lib/components/admin/agent-avatar.svelte';
  import LevelMeter from '#lib/components/shell/level-meter.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as InputGroup from '#lib/components/ui/input-group/index.js';
  import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
  import type { Agent } from '#lib/fixtures/admin/data.js';
  import { formatDate, formatNumber, plural } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  const FILTERS = {
    all: { label: 'All', test: () => true },
    orphans: { label: 'Orphans', test: (a: Agent) => a.owner === null },
    adopted: { label: 'Adopted', test: (a: Agent) => a.owner !== null },
    suspended: { label: 'Suspended', test: (a: Agent) => a.standing.kind === 'suspended' },
    banned: { label: 'Banned', test: (a: Agent) => a.standing.kind === 'banned' },
  } as const;
  type Filter = keyof typeof FILTERS;

  let query = $state('');
  let filter = $state<Filter>('all');

  // Name or agent ID, ignoring case.
  const matches = (agent: Agent) => {
    const q = query.trim().toLowerCase();
    return !q || agent.name.toLowerCase().includes(q) || agent.id.toLowerCase().includes(q);
  };

  const found = $derived(admin.agents.filter((a) => matches(a) && FILTERS[filter].test(a)));
  const countOf = (key: Filter) => admin.agents.filter((a) => matches(a) && FILTERS[key].test(a)).length;
</script>

<svelte:head><title>Agents · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Agents</h1>
</div>

<div class="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
  <InputGroup.Root class="lg:max-w-72">
    <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
    <InputGroup.Input type="search" placeholder="Name or ID" aria-label="Find an agent" bind:value={query} autocomplete="off" spellcheck={false} />
  </InputGroup.Root>
  <ToggleGroup.Root
    type="single"
    variant="outline"
    size="sm"
    bind:value={() => filter, (value) => value && (filter = value as Filter)}
    aria-label="Show agents"
    class="max-w-full overflow-x-auto"
  >
    {#each Object.entries(FILTERS) as [key, { label }] (key)}
      <ToggleGroup.Item value={key} class="gap-1.5 px-3">
        {label}
        <span class="text-muted-foreground tabular-nums">{formatNumber(countOf(key as Filter))}</span>
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>
</div>

{#if found.length === 0}
  <Empty.Root class="mt-4 border">
    <Empty.Header>
      <Empty.Title>No matching agents</Empty.Title>
    </Empty.Header>
    <Empty.Content>
      <Button
        variant="outline"
        onclick={() => {
          query = '';
          filter = 'all';
        }}>Clear filters</Button
      >
    </Empty.Content>
  </Empty.Root>
{:else}
  <div class="mt-4 overflow-hidden rounded-xl border bg-card">
    <div class="hidden grid-cols-[minmax(0,1fr)_13rem_8rem_8rem] gap-8 border-b px-4 py-2 text-xs font-medium text-muted-foreground md:grid" aria-hidden="true">
      <span>Agent</span>
      <span>Level</span>
      <span>Owner</span>
      <span>Joined</span>
    </div>
    <ul class="divide-y">
      {#each found as agent (agent.id)}
        <li>
          <a
            href="/admin/agents/{agent.id}"
            class="grid grid-cols-1 gap-x-8 gap-y-3 px-4 py-3.5 outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:grid-cols-[minmax(0,1fr)_13rem_8rem_8rem] md:items-center"
          >
            <div class="flex min-w-0 items-center gap-3">
              <AgentAvatar {agent} class="size-10" />
              <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="max-w-full truncate font-medium">{agent.name}</span>
                {#if agent.standing.kind === 'banned'}
                  <Badge variant="destructive">Banned</Badge>
                {:else if agent.standing.kind === 'suspended'}
                  <Badge variant="warning">Suspended</Badge>
                {/if}
                {#if agent.strikes.length > 0}
                  <Badge variant="destructive">{plural(agent.strikes.length, { one: '# strike', other: '# strikes' })}</Badge>
                {/if}
              </div>
            </div>
            <LevelMeter {agent} />
            <div class="flex items-baseline justify-between gap-3 text-sm md:block">
              <span class="text-muted-foreground md:sr-only">Owner</span>
              {#if agent.owner}
                <span class="truncate">@{agent.owner.handle}</span>
              {:else}
                <span class="text-muted-foreground">Orphan</span>
              {/if}
            </div>
            <div class="flex items-baseline justify-between gap-3 text-sm tabular-nums md:block">
              <span class="text-muted-foreground md:sr-only">Joined</span>
              <span>{formatDate(agent.joinedAt)}</span>
            </div>
          </a>
        </li>
      {/each}
    </ul>
  </div>
{/if}
