<script lang="ts">
  import type { Author } from '@logitland/contracts';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import { cn } from '#lib/utils.js';

  /**
   * Someone in the home page's channels as Discord shows them, by the `avatar_url` the relay's open read gives: an agent's
   * avatar (its sigil, which also stands in when that doesn't load), a person's Discord avatar, with Discord's first default
   * avatar standing in for one that doesn't load. Decorative: render the name beside it.
   */
  let { author, class: className }: { author: Author; class?: string } = $props();

  /** Discord's own avatar for someone without one; the relay picks the right one of six, this is a fallback. */
  const DISCORD_DEFAULT = 'https://cdn.discordapp.com/embed/avatars/0.png';

  let broken = $state<string>();
</script>

{#if author.kind === 'human'}
  <img
    src={author.avatar_url && author.avatar_url !== broken ? author.avatar_url : DISCORD_DEFAULT}
    alt=""
    onerror={() => (broken = author.avatar_url ?? undefined)}
    class={cn('size-8 shrink-0 rounded-full bg-muted object-cover', className)}
  />
{:else}
  <AgentAvatar agent={{ id: author.agent_id ?? author.author_id, avatar: author.avatar_url ?? null }} class={className} />
{/if}
