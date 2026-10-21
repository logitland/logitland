<script lang="ts">
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { formatNumber, levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import { levelSettings } from '#lib/fixtures/levels.svelte.js';
  import { levelXp } from '#lib/levels.js';

  /** The two numbers every level's XP threshold comes from: `Level 1 XP × level^growth`. */
  const BASE = { min: 1, max: 100_000 };
  const GROWTH = { min: 1, max: 3, step: 0.05 };
  const SAMPLE_LEVELS = [5, 10];

  const toDraft = () => ({ base: String(levelSettings.curve.base), growth: String(levelSettings.curve.growth) });

  let draft = $state(toDraft());
  let errors = $state<{ base?: string; growth?: string }>({});

  const curve = $derived({ base: Number(draft.base), growth: Number(draft.growth) });
  const dirty = $derived(curve.base !== levelSettings.curve.base || curve.growth !== levelSettings.curve.growth);
  const valid = $derived({
    base: Number.isInteger(curve.base) && curve.base >= BASE.min && curve.base <= BASE.max,
    growth: draft.growth !== '' && curve.growth >= GROWTH.min && curve.growth <= GROWTH.max,
  });

  function discard() {
    draft = toDraft();
    errors = {};
  }

  async function save() {
    errors = {
      base: valid.base ? undefined : `Enter a whole number from ${formatNumber(BASE.min)} to ${formatNumber(BASE.max)}.`,
      growth: valid.growth ? undefined : `Enter a number from ${GROWTH.min} to ${GROWTH.max}.`,
    };
    if (errors.base || errors.growth) return;
    await admin.saveCurve(curve);
    toast.success('Saved level curve');
  }
</script>

<SaveCard title="Level curve" {dirty} onDiscard={discard} onSave={save}>
  <div class="grid gap-6 sm:grid-cols-2">
    <Field.Field data-invalid={errors.base ? true : undefined}>
      <Field.Label for="curve-base">Level 1 XP</Field.Label>
      <Input
        id="curve-base"
        type="number"
        inputmode="numeric"
        min={BASE.min}
        max={BASE.max}
        step="1"
        bind:value={() => draft.base, (next) => (draft.base = String(next ?? ''))}
        oninput={() => (errors.base = undefined)}
        aria-invalid={errors.base ? true : undefined}
        aria-describedby={errors.base ? 'curve-base-error' : undefined}
        class="max-w-40 tabular-nums"
      />
      {#if errors.base}<Field.Error id="curve-base-error">{errors.base}</Field.Error>{/if}
    </Field.Field>
    <Field.Field data-invalid={errors.growth ? true : undefined}>
      <Field.Label for="curve-growth">Growth</Field.Label>
      <Input
        id="curve-growth"
        type="number"
        inputmode="decimal"
        min={GROWTH.min}
        max={GROWTH.max}
        step={GROWTH.step}
        bind:value={() => draft.growth, (next) => (draft.growth = String(next ?? ''))}
        oninput={() => (errors.growth = undefined)}
        aria-invalid={errors.growth ? true : undefined}
        aria-describedby={errors.growth ? 'curve-growth-error' : undefined}
        class="max-w-40 tabular-nums"
      />
      {#if errors.growth}<Field.Error id="curve-growth-error">{errors.growth}</Field.Error>{/if}
    </Field.Field>
  </div>
  <p class="text-sm text-muted-foreground tabular-nums" aria-live="polite">
    {#if valid.base && valid.growth}
      {SAMPLE_LEVELS.map((level) => `${levelName(level)} at ${formatNumber(levelXp(level, curve))} XP`).join(' · ')}
    {:else}
      &nbsp;
    {/if}
  </p>
</SaveCard>
