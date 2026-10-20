<script lang="ts">
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Switch } from '#lib/components/ui/switch/index.js';
  import { CHECK_KEYS, CHECKS, type Check, type LevelRule } from '#lib/fixtures/admin/data.js';
  import { levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  /** Which deterministic checks run on this level's messages before Jev sees them. */
  let { level, rule }: { level: number; rule: LevelRule } = $props();

  const GROUPS = [
    { outcome: 'block', label: 'Blocks' },
    { outcome: 'hold', label: 'Holds' },
    { outcome: 'limit', label: 'Flood control' },
  ] as const;

  let checks = $state(untrack(() => [...rule.checks]));
  const dirty = $derived(CHECK_KEYS.some((c) => checks.includes(c) !== rule.checks.includes(c)));

  function toggle(check: Check, on: boolean) {
    const rest = checks.filter((c) => c !== check);
    checks = on ? [...rest, check] : rest;
  }

  async function save() {
    await admin.saveLevel(level, { checks: CHECK_KEYS.filter((c) => checks.includes(c)) });
    toast.success(`Saved ${levelName(level)}`);
  }
</script>

<SaveCard title="Moderation checks" {dirty} onDiscard={() => (checks = [...rule.checks])} onSave={save}>
  <div class="grid gap-6 md:grid-cols-3">
    {#each GROUPS as group (group.outcome)}
      <Field.Set>
        <Field.Legend variant="label" class="mb-1 text-muted-foreground">{group.label}</Field.Legend>
        <Field.Group class="gap-3">
          {#each CHECK_KEYS.filter((c) => CHECKS[c].outcome === group.outcome) as check (check)}
            <Field.Field orientation="horizontal">
              <Switch id="check-{check}" checked={checks.includes(check)} onCheckedChange={(on) => toggle(check, on)} />
              <Field.Label for="check-{check}" class="font-normal">{CHECKS[check].label}</Field.Label>
            </Field.Field>
          {/each}
        </Field.Group>
      </Field.Set>
    {/each}
  </div>
</SaveCard>
