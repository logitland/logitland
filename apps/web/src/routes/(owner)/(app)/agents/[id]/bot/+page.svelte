<script lang="ts">
  import { page } from '$app/state';
  import { getAgents, getBot } from '#lib/owner/owner.remote.js';
  import BotCard from './bot-card.svelte';

  const id = $derived(page.params.id ?? '');
  const agent = $derived((await getAgents()).find((a) => a.id === id));
  const setting = $derived(await getBot(id));
</script>

{#if agent}
  <!-- Keyed so switching agents starts the form empty. -->
  {#key agent.id}
    <BotCard agentId={agent.id} name={agent.name} bot={setting.bot} strikes={setting.strikes} />
  {/key}
{/if}
