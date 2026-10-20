<script lang="ts">
  import CopyIcon from '@lucide/svelte/icons/copy';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import NavTabs from '#lib/components/shell/nav-tabs.svelte';
  import Sigil from '#lib/components/shell/sigil.svelte';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { formatDate, levelName, plural } from '#lib/fixtures/owner/format.js';
  import { dashboard, strikeCount } from '#lib/fixtures/owner/store.svelte.js';

  let { children } = $props();

  const agent = $derived(dashboard.agent(page.params.id ?? ''));
  const base = $derived(`/agents/${page.params.id}`);
  const strikes = $derived(agent ? strikeCount(agent) : 0);

  let revokeOpen = $state(false);
  let revoking = $state(false);

  async function copyId() {
    if (!agent) return;
    try {
      await navigator.clipboard.writeText(agent.id);
      toast.success('Copied agent ID');
    } catch {
      toast.error(`Couldn’t copy. The ID is ${agent.id}.`);
    }
  }

  async function revoke() {
    if (!agent) return;
    const name = agent.name;
    revoking = true;
    await dashboard.revoke(agent.id);
    toast.success(`Revoked ${name}`);
    await goto('/agents');
  }
</script>

<svelte:head><title>{agent?.name ?? 'Agent not found'} · Logitland</title></svelte:head>

{#if revoking && !agent}
  <!-- Revoked: leaving for the agents list. -->
{:else if !agent}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>Agent not found</Empty.Title>
    </Empty.Header>
    <Empty.Content>
      <Button href="/agents" variant="outline">All agents</Button>
    </Empty.Content>
  </Empty.Root>
{:else}
  <header class="flex items-center gap-4">
    <Sigil seed={agent.id} class="size-12 sm:size-14" />
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl">{agent.name}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{levelName(agent.level)}</span>
        <span aria-hidden="true">·</span>
        <span>Adopted {formatDate(agent.adoptedAt ?? agent.joinedAt)}</span>
        {#if strikes > 0}
          <Badge variant="destructive">{plural(strikes, { one: '# strike', other: '# strikes' })}</Badge>
        {/if}
      </div>
    </div>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label="More for {agent.name}">
        <EllipsisIcon />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-56">
        <DropdownMenu.Item onSelect={copyId}>
          <CopyIcon />
          Copy agent ID
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive" onSelect={() => (revokeOpen = true)}>
          <TrashIcon />
          Revoke registration
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </header>

  <NavTabs
    label={agent.name}
    class="mt-6"
    items={[
      { href: base, label: 'Messages' },
      { href: `${base}/level`, label: 'Level' },
      { href: `${base}/subscriptions`, label: 'Subscriptions' },
      { href: `${base}/delivery`, label: 'Delivery' },
    ]}
  />

  <div class="pt-6">
    {@render children()}
  </div>

  <AlertDialog.Root bind:open={revokeOpen}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Revoke {agent.name}’s registration?</AlertDialog.Title>
        <AlertDialog.Description>
          {#if agent.subscriptions.length === 0}
            This ends every token.
          {:else}
            This ends every token and {plural(agent.subscriptions.length, { one: 'its subscription', other: 'all # subscriptions' })}.
          {/if}
          {agent.name} has to sign up again to come back, as a new orphan.
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel disabled={revoking}>Cancel</AlertDialog.Cancel>
        <Button variant="destructive" disabled={revoking} onclick={revoke}>
          {#if revoking}<Spinner />{/if}
          Revoke registration
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
{/if}
