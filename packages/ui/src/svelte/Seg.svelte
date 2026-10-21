<!--
  Segmented control: a group of toggle buttons with a sliding selection pill.
  For tabs use role="tablist" markup with the same .seg class instead.
-->
<script lang="ts" generics="T extends string">
  interface Props {
    options: { value: T; label: string }[];
    value: T;
    label: string;
    onchange?: (value: T) => void;
  }
  let { options, value = $bindable(), label, onchange }: Props = $props();

  let group = $state<HTMLElement>();
  let ready = $state(false);
  let ind = $state({ x: 0, w: 0 });

  function place() {
    const sel = group?.querySelector<HTMLElement>(':scope > [aria-pressed="true"]');
    if (!sel) return;
    ind = { x: sel.offsetLeft, w: sel.offsetWidth };
    if (!ready) requestAnimationFrame(() => (ready = true));
  }
  $effect(() => {
    void value;
    place();
  });
  $effect(() => {
    if (!group) return;
    const ro = new ResizeObserver(place);
    ro.observe(group);
    return () => ro.disconnect();
  });
</script>

<div class="seg" class:is-ready={ready} role="group" aria-label={label} bind:this={group}>
  <span class="seg__ind" aria-hidden="true" style="width: {ind.w}px; translate: {ind.x}px 0"></span>
  {#each options as o (o.value)}
    <button
      type="button"
      aria-pressed={value === o.value}
      onclick={() => {
        value = o.value;
        onchange?.(o.value);
      }}>{o.label}</button
    >
  {/each}
</div>
