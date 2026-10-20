<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Logo from '#lib/components/shell/logo.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  // The owner sign-in, signing in the fixture admin instead. One shared sign-in is the real design (#13).
  let signingIn = $state(false);

  // Only admin paths, so `next` can't send the admin elsewhere.
  const next = $derived.by(() => {
    const requested = page.url.searchParams.get('next');
    return requested && /^\/admin(\/|$)/.test(requested) ? requested : '/admin';
  });

  async function signIn() {
    signingIn = true;
    await admin.signIn();
    await goto(next, { replaceState: true });
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
