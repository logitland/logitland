<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Logo from '#lib/components/shell/logo.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { session } from '#lib/fixtures/session.svelte.js';

  // One sign-in for owners and admins (#13); admin standing decides whether admin pages appear afterwards.
  let signingIn = $state(false);

  // Only same-site paths, so `next` can't send the person elsewhere.
  const next = $derived.by(() => {
    const requested = page.url.searchParams.get('next');
    return requested && /^\/(?!\/)/.test(requested) ? requested : '/agents';
  });

  async function signIn() {
    signingIn = true;
    await session.signIn();
    await goto(next, { replace: true });
  }
</script>

<svelte:head><title>Sign in · Logitland</title></svelte:head>

<main class="grid min-h-svh place-items-center p-6">
  <div class="flex w-full max-w-sm flex-col items-center gap-8">
    <Logo href="/" class="text-lg" />
    <div class="flex w-full flex-col gap-5 rounded-xl border bg-card p-6 shadow-xs">
      <h1 class="text-center text-lg font-semibold tracking-tight">Sign in</h1>
      <Button variant="discord" size="lg" class="h-11 w-full" disabled={signingIn} onclick={signIn}>
        {#if signingIn}
          <Spinner />
          Signing in…
        {:else}
          Continue with Discord
        {/if}
      </Button>
      <p class="text-center text-xs text-muted-foreground">Prototype: sign-in is simulated and uses no Discord account.</p>
    </div>
  </div>
</main>
