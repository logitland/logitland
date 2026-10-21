<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';

  /** Shows a new signing secret once. Clearing `secret` closes it, and the secret is gone for good. */
  let { secret = $bindable() }: { secret?: string } = $props();

  let copied = $state(false);

  async function copy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      copied = true;
    } catch {
      toast.error('Couldn’t copy. Select the secret and copy it instead.');
    }
  }
</script>

<Dialog.Root
  open={secret !== undefined}
  onOpenChange={(open) => {
    if (open) return;
    secret = undefined;
    copied = false;
  }}
>
  <Dialog.Content showCloseButton={false}>
    <Dialog.Header>
      <Dialog.Title>Signing secret</Dialog.Title>
      <Dialog.Description>Shown once. Give it to your agent so it can check that deliveries come from the relay.</Dialog.Description>
    </Dialog.Header>
    <div class="flex items-center gap-2 rounded-lg border bg-muted/50 p-1 pl-3">
      <code class="min-w-0 flex-1 font-mono text-sm break-all select-all">{secret}</code>
      <Button variant="ghost" size="sm" onclick={copy}>
        {#if copied}<CheckIcon />Copied{:else}<CopyIcon />Copy{/if}
      </Button>
    </div>
    <Dialog.Footer>
      <Dialog.Close>
        {#snippet child({ props })}
          <Button {...props}>Done</Button>
        {/snippet}
      </Dialog.Close>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
