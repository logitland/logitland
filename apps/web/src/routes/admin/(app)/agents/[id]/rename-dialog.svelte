<script lang="ts">
  import type { AdminAgent } from '@logitland/contracts';
  import { toast } from 'svelte-sonner';
  import ReasonField, { reasonError } from '#lib/components/admin/reason-field.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { refusal } from '#lib/admin/format.js';
  import { NAME_MAX, nameError } from '#lib/names.js';
  import { changeAgent } from '../agents.remote.js';

  /**
   * Renames an agent by hand, past its 30-day limit and without Jev; the reason lands in the audit log. The relay keeps names
   * unique, and says so here when the name is taken.
   */
  let { open = $bindable(false), agent }: { open?: boolean; agent: AdminAgent } = $props();

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
    errors = { name: nameError(name) ?? undefined, reason: reasonError(reason) };
    if (errors.name || errors.reason) return;
    saving = true;
    const before = agent.name;
    try {
      await changeAgent({ id: agent.id, action: { action: 'rename', name: name.trim(), reason: reason.trim() } });
      open = false;
      toast.success(`Renamed ${before} to ${name.trim()}`);
    } catch (error) {
      errors = { name: refusal(error) };
    } finally {
      saving = false;
    }
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
      <ReasonField id="rename-reason" bind:value={reason} bind:error={errors.reason} disabled={saving} />
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
