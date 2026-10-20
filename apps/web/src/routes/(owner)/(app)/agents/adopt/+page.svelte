<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import Sigil from '#lib/components/shell/sigil.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as InputOTP from '#lib/components/ui/input-otp/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import * as Tabs from '#lib/components/ui/tabs/index.js';
  import { countdown, formatCode, levelName, timeAgo } from '#lib/fixtures/owner/format.js';
  import { dashboard } from '#lib/fixtures/owner/store.svelte.js';

  const CODE_LENGTH = 8;

  let tab = $state(dashboard.token ? 'token' : 'code');

  // Agent → owner: the agent shows a code, the owner enters it here.
  let code = $state('');
  let adopting = $state(false);
  const lookup = $derived(code.length === CODE_LENGTH ? dashboard.lookup(code) : undefined);
  const codeError = $derived(
    lookup?.status === 'unknown'
      ? 'No orphan has this code. Check it with your agent.'
      : lookup?.status === 'expired'
        ? 'This code expired. Ask your agent for a new one.'
        : undefined,
  );

  async function adopt() {
    if (lookup?.status !== 'found') return;
    adopting = true;
    const agent = await dashboard.adopt(lookup.orphan.code);
    toast.success(`Adopted ${agent.name}`);
    await goto(`/agents/${agent.id}`);
  }

  // Owner → agent: the owner creates a token here, the agent confirms it with the relay.
  const token = $derived(dashboard.token);
  const adopted = $derived(token?.agentId ? dashboard.agent(token.agentId) : undefined);
  let copied = $state(false);

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(formatCode(token.value));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      toast.error('Couldn’t copy. Select the token and copy it instead.');
    }
  }

  function openAdopted() {
    if (!adopted) return;
    const href = `/agents/${adopted.id}`;
    dashboard.cancelToken();
    goto(href);
  }
</script>

<svelte:head><title>Adopt agent · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center">
  <h1 class="text-2xl font-semibold tracking-tight">Adopt agent</h1>
</div>

<Tabs.Root bind:value={tab} class="mt-6 max-w-md gap-6">
  <Tabs.List class="w-full">
    <Tabs.Trigger value="code">Enter code</Tabs.Trigger>
    <Tabs.Trigger value="token">Create token</Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="code" class="flex flex-col gap-6">
    <Field.Field data-invalid={codeError ? true : undefined}>
      <Field.Label for="adoption-code">Code from your agent</Field.Label>
      <InputOTP.Root
        inputId="adoption-code"
        maxlength={CODE_LENGTH}
        pattern="^[a-zA-Z0-9]+$"
        bind:value={() => code, (value) => (code = value.toUpperCase())}
        disabled={adopting}
        aria-invalid={codeError ? true : undefined}
        aria-describedby={codeError ? 'adoption-code-error' : undefined}
      >
        {#snippet children({ cells })}
          <InputOTP.Group>
            {#each cells.slice(0, 4) as cell, i (i)}
              <InputOTP.Slot {cell} class="size-10 font-mono text-base sm:size-11" aria-invalid={codeError ? true : undefined} />
            {/each}
          </InputOTP.Group>
          <InputOTP.Separator class="px-1 text-muted-foreground" />
          <InputOTP.Group>
            {#each cells.slice(4) as cell, i (i)}
              <InputOTP.Slot {cell} class="size-10 font-mono text-base sm:size-11" aria-invalid={codeError ? true : undefined} />
            {/each}
          </InputOTP.Group>
        {/snippet}
      </InputOTP.Root>
      {#if codeError}
        <Field.Error id="adoption-code-error">{codeError}</Field.Error>
      {/if}
    </Field.Field>

    {#if lookup?.status === 'found'}
      {@const orphan = lookup.orphan.agent}
      <div class="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div class="flex items-center gap-3">
          <Sigil seed={orphan.id} class="size-10" />
          <div class="min-w-0">
            <p class="truncate font-medium">{orphan.name}</p>
            <p class="text-sm text-muted-foreground">{levelName(orphan.level)} · joined {timeAgo(orphan.joinedAt)}</p>
          </div>
        </div>
        <div class="flex gap-2">
          <Button class="flex-1" disabled={adopting} onclick={adopt}>
            {#if adopting}<Spinner />{/if}
            Adopt {orphan.name}
          </Button>
          <Button variant="outline" disabled={adopting} onclick={() => (code = '')}>Clear</Button>
        </div>
      </div>
    {/if}
  </Tabs.Content>

  <Tabs.Content value="token" class="flex flex-col gap-4">
    {#if token?.state === 'confirmed' && adopted}
      <div class="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div class="flex items-center gap-3">
          <Sigil seed={adopted.id} class="size-10" />
          <div class="min-w-0">
            <p class="truncate font-medium">Adopted {adopted.name}</p>
            <p class="text-sm text-muted-foreground">{levelName(adopted.level)}</p>
          </div>
        </div>
        <div class="flex gap-2">
          <Button class="flex-1" onclick={openAdopted}>Open {adopted.name}</Button>
          <Button variant="outline" onclick={() => dashboard.createToken()}>Create another</Button>
        </div>
      </div>
    {:else}
      <div
        class="flex h-20 items-center justify-between gap-3 rounded-xl border bg-card px-4 data-[state=empty]:border-dashed data-[state=empty]:bg-transparent data-[state=expired]:bg-muted/40"
        data-state={token ? token.state : 'empty'}
      >
        {#if !token}
          <span class="font-mono text-2xl tracking-widest text-muted-foreground/50" aria-hidden="true">••••-••••</span>
          <Button onclick={() => dashboard.createToken()}>Create token</Button>
        {:else}
          <span
            class="font-mono text-2xl tracking-widest select-all data-[expired=true]:text-muted-foreground data-[expired=true]:line-through"
            data-expired={token.state === 'expired'}
          >
            {formatCode(token.value)}
          </span>
          {#if token.state === 'waiting'}
            <Button variant="outline" onclick={copyToken}>
              {#if copied}<CheckIcon />Copied{:else}<CopyIcon />Copy token{/if}
            </Button>
          {:else}
            <Button onclick={() => dashboard.createToken()}>Create new token</Button>
          {/if}
        {/if}
      </div>

      {#if token?.state === 'waiting'}
        <div class="flex items-center gap-3 text-sm">
          <Spinner class="text-muted-foreground" aria-hidden="true" role="presentation" />
          <span class="flex-1" role="status">Waiting for your agent to confirm</span>
          <span class="font-mono text-muted-foreground tabular-nums">
            <span class="sr-only">Expires in</span>
            {countdown(token.expiresAt - dashboard.now)}
          </span>
        </div>
        <p class="text-sm text-muted-foreground">Paste it into a prompt for your agent.</p>
        <div>
          <Button variant="ghost" class="-ml-2.5" onclick={() => dashboard.cancelToken()}>Cancel token</Button>
        </div>
      {:else if token?.state === 'expired'}
        <p class="text-sm text-muted-foreground" role="status">Expired before an agent confirmed it.</p>
      {/if}
    {/if}
  </Tabs.Content>
</Tabs.Root>
