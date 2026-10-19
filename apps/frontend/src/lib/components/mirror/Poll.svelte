<!-- A Discord poll, read-only: the question, how it ends, and each answer with its votes when the relay has them. -->
<script lang="ts">
  import { formatFull } from '#lib/mirror/clock.svelte.js';
  import type { MirrorPoll } from '#lib/mirror/types.js';

  let { poll }: { poll: MirrorPoll } = $props();

  const ended = $derived(poll.results?.final === true || (poll.endsAt !== null && Date.parse(poll.endsAt) <= Date.now()));
  const votes = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'vote' : 'votes'}`;
  // A custom emoji comes through as <:name:id>; show its name.
  const emoji = (e: string) => e.replace(/^<a?:([^:]+):\d+>$/, ':$1:');
</script>

<div class="poll" role="group" aria-label="Poll: {poll.question}">
  <p class="poll__q">{poll.question}</p>
  <p class="caption t-3">
    {poll.multi ? 'Choose any number of answers' : 'Choose one answer'}
    {#if poll.endsAt}<span class="sep" aria-hidden="true">·</span><span class="sr-only">{'. '}</span>{ended ? 'Ended' : 'Ends'}{' '}<time datetime={poll.endsAt}
        >{formatFull(poll.endsAt)}</time
      >{/if}
  </p>
  <ul class="poll__list">
    {#each poll.answers as a (a.id)}
      <li class="poll__a" class:poll__a--lead={a.leading}>
        <span class="poll__row">
          <span class="poll__label"
            >{#if a.emoji}<span class="poll__emoji" aria-hidden="true">{emoji(a.emoji)}</span>{/if}<span>{a.text}</span></span
          >
          {#if a.count !== null}<span class="poll__count small"
              >{votes(a.count)}<span class="sep" aria-hidden="true">·</span><span class="sr-only">{', '}</span>{a.share}%</span
            >{/if}
        </span>
        {#if a.share !== null}<span class="meter poll__bar" aria-hidden="true"><span style="--w: {a.share}%"></span></span>{/if}
      </li>
    {/each}
  </ul>
  <p class="caption t-3">
    {#if poll.results}{votes(poll.results.total)}{poll.results.final ? ', final result' : ' so far'}{:else}The relay has no vote counts for this poll yet.{/if}
  </p>
</div>

<style>
  .poll {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    max-width: 480px;
    margin-top: var(--s-2);
    padding: var(--s-4);
    border-radius: var(--r-panel);
    background: var(--sunken);
  }
  .poll__q {
    margin: 0;
    font-weight: 600;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .poll__list {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin-block: var(--s-1);
    list-style: none;
  }
  .poll__a {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .poll__row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0 var(--s-3);
  }
  .poll__label {
    display: inline-flex;
    align-items: baseline;
    gap: var(--s-2);
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--ink);
  }
  .poll__count {
    color: var(--ink-2);
    white-space: nowrap;
  }
  .sep {
    margin-inline: 0.4em;
  }
  .poll__bar {
    height: 6px;
  }
  .poll__a--lead .poll__label {
    font-weight: 600;
  }
  .poll__a--lead :global(.meter > span) {
    background: var(--ink-2);
  }
</style>
