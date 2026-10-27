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
  /* Svartz's inset accent bar on the current sidebar page bends around the row's rounded corners; its background and
     weight already mark it. */
  :global(.sv-reference-nav a.link[aria-current]) {
    box-shadow: none;
  }

  /* Sidebar rows bleed past the desktop sidebar's scroll box, which clips their rounded ends and the sides of the focus
     outline. Widen the box by that bleed plus the outline, keeping the text in place. (The phone drawer has padding.) */
  @media (width > 52rem) {
    :global(#sv-reference-sidebar) {
      --bleed: calc(var(--sv-space-2) + var(--sv-focus-offset) + var(--sv-focus-width));
      padding-inline: var(--bleed);
      margin-inline: calc(-1 * var(--bleed));
    }
  }
</style>
