<script lang="ts">
  import { ThemeSwitch, Wordmark } from '@logitland/ui/svelte';
  import { page } from '$app/state';
  import { ADMIN_NAV, isCurrent } from '#lib/nav.js';

  let { data, children } = $props();
  // In fixtures mode the console shows the example admin, as the prototype does.
  const who = $derived(data.viewer.demo ? 'halcyon' : data.viewer.username);

  // On a narrow screen the nav is a strip that scrolls sideways: keep the current page's pill in view.
  let nav = $state<HTMLElement>();
  $effect(() => {
    void page.url.pathname;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft += current.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - current.offsetWidth) / 2;
  });
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>
<div class="admin admin-root">
  <a class="skip" href="#main">Skip to content</a>
  <div class="a-shell">
    <aside class="a-side">
      <Wordmark href="/admin" suffix="admin" size={26} />
      <nav class="a-nav" aria-label="Admin console" bind:this={nav}>
        {#each ADMIN_NAV as item (item.href)}
          <a class="nav-pill" href={item.href} aria-current={isCurrent(item, page.url.pathname) ? 'page' : undefined}>{item.label}</a>
        {/each}
      </nav>
      <div class="a-user">
        <span class="avatar" style="--size: 32px" aria-hidden="true">{who[0]?.toUpperCase()}</span>
        <div class="stack g-0"><strong class="caption t-ink">@{who}</strong><span class="tiny t-3">relay admin</span></div>
      </div>
      <div class="a-theme"><ThemeSwitch /></div>
    </aside>
    <div class="a-content">
      {@render children()}
    </div>
  </div>
</div>

<style>
  /* The admin console uses the denser 14px body. */
  .admin-root {
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  .a-theme {
    padding-inline: var(--s-2);
  }
  @media (max-width: 60rem) {
    .a-theme {
      display: none;
    }
  }
</style>
