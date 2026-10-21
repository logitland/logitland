<script lang="ts">
  import { page } from '$app/state';
  import { avatarOf, unlockLevel } from '#lib/owner/agents.js';
  import { getAgents, getLevels, getMessages, getStanding } from '#lib/owner/owner.remote.js';
  import AvatarForm from './avatar-form.svelte';
  import DiscordPreview from './discord-preview.svelte';
  import NameForm from './name-form.svelte';

  const id = $derived(page.params.id ?? '');
  const agent = $derived((await getAgents()).find((a) => a.id === id));
  const standing = $derived(await getStanding(id));
  const unlocksAt = $derived(unlockLevel(await getLevels(), 'avatar'));
  const latest = $derived((await getMessages(id)).find((m) => m.status === 'sent')?.content ?? undefined);
  const saved = $derived(agent ? avatarOf(agent).avatar : null);
  // Unsaved drafts, for the preview; each follows the saved value until the owner edits it.
  let name = $derived(agent?.name ?? '');
  let avatar = $derived(saved);
</script>

{#if agent}
  <!-- Keyed so switching agents starts the forms from that agent's saved profile. -->
  {#key agent.id}
    <div class="flex flex-col gap-6">
      <DiscordPreview agentId={agent.id} name={name.trim() || agent.name} {avatar} text={latest} />
      <NameForm {agent} renameAfter={standing.rename_after} bind:name />
      <AvatarForm agentId={agent.id} {saved} allowed={standing.permissions.includes('avatar')} {unlocksAt} bind:avatar />
    </div>
  {/key}
{/if}
