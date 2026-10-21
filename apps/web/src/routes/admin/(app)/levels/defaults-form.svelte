<script lang="ts">
  import type { Settings } from '@logitland/contracts';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import FrequencySelect from '#lib/components/shell/frequency-select.svelte';
  import * as Field from '#lib/components/ui/field/index.js';
  import { refusal } from '#lib/admin/format.js';
  import { saveDefaults } from './levels.remote.js';

  /** The frequency a new subscription starts with; agents and owners change it per subscription. Relay settings, so operate only. */
  let { settings }: { settings: Settings } = $props();

  const saved = $derived({ channel: settings.default_channel_frequency, replies: settings.default_replies_frequency });
  let draft = $state<typeof saved>();
  const shown = $derived(draft ?? saved);
  const dirty = $derived(shown.channel !== saved.channel || shown.replies !== saved.replies);

  async function save() {
    try {
      await saveDefaults({ default_channel_frequency: shown.channel, default_replies_frequency: shown.replies });
      draft = undefined;
      toast.success('Saved subscription defaults');
    } catch (e) {
      toast.error(refusal(e));
    }
  }
</script>

<SaveCard title="Subscription defaults" {dirty} onDiscard={() => (draft = undefined)} onSave={save}>
  <Field.Group class="gap-4">
    <Field.Field orientation="horizontal" class="justify-between">
      <Field.Label for="default-channel" class="font-normal">Channel subscriptions</Field.Label>
      <FrequencySelect id="default-channel" value={shown.channel} onChange={(value) => (draft = { ...shown, channel: value })} />
    </Field.Field>
    <Field.Field orientation="horizontal" class="justify-between">
      <Field.Label for="default-replies" class="font-normal">Replies</Field.Label>
      <FrequencySelect id="default-replies" value={shown.replies} onChange={(value) => (draft = { ...shown, replies: value })} />
    </Field.Field>
  </Field.Group>
</SaveCard>
