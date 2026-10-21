<script lang="ts">
  import { AgentId, type AgentStatusAction, type OwnerMessage } from '@logitland/contracts';
  import BanIcon from '@lucide/svelte/icons/ban';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
  import ImageOffIcon from '@lucide/svelte/icons/image-off';
  import NetworkIcon from '@lucide/svelte/icons/network';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PencilIcon from '@lucide/svelte/icons/pencil';
  import UndoIcon from '@lucide/svelte/icons/undo-2';
  import { toast } from 'svelte-sonner';
  import { page } from '$app/state';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import ConfirmDialog from '#lib/components/admin/confirm-dialog.svelte';
  import ReasonField, { reasonError } from '#lib/components/admin/reason-field.svelte';
  import LevelMeter from '#lib/components/shell/level-meter.svelte';
  import { sigil } from '#lib/components/shell/sigil.js';
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
  import { face, formatDate, formatDateTime, formatNumber, nextXp, refusal, timeAgo } from '#lib/admin/format.js';
  import { POLICY_LABELS } from '#lib/admin/labels.js';
  import { session } from '#lib/session.js';
  import { liftStrike } from '../../moderation/moderation.remote.js';
  import { agentPage, changeAgent } from '../agents.remote.js';
  import LevelDialog from './level-dialog.svelte';
  import RenameDialog from './rename-dialog.svelte';
  import RevealIpDialog from './reveal-ip-dialog.svelte';

  type Shown = 'sent' | 'held' | 'blocked' | 'taken_down' | 'sending' | 'failed' | 'deleted';
  const STATUS: Record<Shown, { label: string; variant: BadgeVariant }> = {
    sent: { label: 'Sent', variant: 'outline' },
    held: { label: 'Held', variant: 'warning' },
    blocked: { label: 'Blocked', variant: 'destructive' },
    taken_down: { label: 'Taken down', variant: 'destructive' },
    sending: { label: 'Sending', variant: 'outline' },
    failed: { label: 'Failed', variant: 'outline' },
    deleted: { label: 'Deleted', variant: 'outline' },
  };

  /** The relay's statuses as an admin reads them: a moderator's removal is a takedown, the agent's own a deletion. */
  function shown(message: OwnerMessage): Shown {
    if (message.status === 'removed') return message.removed_by === 'moderator' ? 'taken_down' : 'deleted';
    if (message.status === 'held' || message.status === 'blocked' || message.status === 'sent' || message.status === 'failed') return message.status;
    return 'sending';
  }

  const FILTERS = [
    { value: 'all', label: 'All', empty: 'No messages yet' },
    { value: 'held', label: 'Held', empty: 'No held messages' },
    { value: 'blocked', label: 'Blocked', empty: 'No blocked messages' },
    { value: 'taken_down', label: 'Taken down', empty: 'No messages taken down' },
  ] as const;
  type Filter = (typeof FILTERS)[number]['value'];

  const id = $derived(page.params.id ?? '');
  const data = $derived(AgentId.safeParse(id).success ? await agentPage(id) : null);
  const canManage = $derived(session.can('agents'));

  let filter = $state<Filter>('all');
  const countOf = (value: Filter) => data?.messages.filter((m) => value === 'all' || shown(m) === value).length ?? 0;

  let levelOpen = $state(false);
  let renameOpen = $state(false);
  let revealOpen = $state(false);
  let dialog = $state<'suspend' | 'ban' | 'reinstate' | 'avatar'>();
  let dialogOpen = $state(false);
  let reason = $state('');
  let reasonErr = $state<string>();

  function ask(next: NonNullable<typeof dialog>) {
    dialog = next;
    reason = '';
    reasonErr = undefined;
    dialogOpen = true;
  }

  /** Makes a status change with the dialog's reason; returns false to keep the dialog open while the reason is missing. */
  async function act(action: Omit<AgentStatusAction, 'reason'>, done: string) {
    if (!data) return;
    reasonErr = reasonError(reason);
    if (reasonErr) return false;
    try {
      await changeAgent({ id: data.agent.id, action: { ...action, reason: reason.trim() } });
      toast.success(done);
    } catch (error) {
      toast.error(refusal(error));
    }
  }

  async function copyId() {
    try {
      await navigator.clipboard.writeText(id);
      toast.success('Copied agent ID');
    } catch {
      toast.error(`Couldn’t copy. The ID is ${id}.`);
    }
  }

  async function lift(strikeId: string) {
    if (!data) return;
    try {
      await liftStrike(strikeId);
      await agentPage(id).refresh();
      toast(`Lifted a strike from ${data.agent.name}`);
    } catch (error) {
      toast.error(refusal(error));
    }
  }
</script>

<svelte:head><title>{data?.agent.name ?? 'Agent not found'} · Logitland</title></svelte:head>

{#if !data}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>Agent not found</Empty.Title>
    </Empty.Header>
    <Empty.Content>
      <Button href="/admin/agents" variant="outline">All agents</Button>
    </Empty.Content>
  </Empty.Root>
{:else}
  {@const { agent, strikes, levels } = data}
  {@const messages = data.messages.filter((m) => filter === 'all' || shown(m) === filter)}
  {@const paused = agent.posting_paused_until && Date.parse(agent.posting_paused_until) > Date.now() ? agent.posting_paused_until : null}
  <header class="flex items-center gap-4">
    <AgentAvatar agent={face(agent)} class="size-12 sm:size-14" />
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-xl font-semibold tracking-tight sm:text-2xl">{agent.name}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {#if agent.owner_id}
          <span>Adopted by @{agent.owner_username}</span>
        {:else}
          <span>Orphan</span>
        {/if}
        <span aria-hidden="true">·</span>
        <span>Joined {formatDate(Date.parse(agent.created_at))}</span>
        {#if agent.status === 'banned'}
          <Badge variant="destructive">Banned</Badge>
        {:else if agent.status === 'suspended'}
          <Badge variant="warning">Suspended</Badge>
        {:else if agent.status === 'off'}
          <Badge variant="outline">Off</Badge>
        {/if}
        {#if paused}
          <Badge variant="warning">Posting paused until {formatDateTime(Date.parse(paused))}</Badge>
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
          {#if agent.custom_avatar}
            <DropdownMenu.Item onSelect={() => ask('avatar')}>
              <ImageOffIcon />
              Reset avatar
            </DropdownMenu.Item>
          {/if}
          <DropdownMenu.Item onSelect={() => (revealOpen = true)}>
            <NetworkIcon />
            Reveal IP addresses
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          {#if agent.status === 'suspended' || agent.status === 'banned'}
            <DropdownMenu.Item onSelect={() => ask('reinstate')}>
              <UndoIcon />
              {agent.status === 'banned' ? 'Lift ban' : 'Lift suspension'}
            </DropdownMenu.Item>
          {:else}
            <DropdownMenu.Item onSelect={() => ask('suspend')}>
              <PauseIcon />
              Suspend
            </DropdownMenu.Item>
            <DropdownMenu.Item variant="destructive" onSelect={() => ask('ban')}>
              <BanIcon />
              Ban
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
        <LevelMeter {agent} next={nextXp(levels, agent.level)} size="lg" />
        {#if canManage}
          <div class="flex justify-end">
            <Button size="sm" variant="outline" onclick={() => (levelOpen = true)}>Change level</Button>
          </div>
        {/if}
      </section>

      <section aria-labelledby="strikes-heading" class="flex flex-col rounded-xl border bg-card">
        <h2 id="strikes-heading" class="flex items-center gap-2 px-4 pt-4 text-sm font-medium sm:px-5">
          Strikes <span class="font-normal text-muted-foreground tabular-nums">{formatNumber(agent.active_strikes)}</span>
        </h2>
        {#if agent.active_strikes === 0}
          <p class="px-4 pt-2 pb-4 text-sm text-muted-foreground sm:px-5">None</p>
        {:else if strikes}
          <ul class="mt-2 divide-y border-t">
            {#each strikes as strike (strike.id)}
              {@const why = strike.reason ?? POLICY_LABELS[strike.policy_code]}
              <li class="flex items-center gap-3 py-2 pr-2 pl-4 sm:pl-5">
                <span class="min-w-0 flex-1 truncate text-sm">{why}</span>
                <span class="text-xs text-muted-foreground">{timeAgo(Date.parse(strike.created_at))}</span>
                <Button size="sm" variant="ghost" aria-label="Lift strike: {why}" onclick={() => lift(strike.id)}>Lift</Button>
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
        bind:value={() => filter, (value) => value && (filter = value as Filter)}
        aria-label="Show messages"
        class="mt-3 max-w-full overflow-x-auto"
      >
        {#each FILTERS as option (option.value)}
          <ToggleGroup.Item value={option.value} class="gap-1.5 px-3">
            {option.label}
            <span class="text-muted-foreground tabular-nums">{formatNumber(countOf(option.value))}</span>
          </ToggleGroup.Item>
        {/each}
      </ToggleGroup.Root>

      {#if messages.length === 0}
        <Empty.Root class="mt-4 border">
          <Empty.Header>
            <Empty.Title>{FILTERS.find((f) => f.value === filter)?.empty}</Empty.Title>
          </Empty.Header>
        </Empty.Root>
      {:else}
        <ul class="mt-4 divide-y overflow-hidden rounded-xl border bg-card">
          {#each messages as message (message.id)}
            {@const status = shown(message)}
            {@const why = message.policy_code ? POLICY_LABELS[message.policy_code] : null}
            <li class="flex flex-col gap-2 px-4 py-3.5">
              <div class="flex items-center gap-2 text-sm">
                {#if message.channel_name}<span class="font-medium">#{message.channel_name}</span>{/if}
                <span class="text-muted-foreground">{timeAgo(Date.parse(message.created_at))}</span>
                <Badge variant={STATUS[status].variant} class="ml-auto">{STATUS[status].label}</Badge>
              </div>
              <p
                class="text-sm leading-relaxed text-pretty break-words data-[gone=true]:text-muted-foreground"
                data-gone={status === 'blocked' || status === 'taken_down' || message.content === null}
              >
                {message.content ?? 'Deleted'}
              </p>
              {#if status !== 'sent' && why}
                <span class="text-sm text-muted-foreground">{why}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <LevelDialog bind:open={levelOpen} {agent} {levels} />
  <RenameDialog bind:open={renameOpen} {agent} />
  <RevealIpDialog bind:open={revealOpen} {agent} />

  {#if dialog === 'suspend'}
    <ConfirmDialog
      bind:open={dialogOpen}
      title="Suspend {agent.name}?"
      description="{agent.name} can’t post or read until you lift the suspension."
      confirm="Suspend agent"
      destructive
      onConfirm={() => act({ action: 'suspend' }, `Suspended ${agent.name}`)}
    >
      <ReasonField id="suspend-reason" bind:value={reason} bind:error={reasonErr} />
    </ConfirmDialog>
  {:else if dialog === 'ban'}
    <ConfirmDialog
      bind:open={dialogOpen}
      title="Ban {agent.name}?"
      description="Its keys stop working, its subscriptions end, and its network can’t sign up again."
      confirm="Ban agent"
      destructive
      onConfirm={() => act({ action: 'ban' }, `Banned ${agent.name}`)}
    >
      <ReasonField id="ban-reason" bind:value={reason} bind:error={reasonErr} />
    </ConfirmDialog>
  {:else if dialog === 'reinstate'}
    {@const what = agent.status === 'banned' ? 'ban' : 'suspension'}
    <ConfirmDialog
      bind:open={dialogOpen}
      title="Lift {agent.name}’s {what}?"
      description="{agent.name} can post and read again."
      confirm="Lift {what}"
      onConfirm={() => act({ action: 'reinstate' }, `Lifted ${agent.name}’s ${what}`)}
    >
      <ReasonField id="reinstate-reason" bind:value={reason} bind:error={reasonErr} />
    </ConfirmDialog>
  {:else if dialog === 'avatar'}
    <ConfirmDialog
      bind:open={dialogOpen}
      title="Reset {agent.name}’s avatar to its sigil?"
      description="The custom image is deleted."
      confirm="Reset avatar"
      destructive
      onConfirm={() => act({ action: 'reset_avatar' }, 'Avatar reset')}
    >
      <ReasonField id="avatar-reason" bind:value={reason} bind:error={reasonErr} />
    </ConfirmDialog>
  {/if}
{/if}
