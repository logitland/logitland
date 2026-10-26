<!--
  The current page as Markdown: a link to its `.md` version and a button that copies it. The web app and the docs
  both render it, styled by the shared theme (`@logitland/tokens/theme.css`), so it looks the same everywhere.
  The caller passes the page's Markdown URL; the fetch sends the session cookie, so dashboard pages copy what the
  signed-in person sees.
-->
<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Copy from '@lucide/svelte/icons/copy';
  import FileText from '@lucide/svelte/icons/file-text';

  let { href, class: className }: { href: string; class?: string } = $props();

  const MESSAGES = { idle: '', copied: 'Copied', failed: 'Couldn’t copy. Open Markdown and copy it there.' };
  let status = $state<keyof typeof MESSAGES>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const RESET_AFTER_MS = 2000;
  $effect(() => () => clearTimeout(timer));

  async function markdown() {
    const response = await fetch(href, { credentials: 'same-origin', headers: { accept: 'text/markdown' } });
    if (!response.ok) throw new Error(`${href} answered ${response.status}`);
    return new Blob([await response.text()], { type: 'text/plain' });
  }

  async function copy() {
    try {
      // A promised ClipboardItem keeps the click's user activation through the fetch, which Safari requires.
      if (typeof ClipboardItem !== 'undefined') await navigator.clipboard.write([new ClipboardItem({ 'text/plain': markdown() })]);
      else await navigator.clipboard.writeText(await (await markdown()).text());
      status = 'copied';
    } catch (error) {
      console.error(error);
      status = 'failed';
    }
    clearTimeout(timer);
    timer = setTimeout(() => (status = 'idle'), RESET_AFTER_MS);
  }
</script>

<!-- data-slot: the web app's HTML-to-Markdown conversion leaves this control out of a page's Markdown. -->
<div class={['page-markdown', className]} data-slot="page-markdown" role="group" aria-label="This page as Markdown">
  <!-- rel=external: SvelteKit loads it from the server instead of routing it, and its prerender crawler skips it. -->
  <a {href} rel="external" class="item">
    <FileText aria-hidden="true" />
    <span class="label">Markdown</span>
  </a>
  <button type="button" class="item" aria-label="Copy as Markdown" title={MESSAGES[status] || 'Copy as Markdown'} onclick={copy}>
    {#if status === 'copied'}<Check aria-hidden="true" />{:else if status === 'failed'}<CircleAlert class="failed" aria-hidden="true" />{:else}<Copy
        aria-hidden="true"
      />{/if}
  </button>
  <span class="status" role="status">{MESSAGES[status]}</span>
</div>

<style>
  .page-markdown {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: stretch;
    /* The web app's control height (h-9). */
    block-size: 2.25rem;
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) * 0.8);
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1;
  }

  .item {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding-inline: 0.625rem;
    border: 0;
    border-radius: inherit;
    background: transparent;
    color: var(--muted-foreground);
    font: inherit;
    text-decoration: none;
    cursor: pointer;
    transition:
      background-color 150ms,
      color 150ms;
  }

  .item + .item {
    border-inline-start: 1px solid var(--border);
    border-start-start-radius: 0;
    border-end-start-radius: 0;
  }

  .item:first-child {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
  }

  .item:hover {
    background: var(--accent);
    color: var(--foreground);
  }

  .item:focus-visible {
    outline: none;
    /* Opaque, like the web app's rings: 3:1 or more against every surface (see theme.css). */
    box-shadow: 0 0 0 3px var(--ring);
  }

  .item :global(svg) {
    inline-size: 1rem;
    block-size: 1rem;
  }

  .item :global(.failed) {
    color: var(--destructive);
  }

  /* The status is announced, not shown: the check icon is the visible result. On phones the link keeps its name but
     shows only its icon, so the control fits a header beside two others. */
  .status {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  @media (width < 30rem) {
    .label {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .item {
      transition: none;
    }
  }
</style>
