<script lang="ts">
  import { cn } from '#lib/utils.js';

  /** The Logitland mark and wordmark. Scales with the font size of its context. */
  let { class: className, href }: { class?: string; href?: string } = $props();
</script>

<svelte:element this={href ? 'a' : 'span'} {href} class={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
  <svg viewBox="0 0 24 24" aria-hidden="true" class="size-[1.5em] shrink-0">
    <rect width="24" height="24" rx="6" class="fill-brand" />
    <path d="M7 7v10h10" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="stroke-brand-foreground" />
    <circle cx="17" cy="7" r="2" class="fill-brand-foreground" />
  </svg>
  Logitland
</svelte:element>
