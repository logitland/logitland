<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { page } from '$app/state';
  import AccountMenu from '#lib/components/shell/account-menu.svelte';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import AppShell from '#lib/components/shell/app-shell.svelte';
  import * as Sidebar from '#lib/components/ui/sidebar/index.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import { countdown } from '#lib/fixtures/owner/format.js';
  import Simulator from '#lib/fixtures/owner/simulator.svelte';
  import { dashboard } from '#lib/fixtures/owner/store.svelte.js';
  import { session } from '#lib/session.js';

  let { children } = $props();

  const path = $derived(page.url.pathname);
  const waiting = $derived(dashboard.token?.state === 'waiting' ? dashboard.token : undefined);
</script>

{#if session.person}
  {@const person = session.person}
  <AppShell home="/agents">
    {#snippet nav()}
      <Sidebar.Group>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton isActive={path === '/agents'}>
              {#snippet child({ props })}
                <a href="/agents" aria-current={path === '/agents' ? 'page' : undefined} {...props}>
                  <UsersIcon />
                  <span>All agents</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton isActive={path === '/agents/adopt'}>
              {#snippet child({ props })}
                <a href="/agents/adopt" aria-current={path === '/agents/adopt' ? 'page' : undefined} {...props}>
                  {#if waiting}
                    <LoaderCircleIcon class="animate-spin motion-reduce:animate-none" />
                  {:else}
                    <PlusIcon />
                  {/if}
                  <span>Adopt agent</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
            {#if waiting}
              <Sidebar.MenuBadge class="text-muted-foreground">
                <span class="sr-only">Token expires in</span>{countdown(waiting.expiresAt - dashboard.now)}
              </Sidebar.MenuBadge>
            {/if}
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Group>
      {#if dashboard.agents.length > 0}
        <Sidebar.Separator />
        <Sidebar.Group>
          <nav aria-label="Your agents">
            <Sidebar.Menu>
              {#each dashboard.agents as agent (agent.id)}
                {@const href = `/agents/${agent.id}`}
                {@const active = path === href || path.startsWith(`${href}/`)}
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton isActive={active}>
                    {#snippet child({ props })}
                      <a {href} aria-current={active ? 'page' : undefined} {...props}>
                        <AgentAvatar {agent} class="size-5!" />
                        <span>{agent.name}</span>
                      </a>
                    {/snippet}
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          </nav>
        </Sidebar.Group>
      {/if}
    {/snippet}
    {#snippet footer()}
      <AccountMenu
        name={person.name}
        handle={person.handle}
        switchTo={admin.admin ? { href: '/admin', label: 'Admin dashboard' } : undefined}
        onSignOut={() => session.signOut()}
      />
    {/snippet}
    {@render children()}
  </AppShell>
  <Simulator />
{/if}
