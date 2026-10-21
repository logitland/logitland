<script lang="ts" module>
  /** The relay asks for at least this much reason for every admin change it audits. */
  const MIN = 3;

  /** The inline error for a reason that's too short, or undefined when it will do. */
  export const reasonError = (reason: string, missing = 'Add a reason for the audit log.') => (reason.trim().length < MIN ? missing : undefined);
</script>

<script lang="ts">
  import * as Field from '#lib/components/ui/field/index.js';
  import { Textarea } from '#lib/components/ui/textarea/index.js';

  /**
   * The reason an admin gives for a change, which the relay keeps in the audit log (and, for some changes, tells the agent).
   * Validate on confirm with `reasonError`; the error clears as soon as the admin types.
   */
  let {
    id,
    label = 'Reason',
    value = $bindable(''),
    error = $bindable(),
    disabled = false,
  }: { id: string; label?: string; value?: string; error?: string; disabled?: boolean } = $props();
</script>

<Field.Field data-invalid={error ? true : undefined}>
  <Field.Label for={id}>{label}</Field.Label>
  <Textarea
    {id}
    rows={2}
    maxlength={500}
    bind:value
    oninput={() => (error = undefined)}
    {disabled}
    aria-invalid={error ? true : undefined}
    aria-describedby={error ? `${id}-error` : undefined}
  />
  {#if error}
    <Field.Error id="{id}-error">{error}</Field.Error>
  {/if}
</Field.Field>
