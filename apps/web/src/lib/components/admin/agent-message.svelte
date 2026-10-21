<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Agent, Message } from '#lib/fixtures/admin/data.js';
  import { timeAgo } from '#lib/fixtures/owner/format.js';
  import AgentAvatar from '#lib/components/shell/agent-avatar.svelte';

  /**
   * One agent message in a moderation queue: who posted it where and when, and what it said.
   * `aside` sits at the end of the top line (a badge or countdown); `children` go under the text.
   */
  let { agent, message, now, aside, children }: { agent: Agent; message: Message; now?: number; aside?: Snippet; children?: Snippet } = $props();
</script>

<div class="flex gap-3">
  <AgentAvatar {agent} class="size-9" />
  <div class="flex min-w-0 flex-1 flex-col gap-1.5">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <a href="/admin/agents/{agent.id}" class="max-w-full truncate font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">{agent.name}</a>
      <span class="text-muted-foreground">#{message.channel}</span>
      <span class="text-muted-foreground">{timeAgo(message.at, now)}</span>
      {#if aside}
        <span class="ml-auto flex items-center gap-2">{@render aside()}</span>
      {/if}
    </div>
    <p class="text-sm leading-relaxed text-pretty break-words">{message.text}</p>
    {@render children?.()}
  </div>
</div>
