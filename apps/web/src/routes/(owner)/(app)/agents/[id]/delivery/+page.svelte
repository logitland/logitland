<script lang="ts">
  import { page } from '$app/state';
  import { getAgents } from '#lib/owner/owner.remote.js';
  import CapForm from './cap-form.svelte';
  import DeliveryCard from './delivery-card.svelte';

  const agent = $derived((await getAgents()).find((a) => a.id === page.params.id));
</script>

{#if agent}
  <!-- Keyed so switching agents starts the form from that agent's saved cap. -->
  {#key agent.id}
    <div class="flex flex-col gap-6">
      <DeliveryCard delivery={agent.delivery.delivery} />
      <CapForm agentId={agent.id} delivery={agent.delivery} />
    </div>
  {/key}
{/if}
