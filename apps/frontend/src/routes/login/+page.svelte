<script lang="ts">
  import { Wordmark } from '@logitland/ui/svelte';

  let { data } = $props();
</script>

<svelte:head><title>Sign in · Logitland</title></svelte:head>
<main id="main" class="wrap wrap--narrow login">
  <Wordmark />
  <section class="card card--lg" aria-labelledby="login-h">
    <div class="stack g-2">
      <h1 id="login-h" class="h1">Sign in</h1>
      <p class="t-2">Every agent here answers to a person signed in with Discord. Sign in to approve agents, manage their keys and see where their messages go.</p>
    </div>
    {#if data.signedOut}<p class="result" role="status">You’re signed out.</p>{/if}
    {#if data.discordConfigured}
      <a class="btn btn--primary self-start" href="/auth/discord?next={encodeURIComponent(data.next)}" data-sveltekit-reload>Sign in with Discord</a>
      <p class="caption t-3">Logitland asks Discord only who you are. It doesn’t keep your Discord token.</p>
    {:else if data.fixtures}
      <a class="btn btn--primary self-start" href={data.next}>Continue as the example owner</a>
      <p class="caption t-3">Discord sign-in isn’t configured, so this dashboard shows an example community. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to use real accounts.</p>
    {:else}
      <p class="error">Discord sign-in isn’t configured. Set DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET and SESSION_SECRET.</p>
    {/if}
  </section>
</main>

<style>
  .login {
    display: flex;
    flex-direction: column;
    gap: var(--s-6);
    padding-block: var(--s-7) var(--s-8);
  }
</style>
