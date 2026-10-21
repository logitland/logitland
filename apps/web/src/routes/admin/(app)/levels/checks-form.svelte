<script lang="ts">
  import type { Level, ModerationCheck } from '@logitland/contracts';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Switch } from '#lib/components/ui/switch/index.js';
  import { levelName, refusal } from '#lib/admin/format.js';
  import { CHECK_KEYS, CHECKS } from '#lib/admin/labels.js';
  import { saveLevel } from './levels.remote.js';

  /** Which deterministic checks run on this level's messages before Jev sees them. */
  let { level }: { level: Level } = $props();

  const GROUPS = [
    { outcome: 'block', label: 'Blocks' },
    { outcome: 'hold', label: 'Holds' },
    { outcome: 'limit', label: 'Flood control' },
  ] as const;

  // A draft only once the admin changes something; until then the form follows the relay's level as it refreshes.
  let edited = $state<ModerationCheck[]>();
  const checks = $derived(edited ?? level.checks);
  const dirty = $derived(CHECK_KEYS.some((c) => checks.includes(c) !== level.checks.includes(c)));

  function toggle(check: ModerationCheck, on: boolean) {
    const rest = checks.filter((c) => c !== check);
    edited = on ? [...rest, check] : rest;
  }

  async function save() {
    const { level: n, xp: _, ...update } = level;
    try {
      await saveLevel({ level: n, update: { ...update, checks: CHECK_KEYS.filter((c) => checks.includes(c)) } });
      edited = undefined;
      toast.success(`Saved ${levelName(n)}`);
    } catch (e) {
      toast.error(refusal(e));
    }
  }
</script>

<SaveCard title="Moderation checks" {dirty} onDiscard={() => (edited = undefined)} onSave={save}>
  <div class="grid gap-6 md:grid-cols-3">
    {#each GROUPS as group (group.outcome)}
      <Field.Set>
        <Field.Legend variant="label" class="mb-1 text-muted-foreground">{group.label}</Field.Legend>
        <Field.Group class="gap-3">
          {#each CHECK_KEYS.filter((c) => CHECKS[c].outcome === group.outcome) as check (check)}
            <Field.Field orientation="horizontal">
              <Switch id="level-{level.level}-check-{check}" checked={checks.includes(check)} onCheckedChange={(on) => toggle(check, on)} />
              <Field.Label for="level-{level.level}-check-{check}" class="font-normal">{CHECKS[check].label}</Field.Label>
            </Field.Field>
          {/each}
        </Field.Group>
      </Field.Set>
    {/each}
  </div>
</SaveCard>
