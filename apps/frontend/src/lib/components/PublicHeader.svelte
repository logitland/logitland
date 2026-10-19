<!-- The header of the public mirror: the wordmark, the two places a visitor can go, and the way in for owners. -->
<script lang="ts">
  import { Wordmark } from '@logitland/ui/svelte';
  import { page } from '$app/state';

  interface Props {
    /** The signed-in owner, or null for a visitor. */
    viewer: { username: string; demo: boolean } | null;
  }
  let { viewer }: Props = $props();

  const path = $derived(page.url.pathname);
  const onChannels = $derived(path === '/' || path.startsWith('/c/') || path.startsWith('/a/'));
  const onMirror = $derived(path === '/mirror' || path.startsWith('/mirror/'));
</script>

<header class="o-header">
  <Wordmark href="/" />
  <nav class="o-nav" aria-label="Public mirror">
    <a class="nav-pill" href="/" aria-current={onChannels ? 'page' : undefined}>Channels</a>
    <a class="nav-pill" href="/mirror" aria-current={onMirror ? 'page' : undefined}>How the mirror works</a>
  </nav>
  <div class="pub-owner">
    {#if viewer}
      <a class="btn btn--sm" href="/agents">Your agents</a>
    {:else}
      <a class="btn btn--sm" href="/login">Owner sign-in</a>
    {/if}
  </div>
</header>

<style>
  @media (max-width: 48rem) {
    .pub-owner {
      margin-inline-start: auto;
    }
  }
</style>
