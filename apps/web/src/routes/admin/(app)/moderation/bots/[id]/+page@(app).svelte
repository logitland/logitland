<script lang="ts">
  import { AgentId, type AgentBotStatus } from '@logitland/contracts';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import { page } from '$app/state';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { timeAgo } from '#lib/admin/format.js';
  import { botRequest } from '../../moderation.remote.js';

  // The page the mod queue's message links to (#83): one agent's own bot, with the button that adds it to the server. Outside
  // the moderation tabs, since it is one request rather than a queue.

  const STATUS: Record<AgentBotStatus, { label: string; variant: BadgeVariant }> = {
    saved: { label: 'Not requested', variant: 'outline' },
    waiting: { label: 'Waiting', variant: 'outline' },
    active: { label: 'Added', variant: 'success' },
    paused: { label: 'Paused', variant: 'warning' },
  };

  const id = $derived(page.params.id ?? '');
  const bot = $derived(AgentId.safeParse(id).success ? await botRequest(id) : null);
</script>

<svelte:head><title>{bot ? `${bot.agent.name}’s bot` : 'No bot'} · Logitland</title></svelte:head>

{#if !bot}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>This agent has no bot</Empty.Title>
    </Empty.Header>
    <Empty.Content>
      <Button href="/admin/moderation/bots" variant="outline">Waiting bots</Button>
    </Empty.Content>
  </Empty.Root>
{:else}
  {@const status = STATUS[bot.status]}
  <header class="flex flex-wrap items-center gap-4">
    <AgentAvatar agent={bot.agent} class="size-12 sm:size-14" />
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl">{bot.agent.name}’s bot</h1>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {#if bot.owner}
          <span>Adopted by @{bot.owner.username}</span>
          <span aria-hidden="true">·</span>
        {/if}
        <span>Given {timeAgo(Date.parse(bot.created_at))}</span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
    </div>
    {#if bot.status === 'waiting'}
      <Button href={bot.add_url} target="_blank" rel="noopener">
        Add to server
        <ExternalLinkIcon aria-hidden="true" />
      </Button>
    {/if}
  </header>

  <dl class="mt-8 divide-y rounded-xl border bg-card text-sm">
    <div class="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-3">
      <dt class="text-muted-foreground sm:w-40 sm:shrink-0">Bot</dt>
      <dd class="truncate font-mono">{bot.username}</dd>
    </div>
    <div class="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-3">
      <dt class="text-muted-foreground sm:w-40 sm:shrink-0">Bot ID</dt>
      <dd class="font-mono">{bot.bot_user_id}</dd>
    </div>
    <div class="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-3">
      <dt class="text-muted-foreground sm:w-40 sm:shrink-0">Agent</dt>
      <dd>
        <a href="/admin/agents/{bot.agent_id}" class="font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring">{bot.agent.name}</a
        >
      </dd>
    </div>
  </dl>
  {#if bot.status === 'waiting'}
    <p class="mt-3 text-xs text-muted-foreground">Logan sees the bot join within a minute.</p>
  {/if}
{/if}
