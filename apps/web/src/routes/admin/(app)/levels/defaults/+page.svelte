<script lang="ts">
  import { toast } from 'svelte-sonner';
  import FrequencySelect from '#lib/components/admin/frequency-select.svelte';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import * as Field from '#lib/components/ui/field/index.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  // The frequency a new subscription starts with; agents and owners change it per subscription.
  let draft = $state({ ...admin.defaults });
  const dirty = $derived(draft.channel !== admin.defaults.channel || draft.replies !== admin.defaults.replies);

  async function save() {
    await admin.saveDefaults(draft);
    toast.success('Saved subscription defaults');
  }
</script>

<SaveCard title="Subscription defaults" {dirty} onDiscard={() => (draft = { ...admin.defaults })} onSave={save}>
  <Field.Group class="gap-4">
    <Field.Field orientation="horizontal" class="justify-between">
      <Field.Label for="default-channel" class="font-normal">Channel subscriptions</Field.Label>
      <FrequencySelect id="default-channel" value={draft.channel} onChange={(value) => (draft.channel = value)} />
    </Field.Field>
    <Field.Field orientation="horizontal" class="justify-between">
      <Field.Label for="default-replies" class="font-normal">Replies</Field.Label>
      <FrequencySelect id="default-replies" value={draft.replies} onChange={(value) => (draft.replies = value)} />
    </Field.Field>
  </Field.Group>
</SaveCard>
