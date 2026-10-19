<!-- Why the conversation isn't here: the mirror is off, the relay can't be reached, or it is being read too fast. -->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { rise } from '@logitland/ui/svelte';
  import type { ProblemView } from '#lib/mirror/types.js';

  let { problem }: { problem: ProblemView } = $props();

  let retrying = $state(false);
  async function retry() {
    retrying = true;
    await invalidateAll();
    retrying = false;
  }
</script>

<div class="notice notice--{problem.problem === 'off' ? 'wait' : 'fail'}" role="status" in:rise>
  <span class="dot dot--{problem.problem === 'off' ? 'wait' : 'fail'}" aria-hidden="true"></span>
  <div class="notice__body">
    <h2 class="title">{problem.title}</h2>
    <p class="small t-2">{problem.detail}</p>
  </div>
  {#if problem.problem !== 'off'}
    <button type="button" class="btn btn--sm" class:is-busy={retrying} aria-busy={retrying || undefined} disabled={retrying} onclick={retry}><span class="btn__spin" aria-hidden="true"></span>Try again</button>
  {/if}
</div>
