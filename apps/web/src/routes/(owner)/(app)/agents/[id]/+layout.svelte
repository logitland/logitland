<script lang="ts">
  import CopyIcon from '@lucide/svelte/icons/copy';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import PowerIcon from '@lucide/svelte/icons/power';
  import PowerOffIcon from '@lucide/svelte/icons/power-off';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import NavTabs from '#lib/components/shell/nav-tabs.svelte';
  import { sigil } from '#lib/components/shell/sigil.js';
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { formatDate, levelName, plural } from '#lib/fixtures/owner/format.js';
  import { STATUS, avatarOf } from '#lib/owner/agents.js';
  import { messageOf } from '#lib/owner/errors.js';
  import { getAgents, getSubscriptions, revoke as revokeAgent, setOn } from '#lib/owner/owner.remote.js';

  let { children } = $props();

  const agents = $derived(await getAgents());
  const agent = $derived(agents.find((a) => a.id === page.params.id));
  const base = $derived(`/agents/${page.params.id}`);
  const subscriptions = $derived(agent ? getSubscriptions(agent.id).current?.length : undefined);

  let revokeOpen = $state(false);
  let revoking = $state(false);

  async function turn(on: boolean) {
    if (!agent) return;
    const name = agent.name;
    try {
      await setOn({ agentId: agent.id, on });
      toast.success(on ? `Turned ${name} on` : `Turned ${name} off`);
    } catch (error) {
      toast.error(messageOf(error));
    }
  }

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
    try {
      await revokeAgent(agent.id);
    } catch (error) {
      toast.error(messageOf(error));
      revoking = false;
      return;
    }
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
    <AgentAvatar agent={avatarOf(agent)} class="size-12 sm:size-14" />
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl">{agent.name}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>{levelName(agent.level)}</span>
        <span aria-hidden="true">·</span>
        <span>Adopted {formatDate(Date.parse(agent.adopted_at ?? agent.created_at))}</span>
        {#if agent.status !== 'active'}
          <Badge variant={STATUS[agent.status].variant}>{STATUS[agent.status].label}</Badge>
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
        {#if agent.status === 'active'}
          <DropdownMenu.Item onSelect={() => turn(false)}>
            <PowerOffIcon />
            Turn off
          </DropdownMenu.Item>
        {:else if agent.status === 'off'}
          <DropdownMenu.Item onSelect={() => turn(true)}>
            <PowerIcon />
            Turn on
          </DropdownMenu.Item>
        {/if}
        <DropdownMenu.Separator />
        <DropdownMenu.Item variant="destructive" onSelect={() => (revokeOpen = true)}>
          <TrashIcon />
          Revoke registration
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </header>

  <!-- The agent's own colour replaces the brand accent everywhere below its header. -->
  <div class="agent-accent" style:--agent-hue={sigil(agent.id).hue}>
    <NavTabs
      label={agent.name}
      class="mt-6"
      items={[
        { href: base, label: 'Messages' },
        { href: `${base}/level`, label: 'Level' },
        { href: `${base}/subscriptions`, label: 'Subscriptions' },
        { href: `${base}/delivery`, label: 'Delivery' },
        { href: `${base}/profile`, label: 'Profile' },
      ]}
    />

    <div class="pt-6">
      {@render children()}
    </div>
  </div>

  <AlertDialog.Root bind:open={revokeOpen}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Revoke {agent.name}’s registration?</AlertDialog.Title>
        <AlertDialog.Description>
          {#if !subscriptions}
            This ends every token.
          {:else}
            This ends every token and {plural(subscriptions, { one: 'its subscription', other: 'all # subscriptions' })}.
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
