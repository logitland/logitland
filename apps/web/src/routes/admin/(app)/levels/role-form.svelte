<script lang="ts">
  import type { AdminRole, Level, Settings } from '@logitland/contracts';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Command from '#lib/components/ui/command/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { formatNumber, levelName, refusal } from '#lib/admin/format.js';
  import { saveLevel } from './levels.remote.js';

  /**
   * The XP that reaches this level and the Discord level role mapped to it, whose overwrites say what the level may do in
   * Discord. Thresholds rise with the level; probation starts at 0. `settings` names `@agents` and `@adopted`, which have their
   * own jobs (null without the operate power).
   */
  let { level, levels, roles, settings }: { level: Level; levels: Level[]; roles: AdminRole[]; settings: Settings | null } = $props();

  // A draft only once the admin changes something; until then the form follows the relay's level as it refreshes.
  let edited = $state<{ role: string | null; xp: string }>();
  const role = $derived(edited ? edited.role : level.role_id);
  const xp = $derived(edited?.xp ?? String(level.xp));
  let error = $state<string>();
  let open = $state(false);

  const id = $derived(`level-${level.level}`);
  const probation = $derived(level.level === 0);
  const dirty = $derived(role !== level.role_id || Number(xp) !== level.xp);
  const below = $derived(levels.findLast((l) => l.level < level.level));
  const above = $derived(levels.find((l) => l.level > level.level));

  // `@agents` and `@adopted` have their own jobs; every other role can be a level role.
  const options = $derived(roles.filter((r) => r.id !== settings?.agents_role_id && r.id !== settings?.adopted_role_id));
  const roleLabel = (roleId: string | null) => (roleId ? `@${roles.find((r) => r.id === roleId)?.name ?? roleId}` : 'No role');
  const levelOfRole = (roleId: string) => levels.find((l) => l.role_id === roleId)?.level;

  function pick(roleId: string | null) {
    edited = { role: roleId, xp };
    open = false;
  }

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
      await saveLevel({ level: n, update: { ...update, xp: next, role_id: role } });
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
        <Field.Label for="{id}-xp">XP to reach {levelName(level.level)}</Field.Label>
        <Input
          id="{id}-xp"
          type="number"
          inputmode="numeric"
          min="1"
          step="1"
          bind:value={() => xp, (next) => (edited = { role, xp: String(next ?? '') })}
          oninput={() => (error = undefined)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-xp-error` : undefined}
          class="tabular-nums sm:max-w-60"
        />
        {#if error}<Field.Error id="{id}-xp-error">{error}</Field.Error>{/if}
      </Field.Field>
    {/if}
    <Field.Field>
      <Field.Label for="{id}-role">Level role</Field.Label>
      <Popover.Root bind:open>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button {...props} id="{id}-role" variant="outline" role="combobox" aria-expanded={open} class="w-full justify-between font-normal sm:max-w-60">
              <span class="truncate">{roleLabel(role)}</span>
              <ChevronsUpDownIcon class="opacity-50" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-60 p-0" align="start">
          <Command.Root>
            <Command.Input placeholder="Search roles" />
            <Command.List>
              <Command.Empty>No role by that name</Command.Empty>
              <Command.Group>
                <Command.Item value="No role" data-checked={role === null} onSelect={() => pick(null)}>No role</Command.Item>
                {#each options as option (option.id)}
                  {@const mapped = levelOfRole(option.id)}
                  {@const taken = mapped !== undefined && mapped !== level.level}
                  <Command.Item value="@{option.name}" disabled={taken} data-checked={role === option.id} onSelect={() => pick(option.id)}>
                    <span class="flex-1 truncate">@{option.name}</span>
                    {#if taken}<span class="text-xs text-muted-foreground">{levelName(mapped)}</span>{/if}
                  </Command.Item>
                {/each}
              </Command.Group>
            </Command.List>
          </Command.Root>
        </Popover.Content>
      </Popover.Root>
    </Field.Field>
  </div>
</SaveCard>
