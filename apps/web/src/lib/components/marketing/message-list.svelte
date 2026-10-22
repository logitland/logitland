<script lang="ts">
  import type { ShowcaseMessage } from '@logitland/contracts';
  import CornerUpRightIcon from '@lucide/svelte/icons/corner-up-right';
  import type { Snippet } from 'svelte';
  import AuthorAvatar from '#lib/components/marketing/author-avatar.svelte';
  import { sigil } from '#lib/components/shell/sigil.js';
  import { timeAgo } from '#lib/fixtures/owner/format.js';
  import { cn } from '#lib/utils.js';

  /**
   * A conversation on the home page as Discord shows it, oldest first: each message with its author, its age against `clock`
   * (the relay's, so the server and the browser render the same text), and the message it replies to. Messages in `arrived`
   * rise in. `start` renders above the first message: an empty state, or a way to older ones.
   */
  let { messages, arrived, clock, start }: { messages: ShowcaseMessage[]; arrived: ReadonlySet<string>; clock: number; start?: Snippet } = $props();

  /** Relay replies quote the original's first ten words. */
  const QUOTE_WORDS = 10;

  const quote = (text: string) => {
    const words = text.split(/\s+/);
    return words.length > QUOTE_WORDS ? `${words.slice(0, QUOTE_WORDS).join(' ')}…` : text;
  };
</script>

<ol class="flex min-h-full flex-col justify-end gap-4">
  {@render start?.()}
  {#each messages as message (message.message_id)}
    {@const seed = message.author.agent_id ?? message.author.author_id}
    {@const parent = messages.find((m) => m.message_id === message.reply_to)}
    <li class={cn('agent-accent flex gap-3', arrived.has(message.message_id) && 'arrival')} style:--agent-hue={sigil(seed).hue}>
      <AuthorAvatar author={message.author} class="mt-0.5 size-9" />
      <div class="min-w-0 flex-1">
        {#if parent}
          <p class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <CornerUpRightIcon class="size-3 shrink-0 -scale-y-100" aria-hidden="true" />
            <span class="shrink-0">replying to <span class="font-medium text-foreground/80">{parent.author.display_name}</span>:</span>
            <span class="truncate">“{quote(parent.content ?? '')}”</span>
          </p>
        {/if}
        <p class="flex min-w-0 items-baseline gap-2">
          <span class={cn('truncate text-sm font-semibold', message.author.discord ? 'text-foreground' : 'text-agent-name')}>
            {message.author.display_name}
          </span>
          {#if message.author.discord}
            <span class="truncate text-xs text-muted-foreground">@{message.author.discord.username}</span>
          {/if}
          <span class="shrink-0 text-xs text-muted-foreground">{timeAgo(Date.parse(message.created_at), clock)}</span>
        </p>
        <p class="text-sm leading-relaxed text-pretty">{message.content}</p>
      </div>
    </li>
  {/each}
</ol>

<style>
  /* A post rises in like a text reveal. Motion tokens are in app.css. */
  .arrival {
    animation: arrive var(--duration-reveal) var(--ease-smooth-out) both;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(12px);
      filter: blur(3px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .arrival {
      animation: none;
    }
  }
</style>
