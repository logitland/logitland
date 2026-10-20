<script lang="ts">
  /*
   * PROTOTYPE control panel, deliberately styled apart from the product: it plays the agent's side
   * of adoption and resets fixtures. It is not part of the owner dashboard design.
   */
  import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { formatCode } from './format.js';
  import { dashboard } from './store.svelte.js';

  let open = $state(false);

  const nextOrphan = $derived(dashboard.orphans.find((o) => !o.expired));

  function confirmToken() {
    const agent = dashboard.confirmToken();
    // The adopt page shows the result itself; elsewhere the owner hears about it in a toast.
    if (!agent || page.url.pathname === '/agents/adopt') return;
    toast.success(`Adopted ${agent.name}`, { action: { label: 'Open', onClick: () => goto(`/agents/${agent.id}`) } });
  }

  function reset(fresh: boolean) {
    dashboard.reset({ fresh });
    open = false;
    goto('/agents');
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class="fixed right-3 bottom-3 z-40 inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-foreground/30 bg-background/90 px-3 font-mono text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
  >
    <FlaskConicalIcon class="size-3.5" />
    Simulator
  </Popover.Trigger>
  <Popover.Content side="top" align="end" class="w-72 gap-4 border border-dashed border-foreground/30 font-mono text-xs">
    <section class="flex flex-col gap-2">
      <h2 class="text-muted-foreground">Codes orphans show</h2>
      {#each dashboard.orphans as orphan (orphan.code)}
        <div class="flex items-center justify-between gap-2">
          <span class="select-all">{formatCode(orphan.code)}</span>
          <span class="truncate text-muted-foreground">{orphan.agent.name}{orphan.expired ? ' · expired' : ''}</span>
        </div>
      {:else}
        <p class="text-muted-foreground">All adopted.</p>
      {/each}
    </section>
    <section class="flex flex-col gap-2">
      <h2 class="text-muted-foreground">Waiting token</h2>
      <div class="flex gap-2">
        <Button size="sm" variant="outline" class="flex-1 font-mono text-xs" disabled={dashboard.token?.state !== 'waiting' || !nextOrphan} onclick={confirmToken}>
          {nextOrphan ? `${nextOrphan.agent.name} confirms` : 'No orphans left'}
        </Button>
        <Button size="sm" variant="outline" class="font-mono text-xs" disabled={dashboard.token?.state !== 'waiting'} onclick={() => dashboard.expireToken()}>Expire</Button>
      </div>
    </section>
    <section class="flex flex-col gap-2">
      <h2 class="text-muted-foreground">Fixtures</h2>
      <div class="flex gap-2">
        <Button size="sm" variant="outline" class="flex-1 font-mono text-xs" onclick={() => reset(false)}>Reset</Button>
        <Button size="sm" variant="outline" class="flex-1 font-mono text-xs" onclick={() => reset(true)}>New owner</Button>
      </div>
    </section>
  </Popover.Content>
</Popover.Root>
