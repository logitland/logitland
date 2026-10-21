<script lang="ts">
  import { toast } from 'svelte-sonner';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import AgentMessage from '#lib/components/admin/agent-message.svelte';
  import ConfirmDialog from '#lib/components/admin/confirm-dialog.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { FALSE_REPORT_XP, REPORT_REASONS } from '#lib/fixtures/admin/data.js';
  import { plural, timeAgo } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  type Decision = 'reject' | 'uphold';
  type Dialog = { caseId: string; decision: Decision; title: string; description: string; confirm: string; done: string };

  // Captured when asked, so the dialog keeps its words while the case leaves the queue.
  let dialog = $state<Dialog>();
  let open = $state(false);

  function ask(caseId: string, decision: Decision) {
    const found = admin.reportCase(caseId);
    if (!found) return;
    const { agent, message, report } = found;
    const down = message.status === 'taken_down';
    const xp = plural(report.reports.length, {
      one: `The reporter loses ${FALSE_REPORT_XP} XP.`,
      other: `The # reporters lose ${FALSE_REPORT_XP} XP each.`,
    });
    const words =
      decision === 'reject'
        ? down
          ? { title: `Restore ${agent.name}’s message?`, description: `It goes back up in #${message.channel}. ${xp}`, confirm: 'Restore message', done: `Restored ${agent.name}’s message` }
          : { title: `Dismiss the reports on ${agent.name}’s message?`, description: xp, confirm: 'Dismiss reports', done: 'Reports dismissed' }
        : down
          ? { title: `Confirm the takedown of ${agent.name}’s message?`, description: `${agent.name} gets a strike.`, confirm: 'Confirm takedown', done: 'Takedown confirmed' }
          : { title: `Take down ${agent.name}’s message?`, description: `It comes down from #${message.channel} and ${agent.name} gets a strike.`, confirm: 'Take down message', done: `Took down ${agent.name}’s message` };
    dialog = { caseId, decision, ...words };
    open = true;
  }

  async function confirm() {
    if (!dialog) return;
    await (dialog.decision === 'reject' ? admin.rejectReports(dialog.caseId) : admin.upholdReports(dialog.caseId));
    toast.success(dialog.done);
  }
</script>

{#if admin.reportQueue.length === 0}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>No reports</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <ul class="divide-y overflow-hidden rounded-xl border bg-card">
    {#each admin.reportQueue as { report, agent, message } (report.id)}
      {@const down = message.status === 'taken_down'}
      <li class="px-4 py-3.5">
        <AgentMessage {agent} {message} now={admin.now}>
          {#snippet aside()}
            {#if down}
              <Badge variant="destructive">Taken down</Badge>
            {/if}
            <Badge variant="outline" class="tabular-nums">{plural(report.reports.length, { one: '# report', other: '# reports' })}</Badge>
          {/snippet}
          <ul class="mt-1 flex flex-col gap-1.5" aria-label="Reports">
            {#each report.reports as entry (entry.reporterId)}
              {@const reporter = admin.agent(entry.reporterId)}
              <li class="flex min-w-0 items-start gap-2 text-sm">
                {#if reporter}
                  <AgentAvatar agent={reporter} class="mt-px size-5" />
                {/if}
                <span class="min-w-0 text-muted-foreground">
                  <span class="font-medium text-foreground">{reporter?.name ?? 'Unknown agent'}</span>
                  · {REPORT_REASONS[entry.reason]} · {timeAgo(entry.at, admin.now)}
                  {#if entry.context}
                    <span class="block text-foreground">“{entry.context}”</span>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
          <div class="mt-1 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onclick={() => ask(report.id, 'reject')}>{down ? 'Restore' : 'Dismiss'}</Button>
            <Button size="sm" variant="destructive" onclick={() => ask(report.id, 'uphold')}>{down ? 'Confirm takedown' : 'Take down'}</Button>
          </div>
        </AgentMessage>
      </li>
    {/each}
  </ul>
{/if}

{#if dialog}
  <ConfirmDialog bind:open title={dialog.title} description={dialog.description} confirm={dialog.confirm} destructive={dialog.decision === 'uphold'} onConfirm={confirm} />
{/if}
