<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Progress } from '#lib/components/ui/progress/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { Switch } from '#lib/components/ui/switch/index.js';
  import type { OwnerDelivery } from '@logitland/contracts';
  import { formatNumber } from '#lib/fixtures/owner/format.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { setCap } from '#lib/owner/owner.remote.js';

  let { agentId, delivery }: { agentId: string; delivery: OwnerDelivery } = $props();

  /** The relay's bounds (`OwnerDeliveryPatch`), and the cap suggested when turning it on. */
  const MAX_CAP = 1_000_000;
  const SUGGESTED_CAP = 5000;
  const NEAR_CAP = 0.9;

  const cap = $derived(delivery.daily_event_cap);
  const delivered = $derived(delivery.delivered_today);

  /** What the owner has changed. Until they change something, the form follows the relay's cap as it refreshes. */
  let draft = $state<{ enabled: boolean; value: string }>();
  const enabled = $derived(draft?.enabled ?? cap !== null);
  const value = $derived(draft?.value ?? String(cap ?? SUGGESTED_CAP));
  let error = $state<string>();
  let saving = $state(false);

  const parsed = $derived(Number(value));
  const dirty = $derived(enabled !== (cap !== null) || (enabled && parsed !== cap));
  const usage = $derived(cap ? delivered / cap : 0);

  function discard() {
    draft = undefined;
    error = undefined;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (enabled && !(Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CAP)) {
      error = `Enter a whole number from 1 to ${formatNumber(MAX_CAP)}.`;
      return;
    }
    const next = enabled ? parsed : null;
    saving = true;
    try {
      await setCap({ agentId, daily_event_cap: next });
      // The saved cap is the relay's now; the form follows it again.
      draft = undefined;
      toast.success(next === null ? 'Cap removed' : `Capped at ${formatNumber(next)} a day`);
    } catch (failure) {
      error = messageOf(failure);
    }
    saving = false;
  }
</script>

<Card.Root class="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
  <form onsubmit={save} novalidate class="contents">
    <Card.Header>
      <Card.Title>Daily cap</Card.Title>
    </Card.Header>
    <Card.Content class="gap-6">
      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-3 text-sm tabular-nums">
          <span class="text-muted-foreground">Delivered today</span>
          <span>
            <span class="font-medium">{formatNumber(delivered)}</span>
            {#if cap !== null}
              <span class="text-muted-foreground">/ {formatNumber(cap)}</span>
            {/if}
          </span>
        </div>
        {#if cap !== null}
          <Progress
            value={delivered}
            max={cap}
            variant={usage >= NEAR_CAP ? 'warning' : 'default'}
            aria-label="{formatNumber(delivered)} of {formatNumber(cap)} delivered today"
          />
        {/if}
      </div>

      <Field.Field orientation="horizontal">
        <Switch
          id="cap-enabled"
          bind:checked={() => enabled, (next) => (draft = { enabled: next, value })}
          disabled={saving}
          onCheckedChange={() => (error = undefined)}
        />
        <Field.Content>
          <Field.Label for="cap-enabled">Cap daily deliveries</Field.Label>
          <Field.Description>Past the cap, your agent gets one digest a day until 00:00 UTC.</Field.Description>
        </Field.Content>
      </Field.Field>

      {#if enabled}
        <Field.Field data-invalid={error ? true : undefined}>
          <Field.Label for="cap-value">Events per day</Field.Label>
          <Input
            id="cap-value"
            type="number"
            inputmode="numeric"
            min="1"
            max={MAX_CAP}
            step="1"
            bind:value={() => value, (next) => (draft = { enabled, value: String(next ?? '') })}
            oninput={() => (error = undefined)}
            disabled={saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'cap-value-error' : undefined}
            class="max-w-40 tabular-nums"
          />
          {#if error}
            <Field.Error id="cap-value-error">{error}</Field.Error>
          {/if}
        </Field.Field>
      {/if}
    </Card.Content>
    <Card.Footer class="justify-end gap-2">
      {#if dirty && !saving}
        <Button variant="ghost" onclick={discard}>Discard</Button>
      {/if}
      <Button type="submit" disabled={!dirty || saving}>
        {#if saving}<Spinner />Saving…{:else}Save{/if}
      </Button>
    </Card.Footer>
  </form>
</Card.Root>
