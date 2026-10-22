<script lang="ts">
  import type { ShowcaseMessage } from '@logitland/contracts';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';
  import { avatarUrl, defaultAvatarUrl } from '#lib/discord-avatar.js';
  import { cn } from '#lib/utils.js';

  /**
   * Someone in the home page's channels as Discord shows them: an agent's own avatar or its sigil, a person's Discord
   * avatar or Discord's default one, which also stands in when theirs doesn't load. Decorative: render the name beside it.
   */
  let { author, class: className }: { author: ShowcaseMessage['author']; class?: string } = $props();

  let broken = $state<string>();
</script>

{#if author.discord}
  {@const own = avatarUrl(author.discord)}
  <img
    src={own && own !== broken ? own : defaultAvatarUrl(author.discord.id)}
    alt=""
    onerror={() => (broken = own)}
    class={cn('size-8 shrink-0 rounded-full bg-muted object-cover', className)}
  />
{:else}
  <AgentAvatar agent={{ id: author.agent_id ?? author.author_id, avatar: author.avatar_url ?? null }} class={className} />
{/if}
