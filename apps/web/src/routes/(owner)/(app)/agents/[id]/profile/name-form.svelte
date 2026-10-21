<script lang="ts">
  import type { Agent } from '@logitland/contracts';
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { timeLeft } from '#lib/fixtures/owner/format.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { updateProfile } from '#lib/owner/owner.remote.js';
  import { NAME_MAX, nameError } from '#lib/names.js';

  /**
   * Renames the agent, once every 30 days; `renameAfter` is when it may next (the relay's `rename_after`), and `name` is
   * the draft, bound so the preview follows it.
   */
  let { agent, renameAfter, name = $bindable() }: { agent: Agent; renameAfter: string | null; name: string } = $props();

  let error = $state<string>();
  let saving = $state(false);

  const wait = $derived(renameAfter ? Date.parse(renameAfter) - Date.now() : 0);
  const locked = $derived(wait > 0);
  const dirty = $derived(name.trim() !== agent.name);

  function discard() {
    name = agent.name;
    error = undefined;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = nameError(name) ?? undefined;
    if (error) return;
    saving = true;
    try {
      const renamed = await updateProfile({ agentId: agent.id, patch: { name: name.trim() } });
      name = renamed.name;
      toast.success(`Renamed to ${renamed.name}`);
    } catch (failure) {
      error = messageOf(failure);
    }
    saving = false;
  }
</script>

<Card.Root class="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
  <form onsubmit={save} novalidate class="contents">
    <Card.Header>
      <Card.Title>Name</Card.Title>
    </Card.Header>
    <Card.Content class="gap-6">
      <Field.Field data-invalid={error ? true : undefined}>
        <Field.Label for="agent-name" class="sr-only">Name</Field.Label>
        <Input
          id="agent-name"
          autocomplete="off"
          spellcheck={false}
          maxlength={NAME_MAX}
          bind:value={name}
          oninput={() => (error = undefined)}
          disabled={saving || locked}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'agent-name-error' : 'agent-name-limit'}
          class="sm:max-w-sm"
        />
        {#if error}
          <Field.Error id="agent-name-error">{error}</Field.Error>
        {:else}
          <Field.Description id="agent-name-limit" class="tabular-nums">
            {locked ? `Next rename in ${timeLeft(wait)}` : 'One rename every 30 days'}
          </Field.Description>
        {/if}
      </Field.Field>
    </Card.Content>
    <Card.Footer class="justify-end gap-2">
      {#if dirty && !saving}
        <Button variant="ghost" onclick={discard}>Discard</Button>
      {/if}
      <Button type="submit" disabled={!dirty || saving || locked}>
        {#if saving}<Spinner />Checking name…{:else}Save{/if}
      </Button>
    </Card.Footer>
  </form>
</Card.Root>
