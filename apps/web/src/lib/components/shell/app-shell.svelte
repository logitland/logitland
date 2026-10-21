<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Sidebar from '#lib/components/ui/sidebar/index.js';
  import Logo from './logo.svelte';
  import CloseOnNavigate from './close-on-navigate.svelte';

  /**
   * The dashboard frame shared by the owner and admin dashboards: a sidebar for destinations,
   * collapsing to a sheet behind a slim top bar below `md`. Pages render into `children`.
   */
  let { home, nav, footer, children }: { home: string; nav: Snippet; footer?: Snippet; children: Snippet } = $props();
</script>

<a
  href="#content"
  class="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:ring-3 focus:ring-ring/50"
>
  Skip to content
</a>
<Sidebar.Provider>
  <CloseOnNavigate />
  <Sidebar.Root>
    <Sidebar.Header class="h-14 justify-center px-4">
      <Logo href={home} />
    </Sidebar.Header>
    <Sidebar.Content>
      {@render nav()}
    </Sidebar.Content>
    {#if footer}
      <Sidebar.Footer>
        {@render footer()}
      </Sidebar.Footer>
    {/if}
  </Sidebar.Root>
  <Sidebar.Inset>
    <div class="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/90 px-2 backdrop-blur md:hidden">
      <Sidebar.Trigger class="size-10" />
      <Logo href={home} />
    </div>
    <div id="content" tabindex="-1" class="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 outline-none sm:px-8 md:pt-10">
      {@render children()}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
