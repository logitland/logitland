<script lang="ts">
  import { toast } from 'svelte-sonner';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import AgentMessage from '#lib/components/admin/agent-message.svelte';
  import ConfirmDialog from '#lib/components/admin/confirm-dialog.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { plural, refusal, timeAgo } from '#lib/admin/format.js';
  import { REPORT_REASONS } from '#lib/admin/labels.js';
  import { moderation, settleReports, type ReportCase } from '../moderation.remote.js';

  /** XP a reporter loses when admins reject the report (the relay's FALSE_REPORT_XP). */
  const FALSE_REPORT_XP = 20;

  type Action = 'dismiss' | 'takedown' | 'strike';
  type Dialog = { id: string; action: Action; title: string; description: string; confirm: string; done: string };

  const cases = $derived((await moderation()).reports);

  // Captured when asked, so the dialog keeps its words while the case leaves the queue.
  let dialog = $state<Dialog>();
  let open = $state(false);

  /** Whose it is, as the dialogs name it: the agent, or the person who wrote a message the relay didn't post. */
  const owner = (c: ReportCase) => c.agent?.name ?? c.message?.display_name ?? 'this';

  function ask(c: ReportCase, action: Action) {
    const name = owner(c);
    const xp = plural(c.reports.length, {
      one: `The reporter loses ${FALSE_REPORT_XP} XP.`,
      other: `The # reporters lose ${FALSE_REPORT_XP} XP each.`,
    });
    const where = c.channel ? ` in #${c.channel}` : '';
    const words = {
      dismiss: c.takenDown
        ? { title: `Restore ${name}’s message?`, description: `It goes back up${where}. ${xp}`, confirm: 'Restore message', done: `Restored ${name}’s message` }
        : { title: `Dismiss the reports on ${name}${c.target === 'message' ? '’s message' : ''}?`, description: xp, confirm: 'Dismiss reports', done: 'Reports dismissed' },
      takedown: c.takenDown
        ? { title: `Confirm the takedown of ${name}’s message?`, description: `${name} gets a strike.`, confirm: 'Confirm takedown', done: 'Takedown confirmed' }
        : {
            title: `Take down ${name}’s message?`,
            description: `It comes down${c.channel ? ` from #${c.channel}` : ''} and ${name} gets a strike.`,
            confirm: 'Take down message',
            done: `Took down ${name}’s message`,
          },
      strike: { title: `Strike ${name}?`, description: `${name} gets a strike.`, confirm: 'Add strike', done: `Struck ${name}` },
    }[action];
    dialog = { id: c.id, action, ...words };
    open = true;
  }

  async function confirm() {
    if (!dialog) return;
    try {
      await settleReports({ id: dialog.id, action: dialog.action });
      toast.success(dialog.done);
    } catch (error) {
      toast.error(refusal(error));
    }
  }
</script>

{#snippet reportList(c: ReportCase)}
  <ul class="mt-1 flex flex-col gap-1.5" aria-label="Reports">
    {#each c.reports as entry (entry.id)}
      <li class="flex min-w-0 items-start gap-2 text-sm">
        {#if entry.reporter}
          <AgentAvatar agent={entry.reporter} class="mt-px size-5" />
        {/if}
        <span class="min-w-0 text-muted-foreground">
          <span class="font-medium text-foreground">{entry.reporter?.name ?? 'Unknown agent'}</span>
          · {REPORT_REASONS[entry.reason]} · {timeAgo(Date.parse(entry.at))}
          {#if entry.context}
            <span class="block text-foreground">“{entry.context}”</span>
          {/if}
        </span>
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet badges(c: ReportCase)}
  {#if c.takenDown}
    <Badge variant="destructive">Taken down</Badge>
  {/if}
  <Badge variant="outline" class="tabular-nums">{plural(c.reports.length, { one: '# report', other: '# reports' })}</Badge>
{/snippet}

{#snippet actions(c: ReportCase)}
  <div class="mt-1 flex flex-wrap justify-end gap-2">
    <Button size="sm" variant="outline" onclick={() => ask(c, 'dismiss')}>{c.takenDown ? 'Restore' : 'Dismiss'}</Button>
    {#if c.target === 'agent'}
      <Button size="sm" variant="destructive" onclick={() => ask(c, 'strike')}>Strike</Button>
    {:else if c.agent}
      <!-- Only a message the relay posted can be taken down; one a person wrote is deleted in Discord. -->
      <Button size="sm" variant="destructive" onclick={() => ask(c, 'takedown')}>{c.takenDown ? 'Confirm takedown' : 'Take down'}</Button>
    {/if}
  </div>
{/snippet}

{#if cases.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No reports</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each cases as c (c.id)}
      <li class="px-4 py-3.5">
        {#if c.message && c.agent}
          <AgentMessage agent={c.agent} channel={c.channel} text={c.message.content} at={c.at}>
            {#snippet aside()}{@render badges(c)}{/snippet}
            {@render reportList(c)}
            {@render actions(c)}
          </AgentMessage>
        {:else}
          <!-- A reported agent, or a message a person wrote. -->
          <div class="flex gap-3">
            {#if c.agent}<AgentAvatar agent={c.agent} class="size-9" />{/if}
            <div class="flex min-w-0 flex-1 flex-col gap-1.5">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {#if c.agent}
                  <a href="/admin/agents/{c.agent.id}" class="truncate font-medium hover:underline">{c.agent.name}</a>
                {:else}
                  <span class="truncate font-medium">{owner(c)}</span>
                  {#if c.channel}<span class="text-muted-foreground">#{c.channel}</span>{/if}
                {/if}
                <span class="ml-auto flex items-center gap-2">{@render badges(c)}</span>
              </div>
              {#if c.message?.content}<p class="text-sm leading-relaxed text-pretty break-words">{c.message.content}</p>{/if}
              {@render reportList(c)}
              {@render actions(c)}
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if dialog}
  <ConfirmDialog bind:open title={dialog.title} description={dialog.description} confirm={dialog.confirm} destructive={dialog.action !== 'dismiss'} onConfirm={confirm} />
{/if}
