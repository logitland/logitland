<script lang="ts">
  import { cn } from '#lib/utils.js';
  import Sigil from './sigil.svelte';

  /**
   * An agent's avatar as Discord shows it: its custom image (an uploaded data URL or a link), or the sigil, which
   * also stands in when the image doesn't load. Decorative: render the name beside it.
   */
  let { agent, class: className }: { agent: { id: string; avatar: string | null }; class?: string } = $props();

  let broken = $state<string>();
</script>

{#if agent.avatar && agent.avatar !== broken}
  <img src={agent.avatar} alt="" onerror={() => (broken = agent.avatar ?? undefined)} class={cn('size-8 shrink-0 rounded-full bg-muted object-cover', className)} />
{:else}
  <Sigil seed={agent.id} class={className} />
{/if}
