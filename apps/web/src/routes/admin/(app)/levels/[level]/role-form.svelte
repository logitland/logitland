<script lang="ts">
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import type { LevelRule } from '#lib/fixtures/admin/data.js';
  import { formatNumber, levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  /** The XP that reaches this level, and the Discord level role mapped to it. */
  let { level, rule }: { level: number; rule: LevelRule } = $props();

  const NO_ROLE = 'none';

  let xp = $state(untrack(() => String(rule.xp)));
  let role = $state(untrack(() => rule.role ?? NO_ROLE));
  let error = $state<string>();

  const probation = $derived(level === 0);
  const min = $derived(probation ? 0 : admin.levels[level - 1].xp + 1);
  const max = $derived(admin.levels[level + 1] ? admin.levels[level + 1].xp - 1 : 1_000_000);
  const dirty = $derived(Number(xp) !== rule.xp || role !== (rule.role ?? NO_ROLE));

  // `@agents` and `@adopted` have their own jobs; every other agent role can be a level role.
  const roles = $derived(admin.serverRoles.filter((r) => r.kind === 'agent' && r.id !== 'r_agents' && r.id !== 'r_adopted'));
  const roleLabel = (roleId: string) => (roleId === NO_ROLE ? 'No role' : `@${admin.role(roleId)?.name}`);

  function discard() {
    xp = String(rule.xp);
    role = rule.role ?? NO_ROLE;
    error = undefined;
  }

  async function save() {
    const value = Number(xp);
    if (!probation && !(Number.isInteger(value) && value >= min && value <= max)) {
      error = `Enter a whole number from ${formatNumber(min)} to ${formatNumber(max)}, so levels stay in order.`;
      return;
    }
    await admin.saveLevel(level, { xp: value, role: role === NO_ROLE ? null : role });
    toast.success(`Saved ${levelName(level)}`);
  }
</script>

<SaveCard title={probation ? 'Discord role' : 'XP and Discord role'} {dirty} onDiscard={discard} onSave={save}>
  <div class="grid gap-6 sm:grid-cols-2">
    {#if !probation}
      <Field.Field data-invalid={error ? true : undefined}>
        <Field.Label for="level-xp">XP to reach {levelName(level)}</Field.Label>
        <Input
          id="level-xp"
          type="number"
          inputmode="numeric"
          {min}
          {max}
          step="1"
          bind:value={() => xp, (next) => (xp = String(next ?? ''))}
          oninput={() => (error = undefined)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'level-xp-error' : undefined}
          class="max-w-40 tabular-nums"
        />
        {#if error}<Field.Error id="level-xp-error">{error}</Field.Error>{/if}
      </Field.Field>
    {/if}
    <Field.Field>
      <Field.Label for="level-role">Level role</Field.Label>
      <Select.Root type="single" bind:value={role}>
        <Select.Trigger id="level-role" class="w-full sm:max-w-60">{roleLabel(role)}</Select.Trigger>
        <Select.Content>
          <Select.Item value={NO_ROLE} label="No role" />
          {#each roles as option (option.id)}
            {@const mapped = admin.levelOfRole(option.id)}
            {@const taken = mapped !== undefined && mapped !== level}
            <Select.Item value={option.id} label="@{option.name}" disabled={taken}>
              <span class="flex-1">@{option.name}</span>
              {#if taken}<span class="text-xs text-muted-foreground">{levelName(mapped)}</span>{/if}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </Field.Field>
  </div>
</SaveCard>
