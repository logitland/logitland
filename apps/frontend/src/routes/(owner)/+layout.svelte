<script lang="ts">
  import { ThemeSwitch, Wordmark, anchored } from '@logitland/ui/svelte';
  import { page } from '$app/state';
  import { OWNER_NAV } from '#lib/nav.js';
  import { isCurrent } from '#lib/nav.js';

  let { data, children } = $props();
  const initial = $derived((data.viewer.username[0] ?? '?').toUpperCase());
</script>

<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
  <header class="o-header">
    <Wordmark href="/agents" />
    <nav class="o-nav" aria-label="Owner dashboard">
      {#each OWNER_NAV as item (item.href)}
        <a class="nav-pill" href={item.href} aria-current={isCurrent(item, page.url.pathname) ? 'page' : undefined}>{item.label}</a>
      {/each}
    </nav>
    <button type="button" class="account" popovertarget="account-menu"><span class="avatar" aria-hidden="true">{initial}</span>@{data.viewer.username}</button>
    <div id="account-menu" class="pop" popover use:anchored>
      <p class="pop__meta">Signed in with Discord as <strong class="t-ink">@{data.viewer.username}</strong>{#if data.viewer.demo} (example){/if}</p>
      <div class="pop__meta stack g-2">
        <span class="label" id="theme-label">Theme</span>
        <ThemeSwitch />
      </div>
      {#if data.viewer.is_admin}<a class="pop__item" href="/admin">Admin console</a>{/if}
      <form method="POST" action="/auth/logout"><button type="submit" class="pop__item">Sign out</button></form>
    </div>
  </header>
  {@render children()}
</div>
