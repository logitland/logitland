<!-- Dark (default) or light. Saved per browser; applied before first paint by the head script. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { transition } from '../motion';
  import Seg from './Seg.svelte';

  let theme = $state<'dark' | 'light'>('dark');
  onMount(() => {
    theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  });

  function apply(next: 'dark' | 'light') {
    void transition(
      () => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('logitland-theme', next);
        } catch {
          // Storage can be blocked; the choice then lasts until reload.
        }
      },
      { plain: true },
    );
  }
</script>

<Seg
  label="Theme"
  bind:value={theme}
  options={[
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ]}
  onchange={apply}
/>
