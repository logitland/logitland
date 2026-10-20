<script lang="ts">
  /*
   * PROTOTYPE control panel, deliberately styled apart from the product: it plays the outside world
   * (agents reporting, the Gateway dropping, Jev failing), switches between fixture admins, and resets.
   * It is not part of the admin dashboard design.
   */
  import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Popover from '#lib/components/ui/popover/index.js';
  import { ADMINS, POWER_LABELS } from './data.js';
  import { admin } from './store.svelte.js';

  let open = $state(false);

  function report() {
    const agent = admin.simulateReport();
    if (!agent) toast('No open reports left to add to');
  }

  function reset() {
    admin.reset();
    open = false;
    goto('/admin');
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class="fixed right-3 bottom-3 z-40 inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-foreground/30 bg-background/90 px-3 font-mono text-xs text-muted-foreground shadow-sm backdrop-blur hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
  >
    <FlaskConicalIcon class="size-3.5" />
    Simulator
  </Popover.Trigger>
  <Popover.Content side="top" align="end" class="w-80 gap-4 border border-dashed border-foreground/30 font-mono text-xs">
    <section class="flex flex-col gap-2">
      <h2 class="text-muted-foreground">Signed in as</h2>
      {#each ADMINS as candidate (candidate.id)}
        <Button
          size="sm"
          variant={admin.adminId === candidate.id ? 'secondary' : 'ghost'}
          class="h-auto justify-between py-1.5 font-mono text-xs"
          onclick={() => admin.switchAdmin(candidate.id)}
        >
          <span>{candidate.name}</span>
          <span class="truncate text-muted-foreground">
            {candidate.team ? 'Developer team' : candidate.roles.map((r) => `@${admin.role(r)?.name}`).join(' ')}
          </span>
        </Button>
      {/each}
      <p class="text-muted-foreground">
        Powers: {admin.admin?.team ? 'all' : admin.powers.map((p) => POWER_LABELS[p]).join(', ') || 'none'}
      </p>
    </section>
    <section class="flex flex-col gap-2">
      <h2 class="text-muted-foreground">Outside world</h2>
      <div class="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" class="font-mono text-xs" onclick={report}>Agent reports</Button>
        <Button size="sm" variant="outline" class="font-mono text-xs" disabled={!admin.health.gateway.connected} onclick={() => admin.simulateGatewayDrop()}>Gateway drops</Button>
        <Button size="sm" variant="outline" class="font-mono text-xs" onclick={() => admin.simulateJevErrors()}>Jev errors</Button>
        <Button size="sm" variant="outline" class="font-mono text-xs" onclick={reset}>Reset</Button>
      </div>
    </section>
  </Popover.Content>
</Popover.Root>
