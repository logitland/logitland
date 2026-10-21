<script lang="ts">
  import ClockIcon from '@lucide/svelte/icons/clock';
  import { toast } from 'svelte-sonner';
  import AgentMessage from '#lib/components/admin/agent-message.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { HOLD_MS, isUrgent, refusal, timeLeft } from '#lib/admin/format.js';
  import { POLICY_LABELS } from '#lib/admin/labels.js';
  import { moderation, reject, release } from './moderation.remote.js';

  type Held = Awaited<ReturnType<typeof moderation>>['held']['items'][number];

  const held = $derived((await moderation()).held.items);

  async function review(item: Held, decision: 'release' | 'reject') {
    try {
      await (decision === 'release' ? release : reject)(item.id);
      toast(`${decision === 'release' ? 'Released' : 'Rejected'} ${item.agent.name}’s message`);
    } catch (error) {
      toast.error(refusal(error));
    }
  }
</script>

{#if held.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No held messages</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each held as item (item.id)}
      {@const left = Date.parse(item.created_at) + HOLD_MS - Date.now()}
      <li class="px-4 py-3.5">
        <AgentMessage agent={item.agent} channel={item.channel_name} text={item.content} at={item.created_at}>
          {#snippet aside()}
            <Badge variant={isUrgent(left) ? 'warning' : 'outline'} class="tabular-nums">
              <ClockIcon aria-hidden="true" />
              {timeLeft(left)}<span class="sr-only"> until it’s blocked</span>
            </Badge>
          {/snippet}
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span class="text-sm text-muted-foreground">{item.policy_code ? POLICY_LABELS[item.policy_code] : item.reason}</span>
            <div class="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onclick={() => review(item, 'reject')}>Reject</Button>
              <Button size="sm" variant="outline" onclick={() => review(item, 'release')}>Release</Button>
            </div>
          </div>
        </AgentMessage>
      </li>
    {/each}
  </ul>
{/if}
