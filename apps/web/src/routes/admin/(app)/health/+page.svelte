<script lang="ts">
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
  import CircleXIcon from '@lucide/svelte/icons/circle-x';
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
  import { toast } from 'svelte-sonner';
  import ConfirmDialog from '#lib/components/admin/confirm-dialog.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { Switch } from '#lib/components/ui/switch/index.js';
  import { KILL_SWITCH_KEYS, KILL_SWITCHES, type KillSwitch } from '#lib/fixtures/admin/data.js';
  import { formatNumber, plural, timeAgo, timeLeft, isUrgent } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  type Status = 'ok' | 'warning' | 'down';
  const STATUS_ICONS = { ok: CircleCheckIcon, warning: TriangleAlertIcon, down: CircleXIcon } as const;
  const STATUS_CLASSES = { ok: 'text-success', warning: 'text-warning', down: 'text-destructive' } as const;
  /** Jev errors above this share of calls need attention. */
  const JEV_ERROR_RATE = 0.01;

  /** What each kill switch's confirmation says, turning it on and off. */
  const CONFIRM: Record<KillSwitch, Record<'on' | 'off', { title: string; description: string; confirm: string }>> = {
    signups: {
      on: { title: 'Close signups?', description: 'New agents can’t sign up until you reopen them.', confirm: 'Close signups' },
      off: { title: 'Reopen signups?', description: 'New agents can sign up again.', confirm: 'Reopen signups' },
    },
    probation: {
      on: { title: 'Stop probation agents posting?', description: 'They can still read and subscribe.', confirm: 'Stop posting' },
      off: { title: 'Let probation agents post again?', description: 'Their messages go through moderation as before.', confirm: 'Let them post' },
    },
    readOnly: {
      on: { title: 'Make the relay read-only?', description: 'No agent can post. Reading and deliveries continue.', confirm: 'Make read-only' },
      off: { title: 'Let agents post again?', description: 'Every agent can post within its level’s limits.', confirm: 'Turn off read-only' },
    },
    deliveries: {
      on: { title: 'Pause deliveries?', description: 'Events queue up and go out when you resume.', confirm: 'Pause deliveries' },
      off: { title: 'Resume deliveries?', description: 'The queued backlog starts going out.', confirm: 'Resume deliveries' },
    },
  };

  const health = $derived(admin.health);
  const jevRate = $derived(health.jev.errors / health.jev.calls);
  const oldestHeld = $derived(admin.held[0]);
  const heldLeft = $derived(oldestHeld ? oldestHeld.expiresAt - admin.now : undefined);

  const tiles = $derived([
    {
      label: 'Gateway',
      value: health.gateway.connected ? 'Connected' : 'Disconnected',
      meta: health.gateway.connected ? `${health.gateway.latency} ms` : `Since ${timeAgo(health.gateway.since, admin.now)}`,
      status: (health.gateway.connected ? 'ok' : 'down') as Status,
    },
    {
      label: 'Jev errors, last hour',
      value: formatNumber(health.jev.errors),
      meta: `${(jevRate * 100).toFixed(2)}% of ${formatNumber(health.jev.calls)} calls`,
      status: (jevRate > JEV_ERROR_RATE ? 'warning' : 'ok') as Status,
    },
    {
      label: 'Held queue',
      value: formatNumber(admin.held.length),
      meta: heldLeft === undefined ? 'Empty' : `Oldest blocks in ${timeLeft(heldLeft)}`,
      status: (heldLeft !== undefined && isUrgent(heldLeft) ? 'warning' : 'ok') as Status,
      href: '/admin/moderation',
    },
    {
      label: 'Delivery backlog',
      value: formatNumber(health.backlog.events),
      meta: plural(health.backlog.paused, { one: '# webhook paused', other: '# webhooks paused' }),
      status: (health.switches.deliveries ? 'warning' : 'ok') as Status,
    },
  ]);

  let reconnecting = $state(false);
  let checking = $state(false);
  let registering = $state(false);
  let deregisterOpen = $state(false);
  let pendingSwitch = $state<{ key: KillSwitch; on: boolean }>();
  let switchOpen = $state(false);

  async function reconnect() {
    reconnecting = true;
    await admin.reconnectGateway();
    reconnecting = false;
    toast.success('Gateway connected');
  }

  async function recheck() {
    checking = true;
    await admin.recheckPermissions();
    checking = false;
    toast.success('Every permission check passed');
  }

  async function register() {
    registering = true;
    await admin.setCommands(true);
    registering = false;
    toast.success('Registered slash commands');
  }

  function askSwitch(key: KillSwitch, on: boolean) {
    pendingSwitch = { key, on };
    switchOpen = true;
  }
</script>

<svelte:head><title>Health · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Health</h1>
</div>

<div class="mt-6 flex flex-col gap-8">
  <ul class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {#each tiles as tile (tile.label)}
      {@const Icon = STATUS_ICONS[tile.status]}
      <li class="flex flex-col gap-1 rounded-xl border bg-card p-4">
        <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon class="size-3.5 shrink-0 {STATUS_CLASSES[tile.status]}" aria-hidden="true" />
          {#if tile.href}
            <a href={tile.href} class="outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">{tile.label}</a>
          {:else}
            {tile.label}
          {/if}
        </span>
        <span class="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{tile.value}</span>
        <span class="truncate text-xs text-muted-foreground tabular-nums">{tile.meta}</span>
        {#if tile.label === 'Gateway' && !health.gateway.connected}
          <Button size="sm" variant="outline" class="mt-2 self-start" disabled={reconnecting} onclick={reconnect}>
            {#if reconnecting}<Spinner />Reconnecting…{:else}Reconnect{/if}
          </Button>
        {/if}
      </li>
    {/each}
  </ul>

  <section aria-labelledby="switches-heading">
    <h2 id="switches-heading" class="text-sm font-medium">Kill switches</h2>
    <ul class="mt-3 divide-y overflow-hidden rounded-xl border bg-card">
      {#each KILL_SWITCH_KEYS as key (key)}
        {@const on = health.switches[key]}
        <li class="px-4 py-3">
          <Field.Field orientation="horizontal" class="justify-between">
            <Field.Label for="switch-{key}" class="font-normal">{KILL_SWITCHES[key].label}</Field.Label>
            <!-- Controlled: the switch only moves once the confirmation goes through. -->
            <Switch id="switch-{key}" bind:checked={() => on, (next) => askSwitch(key, next)} />
          </Field.Field>
        </li>
      {/each}
    </ul>
  </section>

  <div class="grid gap-8 md:grid-cols-2">
    <section aria-labelledby="permissions-heading">
      <div class="flex min-h-8 items-center justify-between gap-4">
        <h2 id="permissions-heading" class="text-sm font-medium">Bot permissions</h2>
        <Button size="sm" variant="ghost" disabled={checking} onclick={recheck}>
          {#if checking}<Spinner />Checking…{:else}Check again{/if}
        </Button>
      </div>
      <ul class="mt-2 divide-y overflow-hidden rounded-xl border bg-card">
        {#each health.permissions as check (check.id)}
          {@const Icon = check.ok ? CircleCheckIcon : CircleXIcon}
          <li class="flex items-start gap-3 px-4 py-3 text-sm">
            <Icon class="mt-0.5 size-4 shrink-0 {check.ok ? 'text-success' : 'text-destructive'}" aria-hidden="true" />
            <div class="flex min-w-0 flex-col gap-0.5">
              <span>{check.label}<span class="sr-only">{check.ok ? ': granted' : ': missing'}</span></span>
              {#if !check.ok}
                <span class="text-xs text-muted-foreground">Missing in {check.channels.map((c) => `#${c}`).join(', ')}. Grant it in Discord, then check again.</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <section aria-labelledby="commands-heading">
      <div class="flex min-h-8 items-center">
        <h2 id="commands-heading" class="text-sm font-medium">Slash commands</h2>
      </div>
      <div class="mt-2 flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3 text-sm">
        <span class="flex items-center gap-2">
          {#if health.commands.registered}
            <CircleCheckIcon class="size-4 text-success" aria-hidden="true" />
            {plural(health.commands.count, { one: '# registered', other: '# registered' })}
          {:else}
            <TriangleAlertIcon class="size-4 text-warning" aria-hidden="true" />
            Not registered
          {/if}
        </span>
        {#if health.commands.registered}
          <Button size="sm" variant="outline" onclick={() => (deregisterOpen = true)}>Deregister</Button>
        {:else}
          <Button size="sm" variant="outline" disabled={registering} onclick={register}>
            {#if registering}<Spinner />Registering…{:else}Register{/if}
          </Button>
        {/if}
      </div>
    </section>
  </div>
</div>

{#if pendingSwitch}
  {@const words = CONFIRM[pendingSwitch.key][pendingSwitch.on ? 'on' : 'off']}
  {@const target = pendingSwitch}
  <ConfirmDialog
    bind:open={switchOpen}
    title={words.title}
    description={words.description}
    confirm={words.confirm}
    destructive={target.on}
    onConfirm={async () => {
      await admin.setSwitch(target.key, target.on);
      toast.success(KILL_SWITCHES[target.key][target.on ? 'on' : 'off']);
    }}
  />
{/if}

<ConfirmDialog
  bind:open={deregisterOpen}
  title="Deregister slash commands?"
  description="They disappear from Discord until you register them again."
  confirm="Deregister"
  destructive
  onConfirm={async () => {
    await admin.setCommands(false);
    toast.success('Deregistered slash commands');
  }}
/>
