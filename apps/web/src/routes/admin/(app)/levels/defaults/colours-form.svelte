<script lang="ts">
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import * as Select from '#lib/components/ui/select/index.js';
  import { formatNumber, levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import { levelSettings } from '#lib/fixtures/levels.svelte.js';
  import { COLOUR_PRESETS, colourName, colourPreset, levelColour, type ColourName, type LevelColour, type LevelColours } from '#lib/levels.js';

  /**
   * The colour XP bars take per level when a viewer colours them by level. Admins assign colours to some levels;
   * the rest tween between their neighbours, and levels past the last row keep its colour.
   */
  const LAST_LEVEL = 10;
  const TWEEN = 'tween';
  const levels = Array.from({ length: LAST_LEVEL + 1 }, (_, level) => level);

  type Choice = ColourName | typeof TWEEN;
  // The prototype's colours all come from the presets, so every assigned colour has a name.
  const toDraft = (): Choice[] => levels.map((level) => (levelSettings.colours[level] && colourName(levelSettings.colours[level])) || TWEEN);
  const isColour = (choice: Choice): choice is ColourName => choice !== TWEEN;

  let draft = $state(toDraft());

  const assigned = $derived<LevelColours>(
    Object.fromEntries(levels.flatMap((level) => (isColour(draft[level]) ? [[level, colourPreset(draft[level])]] : []))),
  );
  const saved = $derived(toDraft());
  const dirty = $derived(levels.some((level) => draft[level] !== saved[level]));

  async function save() {
    await admin.saveColours(assigned);
    toast.success('Saved level colours');
  }
</script>

{#snippet swatch(colour: LevelColour, className: string)}
  <span class="level-accent shrink-0 rounded-full bg-brand {className}" style:--level-hue={colour.hue} style:--level-chroma={colour.chroma} aria-hidden="true"></span>
{/snippet}

<SaveCard title="Level colours" {dirty} onDiscard={() => (draft = toDraft())} onSave={save}>
  <ul class="divide-y border-y">
    {#each levels as level (level)}
      {@const colour = levelColour(level, assigned)}
      {@const choice = draft[level]}
      <li class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 sm:gap-6">
        <div class="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-3">
          <span class="text-sm">{levelName(level)}</span>
          <span class="text-xs text-muted-foreground tabular-nums">{formatNumber(levelSettings.xp(level))} XP</span>
        </div>
        {@render swatch(colour, 'h-1.5 w-12 sm:w-32')}
        <Select.Root type="single" bind:value={() => choice, (next) => (draft[level] = next as Choice)}>
          <Select.Trigger size="sm" aria-label="{levelName(level)} colour" class="w-32">
            {#if isColour(choice)}
              <span class="flex items-center gap-2">{@render swatch(colourPreset(choice), 'size-3')}{choice}</span>
            {:else}
              <span class="text-muted-foreground">Tween</span>
            {/if}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value={TWEEN} label="Tween" />
            {#each COLOUR_PRESETS as preset (preset.name)}
              <Select.Item value={preset.name} label={preset.name}>
                {@render swatch(preset, 'size-3')}{preset.name}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </li>
    {/each}
  </ul>
</SaveCard>
