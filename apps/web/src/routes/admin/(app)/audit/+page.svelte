<script lang="ts">
  import SearchIcon from '@lucide/svelte/icons/search';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as InputGroup from '#lib/components/ui/input-group/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import { formatDateTime, timeAgo } from '#lib/admin/format.js';
  import { audit } from './audit.remote.js';
  import { AREA_LABELS, actionOf, actorOf, areaOf, detailOf, targetOf, type Area } from './describe.js';

  const PAGE = 20;
  const ALL = 'all';

  let query = $state('');
  let actor = $state(ALL);
  let area = $state<Area | typeof ALL>(ALL);
  let shown = $state(PAGE);

  const all = $derived(
    (await audit()).map((entry) => ({
      ...entry,
      at: Date.parse(entry.created_at),
      who: actorOf(entry),
      area: areaOf(entry),
      text: actionOf(entry),
      target: targetOf(entry),
      detail: detailOf(entry),
    })),
  );

  // Everyone who appears in the entries read, the relay last.
  const actors = $derived([...new Set(all.map((e) => e.who))].sort((a, b) => Number(a === 'Relay') - Number(b === 'Relay') || a.localeCompare(b)));
  const actorLabel = $derived(actor === ALL ? 'Everyone' : actor);

  const entries = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (e) =>
        (actor === ALL || e.who === actor) &&
        (area === ALL || e.area === area) &&
        (!q || [e.text, e.target?.label, e.detail].some((text) => text?.toLowerCase().includes(q))),
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
    <Select.Trigger class="w-full" aria-label="Changed by"><span class="truncate">{actorLabel}</span></Select.Trigger>
    <Select.Content class="max-h-72">
      <Select.Item value={ALL} label="Everyone" />
      {#each actors as name (name)}
        <Select.Item value={name} label={name} />
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
          <span class="truncate font-medium sm:order-2 {entry.actor_type === 'system' ? 'text-muted-foreground' : ''}">{entry.who}</span>
          <time datetime={entry.created_at} title={formatDateTime(entry.at)} class="text-muted-foreground tabular-nums sm:order-1">{timeAgo(entry.at)}</time>
        </div>
        <div class="flex min-w-0 flex-col gap-0.5 sm:order-3">
          <span>
            {entry.text}{#if entry.target}{' · '}<a href={entry.target.href} class="font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                >{entry.target.label}</a
              >{/if}
          </span>
          {#if entry.detail}<span class="text-pretty break-words text-muted-foreground">{entry.detail}</span>{/if}
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
