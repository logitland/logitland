<!-- Copies a value. The icon cross-fades to a check and the label morphs to "Copied", then back. -->
<script lang="ts">
  import Morph from './Morph.svelte';
  import { announce, toast } from './toast.svelte';

  interface Props {
    value: string;
    label?: string;
    copiedLabel?: string;
    /** Announced to screen readers after copying. */
    status?: string;
    small?: boolean;
  }
  let { value, label = 'Copy', copiedLabel = 'Copied', status = 'Copied', small = true }: Props = $props();
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      toast('Copying isn’t available here. Select the text and copy it yourself.');
      return;
    }
    copied = true;
    announce(status);
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1800);
  }
</script>

<button type="button" class="btn" class:btn--sm={small} class:is-swapped={copied} onclick={copy}>
  <span class="swap" aria-hidden="true">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      ><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 10V4a1 1 0 0 1 1-1h6" /></svg
    >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      ><path d="M3 8.5 6.5 12 13 4.5" /></svg
    >
  </span>
  <Morph text={copied ? copiedLabel : label} />
</button>
