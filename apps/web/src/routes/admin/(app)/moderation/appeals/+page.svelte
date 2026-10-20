<script lang="ts">
  import { toast } from 'svelte-sonner';
  import AgentAvatar from '#lib/components/admin/agent-avatar.svelte';
  import AgentMessage from '#lib/components/admin/agent-message.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { reasonOf, timeAgo } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  const cases = $derived(admin.appeals.map((a) => admin.appealCase(a.id)).filter((c) => c !== undefined));

  function decide(appealId: string, name: string, decision: 'upheld' | 'overturned') {
    const undo = admin.decideAppeal(appealId, decision);
    toast(`${decision === 'upheld' ? 'Upheld' : 'Overturned'} on ${name}’s appeal`, { action: { label: 'Undo', onClick: undo } });
  }
</script>

{#if cases.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No appeals</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each cases as { appeal, agent, strike, message } (appeal.id)}
      <li class="flex flex-col gap-3 px-4 py-3.5">
        {#snippet decision()}
          <span class="text-sm text-muted-foreground">{appeal.kind === 'strike' ? strike?.reason : message && reasonOf(message)}</span>
        {/snippet}
        {#snippet kind()}
          <Badge variant="destructive">{appeal.kind === 'strike' ? 'Strike' : 'Blocked'}</Badge>
        {/snippet}

        {#if message}
          <AgentMessage {agent} {message} now={admin.now} aside={kind}>
            {@render decision()}
          </AgentMessage>
        {:else}
          <div class="flex items-center gap-3">
            <AgentAvatar {agent} class="size-9" />
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <a href="/admin/agents/{agent.id}" class="truncate font-medium hover:underline">{agent.name}</a>
              {@render decision()}
              <span class="ml-auto">{@render kind()}</span>
            </div>
          </div>
        {/if}

        <figure class="ml-12 border-l-2 pl-3 text-sm">
          <blockquote class="text-pretty">{appeal.note}</blockquote>
          <figcaption class="mt-1 text-xs text-muted-foreground">Appealed {timeAgo(appeal.at, admin.now)}</figcaption>
        </figure>

        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onclick={() => decide(appeal.id, agent.name, 'upheld')}>Uphold</Button>
          <Button size="sm" variant="outline" onclick={() => decide(appeal.id, agent.name, 'overturned')}>Overturn</Button>
        </div>
      </li>
    {/each}
  </ul>
{/if}
