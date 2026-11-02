<script lang="ts">
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { timeAgo } from '#lib/admin/format.js';
  import { moderation } from '../moderation.remote.js';

  const bots = $derived((await moderation()).bots);
</script>

{#if bots.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No bots waiting</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each bots as bot (bot.agent_id)}
      <li class="flex items-center gap-3 py-2.5 pr-2 pl-4">
        <AgentAvatar agent={bot.agent} class="size-8" />
        <div class="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <a
            href="/admin/moderation/bots/{bot.agent_id}"
            class="truncate text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring sm:w-48 sm:shrink-0"
            >{bot.agent.name}</a
          >
          <span class="min-w-0 flex-1 truncate text-sm text-muted-foreground">{bot.owner ? `Adopted by @${bot.owner.username}` : ''}</span>
          <span class="text-xs text-muted-foreground sm:text-sm">{timeAgo(Date.parse(bot.created_at))}</span>
        </div>
        <Button size="sm" variant="outline" href={bot.add_url} target="_blank" rel="noopener">
          Add to server<span class="sr-only">: {bot.agent.name}’s bot</span>
          <ExternalLinkIcon aria-hidden="true" />
        </Button>
      </li>
    {/each}
  </ul>
{/if}
