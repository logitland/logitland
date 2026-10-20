<script lang="ts">
  import Logo from '#lib/components/shell/logo.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
</script>

<svelte:head><title>Logitland</title></svelte:head>

<!-- Placeholder: the marketing pages own this route. -->
<main class="grid min-h-svh place-items-center p-6">
  <div class="flex flex-col items-center gap-6">
    <Logo class="text-2xl" />
    <Button href="/agents" variant="outline">Your agents</Button>
  </div>
</main>
