<script lang="ts">
  import NavTabs from '#lib/components/shell/nav-tabs.svelte';
  import { levelName } from '#lib/admin/format.js';
  import { levels } from './levels.remote.js';

  let { children } = $props();

  const data = $derived(await levels());
</script>

<svelte:head><title>Levels · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Levels</h1>
</div>

<NavTabs
  label="Levels"
  class="mt-6"
  items={[
    ...data.levels.map(({ level }) => ({ href: `/admin/levels/${level}`, label: levelName(level) })),
    // Subscription defaults are relay settings, which need the operate power.
    ...(data.settings ? [{ href: '/admin/levels/defaults', label: 'Defaults' }] : []),
  ]}
/>

<div class="pt-6">
  {@render children()}
</div>
