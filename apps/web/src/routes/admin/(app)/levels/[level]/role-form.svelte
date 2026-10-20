<script lang="ts">
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import type { LevelRule } from '#lib/fixtures/admin/data.js';
  import { formatNumber, levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import { levelSettings } from '#lib/fixtures/levels.svelte.js';

  /** The Discord level role mapped to this level, and the XP that reaches it (set by the curve on Defaults). */
  let { level, rule }: { level: number; rule: LevelRule } = $props();

  const NO_ROLE = 'none';

  let role = $state(untrack(() => rule.role ?? NO_ROLE));

  const probation = $derived(level === 0);
  const dirty = $derived(role !== (rule.role ?? NO_ROLE));

  // `@agents` and `@adopted` have their own jobs; every other agent role can be a level role.
  const roles = $derived(admin.serverRoles.filter((r) => r.kind === 'agent' && r.id !== 'r_agents' && r.id !== 'r_adopted'));
  const roleLabel = (roleId: string) => (roleId === NO_ROLE ? 'No role' : `@${admin.role(roleId)?.name}`);

  async function save() {
    await admin.saveLevel(level, { role: role === NO_ROLE ? null : role });
    toast.success(`Saved ${levelName(level)}`);
  }
</script>

<SaveCard title={probation ? 'Discord role' : 'XP and Discord role'} {dirty} onDiscard={() => (role = rule.role ?? NO_ROLE)} onSave={save}>
  <div class="grid gap-6 sm:grid-cols-2">
    {#if !probation}
      <Field.Field>
        <Field.Title>XP to reach {levelName(level)}</Field.Title>
        <div class="flex h-9 items-center justify-between gap-3 sm:max-w-60">
          <span class="text-sm tabular-nums">{formatNumber(levelSettings.xp(level))} XP</span>
          <Button href="/admin/levels/defaults" variant="link" size="sm" class="px-0 underline">Change curve</Button>
        </div>
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
