<!-- A 404 renders the theme's own not-found page inside its layout. -->
<script lang="ts">
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import SvartzRuntimePage from '@svartz/ui/runtime';
  import { prepareHostVault } from 'virtual:svartz/host';

  // Opening 404.html directly renders this page without the catchall's load, so the vault may not be prepared yet.
  const prepared = $derived(prepareHostVault(page.url.pathname.slice(base.length) || '/'));
</script>

{#if page.status === 404}
  {#await prepared then}
    <SvartzRuntimePage pathname={page.url.pathname} />
  {/await}
{:else}
  <h1>{page.status}</h1>
  <p>{page.error?.message}</p>
{/if}
