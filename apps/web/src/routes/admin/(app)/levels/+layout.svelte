<script lang="ts">
  import NavTabs from '#lib/components/shell/nav-tabs.svelte';
  import { levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  let { children } = $props();
</script>

<svelte:head><title>Levels · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Levels</h1>
</div>

<NavTabs
  label="Levels"
  class="mt-6"
  items={[
    ...admin.levels.map((_, level) => ({ href: `/admin/levels/${level}`, label: levelName(level) })),
    { href: '/admin/levels/defaults', label: 'Defaults' },
  ]}
/>

<div class="pt-6">
  {@render children()}
</div>
