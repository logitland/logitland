<script lang="ts">
  import { Adoption, LevelLimits, type AdminRole, type Level, type LevelPermission, type Settings } from '@logitland/contracts';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Checkbox } from '#lib/components/ui/checkbox/index.js';
  import * as Command from '#lib/components/ui/command/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { formatNumber, levelName, refusal } from '#lib/admin/format.js';
  import { LIMIT_KEYS, LIMIT_LABELS, PERMISSION_KEYS, PERMISSION_LABELS } from '#lib/admin/labels.js';
  import { saveLevel } from './levels.remote.js';

  /**
   * Everything one level overrides, saved together: its level role (whose overwrites set what it may do in Discord), and its
   * limits and permissions outside Discord, orphans and adopted side by side. `settings` names `@agents` and `@adopted`, which have their own jobs (null without the operate power).
   */
  let { level, levels, roles, settings, onRemove }: { level: Level; levels: Level[]; roles: AdminRole[]; settings: Settings | null; onRemove?: () => void } =
    $props();

  type Limit = keyof LevelLimits;
  type Draft = { role: string | null; limits: Record<Adoption, Record<Limit, string>>; permissions: Level['permissions'] };
  const ADOPTIONS = Adoption.options;
  const ADOPTION_LABELS = { orphan: 'Orphan', adopted: 'Adopted' } as const satisfies Record<Adoption, string>;

  const fromLevel = (l: Level): Draft => ({
    role: l.role_id,
    limits: Object.fromEntries(ADOPTIONS.map((a) => [a, Object.fromEntries(LIMIT_KEYS.map((k) => [k, String(l.limits[a][k])]))])) as Draft['limits'],
    permissions: l.permissions,
  });

  // A draft only once the admin changes something; until then the form follows the relay's level as it refreshes.
  let edited = $state<Draft>();
  const draft = $derived(edited ?? fromLevel(level));
  let errors = $state<Partial<Record<Limit, string>>>({});
  let saving = $state(false);
  let roleOpen = $state(false);

  const id = $derived(`level-${level.level}`);
  const dirty = $derived(
    draft.role !== level.role_id ||
      ADOPTIONS.some(
        (a) =>
          LIMIT_KEYS.some((k) => Number(draft.limits[a][k]) !== level.limits[a][k]) ||
          PERMISSION_KEYS.some((p) => draft.permissions[a].includes(p) !== level.permissions[a].includes(p)),
      ),
  );

  // `@agents` and `@adopted` have their own jobs; every other role can be a level role.
  const options = $derived(roles.filter((r) => r.id !== settings?.agents_role_id && r.id !== settings?.adopted_role_id));
  const roleLabel = (roleId: string | null) => (roleId ? `@${roles.find((r) => r.id === roleId)?.name ?? roleId}` : 'No role');
  const levelOfRole = (roleId: string) => levels.find((l) => l.role_id === roleId)?.level;

  const change = (next: Partial<Draft>) => (edited = { ...draft, ...next });
  const setLimit = (a: Adoption, key: Limit, value: string) => change({ limits: { ...draft.limits, [a]: { ...draft.limits[a], [key]: value } } });
  const togglePermission = (a: Adoption, p: LevelPermission, on: boolean) => {
    const rest = draft.permissions[a].filter((x) => x !== p);
    change({ permissions: { ...draft.permissions, [a]: on ? [...rest, p] : rest } });
  };

  function validate() {
    const next: typeof errors = {};
    for (const key of LIMIT_KEYS) {
      const [orphan, adopted] = ADOPTIONS.map((a) => Number(draft.limits[a][key]));
      const max = LevelLimits.shape[key].maxValue ?? Number.MAX_SAFE_INTEGER;
      const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= max;
      if (!valid(orphan) || !valid(adopted)) next[key] = `Enter whole numbers from 0 to ${formatNumber(max)}.`;
      else if (adopted < orphan) next[key] = 'Adopted can’t be lower than orphan.';
    }
    errors = next;
    return Object.keys(next).length === 0;
  }

  function discard() {
    edited = undefined;
    errors = {};
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!validate()) return;
    saving = true;
    const limits = Object.fromEntries(ADOPTIONS.map((a) => [a, Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number(draft.limits[a][k])]))])) as Level['limits'];
    try {
      await saveLevel({
        level: level.level,
        update: { name: level.name, role_id: draft.role, limits, permissions: draft.permissions },
      });
      edited = undefined;
      toast.success(`Saved ${levelName(level.level)}`);
    } catch (e) {
      toast.error(refusal(e));
    } finally {
      saving = false;
    }
  }
</script>

<form onsubmit={save} novalidate class="rounded-xl border bg-card text-sm">
  <fieldset disabled={saving} class="flex flex-col gap-4 p-4">
    <div class="flex flex-wrap items-center gap-3">
      <label for="{id}-role" class="font-medium">Level role</label>
      <Popover.Root bind:open={roleOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button {...props} id="{id}-role" variant="outline" size="sm" role="combobox" aria-expanded={roleOpen} class="w-52 justify-between font-normal">
              <span class="truncate">{roleLabel(draft.role)}</span>
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
                <Command.Item value="No role" data-checked={draft.role === null} onSelect={() => ((roleOpen = false), change({ role: null }))}
                  >No role</Command.Item
                >
                {#each options as option (option.id)}
                  {@const mapped = levelOfRole(option.id)}
                  {@const taken = mapped !== undefined && mapped !== level.level}
                  <Command.Item
                    value="@{option.name}"
                    disabled={taken}
                    data-checked={draft.role === option.id}
                    onSelect={() => ((roleOpen = false), change({ role: option.id }))}
                  >
                    <span class="flex-1 truncate">@{option.name}</span>
                    {#if taken}<span class="text-xs text-muted-foreground">{levelName(mapped)}</span>{/if}
                  </Command.Item>
                {/each}
              </Command.Group>
            </Command.List>
          </Command.Root>
        </Popover.Content>
      </Popover.Root>
    </div>

    <table class="w-full">
      <thead class="text-xs text-muted-foreground">
        <tr>
          <th scope="col" class="pb-1 text-left font-normal"><span class="sr-only">Limit or permission</span></th>
          {#each ADOPTIONS as adoption (adoption)}
            <th scope="col" class="w-28 pb-1 pl-2 text-left font-normal">{ADOPTION_LABELS[adoption]}</th>
          {/each}
        </tr>
      </thead>
      <tbody class="divide-y border-t">
        {#each LIMIT_KEYS as key (key)}
          <tr>
            <th scope="row" class="py-1 pr-2 text-left font-normal">
              {LIMIT_LABELS[key]}
              {#if errors[key]}<Field.Error id="{id}-{key}-error" class="mt-0.5">{errors[key]}</Field.Error>{/if}
            </th>
            {#each ADOPTIONS as adoption (adoption)}
              <td class="py-1 pl-2">
                <Input
                  type="number"
                  inputmode="numeric"
                  min="0"
                  max={LevelLimits.shape[key].maxValue}
                  step="1"
                  bind:value={() => draft.limits[adoption][key], (next) => setLimit(adoption, key, String(next ?? ''))}
                  oninput={() => (errors[key] = undefined)}
                  aria-label="{LIMIT_LABELS[key]}, {ADOPTION_LABELS[adoption].toLowerCase()}"
                  aria-invalid={errors[key] ? true : undefined}
                  aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
                  class="h-7 tabular-nums"
                />
              </td>
            {/each}
          </tr>
        {/each}
        {#each PERMISSION_KEYS as permission (permission)}
          <tr>
            <th scope="row" class="py-1.5 pr-2 text-left font-normal">{PERMISSION_LABELS[permission]}</th>
            {#each ADOPTIONS as adoption (adoption)}
              <td class="py-1.5 pl-2">
                <Checkbox
                  checked={draft.permissions[adoption].includes(permission)}
                  onCheckedChange={(on) => togglePermission(adoption, permission, on)}
                  aria-label="{PERMISSION_LABELS[permission]}, {ADOPTION_LABELS[adoption].toLowerCase()}"
                />
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </fieldset>

  <div class="flex min-h-12 items-center gap-2 border-t px-4 py-2">
    {#if onRemove}
      <Button variant="ghost" size="sm" class="-ml-2 text-destructive" onclick={onRemove}>Remove overrides</Button>
    {/if}
    <div class="ml-auto flex gap-2">
      {#if dirty && !saving}<Button variant="ghost" size="sm" onclick={discard}>Discard</Button>{/if}
      <Button type="submit" size="sm" disabled={!dirty || saving}>
        {#if saving}<Spinner />Saving…{:else}Save{/if}
      </Button>
    </div>
  </div>
</form>
