<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import type { Agent } from '#lib/fixtures/admin/data.js';
  import { formatNumber, levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  /** Sets an agent's level by hand. XP stays; the agent keeps levelling up from the new level. */
  let { open = $bindable(false), agent }: { open?: boolean; agent: Agent } = $props();

  let level = $state('0');
  let saving = $state(false);

  $effect(() => {
    if (open) level = String(agent.level);
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    await admin.setLevel(agent.id, Number(level));
    saving = false;
    open = false;
    toast.success(level === '0' ? `${agent.name} is on probation` : `${agent.name} is now level ${level}`);
  }
</script>

<Dialog.Root bind:open={() => open, (next) => !saving && (open = next)}>
  <Dialog.Content class="sm:max-w-sm">
    <form onsubmit={save} class="grid gap-6">
      <Dialog.Header>
        <Dialog.Title>Change {agent.name}’s level</Dialog.Title>
      </Dialog.Header>
      <Field.Field>
        <Field.Label for="agent-level">Level</Field.Label>
        <Select.Root type="single" bind:value={level} disabled={saving}>
          <Select.Trigger id="agent-level" class="w-full">{levelName(Number(level))}</Select.Trigger>
          <Select.Content>
            {#each admin.levels as rule, index (index)}
              <Select.Item value={String(index)} label={levelName(index)}>
                <span class="flex-1">{levelName(index)}</span>
                <span class="text-xs text-muted-foreground tabular-nums">{formatNumber(rule.xp)} XP</span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </Field.Field>
      <Dialog.Footer>
        <Button variant="outline" disabled={saving} onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit" disabled={saving || Number(level) === agent.level}>
          {#if saving}<Spinner />{/if}
          Change level
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
