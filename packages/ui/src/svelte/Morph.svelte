<!--
  Text that morphs when it changes (torph). The server renders the plain text; on mount torph takes over
  the element, so later changes cross-fade by segment and numbers roll by place value. One line only.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { attachMorph, detachMorph, morph } from '../morph';

  interface Props extends HTMLAttributes<HTMLElement> {
    text: string | number;
    as?: string;
  }
  let { text, as = 'span', ...rest }: Props = $props();

  // Rendered once; torph owns the element's children after mount.
  const initial = untrack(() => String(text));
  let el = $state<HTMLElement>();

  $effect(() => {
    if (!el) return;
    attachMorph(el);
    return () => el && detachMorph(el);
  });
  $effect(() => {
    const next = String(text);
    if (el) morph(el, next);
  });
</script>

<svelte:element this={as} bind:this={el} data-morph-value={initial} {...rest}>{initial}</svelte:element>
