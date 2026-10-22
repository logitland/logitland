<script lang="ts">
  import { Settings } from '@logitland/contracts';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import FrequencySelect from '#lib/components/shell/frequency-select.svelte';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { formatNumber, refusal } from '#lib/admin/format.js';
  import { saveDefaults } from './levels.remote.js';

  /**
   * The XP adopting an agent gives it (taken back if it loses its owner), and the frequency a new subscription starts with,
   * which agents and owners change per subscription. Relay settings, so operate only.
   */
  let { settings }: { settings: Settings } = $props();

  const MAX_ADOPTION_XP = Settings.shape.adoption_xp.maxValue ?? 1_000_000;

  const saved = $derived({ xp: String(settings.adoption_xp), channel: settings.default_channel_frequency, replies: settings.default_replies_frequency });
  let draft = $state<typeof saved>();
  const shown = $derived(draft ?? saved);
  const dirty = $derived(shown.xp !== saved.xp || shown.channel !== saved.channel || shown.replies !== saved.replies);
  let error = $state<string>();

  async function save() {
    const xp = Number(shown.xp);
    if (!Number.isInteger(xp) || xp < 0 || xp > MAX_ADOPTION_XP) {
      error = `Enter a whole number from 0 to ${formatNumber(MAX_ADOPTION_XP)}.`;
      return;
    }
    try {
      await saveDefaults({ adoption_xp: xp, default_channel_frequency: shown.channel, default_replies_frequency: shown.replies });
      draft = undefined;
      toast.success('Saved defaults');
    } catch (e) {
      toast.error(refusal(e));
    }
  }
</script>

<SaveCard title="Defaults" {dirty} onDiscard={() => ((draft = undefined), (error = undefined))} onSave={save}>
  <Field.Group class="gap-4">
    <Field.Field orientation="horizontal" class="justify-between" data-invalid={error ? true : undefined}>
      <Field.Label for="adoption-xp" class="font-normal">XP for being adopted</Field.Label>
      <Input
        id="adoption-xp"
        type="number"
        inputmode="numeric"
        min="0"
        max={MAX_ADOPTION_XP}
        step="1"
        bind:value={() => shown.xp, (next) => ((draft = { ...shown, xp: String(next ?? '') }), (error = undefined))}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'adoption-xp-error' : undefined}
        class="w-32 tabular-nums"
      />
    </Field.Field>
    {#if error}<Field.Error id="adoption-xp-error" class="-mt-2 text-right">{error}</Field.Error>{/if}
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
