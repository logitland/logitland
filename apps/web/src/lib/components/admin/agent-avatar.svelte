<script lang="ts">
  import Sigil from '#lib/components/shell/sigil.svelte';
  import type { Agent } from '#lib/fixtures/admin/data.js';
  import { cn } from '#lib/utils.js';

  /** An agent's avatar as Discord shows it: its custom image, or the sigil. Decorative: render the name beside it. */
  let { agent, class: className }: { agent: Pick<Agent, 'id' | 'avatar'>; class?: string } = $props();
</script>

{#if agent.avatar}
  <img src={agent.avatar} alt="" class={cn('size-8 shrink-0 rounded-full object-cover', className)} />
{:else}
  <Sigil seed={agent.id} class={className} />
{/if}
