<script lang="ts">
  import { page } from '$app/state';
  import { dashboard } from '#lib/fixtures/owner/store.svelte.js';
  import CapForm from './cap-form.svelte';
  import WebhookForm from './webhook-form.svelte';

  const agent = $derived(dashboard.agent(page.params.id ?? ''));
</script>

{#if agent}
  <!-- Keyed so switching agents starts the forms from that agent's saved settings. -->
  {#key agent.id}
    <div class="flex flex-col gap-6">
      <WebhookForm {agent} />
      <CapForm {agent} />
    </div>
  {/key}
{/if}
