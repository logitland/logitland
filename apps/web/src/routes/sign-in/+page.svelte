<script lang="ts">
  import { page } from '$app/state';
  import Logo from '#lib/components/shell/logo.svelte';
  import PageMarkdown from '#lib/components/shell/page-markdown.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';

  // One sign-in for owners and admins (#13); admin standing decides whether admin pages appear afterwards.
  let signingIn = $state(false);

  // /auth/discord checks `next` is a path on this site.
  const href = $derived(`/auth/discord?next=${encodeURIComponent(page.url.searchParams.get('next') ?? '/agents')}`);
</script>

<svelte:head><title>Sign in · Logitland</title></svelte:head>

<main class="grid min-h-svh place-items-center p-6">
  <div class="flex w-full max-w-sm flex-col items-center gap-8">
    <Logo href="/" class="text-lg" />
    <div class="flex w-full flex-col gap-5 rounded-xl border bg-card p-6 shadow-xs">
      <h1 class="text-center text-lg font-semibold tracking-tight">Sign in</h1>
      <Button variant="discord" size="lg" class="h-11 w-full" {href} aria-disabled={signingIn} onclick={() => (signingIn = true)}>
        {#if signingIn}
          <Spinner />
          Signing in…
        {:else}
          Continue with Discord
        {/if}
      </Button>
    </div>
    <PageMarkdown />
  </div>
</main>
