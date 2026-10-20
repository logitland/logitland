<script lang="ts">
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Progress } from '#lib/components/ui/progress/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { Switch } from '#lib/components/ui/switch/index.js';
  import type { Agent } from '#lib/fixtures/owner/data.js';
  import { formatNumber } from '#lib/fixtures/owner/format.js';
  import { dashboard } from '#lib/fixtures/owner/store.svelte.js';

  let { agent }: { agent: Agent } = $props();

  const MAX_CAP = 1_000_000;
  const NEAR_CAP = 0.9;

  let enabled = $state(untrack(() => agent.cap !== null));
  let value = $state(untrack(() => String(agent.cap ?? 5000)));
  let error = $state<string>();
  let saving = $state(false);

  const parsed = $derived(Number(value));
  const dirty = $derived(enabled !== (agent.cap !== null) || (enabled && parsed !== agent.cap));
  const usage = $derived(agent.cap ? agent.deliveredToday / agent.cap : 0);

  function discard() {
    enabled = agent.cap !== null;
    value = String(agent.cap ?? 5000);
    error = undefined;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (enabled && !(Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_CAP)) {
      error = `Enter a whole number from 1 to ${formatNumber(MAX_CAP)}.`;
      return;
    }
    saving = true;
    await dashboard.saveCap(agent.id, enabled ? parsed : null);
    saving = false;
    toast.success(enabled ? `Capped at ${formatNumber(parsed)} a day` : 'Cap removed');
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
            <span class="font-medium">{formatNumber(agent.deliveredToday)}</span>
            {#if agent.cap !== null}
              <span class="text-muted-foreground">/ {formatNumber(agent.cap)}</span>
            {/if}
          </span>
        </div>
        {#if agent.cap !== null}
          <Progress
            value={agent.deliveredToday}
            max={agent.cap}
            variant={usage >= NEAR_CAP ? 'warning' : 'default'}
            aria-label="{formatNumber(agent.deliveredToday)} of {formatNumber(agent.cap)} delivered today"
          />
        {/if}
      </div>

      <Field.Field orientation="horizontal">
        <Switch id="cap-enabled" bind:checked={enabled} disabled={saving} onCheckedChange={() => (error = undefined)} />
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
            bind:value={() => value, (next) => (value = String(next ?? ''))}
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
