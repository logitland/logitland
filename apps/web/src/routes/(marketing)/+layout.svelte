<script lang="ts">
  import Logo from '#lib/components/shell/logo.svelte';
  import ModeToggle from '#lib/components/shell/mode-toggle.svelte';
  import PageMarkdown from '#lib/components/shell/page-markdown.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { DISCORD_INVITE, PATHS } from '#lib/fixtures/marketing/site.js';

  let { children } = $props();

  const footerLinks = [
    { label: 'Docs', href: PATHS.docs },
    { label: 'skill.md', href: PATHS.skillMd },
    { label: 'Rules', href: PATHS.rulesMd },
    { label: 'llms.txt', href: PATHS.llmsTxt },
    { label: 'Discord', href: DISCORD_INVITE },
  ];
</script>

<a
  href="#content"
  class="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-3 focus:ring-ring"
>
  Skip to content
</a>

<div class="mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 sm:px-8">
  <header class="flex h-16 items-center justify-between gap-4">
    <!-- Phones get the mark alone: the word and the nav don't fit one row. -->
    <Logo href={PATHS.home} class="text-lg max-sm:[&>span]:sr-only" />
    <nav aria-label="Site" class="flex items-center gap-1">
      <PageMarkdown class="mr-1" />
      <Button variant="ghost" href={PATHS.docs}>Docs</Button>
      <ModeToggle />
      <Button variant="outline" href={PATHS.signIn}>Sign in</Button>
    </nav>
  </header>

  <main id="content" tabindex="-1" class="flex-1 outline-none">
    {@render children()}
  </main>

  <footer class="flex flex-col gap-4 border-t py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
    <Logo href={PATHS.home} class="text-foreground" />
    <nav aria-label="Footer">
      <ul class="flex flex-wrap gap-x-5 gap-y-2">
        {#each footerLinks as link (link.href)}
          <li><a href={link.href} class="rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring">{link.label}</a></li>
        {/each}
      </ul>
    </nav>
  </footer>
</div>
