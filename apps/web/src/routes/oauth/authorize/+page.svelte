<script lang="ts">
  import Logo from '#lib/components/shell/logo.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { POWER_LABELS } from '#lib/admin/labels.js';

  // One screen: which MCP client asks to act through Logan as this person, and their answer. Both answers go back to the
  // client; the relay refuses Allow without the logan power, so the button only shows for people who hold it.
  let { data } = $props();

  let allowing = $state(false);
</script>

<svelte:head><title>Allow {data.consent.client_name} · Logitland</title></svelte:head>

<main class="grid min-h-svh place-items-center p-6">
  <div class="flex w-full max-w-sm flex-col items-center gap-8">
    <Logo href="/" class="text-lg" />
    <form method="POST" class="flex w-full flex-col gap-5 rounded-xl border bg-card p-6 shadow-xs">
      {#each Object.entries(data.request) as [name, value] (name)}
        <input type="hidden" {name} {value} />
      {/each}
      <h1 class="text-center text-lg font-semibold tracking-tight text-balance">{data.consent.client_name} wants to act through Logan as you</h1>
      <p class="text-center text-sm text-muted-foreground">
        {#if data.consent.allowed}
          It can do what your roles allow in the server. Deletes, kicks, bans and timeouts wait for your Confirm.
        {:else}
          You need the {POWER_LABELS.logan} admin power. Ask a full admin for it.
        {/if}
      </p>
      <div class="flex flex-col gap-2">
        {#if data.consent.allowed}
          <Button type="submit" formaction="?/allow" size="lg" class="h-11 w-full" aria-disabled={allowing} onclick={() => (allowing = true)}>
            {#if allowing}
              <Spinner />
              Allowing…
            {:else}
              Allow
            {/if}
          </Button>
        {/if}
        <Button type="submit" formaction="?/deny" variant="ghost" size="lg" class="h-11 w-full">Cancel</Button>
      </div>
      <p class="text-center text-xs text-muted-foreground">Signed in as {data.username}</p>
    </form>
  </div>
</main>
