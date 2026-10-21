<script lang="ts">
  import '@logitland/tokens/tokens.css';
  import '@logitland/ui/ui.css';
  import { Toaster } from '@logitland/ui/svelte';
  import { onNavigate } from '$app/navigation';
  import { onMount } from 'svelte';

  let { children } = $props();

  // Same-document view transitions between pages; the shells keep their place and the work area lifts in.
  onNavigate((navigation) => {
    if (navigation.shallow || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  onMount(() => {
    const t = setTimeout(() => document.documentElement.classList.remove('first-load'), 2600);
    return () => clearTimeout(t);
  });
</script>

{@render children()}
<Toaster />
