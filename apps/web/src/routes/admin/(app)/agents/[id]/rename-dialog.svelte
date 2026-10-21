<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { Textarea } from '#lib/components/ui/textarea/index.js';
  import type { Agent } from '#lib/fixtures/admin/data.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import { NAME_MAX, nameError } from '#lib/names.js';

  /** Renames an agent by hand, past its daily limit; the reason lands in the audit log. */
  let { open = $bindable(false), agent }: { open?: boolean; agent: Agent } = $props();

  let name = $state('');
  let reason = $state('');
  let errors = $state<{ name?: string; reason?: string }>({});
  let saving = $state(false);

  $effect(() => {
    if (!open) return;
    name = agent.name;
    reason = '';
    errors = {};
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    errors = { name: nameError(name) ?? undefined, reason: reason.trim() ? undefined : 'Add a reason for the audit log.' };
    if (errors.name || errors.reason) return;
    saving = true;
    const before = agent.name;
    const error = await admin.rename(agent.id, name, reason);
    saving = false;
    if (error) {
      errors = { name: error };
      return;
    }
    open = false;
    toast.success(`Renamed ${before} to ${agent.name}`);
  }
</script>

<Dialog.Root bind:open={() => open, (next) => !saving && (open = next)}>
  <Dialog.Content class="sm:max-w-md">
    <form onsubmit={save} novalidate class="grid gap-6">
      <Dialog.Header>
        <Dialog.Title class="break-words">Rename {agent.name}</Dialog.Title>
      </Dialog.Header>
      <Field.Field data-invalid={errors.name ? true : undefined}>
        <Field.Label for="rename-name">Name</Field.Label>
        <Input
          id="rename-name"
          autocomplete="off"
          spellcheck={false}
          maxlength={NAME_MAX}
          bind:value={name}
          oninput={() => (errors.name = undefined)}
          disabled={saving}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? 'rename-name-error' : undefined}
        />
        {#if errors.name}
          <Field.Error id="rename-name-error">{errors.name}</Field.Error>
        {/if}
      </Field.Field>
      <Field.Field data-invalid={errors.reason ? true : undefined}>
        <Field.Label for="rename-reason">Reason</Field.Label>
        <Textarea
          id="rename-reason"
          rows={2}
          bind:value={reason}
          oninput={() => (errors.reason = undefined)}
          disabled={saving}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? 'rename-reason-error' : undefined}
        />
        {#if errors.reason}
          <Field.Error id="rename-reason-error">{errors.reason}</Field.Error>
        {/if}
      </Field.Field>
      <Dialog.Footer>
        <Button variant="outline" disabled={saving} onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit" disabled={saving || name.trim() === agent.name}>
          {#if saving}<Spinner />{/if}
          Rename agent
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
