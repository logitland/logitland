<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as InputGroup from '#lib/components/ui/input-group/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import { ADMINS, AREA_LABELS, RELAY_ACTOR, type Area } from '#lib/fixtures/admin/data.js';
  import { formatDateTime, timeAgo } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  const PAGE = 20;
  const ALL = 'all';

  let query = $state('');
  let actor = $state(ALL);
  let area = $state<Area | typeof ALL>(ALL);
  let shown = $state(PAGE);

  const actors = [...ADMINS.map((a) => ({ value: a.id, label: a.name })), { value: RELAY_ACTOR, label: 'Relay' }];
  const actorLabel = $derived(actor === ALL ? 'Everyone' : actors.find((a) => a.value === actor)?.label);

  const entries = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return admin.audit.filter(
      (e) =>
        (actor === ALL || e.actor === actor) &&
        (area === ALL || e.area === area) &&
        (!q || [e.action, e.target?.label, e.detail].some((text) => text?.toLowerCase().includes(q))),
    );
  });

  const filtered = $derived(query.trim() !== '' || actor !== ALL || area !== ALL);

  function clear() {
    query = '';
    actor = ALL;
    area = ALL;
  }
</script>

<svelte:head><title>Audit · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Audit</h1>
</div>

<div class="mt-6 grid gap-3 sm:grid-cols-[minmax(0,18rem)_10rem_10rem]">
  <InputGroup.Root>
    <InputGroup.Addon><SearchIcon /></InputGroup.Addon>
    <InputGroup.Input type="search" placeholder="Search changes" aria-label="Search changes" bind:value={query} autocomplete="off" />
  </InputGroup.Root>
  <Select.Root type="single" bind:value={actor}>
    <Select.Trigger class="w-full" aria-label="Changed by">{actorLabel}</Select.Trigger>
    <Select.Content>
      <Select.Item value={ALL} label="Everyone" />
      {#each actors as option (option.value)}
        <Select.Item value={option.value} label={option.label} />
      {/each}
    </Select.Content>
  </Select.Root>
  <Select.Root type="single" bind:value={() => area, (next) => (area = next as Area | typeof ALL)}>
    <Select.Trigger class="w-full" aria-label="Area">{area === ALL ? 'All areas' : AREA_LABELS[area]}</Select.Trigger>
    <Select.Content>
      <Select.Item value={ALL} label="All areas" />
      {#each Object.entries(AREA_LABELS) as [value, label] (value)}
        <Select.Item {value} {label} />
      {/each}
    </Select.Content>
  </Select.Root>
</div>

{#if entries.length === 0}
  <Empty.Root class="mt-4 border">
    <Empty.Header>
      <Empty.Title>{filtered ? 'No matching changes' : 'No changes yet'}</Empty.Title>
    </Empty.Header>
    {#if filtered}
      <Empty.Content>
        <Button variant="outline" onclick={clear}>Clear filters</Button>
      </Empty.Content>
    {/if}
  </Empty.Root>
{:else}
  <ul class="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
    {#each entries.slice(0, shown) as entry (entry.id)}
      <li class="grid gap-x-6 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[6rem_6rem_minmax(0,1fr)]">
        <div class="flex items-baseline gap-2 sm:contents">
          <span class="font-medium sm:order-2 {entry.actor === RELAY_ACTOR ? 'text-muted-foreground' : ''}">{admin.adminName(entry.actor)}</span>
          <time datetime={new Date(entry.at).toISOString()} title={formatDateTime(entry.at)} class="text-muted-foreground tabular-nums sm:order-1">{timeAgo(entry.at, admin.now)}</time>
        </div>
        <div class="flex min-w-0 flex-col gap-0.5 sm:order-3">
          <span>
            {entry.action}{#if entry.target}
              · <a href={entry.target.href} class="font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">{entry.target.label}</a>{/if}
          </span>
          {#if entry.detail}<span class="text-muted-foreground text-pretty break-words">{entry.detail}</span>{/if}
        </div>
      </li>
    {/each}
  </ul>
  {#if entries.length > shown}
    <div class="mt-4 flex justify-center">
      <Button variant="outline" onclick={() => (shown += PAGE)}>Show more</Button>
    </div>
  {/if}
{/if}
