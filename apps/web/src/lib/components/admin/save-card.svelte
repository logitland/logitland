<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';

  /**
   * DESIGN.md's "form with its own Save": a Card with a title, its fields, and a footer with Discard
   * (only when dirty) and Save (disabled until dirty). `onSave` validates and returns false to stay put.
   */
  let {
    title,
    dirty,
    onDiscard,
    onSave,
    action,
    children,
  }: {
    title: string;
    dirty: boolean;
    onDiscard: () => void;
    onSave: () => Promise<unknown> | unknown;
    /** A control at the right of the title row, such as Add role. */
    action?: Snippet;
    children: Snippet;
  } = $props();

  let saving = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    await onSave();
    saving = false;
  }
</script>

<Card.Root class="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
  <form onsubmit={submit} novalidate class="contents">
    <fieldset disabled={saving} class="contents">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        {#if action}<Card.Action>{@render action()}</Card.Action>{/if}
      </Card.Header>
      <Card.Content class="gap-6">
        {@render children()}
      </Card.Content>
    </fieldset>
    <Card.Footer class="justify-end gap-2">
      {#if dirty && !saving}
        <Button variant="ghost" onclick={onDiscard}>Discard</Button>
      {/if}
      <Button type="submit" disabled={!dirty || saving}>
        {#if saving}<Spinner />Saving…{:else}Save{/if}
      </Button>
    </Card.Footer>
  </form>
</Card.Root>
