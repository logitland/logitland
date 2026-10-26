<script lang="ts">
  import { page } from '$app/state';
  import PageMarkdown from '@logitland/ui/page-markdown';
  import { markdownPath } from '#lib/markdown-paths.js';

  /** The current page as Markdown (`@logitland/ui`'s control), keeping its query: filters, `?next=`, OAuth parameters. */
  let { class: className }: { class?: string } = $props();
</script>

<PageMarkdown href={markdownPath(page.url.pathname) + page.url.search} class={className} />
