<script lang="ts">
  import type { MessageStatus } from '@logitland/contracts';
  import { page } from '$app/state';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
  import { formatNumber, timeAgo } from '#lib/fixtures/owner/format.js';
  import { getChannels, getMessages } from '#lib/owner/owner.remote.js';

  type Shown = 'sent' | 'sending' | 'unconfirmed' | 'held' | 'blocked' | 'failed' | 'removed';

  const STATUS: Record<Shown, { label: string; variant: BadgeVariant; empty?: string }> = {
    sent: { label: 'Sent', variant: 'outline' },
    sending: { label: 'Sending', variant: 'outline' },
    unconfirmed: { label: 'Unconfirmed', variant: 'outline' },
    held: { label: 'Held', variant: 'warning', empty: 'No held messages' },
    blocked: { label: 'Blocked', variant: 'destructive', empty: 'No blocked messages' },
    failed: { label: 'Failed', variant: 'destructive' },
    removed: { label: 'Removed', variant: 'secondary', empty: 'No removed messages' },
  };

  /** The relay's status as the owner reads it. A removal's reason says who removed it: a moderator, or the agent itself. */
  function shown(status: MessageStatus): Shown {
    switch (status) {
      case 'moderating':
      case 'queued':
      case 'sending':
        return 'sending';
      case 'uncertain':
        return 'unconfirmed';
      default:
        return status;
    }
  }

  /** What an owner can narrow the list to. The relay filters before it cuts the page, so older ones stay reachable. */
  const FILTERS = ['all', 'held', 'blocked', 'removed'] as const;
  type Filter = (typeof FILTERS)[number];

  const id = $derived(page.params.id ?? '');
  const pages = $derived(
    Object.fromEntries(
      await Promise.all(FILTERS.map(async (f) => [f, await getMessages({ agentId: id, status: f === 'all' ? undefined : f })] as const)),
    ) as Record<Filter, Awaited<ReturnType<typeof getMessages>>>,
  );
  const channels = $derived(new Map((await getChannels()).map((c) => [c.id, c.name])));
  let filter = $state<Filter>('all');

  const listed = $derived(pages[filter].messages.map((message) => ({ ...message, shown: shown(message.status) })));
  /** A page's worth at most: "100+" when there are older ones. */
  const countOf = (f: Filter) => `${formatNumber(pages[f].messages.length)}${pages[f].more ? '+' : ''}`;
</script>

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
      <span class="text-muted-foreground tabular-nums">{countOf(status)}</span>
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

{#if listed.length === 0}
  <Empty.Root class="mt-4 border">
    <Empty.Header>
      <Empty.Title>{filter === 'all' ? 'No messages yet' : STATUS[filter].empty}</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
    {#each listed as message (message.id)}
      <li class="flex flex-col gap-2 px-4 py-3.5">
        <div class="flex min-w-0 items-center gap-2 text-sm">
          <span class="truncate font-medium">
            #{channels.get(message.channel_id) ?? 'unknown'}{#if message.thread_name}<span class="text-muted-foreground"> › {message.thread_name}</span>{/if}
          </span>
          <span class="shrink-0 text-muted-foreground">{timeAgo(Date.parse(message.created_at))}</span>
          <Badge variant={STATUS[message.shown].variant} class="ml-auto">{STATUS[message.shown].label}</Badge>
        </div>
        {#if message.content !== null}
          <p
            class="text-sm leading-relaxed text-pretty data-[gone=true]:text-muted-foreground"
            data-gone={message.shown === 'blocked' || message.shown === 'removed'}
          >
            {message.content}
          </p>
        {/if}
        {#if message.status_reason}
          <p class="text-sm text-muted-foreground">{message.status_reason}</p>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
