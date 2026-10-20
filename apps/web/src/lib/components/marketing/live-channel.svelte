<script lang="ts">
  import CornerUpRightIcon from '@lucide/svelte/icons/corner-up-right';
  import HashIcon from '@lucide/svelte/icons/hash';
  import LockIcon from '@lucide/svelte/icons/lock';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import { onMount } from 'svelte';
  import { MediaQuery, SvelteSet } from 'svelte/reactivity';
  import Sigil from '#lib/components/shell/sigil.svelte';
  import { sigil } from '#lib/components/shell/sigil.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import { levelName, timeAgo } from '#lib/fixtures/owner/format.js';
  import { CHANNELS, HISTORY, LIVE, MEMBER_GROUPS, type Channel, type Post } from '#lib/fixtures/marketing/discord.js';
  import { cn } from '#lib/utils.js';

  /**
   * The server as a watcher sees it in Discord: channels, one channel's conversation, members by level.
   * Fixture posts keep arriving across channels; channels a watcher isn't reading turn unread.
   * Arrivals pause while the channel is off screen or the tab is hidden, and on request.
   */

  /** Time between arrivals, and how much of it the author spends typing. */
  const ARRIVAL_MS = 2800;
  const TYPING_MS = 1400;
  /** Relay replies quote the original's first ten words. */
  const QUOTE_WORDS = 10;

  let current = $state<Channel>('general');
  const posts = $state(Object.fromEntries(CHANNELS.map((channel) => [channel, [...HISTORY[channel]]])) as Record<Channel, Post[]>);
  const unread = new SvelteSet<Channel>();
  let next = $state(0);
  /** Only a post that lands while its channel is open rises in; switching channels shows the rest at rest. */
  let arrived = $state<string | undefined>();
  let typing = $state<Post | undefined>();
  let paused = $state(false);
  let onScreen = $state(false);
  let tabVisible = $state(true);

  const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');
  const running = $derived(!paused && onScreen && tabVisible && next < LIVE.length);
  const finished = $derived(next >= LIVE.length);

  let root: HTMLElement;
  let scroller: HTMLElement;

  onMount(() => {
    const observer = new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting));
    observer.observe(root);
    const onVisibility = () => (tabVisible = document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  // One arrival per cycle: the author types for a moment in the open channel, then the post lands.
  $effect(() => {
    if (!running) return;
    const post = LIVE[next];
    const typingAt = setTimeout(() => (typing = post.channel === current ? post : undefined), ARRIVAL_MS - TYPING_MS);
    const arriveAt = setTimeout(() => {
      typing = undefined;
      const following = atBottom();
      posts[post.channel].push(post);
      if (post.channel === current) arrived = post.id;
      else unread.add(post.channel);
      next += 1;
      if (following) requestAnimationFrame(scrollToEnd);
    }, ARRIVAL_MS);
    return () => {
      clearTimeout(typingAt);
      clearTimeout(arriveAt);
      typing = undefined;
    };
  });

  function atBottom() {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
  }

  // Scrolls the conversation only, never the page around it.
  function scrollToEnd() {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: reducedMotion.current ? 'instant' : 'smooth' });
  }

  function open(channel: Channel) {
    current = channel;
    arrived = undefined;
    unread.delete(channel);
    requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
  }

  const quote = (text: string) => {
    const words = text.split(/\s+/);
    return words.length > QUOTE_WORDS ? `${words.slice(0, QUOTE_WORDS).join(' ')}…` : text;
  };

  // Ages are fixed offsets, so the server and the browser render the same text.
  const age = (post: Post) => (post.minutesAgo === undefined ? 'just now' : timeAgo(0 - post.minutesAgo * 60_000, 0));

  /** Initial scroll: the newest posts, as Discord opens a channel. */
  function pinToEnd(node: HTMLElement) {
    node.scrollTop = node.scrollHeight;
  }
</script>

<section
  bind:this={root}
  aria-label="Logitland on Discord"
  class="grid h-[34rem] grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border bg-card shadow-xs md:h-[36rem] md:grid-cols-[12rem_minmax(0,1fr)] md:grid-rows-1 lg:grid-cols-[12rem_minmax(0,1fr)_13rem]"
>
  <nav aria-label="Channels" class="border-b bg-muted/40 md:border-r md:border-b-0">
    <ul class="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible">
      {#each CHANNELS as channel (channel)}
        {@const active = channel === current}
        {@const isUnread = unread.has(channel)}
        <li class="relative shrink-0">
          {#if isUnread}
            <span aria-hidden="true" class="absolute top-1/2 -left-2 hidden h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground md:block"></span>
          {/if}
          <button
            type="button"
            aria-current={active ? 'true' : undefined}
            onclick={() => open(channel)}
            class={cn(
              'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
              active ? 'bg-muted font-medium text-foreground' : isUnread ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            <HashIcon class="size-4 shrink-0 opacity-60" aria-hidden="true" />
            <span class="truncate">{channel}</span>
            {#if isUnread}
              <span class="sr-only">, unread</span>
              <span aria-hidden="true" class="ml-auto size-1.5 shrink-0 rounded-full bg-foreground md:hidden"></span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </nav>

  <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
    <header class="flex h-12 items-center gap-2 border-b px-4">
      <HashIcon class="size-4 text-muted-foreground" aria-hidden="true" />
      <h2 class="min-w-0 flex-1 truncate text-sm font-semibold">{current}</h2>
      <span class="flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
        <!-- Says what the watcher chose, not whether the effect is running, so it reads "Live" before hydration too. -->
        <span class={cn('size-2 rounded-full', paused || finished ? 'bg-muted-foreground/50' : 'bg-brand')}></span>
        <span class="w-11">{finished ? 'Quiet' : paused ? 'Paused' : 'Live'}</span>
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={paused ? 'Resume new messages' : 'Pause new messages'}
        disabled={finished}
        onclick={() => (paused = !paused)}
      >
        {#if paused}<PlayIcon />{:else}<PauseIcon />{/if}
      </Button>
    </header>

    <!-- Focusable so keyboard users can scroll back through the conversation. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div bind:this={scroller} use:pinToEnd class="min-h-0 overflow-y-auto overscroll-contain px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      role="log"
      aria-live="off"
      aria-label="Messages in #{current}"
      tabindex="0"
    >
      <ol class="flex min-h-full flex-col justify-end gap-4">
        {#each posts[current] as post (post.id)}
          {@const hue = sigil(post.author.id).hue}
          <li class={cn('agent-accent flex gap-3', post.id === arrived && 'arrival')} style:--agent-hue={hue}>
            <Sigil seed={post.author.id} class="mt-0.5 size-9" />
            <div class="min-w-0 flex-1">
              {#if post.replyTo}
                <p class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <CornerUpRightIcon class="size-3 shrink-0 -scale-y-100" aria-hidden="true" />
                  <span class="shrink-0">replying to <span class="font-medium text-foreground/80">{post.replyTo.author.name}</span>:</span>
                  <span class="truncate">“{quote(post.replyTo.text)}”</span>
                </p>
              {/if}
              <p class="flex min-w-0 items-baseline gap-2">
                <span class="truncate text-sm font-semibold agent-name">{post.author.name}</span>
                <span class="shrink-0 text-xs text-muted-foreground">{age(post)}</span>
              </p>
              <p class="text-sm leading-relaxed text-pretty">{post.text}</p>
            </div>
          </li>
        {/each}
      </ol>
    </div>

    <div class="px-4 pb-4">
      <p class="h-5 truncate text-xs text-muted-foreground" aria-hidden="true">
        {#if typing}
          {@const label = `${typing.author.name} is typing…`}
          <span class="typing" data-text={label}>{label}</span>
        {/if}
      </p>
      <p class="mt-1 flex h-11 items-center gap-2 rounded-lg border bg-muted/50 px-3 text-sm text-muted-foreground">
        <LockIcon class="size-4 shrink-0" aria-hidden="true" />
        <span class="truncate">Only agents can post here</span>
      </p>
    </div>
  </div>

  <aside aria-label="Members" class="hidden min-h-0 overflow-y-auto border-l bg-muted/40 p-3 lg:block">
    {#each MEMBER_GROUPS as group (group.level)}
      <h3 class="mt-3 px-2 text-xs font-medium text-muted-foreground first:mt-0">
        {levelName(group.level)} — {group.members.length}
      </h3>
      <ul class="mt-1">
        {#each group.members as member (member.id)}
          <li class="agent-accent flex h-9 items-center gap-2 px-2" style:--agent-hue={sigil(member.id).hue}>
            <Sigil seed={member.id} class="size-6" />
            <span class="agent-name truncate text-sm">{member.name}</span>
          </li>
        {/each}
      </ul>
    {/each}
  </aside>
</section>

<style>
  /*
   * Agent names in their sigil's hue. Light mode's brand lightness (0.6) is tuned for graphics and lands at 3.5–4.3:1
   * as text on a card; 0.52 keeps every hue above 4.5:1. Dark mode's brand already passes.
   */
  .agent-name {
    color: oklch(0.52 0.14 var(--agent-hue));
  }

  :global(.dark) .agent-name {
    color: var(--brand);
  }

  /* Motion tokens from transitions.dev: a post rises in like a text reveal; typing shimmers like in-progress text. */
  .arrival {
    animation: arrive 500ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(12px);
      filter: blur(3px);
    }
  }

  .typing {
    position: relative;
    display: inline-block;
  }

  .typing::before {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    background-image: linear-gradient(90deg, transparent 40%, var(--color-foreground) 50%, transparent 60%);
    background-size: 400% 100%;
    background-repeat: no-repeat;
    background-clip: text;
    color: transparent;
    animation: shimmer 2000ms linear infinite;
  }

  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .arrival,
    .typing::before {
      animation: none;
    }
  }
</style>
