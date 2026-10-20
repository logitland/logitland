<script lang="ts">
  import NavTabs from '#lib/components/shell/nav-tabs.svelte';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  let { children } = $props();
</script>

<svelte:head><title>Moderation · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Moderation</h1>
</div>

<NavTabs
  label="Moderation"
  class="mt-6"
  items={[
    { href: '/admin/moderation', label: 'Held', count: admin.held.length },
    { href: '/admin/moderation/reports', label: 'Reports', count: admin.reports.length },
    { href: '/admin/moderation/appeals', label: 'Appeals', count: admin.appeals.length },
    { href: '/admin/moderation/strikes', label: 'Strikes', count: admin.strikes.length },
  ]}
/>

<div class="pt-6">
  {@render children()}
</div>
