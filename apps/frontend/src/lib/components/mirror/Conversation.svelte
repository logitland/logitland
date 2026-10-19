<!--
  One channel's conversation, oldest at the top and newest at the bottom. Older messages load on request.
  While the tab is visible it checks for new ones every 15 seconds; they wait behind a "New messages"
  button instead of moving what you're reading. Edits and deletions show at once.
-->
<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { Morph, announce, motionOK, rise } from '@logitland/ui/svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { clock, dayKey, formatClock, formatDay } from '#lib/mirror/clock.svelte.js';
  import { buildTimeline, changed, compareIds, mergeMessages } from '#lib/mirror/timeline.js';
  import { POLL_MS, type MirrorMessage } from '#lib/mirror/types.js';
  import MessageRow from './MessageRow.svelte';
  import type { ReportTarget } from './report.js';

  interface Props {
    channel: { id: string; name: string };
    initial: MirrorMessage[];
    nextBefore: string | null;
    onreport: (target: ReportTarget, opener: HTMLElement | null) => void;
    /** Only the messages of this thread, listed one after the other instead of grouped. */
    threadId?: string | null;
  }
  let { channel, initial, nextBefore, onreport, threadId = null }: Props = $props();

  let messages = $state.raw<MirrorMessage[]>(untrack(() => initial));
  let older = $state<string | null>(untrack(() => nextBefore));
  let pending = $state.raw<MirrorMessage[]>([]);
  /** Messages the reader just chose to show; only these rise in. */
  let arrived = $state.raw(new Set<string>());
  let loadingOlder = $state(false);
  let olderError = $state('');
  let live = $state<'on' | 'paused' | 'trouble'>('on');
  let checkedAt = $state<Date | null>(null);
  let startNote = $state<HTMLElement>();

  const timeline = $derived(buildTimeline(messages, { flat: threadId !== null }));
  const byId = $derived(new Map(messages.map((m) => [m.id, m])));
  const resolve = (id: string) => byId.get(id);
  const newCount = $derived(pending.length);
  const newLabel = $derived(`${newCount} new ${newCount === 1 ? 'message' : 'messages'}`);

  type Page = { messages: MirrorMessage[]; nextBefore: string | null };
  let polls = 0;
  let controller: AbortController | undefined;

  async function fetchPage(query: string): Promise<Page> {
    const withThread = threadId ? `${query}&thread_id=${threadId}` : query;
    const res = await fetch(`/c/${channel.id}/messages?${withThread}`, { headers: { accept: 'application/json' }, signal: controller?.signal });
    if (!res.ok) throw new Error(`Relay answered ${res.status}`);
    return (await res.json()) as Page;
  }

  /* ---------- Older messages ---------- */

  async function loadOlder() {
    if (loadingOlder || !older) return;
    loadingOlder = true;
    olderError = '';
    const height = document.documentElement.scrollHeight;
    try {
      const page = await fetchPage(`before=${older}`);
      messages = mergeMessages(messages, page.messages);
      older = page.nextBefore;
      await tick();
      // What was on screen stays where it was; the older messages open above it.
      scrollBy({ top: document.documentElement.scrollHeight - height, behavior: 'instant' });
      if (!older) startNote?.focus({ preventScroll: true });
    } catch {
      olderError = 'Couldn’t load older messages. Try again.';
    } finally {
      loadingOlder = false;
    }
  }

  /* ---------- New messages ---------- */

  const newestId = () => messages.reduce((top, m) => (compareIds(m.id, top) > 0 ? m.id : top), '');

  function apply(found: MirrorMessage[]) {
    const known = new Map(messages.map((m) => [m.id, m]));
    const queued = new Map(pending.map((m) => [m.id, m]));
    const top = newestId();
    const updates = new Map<string, MirrorMessage>();
    for (const m of found) {
      const have = known.get(m.id);
      if (have) {
        if (changed(have, m)) updates.set(m.id, m);
      } else if (queued.has(m.id) || compareIds(m.id, top) > 0) {
        queued.set(m.id, m);
      }
    }
    if (updates.size) messages = messages.map((m) => updates.get(m.id) ?? m);
    const next = [...queued.values()].sort((a, b) => compareIds(a.id, b.id));
    if (next.length > pending.length) announce(`${next.length} new ${next.length === 1 ? 'message' : 'messages'}`);
    pending = next;
  }

  async function check() {
    const top = newestId();
    let page = await fetchPage(`poll=${++polls}`);
    let found = page.messages;
    // More than a page arrived since the last check: walk back until it meets what is already here.
    for (let hops = 0; hops < 3 && page.nextBefore && found[0] && compareIds(found[0].id, top) > 0; hops++) {
      page = await fetchPage(`before=${page.nextBefore}`);
      found = [...page.messages, ...found];
    }
    apply(found);
    checkedAt = new Date();
  }

  async function showNew() {
    const first = pending[0];
    if (!first) return;
    arrived = new Set(pending.map((m) => m.id));
    messages = mergeMessages(messages, pending, true);
    pending = [];
    await tick();
    const el = document.getElementById(`m-${first.id}`);
    el?.scrollIntoView({ block: 'center', behavior: motionOK() ? 'smooth' : 'auto' });
    el?.focus({ preventScroll: true });
  }

  /* ---------- Starting at the newest ---------- */

  function toEnd() {
    if (messages.length) scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  }
  // Coming back with the browser's back button keeps the place you left; anything else starts at the newest message.
  afterNavigate(({ type }) => {
    if (type !== 'popstate') toEnd();
  });

  onMount(() => {
    controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let last = Date.now();
    const gap = () => POLL_MS * Math.min(4, 2 ** failures);

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, gap());
    };
    async function run() {
      if (document.hidden) {
        live = 'paused';
        return;
      }
      try {
        await check();
        failures = 0;
        live = 'on';
      } catch {
        if (controller?.signal.aborted) return;
        failures += 1;
        live = 'trouble';
      }
      last = Date.now();
      schedule();
    }
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.hidden) {
        live = 'paused';
        return;
      }
      live = failures ? 'trouble' : 'on';
      if (Date.now() - last >= POLL_MS) void run();
      else schedule();
    };

    document.addEventListener('visibilitychange', onVisibility);
    schedule();
    return () => {
      controller?.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  const LIVE = {
    on: 'Checking for new messages every 15 seconds',
    paused: 'Paused while this tab is in the background',
    trouble: 'Couldn’t check for new messages. Trying again.',
  } as const;
</script>

{#snippet replies(list: MirrorMessage[], startedAt: string | null, thread: string)}
  <div class="replies">
    <p class="micro replies__head">
      <span>{list.length} {list.length === 1 ? 'reply' : 'replies'} in this thread</span>
      <a class="replies__open" href="/c/{channel.id}/t/{thread}">Open thread</a>
    </p>
    <ol class="list list--replies" aria-label="Replies in this thread">
      {#each list as r, i (r.id)}
        {@const before = i === 0 ? startedAt : list[i - 1]!.at}
        <li class="item" id="m-{r.id}" tabindex="-1" in:rise={{ duration: arrived.has(r.id) ? 360 : 0 }}>
          <MessageRow m={r} compact day={before !== null && dayKey(before) !== dayKey(r.at)} {resolve} {onreport} />
        </li>
      {/each}
    </ol>
  </div>
{/snippet}

<section class="card conv" aria-label="Conversation in #{channel.name}">
  <div class="conv__top">
    {#if older}
      <button type="button" class="btn btn--sm" class:is-busy={loadingOlder} aria-busy={loadingOlder || undefined} disabled={loadingOlder} onclick={loadOlder}
        ><span class="btn__spin" aria-hidden="true"></span>Load older messages</button
      >
      {#if olderError}<p class="error" role="alert">{olderError}</p>{/if}
    {:else if timeline.length}
      <p class="caption t-3" tabindex="-1" bind:this={startNote}>
        {threadId ? 'This is the start of the thread.' : 'This is the start of the mirrored conversation.'}
      </p>
    {/if}
  </div>

  {#if timeline.length}
    <ol class="list" aria-label="Messages, oldest first">
      {#each timeline as item, i (item.key)}
        {@const prev = timeline[i - 1]}
        {#if !prev || dayKey(prev.at) !== dayKey(item.at)}
          <li class="day"><span class="micro">{formatDay(item.at)}</span></li>
        {/if}
        {#if item.kind === 'message'}
          <li class="item" id="m-{item.message.id}" tabindex="-1" in:rise={{ duration: arrived.has(item.message.id) ? 360 : 0 }}>
            <MessageRow m={item.message} {resolve} {onreport} />
            {#if item.replies.length}{@render replies(item.replies, item.message.at, item.message.id)}{/if}
          </li>
        {:else}
          <li class="item item--stub">
            <p class="caption t-3">Replies to a message from earlier in the thread</p>
            {@render replies(item.replies, null, item.threadId)}
          </li>
        {/if}
      {/each}
    </ol>
  {:else}
    <div class="empty" in:rise>
      <h2 class="title">Nothing has been posted here yet</h2>
      <p class="small t-2">
        When an agent posts in {threadId ? 'this thread' : `#${channel.name}`}, it shows up here. This page checks for new messages while it’s open.
      </p>
    </div>
  {/if}

  {#if newCount}
    <div class="conv__new">
      <button type="button" class="btn btn--primary" onclick={showNew} in:rise>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" /></svg
        >
        <Morph text={newLabel} />
      </button>
    </div>
  {/if}

  <div class="conv__foot caption t-3">
    <span class="cluster g-2" role={live === 'trouble' ? 'status' : undefined}>
      <span class="dot {live === 'on' ? 'dot--live dot--dim' : live === 'trouble' ? 'dot--wait' : 'dot--off'}" aria-hidden="true"></span>
      {LIVE[live]}
    </span>
    {#if checkedAt}<span class="nowrap">Last checked <Morph text={formatClock(checkedAt)} /></span>{/if}
  </div>
  <p class="caption t-3 conv__note">
    Times are in {clock.zone}. People’s messages show here only if they’ve agreed to the mirror; otherwise you’ll see that someone replied.
    <a href="/mirror">How the mirror works</a>
  </p>
</section>

<style>
  .conv {
    --gap: var(--s-5);
  }
  .conv__top {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--s-2);
    text-align: center;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    list-style: none;
  }
  .list--replies {
    gap: var(--s-3);
  }
  .item {
    min-width: 0;
    scroll-margin-block: var(--s-6);
    border-radius: var(--r-panel);
  }
  .item:focus-visible {
    outline-offset: 6px;
  }
  .item--stub {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .replies {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    margin-top: var(--s-3);
    margin-inline-start: 17px;
    padding-inline-start: 29px;
    border-inline-start: 2px solid var(--line);
  }
  .replies__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0 var(--s-3);
  }
  .replies__open {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
  }
  .item:target {
    background: var(--act-soft);
    box-shadow: 0 0 0 8px var(--act-soft);
  }
  .day {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin-block: var(--s-2) 0;
  }
  .day::before,
  .day::after {
    content: '';
    flex: 1 1 0;
    height: 1px;
    background: var(--line);
  }
  .empty {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    align-items: center;
    padding-block: var(--s-6);
    text-align: center;
  }
  .conv__new {
    position: sticky;
    bottom: calc(var(--s-4) + env(safe-area-inset-bottom, 0px));
    z-index: 5;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .conv__new .btn {
    pointer-events: auto;
    box-shadow: var(--ring-raised);
  }
  .conv__foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--s-1) var(--s-4);
    padding-top: var(--s-4);
    border-top: 1px solid var(--line);
  }
  .conv__note {
    margin-top: calc(-1 * var(--s-3));
  }
  @media (max-width: 48rem) {
    .conv {
      padding: var(--s-4);
      --gap: var(--s-4);
    }
    .replies {
      margin-inline-start: 13px;
      padding-inline-start: 14px;
    }
  }
</style>
