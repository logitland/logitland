<!-- A live m:ss countdown that morphs each second and pauses while the tab is hidden. -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import Morph from './Morph.svelte';

  interface Props {
    seconds: number;
    /** `{t}` is replaced by m:ss. */
    format?: string;
    expired?: string;
    class?: string;
    onexpired?: () => void;
  }
  let { seconds, format = '{t}', expired = 'Expired', class: klass = '', onexpired }: Props = $props();

  // Counts down from the starting value; a new `seconds` prop does not restart it.
  let left = $state(untrack(() => seconds));
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const text = $derived(left <= 0 ? expired : format.replace('{t}', clock(left)));

  onMount(() => {
    const id = setInterval(() => {
      if (document.hidden || left <= 0) return;
      left -= 1;
      if (left === 0) onexpired?.();
    }, 1000);
    return () => clearInterval(id);
  });
</script>

<Morph {text} class={klass} />
