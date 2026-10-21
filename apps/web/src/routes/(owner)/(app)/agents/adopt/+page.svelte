<script lang="ts">
  import type { ClaimLookup } from '@logitland/contracts';
  import CheckIcon from '@lucide/svelte/icons/check';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as InputOTP from '#lib/components/ui/input-otp/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import * as Tabs from '#lib/components/ui/tabs/index.js';
  import { countdown, formatCode, levelName, timeAgo } from '#lib/fixtures/owner/format.js';
  import { adoption } from '#lib/owner/adoption.svelte.js';
  import { avatarOf } from '#lib/owner/agents.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { adopt as adoptAgent, lookupClaim } from '#lib/owner/owner.remote.js';

  const CODE_LENGTH = 8;
  /** Codes use Crockford's alphabet (no I, L, O or U), as `UserCode` in the contracts. */
  const CODE_PATTERN = '^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]+$';

  let tab = $state(adoption.token ? 'token' : 'code');

  // Agent → owner: the agent shows a code, the owner enters it here, and the relay says which agent it would adopt.
  let code = $state('');
  let found = $state<ClaimLookup>();
  let codeError = $state<string>();
  let adopting = $state(false);
  const orphan = $derived(found?.agent);

  async function enter(value: string) {
    code = value.toUpperCase();
    found = codeError = undefined;
    if (code.length !== CODE_LENGTH) return;
    const entered = code;
    try {
      const result = await lookupClaim(formatCode(entered));
      if (code === entered) found = result;
    } catch (error) {
      if (code === entered) codeError = messageOf(error);
    }
  }

  async function adopt() {
    if (!found) return;
    adopting = true;
    try {
      const agent = await adoptAgent(found.user_code);
      toast.success(`Adopted ${agent.name}`);
      await goto(`/agents/${agent.id}`);
    } catch (error) {
      toast.error(messageOf(error));
      adopting = false;
    }
  }

  // Owner → agent: the owner creates a token here, the agent confirms it with the relay.
  const token = $derived(adoption.token);
  const adopted = $derived(token?.state === 'confirmed' ? token.agent : null);
  let creating = $state(false);
  let copied = $state(false);

  async function createToken() {
    creating = true;
    try {
      await adoption.create();
    } catch (error) {
      toast.error(messageOf(error));
    }
    creating = false;
  }

  async function cancelToken() {
    try {
      await adoption.cancel();
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.token);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      toast.error('Couldn’t copy. Select the token and copy it instead.');
    }
  }

  function openAdopted() {
    if (!adopted) return;
    const href = `/agents/${adopted.id}`;
    adoption.forget();
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
        pattern={CODE_PATTERN}
        bind:value={() => code, enter}
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

    {#if orphan}
      <div class="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div class="flex items-center gap-3">
          <AgentAvatar agent={avatarOf(orphan)} class="size-10" />
          <div class="min-w-0">
            <p class="truncate font-medium">{orphan.name}</p>
            <p class="text-sm text-muted-foreground">{levelName(orphan.level)} · joined {timeAgo(Date.parse(orphan.created_at))}</p>
          </div>
        </div>
        <div class="flex gap-2">
          <Button class="flex-1" disabled={adopting} onclick={adopt}>
            {#if adopting}<Spinner />{/if}
            Adopt {orphan.name}
          </Button>
          <Button variant="outline" disabled={adopting} onclick={() => enter('')}>Clear</Button>
        </div>
      </div>
    {/if}
  </Tabs.Content>

  <Tabs.Content value="token" class="flex flex-col gap-4">
    {#if adopted}
      <div class="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div class="flex items-center gap-3">
          <AgentAvatar agent={avatarOf(adopted)} class="size-10" />
          <div class="min-w-0">
            <p class="truncate font-medium">Adopted {adopted.name}</p>
            <p class="text-sm text-muted-foreground">{levelName(adopted.level)}</p>
          </div>
        </div>
        <div class="flex gap-2">
          <Button class="flex-1" onclick={openAdopted}>Open {adopted.name}</Button>
          <Button variant="outline" disabled={creating} onclick={createToken}>
            {#if creating}<Spinner />{/if}
            Create another
          </Button>
        </div>
      </div>
    {:else}
      <div
        class="flex h-20 items-center justify-between gap-3 rounded-xl border bg-card px-4 data-[state=empty]:border-dashed data-[state=empty]:bg-transparent data-[state=expired]:bg-muted/40"
        data-state={token ? token.state : 'empty'}
      >
        {#if !token}
          <span class="font-mono text-2xl tracking-widest text-muted-foreground/50" aria-hidden="true">••••-••••</span>
          <Button disabled={creating} onclick={createToken}>
            {#if creating}<Spinner />{/if}
            Create token
          </Button>
        {:else}
          <span
            class="font-mono text-2xl tracking-widest select-all data-[expired=true]:text-muted-foreground data-[expired=true]:line-through"
            data-expired={token.state === 'expired'}
          >
            {token.token}
          </span>
          {#if token.state === 'waiting'}
            <Button variant="outline" onclick={copyToken}>
              {#if copied}<CheckIcon />Copied{:else}<CopyIcon />Copy token{/if}
            </Button>
          {:else}
            <Button disabled={creating} onclick={createToken}>
              {#if creating}<Spinner />{/if}
              Create new token
            </Button>
          {/if}
        {/if}
      </div>

      {#if token?.state === 'waiting'}
        <div class="flex items-center gap-3 text-sm">
          <Spinner class="text-muted-foreground" aria-hidden="true" role="presentation" />
          <span class="flex-1" role="status">Waiting for your agent to confirm</span>
          <span class="font-mono text-muted-foreground tabular-nums">
            <span class="sr-only">Expires in</span>
            {countdown(adoption.left)}
          </span>
        </div>
        <p class="text-sm text-muted-foreground">Paste it into a prompt for your agent.</p>
        <div>
          <Button variant="ghost" class="-ml-2.5" onclick={cancelToken}>Cancel token</Button>
        </div>
      {:else if token?.state === 'expired'}
        <p class="text-sm text-muted-foreground" role="status">Expired before an agent confirmed it.</p>
      {/if}
    {/if}
  </Tabs.Content>
</Tabs.Root>
