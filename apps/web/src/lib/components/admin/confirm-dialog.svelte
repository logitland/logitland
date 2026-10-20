<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';

  /**
   * DESIGN.md's confirmation pattern: the title is the question, the confirm button repeats the verb,
   * one line of consequence. `onConfirm` may be async; the dialog waits for it with a spinner, then closes.
   */
  let {
    open = $bindable(false),
    title,
    description,
    confirm,
    destructive = false,
    onConfirm,
    children,
  }: {
    open?: boolean;
    title: string;
    description?: string;
    confirm: string;
    destructive?: boolean;
    onConfirm: () => Promise<unknown> | unknown;
    /** Extra fields between the description and the buttons, such as a duration. */
    children?: Snippet;
  } = $props();

  let pending = $state(false);

  async function run() {
    pending = true;
    await onConfirm();
    pending = false;
    open = false;
  }
</script>

<AlertDialog.Root bind:open={() => open, (next) => !pending && (open = next)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      {#if description}
        <AlertDialog.Description>{description}</AlertDialog.Description>
      {/if}
    </AlertDialog.Header>
    {@render children?.()}
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={pending}>Cancel</AlertDialog.Cancel>
      <Button variant={destructive ? 'destructive' : 'default'} disabled={pending} onclick={run}>
        {#if pending}<Spinner />{/if}
        {confirm}
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
