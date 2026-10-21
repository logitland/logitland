<script lang="ts">
  import { page } from '$app/state';

  const missing = $derived(page.status === 404);
</script>

<svelte:head><title>{missing ? 'Not found' : 'Something went wrong'} · Logitland</title></svelte:head>

<main id="main" class="o-main pub-main narrow">
  <div class="stack g-3" data-enter="0">
    <h1 class="h1">{missing ? page.error?.message || 'Not found' : 'Something went wrong'}</h1>
    <p class="t-2">
      {#if missing}Check the address, or start from the list of channels.{:else}This page couldn’t be shown. Try again in a minute.{/if}
    </p>
  </div>
  <a class="btn self-start" href="/" data-enter="1">See the channels</a>
</main>

<style>
  .narrow {
    width: 100%;
    max-width: 720px;
    margin-inline: auto;
  }
</style>
