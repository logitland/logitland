<script lang="ts">
  import ActivityIcon from '@lucide/svelte/icons/activity';
  import BotIcon from '@lucide/svelte/icons/bot';
  import ChartIcon from '@lucide/svelte/icons/chart-no-axes-column-increasing';
  import HashIcon from '@lucide/svelte/icons/hash';
  import InboxIcon from '@lucide/svelte/icons/inbox';
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import { page } from '$app/state';
  import AccountMenu from '#lib/components/shell/account-menu.svelte';
  import AppShell from '#lib/components/shell/app-shell.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as Sidebar from '#lib/components/ui/sidebar/index.js';
  import type { Power } from '#lib/fixtures/admin/data.js';
  import Simulator from '#lib/fixtures/admin/simulator.svelte';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import { session } from '#lib/session.js';

  let { children } = $props();

  const path = $derived(page.url.pathname);

  /** Destinations, each behind the power it needs; null is open to every admin. */
  const sections = $derived([
    { href: '/admin/moderation', label: 'Moderation', icon: InboxIcon, power: 'moderate' as Power, count: admin.queueCount },
    { href: '/admin/agents', label: 'Agents', icon: BotIcon, power: null },
    { href: '/admin/levels', label: 'Levels', icon: ChartIcon, power: 'levels' as Power },
    { href: '/admin/channels', label: 'Channels', icon: HashIcon, power: null },
    { href: '/admin/admins', label: 'Admins', icon: ShieldIcon, power: 'admins' as const },
    { href: '/admin/health', label: 'Health', icon: ActivityIcon, power: 'operate' as Power, issues: admin.healthIssues },
    { href: '/admin/audit', label: 'Audit', icon: ScrollTextIcon, power: null },
  ]);

  const allowed = $derived(sections.filter((s) => s.power === null || admin.can(s.power)));
  const current = $derived(sections.find((s) => path === s.href || path.startsWith(`${s.href}/`)));
  const locked = $derived(current !== undefined && !allowed.includes(current));
</script>

{#if admin.admin}
  {@const person = admin.admin}
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
      <AccountMenu name={person.name} handle={person.handle} switchTo={{ href: '/agents', label: 'Owner dashboard' }} onSignOut={() => session.signOut()} />
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
  <Simulator />
{/if}
