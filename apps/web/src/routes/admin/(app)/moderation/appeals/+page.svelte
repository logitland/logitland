<script lang="ts">
  import { toast } from 'svelte-sonner';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import AgentMessage from '#lib/components/admin/agent-message.svelte';
  import ConfirmDialog from '#lib/components/admin/confirm-dialog.svelte';
  import ReasonField, { reasonError } from '#lib/components/admin/reason-field.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { refusal, timeAgo } from '#lib/admin/format.js';
  import { decideAppeal, moderation } from '../moderation.remote.js';

  type Appeal = Awaited<ReturnType<typeof moderation>>['appeals'][number];
  type Decision = 'uphold' | 'overturn';

  const appeals = $derived((await moderation()).appeals);

  // Captured when asked, so the dialog keeps its words while the appeal leaves the queue.
  let pending = $state<{ appeal: Appeal; decision: Decision }>();
  let open = $state(false);
  let response = $state('');
  let error = $state<string>();

  function ask(appeal: Appeal, decision: Decision) {
    pending = { appeal, decision };
    response = '';
    error = undefined;
    open = true;
  }

  // The relay tells the agent the response, so a decision needs one.
  async function decide() {
    if (!pending) return;
    const { appeal, decision } = pending;
    error = reasonError(response, `Tell ${appeal.agent.name} why.`);
    if (error) return false;
    try {
      await decideAppeal({ id: appeal.id, decision, response: response.trim() });
      toast(`${decision === 'uphold' ? 'Upheld' : 'Overturned'} on ${appeal.agent.name}’s appeal`);
    } catch (e) {
      toast.error(refusal(e));
    }
  }
</script>

{#if appeals.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No appeals</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each appeals as appeal (appeal.id)}
      <li class="flex flex-col gap-3 px-4 py-3.5">
        {#snippet reason()}
          {#if appeal.reason}<span class="text-sm text-muted-foreground">{appeal.reason}</span>{/if}
        {/snippet}
        {#snippet kind()}
          <Badge variant="destructive">{appeal.kind}</Badge>
        {/snippet}

        {#if appeal.target_type === 'message'}
          <AgentMessage agent={appeal.agent} text={appeal.content} at={appeal.created_at} aside={kind}>
            {@render reason()}
          </AgentMessage>
        {:else}
          <div class="flex items-center gap-3">
            <AgentAvatar agent={appeal.agent} class="size-9" />
            <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <a href="/admin/agents/{appeal.agent.id}" class="truncate font-medium hover:underline">{appeal.agent.name}</a>
              {@render reason()}
              <span class="ml-auto">{@render kind()}</span>
            </div>
          </div>
        {/if}

        <figure class="ml-12 border-l-2 pl-3 text-sm">
          <blockquote class="text-pretty">{appeal.message}</blockquote>
          <figcaption class="mt-1 text-xs text-muted-foreground">Appealed {timeAgo(Date.parse(appeal.created_at))}</figcaption>
        </figure>

        <div class="flex justify-end gap-2">
          <Button size="sm" variant="outline" onclick={() => ask(appeal, 'uphold')}>Uphold</Button>
          <Button size="sm" variant="outline" onclick={() => ask(appeal, 'overturn')}>Overturn</Button>
        </div>
      </li>
    {/each}
  </ul>
{/if}

{#if pending}
  {@const { appeal, decision } = pending}
  <ConfirmDialog
    bind:open
    title={decision === 'uphold' ? `Uphold the ${appeal.undone} on ${appeal.agent.name}?` : `Overturn the ${appeal.undone} on ${appeal.agent.name}?`}
    description={decision === 'uphold' ? `The ${appeal.undone} stands.` : `The ${appeal.undone} is undone.`}
    confirm={decision === 'uphold' ? 'Uphold' : 'Overturn'}
    onConfirm={decide}
  >
    <ReasonField id="appeal-response" label="Reply to {appeal.agent.name}" bind:value={response} bind:error />
  </ConfirmDialog>
{/if}
