<script lang="ts">
  import { toast } from 'svelte-sonner';
  import ColourPicker from '#lib/components/admin/colour-picker.svelte';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import { formatNumber, levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import { levelSettings } from '#lib/fixtures/levels.svelte.js';
  import { levelColour, type LevelColour, type LevelColours } from '#lib/levels.js';

  /**
   * The colour XP bars take per level when a viewer colours them by level. Admins assign any colour to some levels;
   * the rest tween between their neighbours in OKLab, and levels past the last row keep its colour.
   */
  const LAST_LEVEL = 10;
  const levels = Array.from({ length: LAST_LEVEL + 1 }, (_, level) => level);

  const toDraft = (): (LevelColour | undefined)[] => levels.map((level) => levelSettings.colours[level]);
  const same = (a: LevelColour | undefined, b: LevelColour | undefined) => a?.hue === b?.hue && a?.chroma === b?.chroma;

  let draft = $state(toDraft());

  const assigned = $derived<LevelColours>(
    Object.fromEntries(levels.flatMap((level) => (draft[level] ? [[level, draft[level]]] : []))),
  );
  const saved = $derived(toDraft());
  const dirty = $derived(levels.some((level) => !same(draft[level], saved[level])));

  async function save() {
    await admin.saveColours(assigned);
    toast.success('Saved level colours');
  }
</script>

<SaveCard title="Level colours" {dirty} onDiscard={() => (draft = toDraft())} onSave={save}>
  <ul class="divide-y border-y">
    {#each levels as level (level)}
      {@const colour = levelColour(level, assigned)}
      <li class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5 sm:gap-6">
        <div class="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-3">
          <span class="text-sm">{levelName(level)}</span>
          <span class="text-xs text-muted-foreground tabular-nums">{formatNumber(levelSettings.xp(level))} XP</span>
        </div>
        <span
          class="level-accent h-1.5 w-12 shrink-0 rounded-full bg-brand sm:w-32"
          style:--level-hue={colour.hue}
          style:--level-chroma={colour.chroma}
          aria-hidden="true"
        ></span>
        <ColourPicker label={levelName(level)} bind:value={draft[level]} />
      </li>
    {/each}
  </ul>
</SaveCard>
