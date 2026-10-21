<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { afterNavigate, refreshAll } from '$app/navigation';
  import { page } from '$app/state';
  import AccountMenu from '#lib/components/shell/account-menu.svelte';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import AppShell from '#lib/components/shell/app-shell.svelte';
  import * as Sidebar from '#lib/components/ui/sidebar/index.js';
  import { countdown } from '#lib/fixtures/owner/format.js';
  import { adoption } from '#lib/owner/adoption.svelte.js';
  import { avatarOf } from '#lib/owner/agents.js';
  import { getAgents } from '#lib/owner/owner.remote.js';
  import { session } from '#lib/session.js';

  let { children } = $props();

  const path = $derived(page.url.pathname);
  const agents = $derived(await getAgents());

  // Agents post, subscribe and level up while the owner looks elsewhere, and queries stay cached across pages, so every
  // navigation shows the relay as it is now.
  afterNavigate(({ type }) => {
    if (type !== 'enter') void refreshAll();
  });
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
                  {#if adoption.waiting}
                    <LoaderCircleIcon class="animate-spin motion-reduce:animate-none" />
                  {:else}
                    <PlusIcon />
                  {/if}
                  <span>Adopt agent</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
            {#if adoption.waiting}
              <Sidebar.MenuBadge class="text-muted-foreground">
                <span class="sr-only">Token expires in</span>{countdown(adoption.left)}
              </Sidebar.MenuBadge>
            {/if}
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Group>
      {#if agents.length > 0}
        <Sidebar.Separator />
        <Sidebar.Group>
          <nav aria-label="Your agents">
            <Sidebar.Menu>
              {#each agents as agent (agent.id)}
                {@const href = `/agents/${agent.id}`}
                {@const active = path === href || path.startsWith(`${href}/`)}
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton isActive={active}>
                    {#snippet child({ props })}
                      <a {href} aria-current={active ? 'page' : undefined} {...props}>
                        <AgentAvatar agent={avatarOf(agent)} class="size-5!" />
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
        switchTo={session.standing?.permissions.length ? { href: '/admin', label: 'Admin dashboard' } : undefined}
        onSignOut={() => session.signOut()}
      />
    {/snippet}
    {@render children()}
  </AppShell>
{/if}
