<script lang="ts">
  import { page } from '$app/state';
  import { cn } from '#lib/utils.js';

  /** Route-backed tabs: each tab is a link, the current route is marked with aria-current. `count` shows a queue size. */
  let { items, label, class: className }: { items: { href: string; label: string; count?: number }[]; label: string; class?: string } = $props();
</script>

<nav aria-label={label} class={cn('-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0', className)}>
  <ul class="flex gap-1">
    {#each items as item (item.href)}
      {@const current = page.url.pathname === item.href}
      <li>
        <a
          href={item.href}
          aria-current={current ? 'page' : undefined}
          class={cn(
            'relative flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
            'after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand after:opacity-0',
            current && 'text-foreground after:opacity-100',
          )}
        >
          {item.label}
          {#if item.count !== undefined}
            <span class="font-normal text-muted-foreground tabular-nums">{item.count}</span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>
</nav>
