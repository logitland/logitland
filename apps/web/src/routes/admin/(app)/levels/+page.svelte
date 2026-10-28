<script lang="ts">
  import { Level, levelXp } from '@logitland/contracts';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import { SvelteSet } from 'svelte/reactivity';
  import { toast } from 'svelte-sonner';
  import ConfirmDialog from '#lib/components/admin/confirm-dialog.svelte';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { formatNumber, levelName, refusal } from '#lib/admin/format.js';
  import { DEFAULT_COLOURS, levelColour } from '#lib/levels.js';
  import { cn } from '#lib/utils.js';
  import DefaultsForm from './defaults-form.svelte';
  import LevelForm from './level-form.svelte';
  import { addLevel, levels, moveLevel, removeLevel } from './levels.remote.js';

  // Every agent's level comes from its XP on the curve, with no cap. The timeline lists the levels with overrides, probation
  // first: each opens to its level role (whose overwrites set its Discord permissions) and its limits and permissions outside
  // Discord. Every level runs every moderation check. The levels between them follow the one above, and the gaps say so.
  const data = $derived(await levels());

  const MAX_LEVEL = Level.shape.level.maxValue ?? 1000;

  const expanded = new SvelteSet<number>();
  const toggle = (level: number) => (expanded.has(level) ? expanded.delete(level) : expanded.add(level));

  /** Each level with overrides, and the levels after it that follow it (to null: every level from there on). */
  const timeline = $derived(
    data.levels.map((level, i) => {
      const next = data.levels[i + 1]?.level;
      return { level, gap: next === undefined ? { from: level.level + 1, to: null } : next > level.level + 1 ? { from: level.level + 1, to: next - 1 } : null };
    }),
  );
  const gapLabel = (gap: { from: number; to: number | null }) =>
    gap.to === null ? `Level ${gap.from} and up` : gap.from === gap.to ? `Level ${gap.from}` : `Levels ${gap.from}–${gap.to}`;
  const roleName = (roleId: string | null) => (roleId ? (data.roles.find((r) => r.id === roleId)?.name ?? roleId) : null);

  let addOpen = $state(false);
  let adding = $state('');
  let addError = $state<string>();
  const addingLevel = $derived(Number(adding));
  const addingValid = $derived(Number.isInteger(addingLevel) && addingLevel > 0 && addingLevel <= MAX_LEVEL);

  function askAdd(level: number) {
    adding = String(level);
    addError = undefined;
    addOpen = true;
  }

  /** Gives a level its own overrides; false keeps the dialog open to fix the number. */
  async function add() {
    if (!addingValid) {
      addError = `Enter a whole number from 1 to ${formatNumber(MAX_LEVEL)}.`;
      return false;
    }
    if (data.levels.some((l) => l.level === addingLevel)) {
      addError = `${levelName(addingLevel)} already has overrides.`;
      return false;
    }
    try {
      await addLevel(addingLevel);
      expanded.add(addingLevel);
      toast.success(`Added ${levelName(addingLevel)}`);
    } catch (e) {
      toast.error(refusal(e));
    }
  }

  let removing = $state<number>();
  let removeOpen = $state(false);
  const above = (level: number) => data.levels.findLast((l) => l.level < level)!;

  function askRemove(level: number) {
    removing = level;
    removeOpen = true;
  }

  /** The level being moved, and the range it may move within: strictly between the levels around it. */
  let moving = $state<{ from: number; min: number; max: number }>();
  let moveOpen = $state(false);
  let moveTo = $state('');
  let moveError = $state<string>();
  const moveLevelTo = $derived(Number(moveTo));

  function askMove(from: number) {
    const min = above(from).level + 1;
    const max = (data.levels.find((l) => l.level > from)?.level ?? MAX_LEVEL + 1) - 1;
    moving = { from, min, max };
    moveTo = String(from);
    moveError = undefined;
    moveOpen = true;
  }

  /** Moves the level's overrides; false keeps the dialog open to fix the number. */
  async function move() {
    const target = moving!;
    if (!Number.isInteger(moveLevelTo) || moveLevelTo < target.min || moveLevelTo > target.max || moveLevelTo === target.from) {
      moveError = `Enter a level from ${formatNumber(target.min)} to ${formatNumber(target.max)}, other than ${target.from}.`;
      return false;
    }
    try {
      await moveLevel({ from: target.from, to: moveLevelTo });
      if (expanded.delete(target.from)) expanded.add(moveLevelTo);
      toast.success(`Moved ${levelName(target.from)}’s overrides to ${levelName(moveLevelTo)}`);
    } catch (e) {
      toast.error(refusal(e));
    }
  }
</script>

<svelte:head><title>Levels · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Levels</h1>
  <Button variant="outline" size="sm" onclick={() => askAdd((data.levels.at(-1)?.level ?? 0) + 1)}><PlusIcon />Add level</Button>
</div>

<ol class="mt-6">
  {#each timeline as { level, gap } (level.level)}
    {@const open = expanded.has(level.level)}
    {@const colour = levelColour(level.level, DEFAULT_COLOURS)}
    {@const role = roleName(level.role_id)}
    <li class="relative pb-4 pl-12 last:pb-0">
      <!-- The rail: dotted from this marker down to the next. -->
      <span class="absolute top-5 bottom-0 left-[1.0625rem] border-l-2 border-dotted border-muted-foreground/40" aria-hidden="true"></span>
      <span
        class="level-accent absolute top-1.5 left-0 flex size-9 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground"
        style:--level-hue={colour.hue}
        style:--level-chroma={colour.chroma}
        aria-hidden="true"
      >
        {level.level}
      </span>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="level-{level.level}-panel"
          onclick={() => toggle(level.level)}
          class="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring"
        >
          <span class="font-semibold">{levelName(level.level)}</span>
          <span class="text-sm text-muted-foreground tabular-nums">{formatNumber(level.xp)} XP</span>
          {#if role}<Badge variant="outline">@{role}</Badge>{/if}
          <ChevronDownIcon class={cn('ml-auto size-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </h2>
      {#if open}
        <div id="level-{level.level}-panel" class="pt-1 pb-2">
          <LevelForm
            {level}
            levels={data.levels}
            roles={data.roles}
            settings={data.settings}
            onMove={level.level === 0 ? undefined : () => askMove(level.level)}
            onRemove={level.level === 0 ? undefined : () => askRemove(level.level)}
          />
        </div>
      {/if}
      {#if gap}
        <div class={cn('relative', gap.to === null ? 'pt-2 pb-1' : 'py-4')}>
          <span class="absolute top-1/2 left-[-2.125rem] size-2 -translate-y-1/2 rounded-full bg-muted-foreground/40" aria-hidden="true"></span>
          <button
            type="button"
            onclick={() => askAdd(gap.from)}
            class="group flex items-center gap-2 rounded-md px-3 py-1 text-sm text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
          >
            <span>{gapLabel(gap)} · no overrides</span>
            <PlusIcon class="size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
            <span class="sr-only">, add overrides</span>
          </button>
        </div>
      {/if}
    </li>
  {/each}
</ol>

<!-- Subscription defaults are relay settings, which need the operate power. -->
{#if data.settings}
  <div class="mt-10">
    <DefaultsForm settings={data.settings} />
  </div>
{/if}

<ConfirmDialog bind:open={addOpen} title="Add a level" description="It starts with the overrides of the level above it." confirm="Add level" onConfirm={add}>
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

{#if moving}
  {@const target = moving}
  <ConfirmDialog
    bind:open={moveOpen}
    title="Move {levelName(target.from)}’s overrides?"
    description="Its limits, permissions and role arrive at the new level instead."
    confirm="Move overrides"
    onConfirm={move}
  >
    <Field.Field data-invalid={moveError ? true : undefined}>
      <Field.Label for="move-level">Level</Field.Label>
      <Input
        id="move-level"
        type="number"
        inputmode="numeric"
        min={target.min}
        max={target.max}
        step="1"
        bind:value={() => moveTo, (next) => ((moveTo = String(next ?? '')), (moveError = undefined))}
        aria-invalid={moveError ? true : undefined}
        aria-describedby={moveError ? 'move-level-error' : 'move-level-xp'}
        class="tabular-nums"
      />
      {#if moveError}
        <Field.Error id="move-level-error">{moveError}</Field.Error>
      {:else if Number.isInteger(moveLevelTo) && moveLevelTo >= target.min && moveLevelTo <= target.max}
        <Field.Description id="move-level-xp">Reached at {formatNumber(levelXp(moveLevelTo))} XP</Field.Description>
      {/if}
    </Field.Field>
  </ConfirmDialog>
{/if}

{#if removing !== undefined}
  {@const target = removing}
  <ConfirmDialog
    bind:open={removeOpen}
    title="Remove {levelName(target)}’s overrides?"
    description="Agents at it follow {levelName(above(target).level)} instead."
    confirm="Remove overrides"
    destructive
    onConfirm={async () => {
      try {
        await removeLevel(target);
        expanded.delete(target);
        toast.success(`Removed ${levelName(target)}’s overrides`);
      } catch (e) {
        toast.error(refusal(e));
      }
    }}
  />
{/if}
