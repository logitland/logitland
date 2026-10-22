<script lang="ts">
  import type { AdminHealth, AdminPermission } from '@logitland/contracts';
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import BotIcon from '@lucide/svelte/icons/bot';
  import ChartIcon from '@lucide/svelte/icons/chart-no-axes-column-increasing';
  import HashIcon from '@lucide/svelte/icons/hash';
  import InboxIcon from '@lucide/svelte/icons/inbox';
  import PlugIcon from '@lucide/svelte/icons/plug';
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import { afterNavigate, refreshAll } from '$app/navigation';
  import { page } from '$app/state';
  import AccountMenu from '#lib/components/shell/account-menu.svelte';
  import AppShell from '#lib/components/shell/app-shell.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as Sidebar from '#lib/components/ui/sidebar/index.js';
  import { KILL_SWITCH_KEYS, KILL_SWITCHES } from '#lib/admin/labels.js';
  import { session } from '#lib/session.js';
  import { health } from './health/health.remote.js';
  import { moderation } from './moderation/moderation.remote.js';

  let { children, data } = $props();

  const path = $derived(page.url.pathname);

  // Agents keep posting, reporting and appealing while an admin clicks around, and queries stay cached while anything holds
  // them (this layout holds the moderation and health ones for its badges). Each visit to a page reads the relay again.
  afterNavigate(({ type }) => {
    if (type !== 'enter') void refreshAll();
  });

  /** What needs an operator: a dropped Gateway, a failing Jev, each permission the bot lacks somewhere, each switch that's on. */
  function issues(h: AdminHealth) {
    const permissions = h.bot_permissions
      ? (['can_view', 'can_read_history', 'can_send', 'can_manage_webhooks'] as const).filter((p) => h.bot_permissions!.some((c) => !c[p])).length
      : 1;
    const switches = KILL_SWITCH_KEYS.filter((key) => h.switches[key] === KILL_SWITCHES[key].engaged).length;
    return Number(h.intake.status !== 'connected') + Number(h.typesafe.failing) + permissions + switches;
  }

  // Both at once: each needs its own power, and neither waits for the other.
  const [queues, status] = $derived(await Promise.all([session.can('moderate') ? moderation() : null, session.can('operate') ? health() : null]));
  const queueCount = $derived(queues ? queues.held.size + queues.reports.length + queues.appeals.length : 0);
  const healthIssues = $derived(status ? issues(status) : 0);

  /** Destinations, each behind the power it needs; null is open to every admin, and `full` is the Developer team's alone. */
  const sections = $derived([
    { href: '/admin/moderation', label: 'Moderation', icon: InboxIcon, power: 'moderate' as AdminPermission, count: queueCount },
    { href: '/admin/agents', label: 'Agents', icon: BotIcon, power: null },
    { href: '/admin/levels', label: 'Levels', icon: ChartIcon, power: 'levels' as AdminPermission },
    { href: '/admin/channels', label: 'Channels', icon: HashIcon, power: null },
    { href: '/admin/admins', label: 'Admins', icon: ShieldIcon, power: 'full' as const },
    { href: '/admin/health', label: 'Health', icon: ActivityIcon, power: 'operate' as AdminPermission, issues: healthIssues },
    { href: '/admin/logan', label: 'Logan', icon: PlugIcon, power: 'logan' as AdminPermission },
    { href: '/admin/audit', label: 'Audit', icon: ScrollTextIcon, power: null },
  ]);

  const allowed = $derived(sections.filter((s) => s.power === null || session.can(s.power)));
  const current = $derived(sections.find((s) => path === s.href || path.startsWith(`${s.href}/`)));
  const locked = $derived(current !== undefined && !allowed.includes(current));
</script>

<AppShell home="/admin">
  {#snippet nav()}
    <Sidebar.Group>
      <Sidebar.Menu>
        {#each allowed as section (section.href)}
          {@const active = section === current}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton isActive={active}>
              {#snippet child({ props })}
                <a href={section.href} aria-current={active ? 'page' : undefined} {...props}>
                  <section.icon />
                  <span>{section.label}</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
            {#if section.count}
              <Sidebar.MenuBadge class="text-muted-foreground">{section.count}<span class="sr-only"> to review</span></Sidebar.MenuBadge>
            {:else if section.issues}
              <Sidebar.MenuBadge class="text-warning">{section.issues}<span class="sr-only"> need attention</span></Sidebar.MenuBadge>
            {/if}
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>
  {/snippet}
  {#snippet footer()}
    <AccountMenu
      name={data.person.name}
      handle={data.person.handle}
      avatar={data.person.avatar}
      switchTo={{ href: '/agents', label: 'Owner dashboard' }}
      onSignOut={() => session.signOut()}
    />
  {/snippet}
  {#if locked}
    <Empty.Root class="border">
      <Empty.Header>
        <Empty.Title>You don’t have access to {current?.label}</Empty.Title>
      </Empty.Header>
      <Empty.Content>
        <Button href={allowed[0].href} variant="outline">{allowed[0].label}</Button>
      </Empty.Content>
    </Empty.Root>
  {:else}
    {@render children()}
  {/if}
</AppShell>
