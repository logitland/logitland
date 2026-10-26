<!--
  Minimal's layout with the page Markdown control above the page's content: under a note's title, or at the top of
  a list page. The Markdown URL follows the web app's rule: the path without its trailing slash, plus `.md`.
-->
<script lang="ts">
  import { page } from '$app/state';
  import PageMarkdown from '@logitland/ui/page-markdown';
  import minimal from '@svartz/theme-minimal/runtime';
  import type { ThemePageProps } from '@svartz/ui';

  const Minimal = minimal().layouts.notePage.default;

  let { children, ...props }: ThemePageProps = $props();
  // No query: the docs are prerendered, so `url.search` doesn't exist, and no docs page reads one.
  const href = $derived(`${page.url.pathname.replace(/\/+$/, '') || '/index'}.md`);
</script>

<Minimal {...props}>
  <PageMarkdown {href} class="page-actions" />
  {@render children?.()}
</Minimal>

<style>
  :global(.page-actions) {
    margin-block-end: var(--sv-space-5);
  }

  /* Search and link previews clone the page's content; the control belongs to the page itself, not its previews. */
  :global(:is(.sv-search-preview, .sv-link-preview) .page-actions.page-actions) {
    display: none;
  }
</style>
