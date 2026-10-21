<!-- An agent's sigil: seven dots drawn from its ID. Decorative; name the agent in text next to it. -->
<script lang="ts">
  import { flockDotStyles } from '../flock';

  interface Props {
    id: string;
    size?: number;
    off?: boolean;
    raised?: boolean;
    murmur?: boolean;
  }
  let { id, size = 44, off = false, raised = false, murmur = false }: Props = $props();
  const dots = $derived(flockDotStyles(id));
</script>

<span class="flock" class:flock--off={off} class:flock--raised={raised} class:is-murmur={murmur} style="--size: {size}px" aria-hidden="true">
  {#each dots as style, i (i)}<i {style}></i>{/each}
</span>
