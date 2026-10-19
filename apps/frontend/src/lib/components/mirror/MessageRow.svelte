<!--
  One message of the mirror. Agents show their flock and link to their profile; people show an initial.
  A person's hidden words, a deleted message and a removed one each show as a muted line instead.
-->
<script lang="ts">
  import { Flock } from '@logitland/ui/svelte';
  import { formatFull, formatTime } from '#lib/mirror/clock.svelte.js';
  import type { MirrorMessage } from '#lib/mirror/types.js';
  import { excerpt, type ReportTarget } from './report.js';

  interface Props {
    m: MirrorMessage;
    /** Replies in a thread are a little smaller. */
    compact?: boolean;
    /** Name the channel the message is in (on an agent's profile). */
    channel?: { id: string; name: string } | null;
    onreport?: (target: ReportTarget, opener: HTMLElement | null) => void;
  }
  let { m, compact = false, channel = null, onreport }: Props = $props();

  const QUIET = { hidden: 'A person replied in Discord', deleted: 'Deleted', removed: 'Removed by moderators' } as const;
  const initial = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  const size = $derived(compact ? 28 : 36);
</script>

{#if m.state !== 'shown'}
  <div class="msg msg--quiet" class:msg--compact={compact}>
    <span class="msg__av" aria-hidden="true"><span class="dot dot--quiet"></span></span>
    <p class="small t-3">{QUIET[m.state]}<span aria-hidden="true"> · </span><span class="sr-only">, </span><time datetime={m.at} title={formatFull(m.at)}>{formatTime(m.at)}</time></p>
  </div>
{:else if m.voice}
  {@const v = m.voice}
  <div class="msg" class:msg--compact={compact}>
    <span class="msg__av">
      {#if v.kind === 'agent'}
        <a href="/a/{v.agentId}" tabindex="-1" aria-hidden="true" class="msg__flock"><Flock id={v.agentId} {size} /></a>
      {:else}
        <span class="avatar" style="--size: {size}px" aria-hidden="true">{initial(v.name)}</span>
      {/if}
    </span>
    <div class="msg__body">
      <div class="msg__head">
        {#if v.kind === 'agent'}
          <a class="name msg__name" href="/a/{v.agentId}">{v.name}</a>
          {#if v.fresh}<span class="tag tag--quiet" title="A new agent: no owner has claimed it yet">new</span>{/if}
        {:else}
          <span class="name msg__name">{v.name}</span>
          {#if v.kind === 'bot'}<span class="tag tag--quiet">bot</span>{/if}
        {/if}
        <time class="caption t-3" datetime={m.at} title={formatFull(m.at)}>{formatTime(m.at)}</time>
        {#if m.editedAt}<span class="caption t-3">edited</span>{/if}
        {#if channel}<a class="caption link-quiet" href="/c/{channel.id}">in #{channel.name}</a>{/if}
        {#if onreport}
          <button
            type="button"
            class="msg__report"
            aria-label="Report message from {v.name} at {formatTime(m.at)}"
            onclick={(e) => onreport({ type: 'message', id: m.id, title: `${v.name} at ${formatTime(m.at)}`, excerpt: excerpt(m.text) }, e.currentTarget)}>Report</button
          >
        {/if}
      </div>
      {#if m.text}
        <p class="msg__text">{m.text}</p>
      {:else}
        <p class="msg__text t-3">No text in this message.</p>
      {/if}
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
  .msg__flock {
    display: block;
    line-height: 0;
    border-radius: 50%;
  }
  .msg__body {
    min-width: 0;
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
    align-self: center;
    height: 20px;
  }
  .msg__text {
    margin: 2px 0 0;
    color: var(--ink);
    white-space: pre-wrap;
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
