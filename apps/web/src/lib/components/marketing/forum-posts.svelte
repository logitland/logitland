<script lang="ts">
  import type { ChannelTag, Thread } from '@logitland/contracts';
  import MessageSquareIcon from '@lucide/svelte/icons/message-square';
  import AuthorAvatar from '#lib/components/marketing/author-avatar.svelte';
  import { sigil } from '#lib/components/shell/sigil.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { plural, timeAgo } from '#lib/fixtures/owner/format.js';
  import { cn } from '#lib/utils.js';

  /**
   * A forum's posts as Discord lists them, latest activity first: title, tags (named by the forum's `tags`), who started it
   * and how, replies and last activity. The title is the button that opens the post (`onopen`), stretched over the card; its
   * ID is `post-<id>`, so focus can return to it.
   */
  let { posts, tags, clock, onopen }: { posts: Thread[]; tags: ChannelTag[]; clock: number; onopen: (post: Thread) => void } = $props();
</script>

<ul class="flex flex-col gap-2">
  {#each posts as post (post.id)}
    {@const starter = post.starter && !post.starter.deleted ? post.starter : null}
    {@const author = starter?.author}
    {@const replies = Math.max(post.message_count - (starter ? 1 : 0), 0)}
    {@const applied = tags.filter((tag) => post.applied_tags.includes(tag.id))}
    <li
      class="agent-accent relative rounded-lg border bg-background px-3 py-2.5 hover:bg-muted/50 has-focus-visible:ring-3 has-focus-visible:ring-ring"
      style:--agent-hue={sigil(author ? (author.agent_id ?? author.author_id) : post.id).hue}
    >
      <div class="flex min-w-0 items-baseline gap-2">
        <h3 class="min-w-0 flex-1 truncate text-sm font-semibold">
          <button id="post-{post.id}" type="button" onclick={() => onopen(post)} class="outline-none after:absolute after:inset-0 after:rounded-lg">
            {post.name}
          </button>
        </h3>
        <span class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <MessageSquareIcon class="size-3.5" aria-hidden="true" />
          <span aria-hidden="true">{replies}</span>
          <span class="sr-only">{plural(replies, { one: '# reply', other: '# replies' })},</span>
          <span class="ml-1">{timeAgo(Date.parse(post.last_message_at ?? post.created_at), clock)}</span>
        </span>
      </div>
      {#if applied.length}
        <ul aria-label="Tags" class="mt-1 flex flex-wrap gap-1">
          {#each applied as tag (tag.id)}
            <li><Badge variant="secondary" class="h-5 px-1.5">{tag.name}</Badge></li>
          {/each}
        </ul>
      {/if}
      {#if starter && author}
        <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">
          <AuthorAvatar {author} class="mr-1 inline-block size-4 align-[-3px]" />
          <span class={cn('font-medium', author.kind === 'human' ? 'text-foreground' : 'text-agent-name')}>{author.display_name}:</span>
          {starter.content}
        </p>
      {/if}
    </li>
  {/each}
</ul>
