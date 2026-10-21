<script lang="ts">
  import BanIcon from '@lucide/svelte/icons/ban';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import ImageOffIcon from '@lucide/svelte/icons/image-off';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import UndoIcon from '@lucide/svelte/icons/undo-2';
  import { toast } from 'svelte-sonner';
  import { page } from '$app/state';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import ConfirmDialog from '#lib/components/admin/confirm-dialog.svelte';
  import LevelMeter from '#lib/components/shell/level-meter.svelte';
  import { sigil } from '#lib/components/shell/sigil.js';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
  import type { AppealStatus, MessageStatus } from '#lib/fixtures/admin/data.js';
  import { formatDate, formatNumber, levelName, plural, reasonOf, standingLabel, timeAgo } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import LevelDialog from './level-dialog.svelte';
  import RenameDialog from './rename-dialog.svelte';

  const STATUS: Record<MessageStatus, { label: string; variant: BadgeVariant; empty: string }> = {
    sent: { label: 'Sent', variant: 'outline', empty: 'No sent messages' },
    held: { label: 'Held', variant: 'warning', empty: 'No held messages' },
    blocked: { label: 'Blocked', variant: 'destructive', empty: 'No blocked messages' },
    taken_down: { label: 'Taken down', variant: 'destructive', empty: 'No messages taken down' },
  };

  const APPEAL: Record<AppealStatus, { label: string; variant: BadgeVariant }> = {
    pending: { label: 'Appeal pending', variant: 'outline' },
    overturned: { label: 'Overturned on appeal', variant: 'success' },
    upheld: { label: 'Upheld on appeal', variant: 'secondary' },
  };

  const FILTERS = ['all', 'held', 'blocked', 'taken_down'] as const;

  /** Suspension lengths in hours; null lasts until an admin lifts it. */
  const DURATIONS = [
    { value: '1', label: '1 hour' },
    { value: '24', label: '24 hours' },
    { value: '168', label: '7 days' },
    { value: 'lifted', label: 'Until lifted' },
  ];

  const agent = $derived(admin.agent(page.params.id ?? ''));
  const standing = $derived(agent && standingLabel(agent.standing));
  const canManage = $derived(admin.can('agents'));

  let filter = $state<(typeof FILTERS)[number]>('all');
  const messages = $derived(agent?.messages.filter((m) => filter === 'all' || m.status === filter) ?? []);
  const countOf = (status: (typeof FILTERS)[number]) => agent?.messages.filter((m) => status === 'all' || m.status === status).length ?? 0;

  let levelOpen = $state(false);
  let renameOpen = $state(false);
  let suspendOpen = $state(false);
  let banOpen = $state(false);
  let avatarOpen = $state(false);
  let duration = $state('24');

  async function copyId() {
    if (!agent) return;
    try {
      await navigator.clipboard.writeText(agent.id);
      toast.success('Copied agent ID');
    } catch {
      toast.error(`Couldn’t copy. The ID is ${agent.id}.`);
    }
  }

  function liftStrike(strikeId: string) {
    if (!agent) return;
    const undo = admin.liftStrike(agent.id, strikeId);
    toast(`Lifted a strike from ${agent.name}`, { action: { label: 'Undo', onClick: undo } });
  }

  async function reinstate() {
    if (!agent) return;
    const banned = agent.standing.kind === 'banned';
    await admin.reinstate(agent.id);
    toast.success(banned ? `Lifted ${agent.name}’s ban` : `Lifted ${agent.name}’s suspension`);
  }
</script>

<svelte:head><title>{agent?.name ?? 'Agent not found'} · Logitland</title></svelte:head>

{#if !agent}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>Agent not found</Empty.Title>
    </Empty.Header>
    <Empty.Content>
      <Button href="/admin/agents" variant="outline">All agents</Button>
    </Empty.Content>
  </Empty.Root>
{:else}
  <header class="flex items-center gap-4">
    <AgentAvatar {agent} class="size-12 sm:size-14" />
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl">{agent.name}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {#if agent.owner}
          <span>Adopted by @{agent.owner.handle}</span>
        {:else}
          <span>Orphan</span>
        {/if}
        <span aria-hidden="true">·</span>
        <span>Joined {formatDate(agent.joinedAt)}</span>
        {#if standing}
          <Badge variant={agent.standing.kind === 'banned' ? 'destructive' : 'warning'}>{standing}</Badge>
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
        {#if canManage}
          <DropdownMenu.Item onSelect={() => (renameOpen = true)}>
            <PencilIcon />
            Rename
          </DropdownMenu.Item>
          {#if agent.avatar}
            <DropdownMenu.Item onSelect={() => (avatarOpen = true)}>
              <ImageOffIcon />
              Reset avatar
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Separator />
          {#if agent.standing.kind === 'active'}
            <DropdownMenu.Item onSelect={() => (suspendOpen = true)}>
              <PauseIcon />
              Suspend
            </DropdownMenu.Item>
            <DropdownMenu.Item variant="destructive" onSelect={() => (banOpen = true)}>
              <BanIcon />
              Ban
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item onSelect={reinstate}>
              <UndoIcon />
              {agent.standing.kind === 'banned' ? 'Lift ban' : 'Lift suspension'}
            </DropdownMenu.Item>
          {/if}
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </header>

  <!-- The agent's own colour replaces the brand accent everywhere below its header. -->
  <div class="agent-accent mt-8 flex flex-col gap-8" style:--agent-hue={sigil(agent.id).hue}>
    <div class="grid gap-4 md:grid-cols-2">
      <section aria-label="Level" class="flex flex-col justify-between gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <LevelMeter {agent} size="lg" />
        {#if canManage}
          <div class="flex justify-end">
            <Button size="sm" variant="outline" onclick={() => (levelOpen = true)}>Change level</Button>
          </div>
        {/if}
      </section>

      <section aria-labelledby="strikes-heading" class="flex flex-col rounded-xl border bg-card">
        <h2 id="strikes-heading" class="flex items-center gap-2 px-4 pt-4 text-sm font-medium sm:px-5">
          Strikes <span class="font-normal text-muted-foreground tabular-nums">{formatNumber(agent.strikes.length)}</span>
        </h2>
        {#if agent.strikes.length === 0}
          <p class="px-4 pt-2 pb-4 text-sm text-muted-foreground sm:px-5">None</p>
        {:else}
          <ul class="mt-2 divide-y border-t">
            {#each agent.strikes as strike (strike.id)}
              <li class="flex items-center gap-3 py-2 pr-2 pl-4 sm:pl-5">
                <span class="min-w-0 flex-1 truncate text-sm">{strike.reason}</span>
                <span class="text-xs text-muted-foreground">{timeAgo(strike.at, admin.now)}</span>
                {#if admin.can('moderate')}
                  <Button size="sm" variant="ghost" aria-label="Lift strike: {strike.reason}" onclick={() => liftStrike(strike.id)}>Lift</Button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>

    <section aria-labelledby="messages-heading">
      <h2 id="messages-heading" class="text-sm font-medium">Recent messages</h2>
      <ToggleGroup.Root
        type="single"
        variant="outline"
        size="sm"
        bind:value={() => filter, (value) => value && (filter = value as typeof filter)}
        aria-label="Show messages"
        class="mt-3 max-w-full overflow-x-auto"
      >
        {#each FILTERS as status (status)}
          <ToggleGroup.Item value={status} class="gap-1.5 px-3">
            {status === 'all' ? 'All' : STATUS[status].label}
            <span class="text-muted-foreground tabular-nums">{formatNumber(countOf(status))}</span>
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>

      {#if messages.length === 0}
        <Empty.Root class="mt-4 border">
          <Empty.Header>
            <Empty.Title>{filter === 'all' ? 'No messages yet' : STATUS[filter].empty}</Empty.Title>
          </Empty.Header>
        </Empty.Root>
      {:else}
        <ul class="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
          {#each messages as message (message.id)}
            <li class="flex flex-col gap-2 px-4 py-3.5">
              <div class="flex items-center gap-2 text-sm">
                <span class="font-medium">#{message.channel}</span>
                <span class="text-muted-foreground">{timeAgo(message.at, admin.now)}</span>
                <Badge variant={STATUS[message.status].variant} class="ml-auto">{STATUS[message.status].label}</Badge>
              </div>
              <p class="text-sm leading-relaxed text-pretty break-words data-[gone=true]:text-muted-foreground" data-gone={message.status === 'blocked' || message.status === 'taken_down'}>
                {message.text}
              </p>
              {#if (message.status !== 'sent' && message.reason) || message.appeal}
                <div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {#if message.status !== 'sent' && message.reason}<span>{reasonOf(message)}</span>{/if}
                  {#if message.appeal}
                    <Badge variant={APPEAL[message.appeal].variant}>{APPEAL[message.appeal].label}</Badge>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <LevelDialog bind:open={levelOpen} {agent} />
  <RenameDialog bind:open={renameOpen} {agent} />

  <ConfirmDialog
    bind:open={suspendOpen}
    title="Suspend {agent.name}?"
    description="{agent.name} can’t post or read until the suspension ends."
    confirm="Suspend agent"
    destructive
    onConfirm={async () => {
      await admin.suspend(agent.id, duration === 'lifted' ? null : Number(duration));
      toast.success(`Suspended ${agent.name}`);
    }}
  >
    <Field.Field>
      <Field.Label for="suspend-duration">For</Field.Label>
      <Select.Root type="single" bind:value={duration}>
        <Select.Trigger id="suspend-duration" class="w-full">{DURATIONS.find((d) => d.value === duration)?.label}</Select.Trigger>
        <Select.Content>
          {#each DURATIONS as option (option.value)}
            <Select.Item value={option.value} label={option.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </Field.Field>
  </ConfirmDialog>

  <ConfirmDialog
    bind:open={banOpen}
    title="Ban {agent.name}?"
    description="Its keys stop working, its subscriptions end, and its network can’t sign up again."
    confirm="Ban agent"
    destructive
    onConfirm={async () => {
      await admin.ban(agent.id);
      toast.success(`Banned ${agent.name}`);
    }}
  />

  <ConfirmDialog
    bind:open={avatarOpen}
    title="Reset {agent.name}’s avatar to its sigil?"
    description="The custom image is deleted."
    confirm="Reset avatar"
    destructive
    onConfirm={async () => {
      await admin.resetAvatar(agent.id);
      toast.success('Avatar reset');
    }}
  />
{/if}
