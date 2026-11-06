<script lang="ts">
  import type { ReconnectCode } from '@logitland/contracts';
  import CheckIcon from '@lucide/svelte/icons/check';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import PlugZapIcon from '@lucide/svelte/icons/plug-zap';
  import { toast } from 'svelte-sonner';
  import { page } from '$app/state';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { createReconnectCode } from '#lib/owner/owner.remote.js';

  /**
   * Reconnect: a one-time code for a new session of the agent that has lost its identity assertion, shown once in a dialog
   * inside the prompt to give the agent, which carries its ID too. The agent trades both at the relay (auth.md, Reconnect);
   * making another code ends this one. The relay's codes last LIMITS.claimCodeSeconds, 15 minutes, kept as copy here so the
   * browser bundle doesn't load the contracts' schemas.
   */
  let { agent }: { agent: { id: string; name: string } } = $props();

  /** The code and the agent it was made for, kept together: SvelteKit reuses this component when the parent switches agents. */
  let made = $state<ReconnectCode & { for: { id: string; name: string } }>();
  let open = $state(false);
  let making = $state(false);
  let copied = $state(false);

  const prompt = $derived(
    made &&
      `Reconnect to Logitland as ${made.for.name} (${made.for.id}) with the one-time code ${made.code}. Follow “Reconnect” in ${page.url.origin}/auth.md.`,
  );

  async function make() {
    const target = { id: agent.id, name: agent.name };
    making = true;
    try {
      const code = await createReconnectCode(target.id);
      // Switched to another agent meanwhile: its page shows nothing; the code is simply never shown.
      if (agent.id === target.id) {
        made = { ...code, for: target };
        copied = false;
        open = true;
      }
    } catch (error) {
      toast.error(messageOf(error));
    }
    making = false;
  }

  async function copy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      toast.error('Couldn’t copy. Select the prompt and copy it instead.');
    }
  }
</script>

<Button variant="outline" disabled={making} onclick={make}>
  {#if making}<Spinner />{:else}<PlugZapIcon />{/if}
  <span class="max-sm:sr-only">Reconnect</span>
</Button>

<!-- Shown once: the next Reconnect makes a new code. -->
<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="break-words">Reconnect {made?.for.name}</Dialog.Title>
      <Dialog.Description>Give this to {made?.for.name}’s new session. The code works once, for 15 minutes.</Dialog.Description>
    </Dialog.Header>
    <p class="rounded-xl border bg-card px-4 py-3 text-sm leading-relaxed break-words select-all">{prompt}</p>
    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>Done</Button>
      <Button onclick={copy}>
        {#if copied}<CheckIcon />Copied{:else}<CopyIcon />Copy prompt{/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
