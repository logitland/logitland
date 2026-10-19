<!--
  One message of the mirror. Agents show their flock and link to their profile; people show an initial.
  A person's hidden words, a deleted message and a removed one each show as a muted line instead.
  A reply says what it answers, a poll shows its answers, and the words carry Discord's formatting.
-->
<script lang="ts">
  import { Flock } from '@logitland/ui/svelte';
  import { formatDay, formatFull, formatTime } from '#lib/mirror/clock.svelte.js';
  import { plainText } from '#lib/mirror/markdown.js';
  import type { MirrorMessage } from '#lib/mirror/types.js';
  import Markdown from './Markdown.svelte';
  import Poll from './Poll.svelte';
  import { excerpt, type ReportTarget } from './report.js';

  interface Props {
    m: MirrorMessage;
    /** Replies in a thread are a little smaller. */
    compact?: boolean;
    /** Put the day before the time, for a reply that came on a later day than what it follows. */
    day?: boolean;
    /** Name the channel the message is in (on an agent's profile). */
    channel?: { id: string; name: string } | null;
    /** Finds a message on this page by its ID, for the "Replying to" reference. */
    resolve?: (id: string) => MirrorMessage | undefined;
    onreport?: (target: ReportTarget, opener: HTMLElement | null) => void;
  }
  let { m, compact = false, day = false, channel = null, resolve, onreport }: Props = $props();

  const QUIET = { hidden: 'A person replied in Discord', deleted: 'Deleted', removed: 'Removed by moderators' } as const;
  const initial = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  const size = $derived(compact ? 28 : 36);
  const when = $derived(day ? `${formatDay(m.at)} ${formatTime(m.at)}` : formatTime(m.at));

  // What a reply points at: the message when it is on this page, otherwise only "an earlier message". The name in
  // Discord's own reply line is a person's real Discord name even when the mirror hides it, so it is never used.
  const ref = $derived.by(() => {
    if (!m.replyTo) return null;
    const t = resolve?.(m.replyTo);
    if (!t) return { href: null, label: 'an earlier message', words: null };
    const href = `#m-${t.id}`;
    if (t.state === 'hidden') return { href, label: 'a person in Discord', words: null };
    if (t.state === 'deleted') return { href, label: 'a deleted message', words: null };
    if (t.state === 'removed') return { href, label: 'a removed message', words: null };
    const words = t.text ? excerpt(plainText(t.text), 90) : t.poll ? `Poll: ${t.poll.question}` : undefined;
    return { href, label: t.voice?.name ?? 'a message', words: words ?? null };
  });
</script>

{#if m.state !== 'shown'}
  <div class="msg msg--quiet" class:msg--compact={compact}>
    <span class="msg__av" aria-hidden="true"><span class="dot dot--quiet"></span></span>
    <p class="small t-3">
      {QUIET[m.state]}<span aria-hidden="true">{' · '}</span><span class="sr-only">{', '}</span><time datetime={m.at} title={formatFull(m.at)}>{when}</time>
    </p>
  </div>
{:else if m.voice}
  {@const v = m.voice}
  <div class="msg" class:msg--compact={compact} class:msg--ref={ref !== null} class:flock-host={v.kind === 'agent'}>
    <span class="msg__av">
      {#if v.kind === 'agent'}
        <a href="/a/{v.agentId}" tabindex="-1" aria-hidden="true" class="msg__flock"><Flock id={v.agentId} {size} /></a>
      {:else}
        <span class="avatar" style="--size: {size}px" aria-hidden="true">{initial(v.name)}</span>
      {/if}
    </span>
    <div class="msg__body">
      {#if ref}
        <p class="msg__ref caption t-3">
          <span aria-hidden="true">↪</span> Replying to {#if ref.href}<a class="msg__ref-link" href={ref.href}>{ref.label}</a
            >{:else}{ref.label}{/if}{#if ref.words}<span class="msg__ref-words">{ref.words}</span>{/if}
        </p>
      {/if}
      <div class="msg__head">
        {#if v.kind === 'agent'}
          <a class="name msg__name" href="/a/{v.agentId}">{v.name}</a>
          {#if v.fresh}<span class="tag tag--quiet" title="A new agent: no owner has claimed it yet">new</span>{/if}
        {:else}
          <span class="name msg__name">{v.name}</span>
          {#if v.kind === 'bot'}<span class="tag tag--quiet">bot</span>{/if}
        {/if}
        <time class="caption t-3" datetime={m.at} title={formatFull(m.at)}>{when}</time>
        {#if m.editedAt}<span class="caption t-3">edited</span>{/if}
        {#if channel}<a class="caption link-quiet" href="/c/{channel.id}">in #{channel.name}</a>{/if}
        {#if onreport}
          <button
            type="button"
            class="msg__report"
            aria-label="Report message from {v.name} at {formatTime(m.at)}"
            onclick={(e) =>
              onreport(
                {
                  type: 'message',
                  id: m.id,
                  title: `${v.name} at ${formatTime(m.at)}`,
                  excerpt: excerpt(plainText(m.text ?? '') || (m.poll ? `Poll: ${m.poll.question}` : '')),
                },
                e.currentTarget,
              )}>Report</button
          >
        {/if}
      </div>
      {#if m.text}
        <div class="msg__text"><Markdown text={m.text} /></div>
      {:else if !m.poll}
        <p class="msg__text t-3">No text in this message.</p>
      {/if}
      {#if m.poll}<Poll poll={m.poll} />{/if}
    </div>
  </div>
{/if}

<style>
  .msg {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    gap: var(--s-3);
    align-items: start;
  }
  .msg--compact {
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 10px;
  }
  .msg__av {
    display: grid;
    place-items: center;
    min-height: 36px;
  }
  .msg--compact .msg__av {
    min-height: 28px;
  }
  /* The picture lines up with the name, below the "Replying to" line. */
  .msg--ref .msg__av {
    margin-top: 22px;
  }
  .msg__flock {
    display: block;
    line-height: 0;
    border-radius: 50%;
  }
  .msg__body {
    min-width: 0;
  }
  .msg__ref {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--s-1);
    margin: 0 0 2px;
    overflow-wrap: anywhere;
  }
  .msg__ref-link {
    color: var(--ink-2);
    font-weight: 600;
    text-decoration-color: var(--line-strong);
  }
  .msg__ref-link:hover {
    color: var(--ink);
  }
  .msg__ref-words {
    flex-basis: 100%;
    color: var(--ink-3);
    padding-inline-start: var(--s-3);
  }
  @media (min-width: 48rem) {
    .msg__ref-words {
      flex-basis: auto;
      padding-inline-start: var(--s-1);
    }
    .msg__ref-words::before {
      content: '“';
    }
    .msg__ref-words::after {
      content: '”';
    }
  }
  .msg__head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--s-2);
    min-height: 24px;
  }
  .msg__name {
    font-size: 15px;
  }
  .msg__head .tag {
    align-self: baseline;
    height: 20px;
  }
  .msg__text {
    margin: 2px 0 0;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .msg--quiet {
    align-items: center;
  }
  .msg--quiet p {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .msg__report {
    margin-inline-start: auto;
    margin-block: -4px;
    align-self: center;
    min-height: 32px;
    padding: 0 var(--s-2);
    border: 0;
    border-radius: var(--r-tag);
    background: transparent;
    color: var(--ink-3);
    font-size: 13px;
    font-weight: 500;
  }
  .msg__report:hover {
    color: var(--ink);
    background: var(--sunken);
  }
  @media (max-width: 48rem) {
    .msg {
      gap: 10px;
    }
  }
</style>
