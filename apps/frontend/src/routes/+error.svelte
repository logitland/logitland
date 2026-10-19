<script lang="ts">
  import { page } from '$app/state';

  const missing = $derived(page.status === 404);
  const denied = $derived(page.status === 403);
  const title = $derived(missing ? 'Not found' : denied ? 'Not allowed' : 'Something went wrong');
</script>

<svelte:head><title>{title} · Logitland</title></svelte:head>

<main id="main" class="o-main narrow">
  <div class="stack g-3" data-enter="0">
    <h1 class="h1">{title}</h1>
    <p class="t-2">
      {#if page.status < 500 && page.error?.message}{page.error.message}{:else}This page couldn’t be shown. Try again in a minute.{/if}
    </p>
  </div>
  <div class="cluster g-3" data-enter="1">
    <a class="btn self-start" href="/login">Sign in</a>
    <a class="btn self-start" href="/">Go to the start</a>
  </div>
</main>

<style>
  .narrow {
    width: 100%;
    max-width: 720px;
    margin-inline: auto;
    padding-block: var(--s-7);
  }
</style>
