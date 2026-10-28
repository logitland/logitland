<script lang="ts">
  // The web app's theme; svartz.config.ts maps Svartz's tokens onto it.
  import '@logitland/tokens/theme.css';
  import { MIGRATE_COLOR_MODE_SCRIPT } from '@logitland/tokens/color-mode';
  import { afterNavigate, goto } from '$app/navigation';

  let { children } = $props();

  /** Sends an old bookmark's missing heading on to where it lives now (src/lib/legacy-anchors.ts), in place of its entry. */
  async function followMovedHeading(url: URL) {
    if (!url.hash || document.getElementById(url.hash.slice(1))) return;
    const { legacyAnchor } = await import('$lib/legacy-anchors');
    const moved = legacyAnchor(url);
    if (moved) await goto(moved, { replaceState: true });
  }

  // Every arrival, including the first page and a redirected bookmark; a hash-only change doesn't navigate, so it has its own event.
  afterNavigate(({ to }) => to && followMovedHeading(to.url));
</script>

<svelte:window onhashchange={() => followMovedHeading(new URL(location.href))} />

<!-- Before Svartz's colour-mode script in the page's head, so a mode saved on the web app before it shared the key applies here. -->
<svelte:head>{@html `<script>${MIGRATE_COLOR_MODE_SCRIPT}</script>`}</svelte:head>

{@render children()}

<style>
  /* The current sidebar page is marked by its weight, without an inset accent bar. */
  :global(.explorer .explorer-list a[aria-current='page']) {
    box-shadow: none;
  }
</style>
