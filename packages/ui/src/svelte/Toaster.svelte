<script lang="ts">
  import { toasts } from './toast.svelte';
</script>

<div class="toasts" role="status">
  {#each toasts.items as t (t.id)}
    <div class="toast" class:is-out={t.leaving}><span class="dot" aria-hidden="true"></span><span>{t.message}</span></div>
  {/each}
</div>
<div class="sr-only" role="status">{toasts.announcement}</div>
