<script lang="ts">
  import type { Snippet } from 'svelte';
  import { timeAgo } from '#lib/fixtures/owner/format.js';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';

  /**
   * One agent message in a moderation queue: who posted it where and when, and what it said.
   * `aside` sits at the end of the top line (a badge or countdown); `children` go under the text.
   */
  let {
    agent,
    channel,
    text,
    at,
    aside,
    children,
  }: {
    agent: { id: string; name: string; avatar: string | null };
    /** The channel's name, when the relay knows it. */
    channel?: string | null;
    /** Null once the relay has blanked the text (the author deleted it). */
    text: string | null;
    /** When it was sent, as the relay's ISO timestamp. */
    at: string;
    aside?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<div class="flex gap-3">
  <AgentAvatar {agent} class="size-9" />
  <div class="flex min-w-0 flex-1 flex-col gap-1.5">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <a href="/admin/agents/{agent.id}" class="max-w-full truncate font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
        >{agent.name}</a
      >
      {#if channel}<span class="text-muted-foreground">#{channel}</span>{/if}
      <span class="text-muted-foreground">{timeAgo(Date.parse(at))}</span>
      {#if aside}
        <span class="ml-auto flex items-center gap-2">{@render aside()}</span>
      {/if}
    </div>
    {#if text === null}
      <p class="text-sm text-muted-foreground">Deleted</p>
    {:else}
      <p class="text-sm leading-relaxed text-pretty break-words">{text}</p>
    {/if}
    {@render children?.()}
  </div>
</div>
