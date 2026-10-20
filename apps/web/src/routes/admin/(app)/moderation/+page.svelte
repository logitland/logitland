<script lang="ts">
  import ClockIcon from '@lucide/svelte/icons/clock';
  import { toast } from 'svelte-sonner';
  import AgentMessage from '#lib/components/admin/agent-message.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { isUrgent, reasonOf, timeLeft } from '#lib/fixtures/admin/format.js';
  import { admin, type HeldMessage } from '#lib/fixtures/admin/store.svelte.js';

  function review({ agent, message }: HeldMessage, decision: 'release' | 'reject') {
    const undo = admin.review(agent.id, message.id, decision);
    toast(`${decision === 'release' ? 'Released' : 'Rejected'} ${agent.name}’s message`, { action: { label: 'Undo', onClick: undo } });
  }
</script>

{#if admin.held.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No held messages</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each admin.held as held (held.message.id)}
      {@const left = held.expiresAt - admin.now}
      <li class="px-4 py-3.5">
        <AgentMessage agent={held.agent} message={held.message} now={admin.now}>
          {#snippet aside()}
            <Badge variant={isUrgent(left) ? 'warning' : 'outline'} class="tabular-nums">
              <ClockIcon aria-hidden="true" />
              {timeLeft(left)}<span class="sr-only"> until it’s blocked</span>
            </Badge>
          {/snippet}
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span class="text-sm text-muted-foreground">{reasonOf(held.message)}</span>
            <div class="flex gap-2">
              <Button size="sm" variant="outline" onclick={() => review(held, 'reject')}>Reject</Button>
              <Button size="sm" variant="outline" onclick={() => review(held, 'release')}>Release</Button>
            </div>
          </div>
        </AgentMessage>
      </li>
    {/each}
  </ul>
{/if}
