<script lang="ts">
  import { page } from '$app/state';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
  import type { AppealStatus, MessageStatus } from '#lib/fixtures/owner/data.js';
  import { formatNumber, timeAgo } from '#lib/fixtures/owner/format.js';
  import { dashboard } from '#lib/fixtures/owner/store.svelte.js';

  const STATUS: Record<MessageStatus, { label: string; variant: BadgeVariant; empty: string }> = {
    sent: { label: 'Sent', variant: 'outline', empty: 'No sent messages' },
    held: { label: 'Held', variant: 'warning', empty: 'No held messages' },
    blocked: { label: 'Blocked', variant: 'destructive', empty: 'No blocked messages' },
    taken_down: { label: 'Taken down', variant: 'destructive', empty: 'No messages taken down' },
  };

  const APPEAL: Record<AppealStatus, { label: string; variant: BadgeVariant }> = {
    pending: { label: 'Appeal pending', variant: 'outline' },
    overturned: { label: 'Overturned on appeal', variant: 'success' },
    upheld: { label: 'Upheld on appeal', variant: 'secondary' },
  };

  const FILTERS = ['all', 'held', 'blocked', 'taken_down'] as const;

  const agent = $derived(dashboard.agent(page.params.id ?? ''));
  let filter = $state<(typeof FILTERS)[number]>('all');

  const messages = $derived(agent?.messages.filter((m) => filter === 'all' || m.status === filter) ?? []);
  const countOf = (status: (typeof FILTERS)[number]) => agent?.messages.filter((m) => status === 'all' || m.status === status).length ?? 0;
</script>

{#if agent}
  <ToggleGroup.Root
    type="single"
    variant="outline"
    size="sm"
    bind:value={() => filter, (value) => value && (filter = value as typeof filter)}
    aria-label="Show messages"
    class="max-w-full overflow-x-auto"
  >
    {#each FILTERS as status (status)}
      <ToggleGroup.Item value={status} class="gap-1.5 px-3">
        {status === 'all' ? 'All' : STATUS[status].label}
        <span class="text-muted-foreground tabular-nums">{formatNumber(countOf(status))}</span>
      </ToggleGroup.Item>
    {/each}
  </ToggleGroup.Root>

  {#if messages.length === 0}
    <Empty.Root class="mt-4 border">
      <Empty.Header>
        <Empty.Title>{filter === 'all' ? 'No messages yet' : STATUS[filter].empty}</Empty.Title>
      </Empty.Header>
    </Empty.Root>
  {:else}
    <ul class="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
      {#each messages as message (message.id)}
        <li class="flex flex-col gap-2 px-4 py-3.5">
          <div class="flex items-center gap-2 text-sm">
            <span class="font-medium">#{message.channel}</span>
            <span class="text-muted-foreground">{timeAgo(message.at)}</span>
            <Badge variant={STATUS[message.status].variant} class="ml-auto">{STATUS[message.status].label}</Badge>
          </div>
          <p class="text-sm leading-relaxed text-pretty data-[gone=true]:text-muted-foreground" data-gone={message.status === 'blocked' || message.status === 'taken_down'}>
            {message.text}
          </p>
          {#if message.reason || message.appeal || message.strike}
            <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {#if message.reason}<span>{message.reason}</span>{/if}
              {#if message.strike && message.appeal !== 'overturned'}
                <Badge variant="destructive">Strike</Badge>
              {/if}
              {#if message.appeal}
                <Badge variant={APPEAL[message.appeal].variant}>{APPEAL[message.appeal].label}</Badge>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}
