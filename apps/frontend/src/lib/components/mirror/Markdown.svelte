<!--
  A message's words, with Discord's formatting. The text is parsed into a small tree (see markdown.ts) and
  drawn here as elements, so nothing in a message can add markup. Links open in a new tab.
-->
<script lang="ts">
  import { parseMarkdown, type Inline, type ListBlock } from '#lib/mirror/markdown.js';
  import Spoiler from './Spoiler.svelte';

  let { text }: { text: string } = $props();
  const blocks = $derived(parseMarkdown(text));
</script>

{#snippet inline(nodes: Inline[])}
  {#each nodes as n, i (i)}
    {#if n.type === 'text'}{n.text}
    {:else if n.type === 'code'}<code class="md__code">{n.text}</code>
    {:else if n.type === 'bold'}<strong>{@render inline(n.children)}</strong>
    {:else if n.type === 'italic'}<em>{@render inline(n.children)}</em>
    {:else if n.type === 'underline'}<u>{@render inline(n.children)}</u>
    {:else if n.type === 'strike'}<s>{@render inline(n.children)}</s>
    {:else if n.type === 'spoiler'}<Spoiler>{@render inline(n.children)}</Spoiler>
    {:else if n.type === 'link'}<a class="md__link" href={n.href} target="_blank" rel="nofollow ugc noopener"
        >{@render inline(n.children)}{#if n.masked}{' '}<span class="md__host">{n.host}</span>{/if}<span class="sr-only">{' (opens in a new tab)'}</span></a
      >
    {/if}
  {/each}
{/snippet}

{#snippet list(l: ListBlock)}
  {#if l.ordered}
    <ol class="md__list md__list--ordered" start={l.start}>
      {#each l.items as item, i (i)}<li>
          {@render inline(item.children)}{#each item.sub as s, j (j)}{@render list(s)}{/each}
        </li>{/each}
    </ol>
  {:else}
    <ul class="md__list">
      {#each l.items as item, i (i)}<li>
          {@render inline(item.children)}{#each item.sub as s, j (j)}{@render list(s)}{/each}
        </li>{/each}
    </ul>
  {/if}
{/snippet}

<div class="md">
  {#each blocks as b, i (i)}
    {#if b.type === 'paragraph'}<p class="md__p">{@render inline(b.children)}</p>
    {:else if b.type === 'heading'}<p class="md__p md__h md__h{b.level}">{@render inline(b.children)}</p>
    {:else if b.type === 'subtext'}<p class="md__p md__sub">{@render inline(b.children)}</p>
    {:else if b.type === 'quote'}<blockquote class="md__quote md__p">{@render inline(b.children)}</blockquote>
    {:else if b.type === 'list'}{@render list(b)}
    {:else}<pre class="md__pre"><code>{b.text}</code></pre>
    {/if}
  {/each}
</div>

<style>
  .md {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .md__p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .md__h {
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
    line-height: 1.25;
  }
  .md__h1 {
    font-size: 1.35em;
  }
  .md__h2 {
    font-size: 1.2em;
  }
  .md__h3 {
    font-size: 1.07em;
  }
  .md__list {
    margin: 0;
    padding-inline-start: 1.5em;
    list-style: disc;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-wrap: anywhere;
  }
  .md__list--ordered {
    list-style: decimal;
  }
  .md__list .md__list {
    margin-block-start: 2px;
    list-style: circle;
  }
  .md__list--ordered .md__list--ordered {
    list-style: decimal;
  }
  .md__sub {
    font-size: 12.5px;
    line-height: 1.45;
    color: var(--ink-3);
  }
  .md__quote {
    padding-inline-start: var(--s-3);
    border-inline-start: 3px solid var(--line-strong);
    color: var(--ink-2);
  }
  .md__code {
    padding: 1px 5px;
    border-radius: var(--r-tag);
    background: var(--sunken);
    font-size: 0.9em;
  }
  .md__pre {
    margin: 0;
    padding: var(--s-3);
    border-radius: var(--r-panel);
    background: var(--sunken);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .md__pre code {
    font-size: inherit;
  }
  .md__host {
    font-size: 0.85em;
    color: var(--ink-3);
    text-decoration: none;
    white-space: nowrap;
  }
  .md__link {
    overflow-wrap: anywhere;
  }
</style>
