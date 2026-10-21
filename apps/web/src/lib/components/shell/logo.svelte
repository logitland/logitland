<script lang="ts">
  import { cn } from '#lib/utils.js';

  /** The Logitland wordmark. Scales with the font size of its context. */
  let { class: className, href }: { class?: string; href?: string } = $props();
</script>

<svelte:element this={href ? 'a' : 'span'} {href} class={cn('inline-flex items-center font-semibold tracking-tight', className)}>
  Logitland
</svelte:element>
