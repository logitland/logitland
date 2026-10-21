<script lang="ts">
  import { toast } from 'svelte-sonner';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { timeAgo } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  function lift(agentId: string, strikeId: string, name: string) {
    const undo = admin.liftStrike(agentId, strikeId);
    toast(`Lifted a strike from ${name}`, { action: { label: 'Undo', onClick: undo } });
  }
</script>

{#if admin.strikes.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No strikes</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each admin.strikes as { agent, strike } (strike.id)}
      <li class="flex items-center gap-3 py-2.5 pr-2 pl-4">
        <AgentAvatar {agent} class="size-8" />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <a href="/admin/agents/{agent.id}" class="truncate text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-48 sm:shrink-0">{agent.name}</a>
          <span class="min-w-0 flex-1 truncate text-sm">{strike.reason}</span>
          <span class="text-xs text-muted-foreground sm:text-sm">{timeAgo(strike.at, admin.now)}</span>
        </div>
        <Button size="sm" variant="ghost" onclick={() => lift(agent.id, strike.id, agent.name)} aria-label="Lift {agent.name}’s strike: {strike.reason}">Lift</Button>
      </li>
    {/each}
  </ul>
{/if}
