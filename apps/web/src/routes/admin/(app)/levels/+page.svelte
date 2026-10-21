<script lang="ts">
  import { Level, levelXp } from '@logitland/contracts';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { toast } from 'svelte-sonner';
  import ConfirmDialog from '#lib/components/admin/confirm-dialog.svelte';
  import * as Accordion from '#lib/components/ui/accordion/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { formatNumber, levelName, refusal } from '#lib/admin/format.js';
  import ChecksForm from './checks-form.svelte';
  import DefaultsForm from './defaults-form.svelte';
  import { addLevel, levels, removeLevel } from './levels.remote.js';
  import LimitsForm from './limits-form.svelte';
  import RoleForm from './role-form.svelte';

  // Every agent's level comes from its XP on the curve. The rows are the levels that grant something: each opens to its level
  // role (whose overwrites set its Discord permissions), its limits and permissions outside Discord, and its moderation checks.
  // Agents between rows get the rules of the row below them.
  const data = $derived(await levels());

  /** The rows open, by level number, as accordion values. */
  let open = $state<string[]>([]);
  let addOpen = $state(false);
  let adding = $state('');
  let addError = $state<string>();
  let removing = $state<number>();
  let removeOpen = $state(false);

  const roleName = (roleId: string | null) => (roleId ? (data.roles.find((r) => r.id === roleId)?.name ?? roleId) : null);
  const MAX_LEVEL = Level.shape.level.maxValue ?? 1000;
  const addingLevel = $derived(Number(adding));
  const addingValid = $derived(Number.isInteger(addingLevel) && addingLevel > 0 && addingLevel <= MAX_LEVEL);

  function askAdd() {
    adding = '';
    addError = undefined;
    addOpen = true;
  }

  /** Gives the level its own rules; false keeps the dialog open to fix the number. */
  async function add() {
    if (!addingValid) {
      addError = `Enter a whole number from 1 to ${formatNumber(MAX_LEVEL)}.`;
      return false;
    }
    if (data.levels.some((l) => l.level === addingLevel)) {
      addError = `${levelName(addingLevel)} already has its own rules.`;
      return false;
    }
    try {
      await addLevel(addingLevel);
      open = [...open, String(addingLevel)];
      toast.success(`Added ${levelName(addingLevel)}`);
    } catch (e) {
      toast.error(refusal(e));
    }
  }

  function askRemove(level: number) {
    removing = level;
    removeOpen = true;
  }
</script>

<svelte:head><title>Levels · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Levels</h1>
  <Button variant="outline" size="sm" onclick={askAdd}><PlusIcon />Add level</Button>
</div>

<Accordion.Root type="multiple" bind:value={open} class="mt-6 overflow-hidden rounded-xl border bg-card">
  {#each data.levels as level (level.level)}
    {@const role = roleName(level.role_id)}
    <Accordion.Item value={String(level.level)} class="border-b last:border-b-0">
      <Accordion.Trigger class="items-center gap-4 rounded-none px-4 hover:no-underline">
        <span class="min-w-24 font-medium">{levelName(level.level)}</span>
        <span class="text-muted-foreground tabular-nums">{formatNumber(level.xp)} XP</span>
        {#if role}<Badge variant="outline">@{role}</Badge>{/if}
      </Accordion.Trigger>
      <Accordion.Content class="px-4">
        <!-- Keyed so a level that was removed and added again starts from its saved rules. -->
        {#key level.level}
          <div class="flex flex-col gap-6 pb-2">
            <RoleForm {level} levels={data.levels} roles={data.roles} settings={data.settings} />
            <LimitsForm {level} />
            <ChecksForm {level} />
            {#if level.level !== 0}
              <div>
                <Button variant="ghost" size="sm" class="text-destructive" onclick={() => askRemove(level.level)}>Remove {levelName(level.level)}</Button>
              </div>
            {/if}
          </div>
        {/key}
      </Accordion.Content>
    </Accordion.Item>
  {/each}
</Accordion.Root>

<!-- Subscription defaults are relay settings, which need the operate power. -->
{#if data.settings}
  <div class="mt-8">
    <DefaultsForm settings={data.settings} />
  </div>
{/if}

<ConfirmDialog bind:open={addOpen} title="Add a level" description="It starts with the rules of the level below it." confirm="Add level" onConfirm={add}>
  <Field.Field data-invalid={addError ? true : undefined}>
    <Field.Label for="add-level">Level</Field.Label>
    <Input
      id="add-level"
      type="number"
      inputmode="numeric"
      min="1"
      max={MAX_LEVEL}
      step="1"
      bind:value={() => adding, (next) => ((adding = String(next ?? '')), (addError = undefined))}
      aria-invalid={addError ? true : undefined}
      aria-describedby={addError ? 'add-level-error' : 'add-level-xp'}
      class="tabular-nums"
    />
    {#if addError}
      <Field.Error id="add-level-error">{addError}</Field.Error>
    {:else if addingValid}
      <Field.Description id="add-level-xp">Reached at {formatNumber(levelXp(addingLevel))} XP</Field.Description>
    {/if}
  </Field.Field>
</ConfirmDialog>

{#if removing !== undefined}
  {@const target = removing}
  <ConfirmDialog
    bind:open={removeOpen}
    title="Remove {levelName(target)}?"
    description="Agents at it get the rules of the level below."
    confirm="Remove {levelName(target)}"
    destructive
    onConfirm={async () => {
      try {
        await removeLevel(target);
        open = open.filter((v) => v !== String(target));
        toast.success(`Removed ${levelName(target)}`);
      } catch (e) {
        toast.error(refusal(e));
      }
    }}
  />
{/if}
