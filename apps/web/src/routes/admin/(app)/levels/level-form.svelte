<script lang="ts">
  import { LevelLimits, type AdminRole, type Level, type LevelPermission, type Settings } from '@logitland/contracts';
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
  import { cn } from '#lib/utils.js';
  import { saveLevel } from './levels.remote.js';

  /**
   * Everything one level overrides, saved together: its level role (whose overwrites set what it may do in Discord), and its
   * limits and permissions outside Discord. `settings` names `@agents`, which isn't a level role (null without operate).
   */
  let {
    level,
    levels,
    roles,
    settings,
    onMove,
    onRemove,
  }: { level: Level; levels: Level[]; roles: AdminRole[]; settings: Settings | null; onMove?: () => void; onRemove?: () => void } = $props();

  type Limit = keyof LevelLimits;
  type Draft = { role: string | null; limits: Record<Limit, string>; permissions: LevelPermission[] };

  const fromLevel = (l: Level): Draft => ({
    role: l.role_id,
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, String(l.limits[k])])) as Draft['limits'],
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
      LIMIT_KEYS.some((k) => Number(draft.limits[k]) !== level.limits[k]) ||
      PERMISSION_KEYS.some((p) => draft.permissions.includes(p) !== level.permissions.includes(p)),
  );

  // `@agents` has its own job; every other role can be a level role.
  const options = $derived(roles.filter((r) => r.id !== settings?.agents_role_id));
  const roleLabel = (roleId: string | null) => (roleId ? `@${roles.find((r) => r.id === roleId)?.name ?? roleId}` : 'No role');
  const levelOfRole = (roleId: string) => levels.find((l) => l.role_id === roleId)?.level;

  // A level only adds to the levels below it and stays within the levels above it, as the relay requires.
  const below = $derived(levels.findLast((l) => l.level < level.level));
  const above = $derived(levels.find((l) => l.level > level.level));
  const min = (key: Limit) => below?.limits[key] ?? 0;
  const max = (key: Limit) => above?.limits[key] ?? LevelLimits.shape[key].maxValue ?? Number.MAX_SAFE_INTEGER;
  /** The lowest level that already grants `p` below this one, which locks it on here. */
  const grantedBy = (p: LevelPermission) => levels.find((l) => l.level < level.level && l.permissions.includes(p))?.level;

  const change = (next: Partial<Draft>) => (edited = { ...draft, ...next });
  const togglePermission = (p: LevelPermission, on: boolean) => {
    const rest = draft.permissions.filter((x) => x !== p);
    change({ permissions: on ? [...rest, p] : rest });
  };

  function validate() {
    const next: typeof errors = {};
    for (const key of LIMIT_KEYS) {
      const n = Number(draft.limits[key]);
      if (!Number.isInteger(n) || n < min(key) || n > max(key)) next[key] = `Enter a whole number from ${formatNumber(min(key))} to ${formatNumber(max(key))}.`;
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
    const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number(draft.limits[k])])) as Level['limits'];
    try {
      const permissions = PERMISSION_KEYS.filter((p) => grantedBy(p) !== undefined || draft.permissions.includes(p));
      await saveLevel({ level: level.level, update: { name: level.name, role_id: draft.role, limits, permissions } });
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
  <fieldset disabled={saving} class="grid gap-x-8 gap-y-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
    <div class="flex flex-col gap-2">
      <div class="flex min-h-8 items-center justify-between gap-3">
        <label for="{id}-role">Level role</label>
        <Popover.Root bind:open={roleOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Button {...props} id="{id}-role" variant="outline" size="sm" role="combobox" aria-expanded={roleOpen} class="w-36 justify-between font-normal">
                <span class="truncate">{roleLabel(draft.role)}</span>
                <ChevronsUpDownIcon class="opacity-50" />
              </Button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-60 p-0" align="end">
            <Command.Root>
              <Command.Input placeholder="Search roles" />
              <Command.List>
                <Command.Empty>No role by that name</Command.Empty>
                <Command.Group>
                  <Command.Item value="No role" data-checked={draft.role === null} onSelect={() => ((roleOpen = false), change({ role: null }))}>
                    No role
                  </Command.Item>
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
      {#each LIMIT_KEYS as key (key)}
        <div class="flex min-h-8 items-center justify-between gap-3">
          <label for="{id}-{key}">{LIMIT_LABELS[key]}</label>
          <Input
            id="{id}-{key}"
            type="number"
            inputmode="numeric"
            min={min(key)}
            max={max(key)}
            step="1"
            bind:value={() => draft.limits[key], (next) => change({ limits: { ...draft.limits, [key]: String(next ?? '') } })}
            oninput={() => (errors[key] = undefined)}
            aria-invalid={errors[key] ? true : undefined}
            aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
            class="h-8 w-36 tabular-nums"
          />
        </div>
        {#if errors[key]}<Field.Error id="{id}-{key}-error" class="-mt-1 text-right">{errors[key]}</Field.Error>{/if}
      {/each}
    </div>

    <fieldset class="flex flex-col gap-2">
      <legend class="mb-2 text-muted-foreground">Also allows</legend>
      {#each PERMISSION_KEYS as permission (permission)}
        {@const from = grantedBy(permission)}
        {@const notYet = above !== undefined && !above.permissions.includes(permission)}
        <label class={cn('flex min-h-8 items-center gap-2.5', (from !== undefined || notYet) && 'text-muted-foreground')}>
          <Checkbox
            checked={from !== undefined || draft.permissions.includes(permission)}
            disabled={from !== undefined || notYet}
            onCheckedChange={(on) => togglePermission(permission, on)}
          />
          {PERMISSION_LABELS[permission]}
          {#if from !== undefined}<span class="ml-auto text-xs whitespace-nowrap">from {levelName(from)}</span>{/if}
        </label>
      {/each}
    </fieldset>
  </fieldset>

  <div class="flex min-h-12 items-center gap-2 border-t px-4 py-2">
    {#if onMove}
      <Button variant="ghost" size="sm" class="-ml-2" onclick={onMove}>Move to another level</Button>
    {/if}
    {#if onRemove}
      <Button variant="ghost" size="sm" class="text-destructive" onclick={onRemove}>Remove overrides</Button>
    {/if}
    <div class="ml-auto flex gap-2">
      {#if dirty && !saving}<Button variant="ghost" size="sm" onclick={discard}>Discard</Button>{/if}
      <Button type="submit" size="sm" disabled={!dirty || saving}>
        {#if saving}<Spinner />Saving…{:else}Save{/if}
      </Button>
    </div>
  </div>
</form>
