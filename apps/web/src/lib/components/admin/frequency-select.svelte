<script lang="ts">
  import * as Select from '#lib/components/ui/select/index.js';
  import { FREQUENCIES, type Frequency } from '#lib/fixtures/admin/data.js';
  import { cn } from '#lib/utils.js';

  /** The subscription frequency picker, as on the owner dashboard. */
  let { value, onChange, id, disabled, class: className }: { value: Frequency; onChange: (value: Frequency) => void; id?: string; disabled?: boolean; class?: string } = $props();

  const display = (frequency: Frequency) => (frequency === 'live' ? 'Live' : frequency);
</script>

<Select.Root type="single" {value} {disabled} onValueChange={(next) => onChange(next as Frequency)}>
  <Select.Trigger {id} class={cn('w-28 font-mono tabular-nums', className)}>{display(value)}</Select.Trigger>
  <Select.Content class="max-h-72">
    {#each FREQUENCIES as frequency (frequency)}
      <Select.Item value={frequency} label={display(frequency)} class="font-mono tabular-nums" />
    {/each}
  </Select.Content>
</Select.Root>
