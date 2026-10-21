<script lang="ts">
  import type { AdminRole, Level, Settings } from '@logitland/contracts';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import { formatNumber, levelName, refusal } from '#lib/admin/format.js';
  import { saveLevel } from '../levels.remote.js';

  /**
   * The XP that reaches this level and the Discord level role mapped to it. Thresholds rise with the level; probation starts
   * at 0. `settings` names `@agents` and `@adopted`, which have their own jobs (null without the operate power).
   */
  let { level, levels, roles, settings }: { level: Level; levels: Level[]; roles: AdminRole[]; settings: Settings | null } = $props();

  const NO_ROLE = 'none';

  // A draft only once the admin changes something; until then the form follows the relay's level as it refreshes.
  let edited = $state<{ role: string; xp: string }>();
  const role = $derived(edited?.role ?? level.role_id ?? NO_ROLE);
  const xp = $derived(edited?.xp ?? String(level.xp));
  let error = $state<string>();

  const probation = $derived(level.level === 0);
  const dirty = $derived(role !== (level.role_id ?? NO_ROLE) || Number(xp) !== level.xp);
  const below = $derived(levels.findLast((l) => l.level < level.level));
  const above = $derived(levels.find((l) => l.level > level.level));

  // `@agents` and `@adopted` have their own jobs; every other role can be a level role.
  const options = $derived(roles.filter((r) => r.id !== settings?.agents_role_id && r.id !== settings?.adopted_role_id));
  const roleLabel = (roleId: string) => (roleId === NO_ROLE ? 'No role' : `@${roles.find((r) => r.id === roleId)?.name ?? roleId}`);
  const levelOfRole = (roleId: string) => levels.find((l) => l.role_id === roleId)?.level;

  function discard() {
    edited = undefined;
    error = undefined;
  }

  async function save() {
    const next = Number(xp);
    const min = (below?.xp ?? 0) + 1;
    const max = above ? above.xp - 1 : undefined;
    if (!probation && (!Number.isInteger(next) || next < min || (max !== undefined && next > max))) {
      error = max === undefined ? `Enter a whole number from ${formatNumber(min)}.` : `Enter a whole number from ${formatNumber(min)} to ${formatNumber(max)}.`;
      return;
    }
    const { level: n, ...update } = level;
    try {
      await saveLevel({ level: n, update: { ...update, xp: next, role_id: role === NO_ROLE ? null : role } });
      edited = undefined;
      toast.success(`Saved ${levelName(n)}`);
    } catch (e) {
      toast.error(refusal(e));
    }
  }
</script>

<SaveCard title={probation ? 'Discord role' : 'XP and Discord role'} {dirty} onDiscard={discard} onSave={save}>
  <div class="grid gap-6 sm:grid-cols-2">
    {#if !probation}
      <Field.Field data-invalid={error ? true : undefined}>
        <Field.Label for="level-xp">XP to reach {levelName(level.level)}</Field.Label>
        <Input
          id="level-xp"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          bind:value={() => xp, (next) => (edited = { role, xp: String(next ?? '') })}
          oninput={() => (error = undefined)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'level-xp-error' : undefined}
          class="tabular-nums sm:max-w-60"
        />
        {#if error}<Field.Error id="level-xp-error">{error}</Field.Error>{/if}
      </Field.Field>
    {/if}
    <Field.Field>
      <Field.Label for="level-role">Level role</Field.Label>
      <Select.Root type="single" bind:value={() => role, (next) => (edited = { role: next, xp })}>
        <Select.Trigger id="level-role" class="w-full sm:max-w-60">{roleLabel(role)}</Select.Trigger>
        <Select.Content>
          <Select.Item value={NO_ROLE} label="No role" />
          {#each options as option (option.id)}
            {@const mapped = levelOfRole(option.id)}
            {@const taken = mapped !== undefined && mapped !== level.level}
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
