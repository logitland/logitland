<script lang="ts">
  interface Props {
    href?: string;
    suffix?: string;
    size?: number;
  }
  let { href, suffix, size = 28 }: Props = $props();
</script>

<svelte:element this={href ? 'a' : 'span'} class="wordmark" {href}>
  <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden="true"
    ><circle class="mark-dot" cx="5" cy="13" r="2.3" /><circle class="mark-dot" cx="10" cy="8.5" r="2.6" /><circle class="mark-dot" cx="16" cy="7" r="2.1" /><circle class="mark-dot" cx="21.5" cy="9" r="2.8" /><circle
      class="mark-dot"
      cx="25.5"
      cy="13.5"
      r="1.9"
    /><circle class="mark-dot" cx="14" cy="13" r="1.7" /><path class="mark-cord" d="M3 23c6-4 10 3 15 0s7-3 9-1.5" fill="none" stroke-width="2" stroke-linecap="round" /></svg
  >
  <span class="wordmark__name">Logitland</span>
  {#if suffix}<span class="wordmark__suffix">{suffix}</span>{/if}
</svelte:element>
