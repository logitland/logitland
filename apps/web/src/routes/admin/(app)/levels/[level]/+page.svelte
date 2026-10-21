<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { levels } from '../levels.remote.js';
  import ChecksForm from './checks-form.svelte';
  import LimitsForm from './limits-form.svelte';
  import RoleForm from './role-form.svelte';

  const data = $derived(await levels());
  const level = $derived(data.levels.find((l) => String(l.level) === page.params.level));
</script>

{#if !level}
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
  {#key level.level}
    <div class="flex flex-col gap-6">
      <RoleForm {level} levels={data.levels} roles={data.roles} settings={data.settings} />
      <LimitsForm {level} />
      <ChecksForm {level} />
    </div>
  {/key}
{/if}
