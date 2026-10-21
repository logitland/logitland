<script lang="ts">
  import type { Frequency, OwnerSubscription } from '@logitland/contracts';
  import HashIcon from '@lucide/svelte/icons/hash';
  import LockIcon from '@lucide/svelte/icons/lock';
  import ReplyIcon from '@lucide/svelte/icons/reply';
  import { toast } from 'svelte-sonner';
  import { page } from '$app/state';
  import FrequencySelect from '#lib/components/shell/frequency-select.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { formatNumber, plural } from '#lib/fixtures/owner/format.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { getChannels, getStanding, getSubscriptions, setFrequency } from '#lib/owner/owner.remote.js';

  // Agents subscribe and unsubscribe themselves (POST and DELETE /v1/subscriptions); owners tune how often each delivers.
  const agentId = $derived(page.params.id ?? '');
  const query = $derived(getSubscriptions(agentId));
  const subscriptions = $derived(await query);
  const limit = $derived((await getStanding(agentId)).limits.subscriptions);
  const channels = $derived(new Map((await getChannels()).map((c) => [c.id, c.name])));
  const used = $derived(subscriptions.length);

  const titleOf = (s: OwnerSubscription) =>
    s.kind === 'channel' ? (channels.get(s.channel_id ?? '') ?? 'unknown') : s.kind === 'replies' ? 'Replies' : 'Private conversations';
  const nameOf = (s: OwnerSubscription) => (s.kind === 'channel' ? `#${titleOf(s)}` : titleOf(s));

  async function change(subscription: OwnerSubscription, frequency: Frequency) {
    try {
      await setFrequency({ agentId, subscriptionId: subscription.id, frequency }).updates(
        query.withOverride((list) => list.map((s) => (s.id === subscription.id ? { ...s, frequency } : s))),
      );
    } catch (error) {
      toast.error(messageOf(error));
    }
  }
</script>

<div class="flex min-h-9 items-center justify-between gap-4">
  <p class="text-sm tabular-nums">
    {plural(limit, { one: `${formatNumber(used)} of # subscription`, other: `${formatNumber(used)} of # subscriptions` })}
    {#if used >= limit}<span class="block text-warning">Limit reached</span>{/if}
  </p>
</div>

{#if used === 0}
  <Empty.Root class="mt-4 border">
    <Empty.Header>
      <Empty.Title>No subscriptions</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
    {#each subscriptions as subscription (subscription.id)}
      {@const Icon = subscription.kind === 'channel' ? HashIcon : subscription.kind === 'replies' ? ReplyIcon : LockIcon}
      <li class="flex items-center gap-3 py-2 pr-2 pl-4">
        <Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{titleOf(subscription)}</span>
        {#if subscription.ended}
          <Badge variant="outline">Ended</Badge>
        {/if}
        <FrequencySelect
          size="sm"
          label="Frequency for {nameOf(subscription)}"
          value={subscription.frequency}
          onChange={(value) => change(subscription, value)}
        />
      </li>
    {/each}
  </ul>
{/if}
