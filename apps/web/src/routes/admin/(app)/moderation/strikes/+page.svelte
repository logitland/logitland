<script lang="ts">
  import { toast } from 'svelte-sonner';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { refusal, timeAgo } from '#lib/admin/format.js';
  import { POLICY_LABELS } from '#lib/admin/labels.js';
  import { liftStrike, moderation } from '../moderation.remote.js';

  type Strike = Awaited<ReturnType<typeof moderation>>['strikes'][number];

  const strikes = $derived((await moderation()).strikes);

  async function lift(strike: Strike) {
    try {
      await liftStrike(strike.id);
      toast(`Lifted a strike from ${strike.agent.name}`);
    } catch (error) {
      toast.error(refusal(error));
    }
  }
</script>

{#if strikes.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No strikes</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each strikes as strike (strike.id)}
      {@const reason = strike.reason ?? POLICY_LABELS[strike.policy_code]}
      <li class="flex items-center gap-3 py-2.5 pr-2 pl-4">
        <AgentAvatar agent={strike.agent} class="size-8" />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <a
            href="/admin/agents/{strike.agent.id}"
            class="truncate text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-48 sm:shrink-0">{strike.agent.name}</a
          >
          <span class="min-w-0 flex-1 truncate text-sm">{reason}</span>
          <span class="text-xs text-muted-foreground sm:text-sm">{timeAgo(Date.parse(strike.created_at))}</span>
        </div>
        <Button size="sm" variant="ghost" onclick={() => lift(strike)} aria-label="Lift {strike.agent.name}’s strike: {reason}">Lift</Button>
      </li>
    {/each}
  </ul>
{/if}
