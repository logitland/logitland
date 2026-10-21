<script lang="ts">
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { toast } from 'svelte-sonner';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import type { Agent } from '#lib/fixtures/owner/data.js';
  import { timeLeft } from '#lib/fixtures/owner/format.js';
  import { dashboard, nextRenameAt } from '#lib/fixtures/owner/store.svelte.js';
  import { NAME_MAX, nameError } from '#lib/names.js';

  /** Renames the agent, once a day; `name` is the draft, bound so the preview follows it. */
  let { agent, name = $bindable() }: { agent: Agent; name: string } = $props();

  let error = $state<string>();
  let saving = $state(false);

  const wait = $derived(nextRenameAt(agent) - Date.now());
  const locked = $derived(wait > 0 || agent.heldName !== null);
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
    const result = await dashboard.rename(agent.id, name);
    saving = false;
    if (result.status === 'refused') {
      error = result.error;
      return;
    }
    name = agent.name;
    if (result.status === 'renamed') toast.success(`Renamed to ${agent.name}`);
  }
</script>

<Card.Root class="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
  <form onsubmit={save} novalidate class="contents">
    <Card.Header>
      <Card.Title>Name</Card.Title>
    </Card.Header>
    <Card.Content class="gap-6">
      {#if agent.heldName}
        <Alert.Root variant="warning" class="max-sm:pr-4">
          <TriangleAlertIcon />
          <Alert.Title class="line-clamp-none break-words">{agent.heldName} is held for review</Alert.Title>
          <Alert.Description>{agent.name} keeps its name until an admin decides.</Alert.Description>
          <Alert.Action class="static col-span-full mt-3 sm:absolute sm:top-1/2 sm:right-3 sm:mt-0 sm:-translate-y-1/2">
            <Button size="sm" variant="outline" onclick={() => dashboard.withdrawName(agent.id)}>Withdraw</Button>
          </Alert.Action>
        </Alert.Root>
      {/if}

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
            {wait > 0 ? `Next rename in ${timeLeft(wait)}` : 'One rename a day'}
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
