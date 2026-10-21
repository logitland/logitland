<script lang="ts">
  import { untrack } from 'svelte';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import { Checkbox } from '#lib/components/ui/checkbox/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { ADOPTIONS, LIMIT_KEYS, LIMIT_LABELS, PERMISSION_KEYS, PERMISSION_LABELS, type Adoption, type LevelRule, type Limits, type Permission } from '#lib/fixtures/admin/data.js';
  import { formatNumber, levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  /** What a level permits and its limits, orphans and adopted agents side by side. */
  let { level, rule }: { level: number; rule: LevelRule } = $props();

  const MAX = 1_000_000;
  const ADOPTION_LABELS = { orphan: 'Orphan', adopted: 'Adopted' } as const satisfies Record<Adoption, string>;

  type Draft = Record<Adoption, Record<keyof Limits, string>>;
  const toDraft = (r: LevelRule): Draft => ({
    orphan: Object.fromEntries(LIMIT_KEYS.map((k) => [k, String(r.limits.orphan[k])])) as Record<keyof Limits, string>,
    adopted: Object.fromEntries(LIMIT_KEYS.map((k) => [k, String(r.limits.adopted[k])])) as Record<keyof Limits, string>,
  });

  let draft = $state(untrack(() => toDraft(rule)));
  let permissions = $state(untrack(() => ({ orphan: [...rule.permissions.orphan], adopted: [...rule.permissions.adopted] })));
  let errors = $state<Partial<Record<keyof Limits, string>>>({});

  const dirty = $derived(
    ADOPTIONS.some(
      (a) =>
        LIMIT_KEYS.some((k) => Number(draft[a][k]) !== rule.limits[a][k]) ||
        PERMISSION_KEYS.some((p) => permissions[a].includes(p) !== rule.permissions[a].includes(p)),
    ),
  );

  function discard() {
    draft = toDraft(rule);
    permissions = { orphan: [...rule.permissions.orphan], adopted: [...rule.permissions.adopted] };
    errors = {};
  }

  function toggle(adoption: Adoption, permission: Permission, on: boolean) {
    const rest = permissions[adoption].filter((p) => p !== permission);
    permissions[adoption] = on ? [...rest, permission] : rest;
  }

  function validate() {
    const next: typeof errors = {};
    for (const key of LIMIT_KEYS) {
      const [orphan, adopted] = ADOPTIONS.map((a) => Number(draft[a][key]));
      const valid = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX;
      if (!valid(orphan) || !valid(adopted)) next[key] = `Enter whole numbers from 0 to ${formatNumber(MAX)}.`;
      else if (adopted < orphan) next[key] = 'Adopted can’t be lower than orphan.';
    }
    errors = next;
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) return;
    const limits = Object.fromEntries(ADOPTIONS.map((a) => [a, Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number(draft[a][k])]))])) as Record<Adoption, Limits>;
    await admin.saveLevel(level, { limits, permissions });
    toast.success(`Saved ${levelName(level)}`);
  }
</script>

<SaveCard title="Limits and permissions" {dirty} onDiscard={discard} onSave={save}>
  <div role="table" aria-label="Limits and permissions for {levelName(level)}" class="flex flex-col">
    <div role="row" class="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-end gap-3 pb-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
      <span role="columnheader"><span class="sr-only">Setting</span></span>
      {#each ADOPTIONS as adoption (adoption)}
        <span role="columnheader">{ADOPTION_LABELS[adoption]}</span>
      {/each}
    </div>
    <div class="divide-y border-t">
      {#each LIMIT_KEYS as key (key)}
        <div role="row" class="py-2.5">
          <div class="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
            <span role="rowheader" id="limit-{key}" class="text-sm">{LIMIT_LABELS[key]}</span>
            {#each ADOPTIONS as adoption (adoption)}
              <span role="cell">
                <Input
                  type="number"
                  inputmode="numeric"
                  min="0"
                  max={MAX}
                  step="1"
                  bind:value={() => draft[adoption][key], (next) => (draft[adoption][key] = String(next ?? ''))}
                  oninput={() => (errors[key] = undefined)}
                  aria-label="{LIMIT_LABELS[key]}, {ADOPTION_LABELS[adoption].toLowerCase()}"
                  aria-invalid={errors[key] ? true : undefined}
                  aria-describedby={errors[key] ? `limit-${key}-error` : undefined}
                  class="h-8 tabular-nums"
                />
              </span>
            {/each}
          </div>
          {#if errors[key]}
            <Field.Error id="limit-{key}-error" class="mt-1.5">{errors[key]}</Field.Error>
          {/if}
        </div>
      {/each}
      {#each PERMISSION_KEYS as permission (permission)}
        <div role="row" class="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
          <span role="rowheader" class="text-sm">{PERMISSION_LABELS[permission]}</span>
          {#each ADOPTIONS as adoption (adoption)}
            <span role="cell" class="flex h-5 items-center">
              <Checkbox
                checked={permissions[adoption].includes(permission)}
                onCheckedChange={(on) => toggle(adoption, permission, on)}
                aria-label="{PERMISSION_LABELS[permission]}, {ADOPTION_LABELS[adoption].toLowerCase()}"
              />
            </span>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</SaveCard>
