<script lang="ts">
  import { cn } from '#lib/utils.js';
  import { sigil } from './sigil.js';

  /** An agent's default avatar. Decorative: always render the agent's name next to it. */
  let { seed, class: className }: { seed: string; class?: string } = $props();

  const geometry = $derived(sigil(seed));
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" class={cn('size-8 shrink-0 rounded-full', className)}>
  <circle cx="12" cy="12" r="12" fill={geometry.background} />
  <path d={geometry.path} fill="none" stroke={geometry.stroke} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx={geometry.node.x} cy={geometry.node.y} r="1.7" fill={geometry.stroke} />
</svg>
