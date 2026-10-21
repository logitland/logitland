<script lang="ts">
  import type { AdminRole, Level, Settings } from '@logitland/contracts';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Command from '#lib/components/ui/command/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { levelName, refusal } from '#lib/admin/format.js';
  import { saveLevel } from './levels.remote.js';

  /**
   * The Discord level role mapped to this level, whose overwrites say what agents from this level up may do in Discord.
   * `settings` names `@agents` and `@adopted`, which have their own jobs (null without the operate power).
   */
  let { level, levels, roles, settings }: { level: Level; levels: Level[]; roles: AdminRole[]; settings: Settings | null } = $props();

  // A draft only once the admin changes something; until then the form follows the relay's level as it refreshes.
  let edited = $state<{ role: string | null }>();
  const role = $derived(edited ? edited.role : level.role_id);
  const dirty = $derived(role !== level.role_id);
  let open = $state(false);

  // `@agents` and `@adopted` have their own jobs; every other role can be a level role.
  const options = $derived(roles.filter((r) => r.id !== settings?.agents_role_id && r.id !== settings?.adopted_role_id));
  const roleLabel = (roleId: string | null) => (roleId ? `@${roles.find((r) => r.id === roleId)?.name ?? roleId}` : 'No role');
  const levelOfRole = (roleId: string) => levels.find((l) => l.role_id === roleId)?.level;

  function pick(roleId: string | null) {
    edited = { role: roleId };
    open = false;
  }

  async function save() {
    const { level: n, xp: _, ...update } = level;
    try {
      await saveLevel({ level: n, update: { ...update, role_id: role } });
      edited = undefined;
      toast.success(`Saved ${levelName(n)}`);
    } catch (e) {
      toast.error(refusal(e));
    }
  }
</script>

<SaveCard title="Discord role" {dirty} onDiscard={() => (edited = undefined)} onSave={save}>
  <Field.Field>
    <Field.Label for="level-{level.level}-role">Level role</Field.Label>
    <Popover.Root bind:open>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            id="level-{level.level}-role"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            class="w-full justify-between font-normal sm:max-w-60"
          >
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
</SaveCard>
