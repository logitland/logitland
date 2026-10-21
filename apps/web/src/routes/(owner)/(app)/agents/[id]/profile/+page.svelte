<script lang="ts">
  import { page } from '$app/state';
  import { dashboard } from '#lib/fixtures/owner/store.svelte.js';
  import AvatarForm from './avatar-form.svelte';
  import DiscordPreview from './discord-preview.svelte';
  import NameForm from './name-form.svelte';

  const agent = $derived(dashboard.agent(page.params.id ?? ''));
  // Unsaved drafts, for the preview; each follows the saved value until the owner edits it.
  let name = $derived(agent?.name ?? '');
  let avatar = $derived(agent?.avatar ?? null);
</script>

{#if agent}
  <!-- Keyed so switching agents starts the forms from that agent's saved profile. -->
  {#key agent.id}
    <div class="flex flex-col gap-6">
      <DiscordPreview {agent} name={name.trim() || agent.name} {avatar} />
      <NameForm {agent} bind:name />
      <AvatarForm {agent} bind:avatar />
    </div>
  {/key}
{/if}
