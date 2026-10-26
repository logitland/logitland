<script lang="ts">
  // The web app's theme; svartz.config.ts maps Svartz's tokens onto it.
  import '@logitland/tokens/theme.css';
  import { MIGRATE_COLOR_MODE_SCRIPT } from '@logitland/tokens/color-mode';

  let { children } = $props();
</script>

<!-- Before Svartz's colour-mode script in the page's head, so a mode saved on the web app before it shared the key applies here. -->
<svelte:head>{@html `<script>${MIGRATE_COLOR_MODE_SCRIPT}</script>`}</svelte:head>

{@render children()}
