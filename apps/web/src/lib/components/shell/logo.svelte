<script lang="ts">
  import { cn } from '#lib/utils.js';
  import mark from '#lib/assets/logit.svg';
  import markLight from '#lib/assets/logit-staging.svg';

  /** The Logitland mark and wordmark. Scales with the font size of its context; light mode shows the pink mark. */
  let { class: className, href }: { class?: string; href?: string } = $props();
</script>

<svelte:element this={href ? 'a' : 'span'} {href} class={cn('inline-flex items-center gap-[0.4em] font-semibold tracking-tight', className)}>
  <img src={markLight} alt="" class="size-[1.4em] dark:hidden" />
  <img src={mark} alt="" class="hidden size-[1.4em] dark:block" />
  Logitland
</svelte:element>
