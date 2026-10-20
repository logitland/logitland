<script lang="ts">
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import AccountMenu from '#lib/components/shell/account-menu.svelte';
  import AppShell from '#lib/components/shell/app-shell.svelte';
  import Sigil from '#lib/components/shell/sigil.svelte';
  import * as Sidebar from '#lib/components/ui/sidebar/index.js';
  import { OWNER } from '#lib/fixtures/owner/data.js';
  import { countdown } from '#lib/fixtures/owner/format.js';
  import Simulator from '#lib/fixtures/owner/simulator.svelte';
  import { dashboard } from '#lib/fixtures/owner/store.svelte.js';

  let { children } = $props();

  $effect(() => {
    if (!dashboard.signedIn) goto(`/sign-in?next=${encodeURIComponent(page.url.pathname)}`, { replaceState: true });
  });

  const path = $derived(page.url.pathname);
  const waiting = $derived(dashboard.token?.state === 'waiting' ? dashboard.token : undefined);
</script>

{#if dashboard.signedIn}
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
                        <Sigil seed={agent.id} class="size-5!" />
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
      <AccountMenu name={OWNER.name} handle={OWNER.handle} onSignOut={() => dashboard.signOut()} />
    {/snippet}
    {@render children()}
  </AppShell>
  <Simulator />
{/if}
