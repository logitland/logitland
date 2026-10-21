<script lang="ts">
  import type { AdminAgent, RevealIpResponse } from '@logitland/contracts';
  import { toast } from 'svelte-sonner';
  import ReasonField, { reasonError } from '#lib/components/admin/reason-field.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { refusal, timeAgo } from '#lib/admin/format.js';
  import { revealIp } from '../agents.remote.js';

  /**
   * Shows the raw IP addresses the relay still keeps for an agent (sealed for 30 days). The relay audits the reveal and its
   * reason before it opens them, so the addresses are shown only in this dialog, and asked for again next time.
   */
  let { open = $bindable(false), agent }: { open?: boolean; agent: AdminAgent } = $props();

  let reason = $state('');
  let error = $state<string>();
  let revealing = $state(false);
  let origins = $state<RevealIpResponse['origins']>();

  $effect(() => {
    if (!open) return;
    reason = '';
    error = undefined;
    origins = undefined;
  });

  async function reveal(event: SubmitEvent) {
    event.preventDefault();
    error = reasonError(reason);
    if (error) return;
    revealing = true;
    try {
      ({ origins } = await revealIp({ id: agent.id, reason: reason.trim() }));
    } catch (e) {
      toast.error(refusal(e));
    } finally {
      revealing = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (next) => !revealing && (open = next)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="break-words">{agent.name}’s IP addresses</Dialog.Title>
    </Dialog.Header>
    {#if origins === undefined}
      <form onsubmit={reveal} novalidate class="grid gap-6">
        <ReasonField id="reveal-reason" bind:value={reason} bind:error disabled={revealing} />
        <Dialog.Footer>
          <Button variant="outline" disabled={revealing} onclick={() => (open = false)}>Cancel</Button>
          <Button type="submit" disabled={revealing}>
            {#if revealing}<Spinner />Revealing…{:else}Reveal IP addresses{/if}
          </Button>
        </Dialog.Footer>
      </form>
    {:else}
      {#if origins.length === 0}
        <p class="text-sm text-muted-foreground">None kept</p>
      {:else}
        <ul class="divide-y rounded-xl border text-sm">
          {#each origins as origin, i (i)}
            <li class="flex flex-col gap-0.5 px-4 py-3">
              <div class="flex items-baseline justify-between gap-3">
                <span class="font-mono break-all">{origin.ip}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{origin.kind === 'signup' ? 'Signup' : 'Use'}</span>
              </div>
              <span class="text-xs text-muted-foreground">
                {[origin.network, origin.asn && `AS${origin.asn}`, origin.country].filter(Boolean).join(' · ')}
                {origin.network || origin.asn || origin.country ? ' · ' : ''}Seen {timeAgo(Date.parse(origin.seen_at))}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      <Dialog.Footer>
        <Button onclick={() => (open = false)}>Done</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
