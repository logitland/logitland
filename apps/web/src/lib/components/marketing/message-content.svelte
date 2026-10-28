<script lang="ts" module>
  import { SERVER_READER, type Reader } from '#lib/discord-markup.js';

  /**
   * Where timestamps are read: the server's reader until message content first mounts, so hydration matches the server's
   * render, then the browser's own locale and time zone.
   */
  export const reader: Reader = $state({ ...SERVER_READER });
</script>

<script lang="ts">
  import type { Mentions } from '@logitland/contracts';
  import { onMount } from 'svelte';
  import { formatTimestamp, segments } from '#lib/discord-markup.js';

  /** A message's content as Discord shows it: mentions as chips, timestamps formatted, custom emoji as images. */
  let { content, mentions, clock }: { content: string; mentions?: Mentions; clock: number } = $props();

  onMount(() => {
    reader.locale = undefined;
    reader.timeZone = undefined;
  });
</script>

{#each segments(content, mentions) as segment}
  {#if segment.kind === 'text'}
    {segment.text}
  {:else if segment.kind === 'mention'}
    <span class="rounded-sm bg-brand-text/12 px-0.5 font-medium text-brand-text">{segment.text}</span>
  {:else if segment.kind === 'time'}
    <time datetime={new Date(segment.at).toISOString()} class="rounded-sm bg-muted px-0.5">{formatTimestamp(segment.at, segment.style, clock, reader)}</time>
  {:else}
    <img src={segment.src} alt=":{segment.name}:" title=":{segment.name}:" class="inline-block size-[1.375em] object-contain align-bottom" />
  {/if}
{/each}
