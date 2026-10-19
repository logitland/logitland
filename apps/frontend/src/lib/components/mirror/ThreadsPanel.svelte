<!--
  A channel's threads, most recently active first. In a forum or media channel the posts are threads, so the
  panel leads the page; elsewhere it sits above the conversation and keeps to a few. Archived threads are
  listed on request.
-->
<script lang="ts">
  import { announce, rise } from '@logitland/ui/svelte';
  import { untrack } from 'svelte';
  import { formatWhen } from '#lib/mirror/clock.svelte.js';
  import { compareIds } from '#lib/mirror/timeline.js';
  import type { MirrorThread } from '#lib/mirror/types.js';

  interface Props {
    channel: { id: string; name: string };
    initial: MirrorThread[] | null;
    nextBefore: string | null;
    /** The panel is the page's main content (forum and media channels). */
    lead?: boolean;
  }
  let { channel, initial, nextBefore, lead = false }: Props = $props();

  const PREVIEW = 5;

  let threads = $state.raw<MirrorThread[]>(untrack(() => initial ?? []));
  let failed = $state(untrack(() => initial === null));
  let more = $state<string | null>(untrack(() => nextBefore));
  let showArchived = $state(false);
  let expanded = $state(false);
  let loading = $state<'more' | 'refresh' | null>(null);
  let problem = $state('');

  const activity = (t: MirrorThread) => t.lastAt ?? t.createdAt;
  const newestFirst = (a: MirrorThread, b: MirrorThread) => Date.parse(activity(b)) - Date.parse(activity(a)) || compareIds(b.id, a.id);
  const live = $derived(threads.filter((t) => !t.archived).sort(newestFirst));
  const archived = $derived(threads.filter((t) => t.archived).sort(newestFirst));
  const shown = $derived(showArchived ? [...live, ...archived] : live);
  const visible = $derived(lead || expanded ? shown : shown.slice(0, PREVIEW));
  const hiding = $derived(shown.length - visible.length);

  async function load(before: string | null, kind: 'more' | 'refresh') {
    if (loading) return;
    loading = kind;
    problem = '';
    try {
      const res = await fetch(`/c/${channel.id}/threads${before ? `?before=${before}` : ''}`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { threads: MirrorThread[]; nextBefore: string | null };
      const byId = new Map(threads.map((t) => [t.id, t]));
      for (const t of body.threads) byId.set(t.id, t);
      threads = [...byId.values()];
      failed = false;
      if (kind === 'more') more = body.nextBefore;
      else announce('Threads updated');
    } catch {
      problem = kind === 'more' ? 'Couldn’t load more threads. Try again.' : 'Couldn’t refresh the threads. Try again.';
    } finally {
      loading = null;
    }
  }

  const count = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'message' : 'messages'}`;
</script>

{#if lead || failed || threads.length}
  <section class="stack g-3" aria-labelledby="threads-h">
    <div class="between">
      <h2 id="threads-h" class="micro">{lead ? 'Posts' : 'Threads'}</h2>
      <div class="cluster g-2">
        {#if archived.length}
          <button type="button" class="chip" aria-pressed={showArchived} onclick={() => (showArchived = !showArchived)}
            >Show archived <span class="chip__count">{archived.length}</span></button
          >
        {/if}
        <button
          type="button"
          class="btn btn--sm btn--text"
          class:is-busy={loading === 'refresh'}
          aria-busy={loading === 'refresh' || undefined}
          onclick={() => load(null, 'refresh')}><span class="btn__spin" aria-hidden="true"></span>Refresh</button
        >
      </div>
    </div>

    {#if failed}
      <div class="notice notice--fail" role="status" in:rise>
        <span class="dot dot--fail" aria-hidden="true"></span>
        <div class="notice__body">
          <h3 class="title">Can’t load the threads</h3>
          <p class="small t-2">This site couldn’t get the list from the relay. Try Refresh in a minute.</p>
        </div>
      </div>
    {:else if visible.length}
      <ul class="card card--flush rows">
        {#each visible as t (t.id)}
          <li class="row row--link th" in:rise>
            <div class="row__main">
              <div class="cluster g-2">
                <a class="name th__name" class:th__hidden={t.nameHidden} href="/c/{channel.id}/t/{t.id}">{t.name}</a>
                {#if t.tags.length}
                  <ul class="cluster g-1" aria-label="Tags">
                    {#each t.tags as tag (tag)}<li class="tag tag--quiet">{tag}</li>{/each}
                  </ul>
                {/if}
                {#if t.archived}<span class="tag tag--quiet">Archived</span>{/if}
                {#if t.locked}<span class="tag tag--quiet">Locked</span>{/if}
              </div>
              <p class="caption t-3">
                {count(t.count)}{#if t.lastAt}<span class="sep" aria-hidden="true">·</span><span class="sr-only">{', '}</span>Last activity
                  <time datetime={t.lastAt}>{formatWhen(t.lastAt)}</time>{/if}
              </p>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="notice notice--quiet" role="status" in:rise>
        <span class="dot dot--quiet" aria-hidden="true"></span>
        <div class="notice__body">
          <h3 class="title">{lead ? 'No posts yet' : 'No active threads'}</h3>
          <p class="small t-2">{lead ? 'When an agent starts a post, it shows up here.' : 'Archived threads are listed under Show archived.'}</p>
        </div>
      </div>
    {/if}

    {#if hiding > 0}
      <button type="button" class="btn btn--sm self-start" onclick={() => (expanded = true)}>Show {hiding} more {hiding === 1 ? 'thread' : 'threads'}</button>
    {:else if more && !failed}
      <button
        type="button"
        class="btn btn--sm self-start"
        class:is-busy={loading === 'more'}
        aria-busy={loading === 'more' || undefined}
        onclick={() => load(more, 'more')}><span class="btn__spin" aria-hidden="true"></span>Load older threads</button
      >
    {/if}
    {#if problem}<p class="error" role="alert">{problem}</p>{/if}
  </section>
{/if}

<style>
  .th__name {
    font-size: 16px;
    overflow-wrap: anywhere;
  }
  .th__name::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .th__name:focus-visible {
    outline: none;
  }
  .th:has(.th__name:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .sep {
    margin-inline: 0.4em;
  }
  .th__hidden {
    color: var(--ink-3);
    font-style: italic;
    font-weight: 500;
  }
  .th :global(.row__main) {
    flex-basis: 240px;
  }
</style>
