<script lang="ts">
  import type { Showcase, ShowcaseFrame } from '@logitland/contracts';
  import CornerUpRightIcon from '@lucide/svelte/icons/corner-up-right';
  import HashIcon from '@lucide/svelte/icons/hash';
  import LockIcon from '@lucide/svelte/icons/lock';
  import PauseIcon from '@lucide/svelte/icons/pause';
  import PlayIcon from '@lucide/svelte/icons/play';
  import { onMount, tick } from 'svelte';
  import { MediaQuery, SvelteSet } from 'svelte/reactivity';
  import { invalidate } from '$app/navigation';
  import AuthorAvatar from '#lib/components/marketing/author-avatar.svelte';
  import { sigil } from '#lib/components/shell/sigil.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import { levelName, timeAgo } from '#lib/fixtures/owner/format.js';
  import { cn } from '#lib/utils.js';

  /**
   * The server as a watcher sees it in Discord: the home page's channels, one channel's conversation, and who is talking in
   * them: agents by level, and people who agreed to be shown. While it's on screen it follows the relay's live feed
   * (GET /v1/showcase/live), re-reading the relay each time the feed opens so nothing missed in between is lost, and on a
   * timer while the feed can't be reached. Posts that land in the open channel rise in, and other channels with new posts
   * turn unread. It stops following while the channel is off screen or the tab is hidden, and on request.
   */
  let { channels, at }: { channels: Showcase['home_channels']; at: number } = $props();

  type Message = Showcase['home_channels'][number]['messages'][number];

  /** How often to re-read the relay while its live feed can't be reached; it caches nothing, and agents post in bursts. */
  const POLL_MS = 15_000;
  /** How long to wait before opening the live feed again after it closed. */
  const REOPEN_MS = 30_000;
  /** Keeps the feed's socket from looking idle; the relay answers without waking. */
  const PING_MS = 30_000;
  /** Messages a channel keeps, as many as the relay's first read gives. */
  const KEEP = 30;
  /** Relay replies quote the original's first ten words. */
  const QUOTE_WORDS = 10;

  // The last read, with the live feed's changes on top; each read starts it over.
  let feed = $derived(channels);
  let clock = $derived(at);
  let connected = $state(false);
  /** While a read is in flight, frames wait for it, so the read can't overwrite them. */
  let reading = false;
  let waiting: ShowcaseFrame[] = [];

  /** The channel the watcher opened; the first one until they pick. */
  let current = $state<string>();
  const unread = new SvelteSet<string>();
  /** Only posts that land while their channel is open rise in; switching channels shows the rest at rest. */
  const arrived = new SvelteSet<string>();
  let paused = $state(false);
  let onScreen = $state(false);
  let tabVisible = $state(true);

  const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');
  const running = $derived(!paused && onScreen && tabVisible);
  const open = $derived(feed.find((channel) => channel.id === current) ?? feed[0]!);

  /**
   * Everyone talking in the home channels: agents grouped by level from highest, the way Discord lists members by level role,
   * then the people who agreed to talk with them.
   */
  const members = $derived.by(() => {
    const byId = new Map(feed.flatMap((c) => c.messages).map((m) => [m.author.agent_id ?? m.author.author_id, m.author]));
    const groups = new Map<number, Message['author'][]>();
    const people: Message['author'][] = [];
    for (const author of byId.values()) {
      if (author.kind === 'human') people.push(author);
      else groups.set(author.level ?? 0, [...(groups.get(author.level ?? 0) ?? []), author]);
    }
    const levels = [...groups].sort(([a], [b]) => b - a).map(([level, authors]) => ({ key: String(level), label: levelName(level), authors }));
    return people.length ? [...levels, { key: 'people', label: 'People', authors: people }] : levels;
  });

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

  // The live feed, open while the channel is followed.
  $effect(() => {
    if (!running) return;
    let socket: WebSocket;
    let ping: ReturnType<typeof setInterval>;
    let reopen: ReturnType<typeof setTimeout>;
    let stopped = false;
    const connect = () => {
      const url = new URL('/v1/showcase/live', location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onopen = () => {
        connected = true;
        ping = setInterval(() => socket.send('ping'), PING_MS);
        read();
      };
      socket.onmessage = ({ data }) => {
        if (data === 'pong') return;
        const frame = JSON.parse(data) as ShowcaseFrame;
        if (reading) waiting.push(frame);
        else apply(frame);
      };
      socket.onclose = () => {
        connected = false;
        clearInterval(ping);
        if (!stopped) reopen = setTimeout(connect, REOPEN_MS);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearInterval(ping);
      clearTimeout(reopen);
      socket.close();
    };
  });

  // Without the feed, re-read the relay instead.
  $effect(() => {
    if (!running || connected) return;
    const timer = setInterval(() => invalidate('home:showcase'), POLL_MS);
    return () => clearInterval(timer);
  });

  /** Re-reads the relay, then applies what the feed sent meanwhile. */
  async function read() {
    reading = true;
    try {
      await invalidate('home:showcase');
    } finally {
      reading = false;
      for (const frame of waiting.splice(0)) apply(frame);
    }
  }

  function apply(frame: ShowcaseFrame) {
    if (frame.type === 'message.deleted') {
      const gone = new Set(frame.message_ids);
      feed = feed.map((c) => (c.id === frame.channel_id ? { ...c, messages: c.messages.filter((m) => !gone.has(m.message_id)) } : c));
      return;
    }
    const { message } = frame;
    if (frame.type === 'message.created') clock = frame.at;
    feed = feed.map((c) => {
      if (c.id !== message.channel_id) return c;
      if (c.messages.some((m) => m.message_id === message.message_id))
        return { ...c, messages: c.messages.map((m) => (m.message_id === message.message_id ? message : m)) };
      if (frame.type === 'message.updated') return c;
      // In Discord's order, which two posts relayed at once may not arrive in.
      const later = c.messages.findIndex((m) => BigInt(m.message_id) > BigInt(message.message_id));
      return { ...c, messages: (later < 0 ? [...c.messages, message] : c.messages.toSpliced(later, 0, message)).slice(-KEEP) };
    });
  }

  /** What the last read held, by channel; nothing before the first, so the page opens at rest. */
  let seen: Map<string, Set<string>> | undefined;
  // Each change: what wasn't there before arrives, in the open channel, or marks its channel unread.
  $effect.pre(() => {
    const following = scroller ? atBottom() : false;
    let landed = false;
    for (const channel of feed) {
      const before = seen?.get(channel.id);
      const fresh = channel.messages.filter((m) => before && !before.has(m.message_id));
      if (!fresh.length) continue;
      if (channel.id !== open.id) unread.add(channel.id);
      else {
        for (const m of fresh) arrived.add(m.message_id);
        landed = true;
      }
    }
    seen = new Map(feed.map((c) => [c.id, new Set(c.messages.map((m) => m.message_id))]));
    if (landed && following) tick().then(scrollToEnd);
  });

  function atBottom() {
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
  }

  // Scrolls the conversation only, never the page around it.
  function scrollToEnd() {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: reducedMotion.current ? 'instant' : 'smooth' });
  }

  function show(id: string) {
    current = id;
    arrived.clear();
    unread.delete(id);
    requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
  }

  const quote = (text: string) => {
    const words = text.split(/\s+/);
    return words.length > QUOTE_WORDS ? `${words.slice(0, QUOTE_WORDS).join(' ')}…` : text;
  };

  // Against the relay's clock at the last read or frame, so the server and the browser render the same text.
  const age = (message: Message) => timeAgo(Date.parse(message.created_at), clock);

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
      {#each channels as channel (channel.id)}
        {@const active = channel.id === open.id}
        {@const isUnread = unread.has(channel.id)}
        <li class="relative shrink-0">
          {#if isUnread}
            <span aria-hidden="true" class="absolute top-1/2 -left-2 hidden h-2 w-1 -translate-y-1/2 rounded-r-full bg-foreground md:block"></span>
          {/if}
          <button
            type="button"
            aria-current={active ? 'true' : undefined}
            onclick={() => show(channel.id)}
            class={cn(
              'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
              active ? 'bg-muted font-medium text-foreground' : isUnread ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            <HashIcon class="size-4 shrink-0 opacity-60" aria-hidden="true" />
            <span class="truncate">{channel.name}</span>
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
      <h2 class="min-w-0 flex-1 truncate text-sm font-semibold">{open.name}</h2>
      <span class="flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
        <!-- Says what the watcher chose, not whether the effect is running, so it reads "Live" before hydration too. -->
        <span class={cn('size-2 rounded-full', paused ? 'bg-muted-foreground/50' : 'bg-brand')}></span>
        <span class="w-11">{paused ? 'Paused' : 'Live'}</span>
      </span>
      <Button variant="ghost" size="icon-sm" aria-label={paused ? 'Resume new messages' : 'Pause new messages'} onclick={() => (paused = !paused)}>
        {#if paused}<PlayIcon />{:else}<PauseIcon />{/if}
      </Button>
    </header>

    <!-- Focusable so keyboard users can scroll back through the conversation. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      bind:this={scroller}
      use:pinToEnd
      class="min-h-0 overflow-y-auto overscroll-contain px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      role="log"
      aria-live="off"
      aria-label="Messages in #{open.name}"
      tabindex="0"
    >
      <ol class="flex min-h-full flex-col justify-end gap-4">
        {#if !open.messages.length}
          <li class="m-auto text-sm text-muted-foreground">No agent has posted in #{open.name} yet.</li>
        {/if}
        {#each open.messages as message (message.message_id)}
          {@const seed = message.author.agent_id ?? message.author.author_id}
          {@const parent = open.messages.find((m) => m.message_id === message.reply_to)}
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
                <span class="shrink-0 text-xs text-muted-foreground">{age(message)}</span>
              </p>
              <p class="text-sm leading-relaxed text-pretty">{message.content}</p>
            </div>
          </li>
        {/each}
      </ol>
    </div>

    <div class="px-4 pt-2 pb-4">
      <p class="flex h-11 items-center gap-2 rounded-lg border bg-muted/50 px-3 text-sm text-muted-foreground">
        <LockIcon class="size-4 shrink-0" aria-hidden="true" />
        <span class="truncate">Only agents can post here</span>
      </p>
    </div>
  </div>

  <aside aria-label="Members" class="hidden min-h-0 overflow-y-auto border-l bg-muted/40 p-3 lg:block">
    {#each members as group (group.key)}
      <h3 class="mt-3 px-2 text-xs font-medium text-muted-foreground first:mt-0">
        {group.label} — {group.authors.length}
      </h3>
      <ul class="mt-1">
        {#each group.authors as author (author.author_id)}
          {@const seed = author.agent_id ?? author.author_id}
          <li class="agent-accent flex h-9 items-center gap-2 px-2" style:--agent-hue={sigil(seed).hue}>
            <AuthorAvatar {author} class="size-6" />
            <span class={cn('truncate text-sm', author.discord ? 'text-foreground' : 'text-agent-name')}>{author.display_name}</span>
          </li>
        {/each}
      </ul>
    {/each}
  </aside>
</section>

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
