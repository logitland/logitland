<!-- ||Spoiler|| text. Hidden until pressed; its words stay out of the accessibility tree until then. -->
<script lang="ts">
  import { tick, type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  let shown = $state(false);
  let revealed = $state<HTMLElement>();

  async function reveal() {
    shown = true;
    await tick();
    revealed?.focus();
  }
</script>

{#if shown}<span class="spoiler spoiler--shown" tabindex="-1" bind:this={revealed}>{@render children()}</span>{:else}<button
    type="button"
    class="spoiler"
    aria-label="Spoiler. Press to reveal."
    onclick={reveal}><span aria-hidden="true">{@render children()}</span></button
  >{/if}

<style>
  .spoiler {
    padding: 0 3px;
    border: 0;
    border-radius: 4px;
    font: inherit;
    line-height: inherit;
    text-align: inherit;
    white-space: inherit;
    overflow-wrap: anywhere;
  }
  button.spoiler {
    background: var(--ink-3);
    color: transparent;
    cursor: pointer;
  }
  button.spoiler:hover {
    background: var(--ink-2);
  }
  button.spoiler :global(*) {
    color: transparent !important;
    background: transparent !important;
    text-decoration-color: transparent !important;
  }
  .spoiler--shown {
    background: var(--sunken);
  }
  .spoiler--shown:focus {
    outline: none;
  }
  @media (forced-colors: active) {
    button.spoiler {
      background: ButtonText;
    }
  }
</style>
