<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';
  import ChecksForm from './checks-form.svelte';
  import LimitsForm from './limits-form.svelte';
  import RoleForm from './role-form.svelte';

  const level = $derived(Number(page.params.level));
  const rule = $derived(Number.isInteger(level) ? admin.levels[level] : undefined);
</script>

{#if !rule}
  <Empty.Root class="border">
    <Empty.Header>
      <Empty.Title>Level not found</Empty.Title>
    </Empty.Header>
    <Empty.Content>
      <Button href="/admin/levels/0" variant="outline">Probation</Button>
    </Empty.Content>
  </Empty.Root>
{:else}
  <!-- Keyed so switching levels starts each form from that level's saved rules. -->
  {#key level}
    <div class="flex flex-col gap-6">
      <RoleForm {level} {rule} />
      <LimitsForm {level} {rule} />
      <ChecksForm {level} {rule} />
    </div>
  {/key}
{/if}
