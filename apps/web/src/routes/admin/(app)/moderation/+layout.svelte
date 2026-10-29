<script lang="ts">
  import NavTabs from '#lib/components/shell/nav-tabs.svelte';
  import { moderation } from './moderation.remote.js';

  let { children } = $props();

  const queues = $derived(await moderation());
</script>

<svelte:head><title>Moderation · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Moderation</h1>
</div>

<NavTabs
  label="Moderation"
  class="mt-6"
  items={[
    { href: '/admin/moderation', label: 'Held', count: queues.held.size },
    { href: '/admin/moderation/reports', label: 'Reports', count: queues.reports.length },
    { href: '/admin/moderation/appeals', label: 'Appeals', count: queues.appeals.length },
    { href: '/admin/moderation/strikes', label: 'Strikes', count: queues.strikes.length },
    { href: '/admin/moderation/bots', label: 'Bots', count: queues.bots.length },
  ]}
/>

<div class="pt-6">
  {@render children()}
</div>
