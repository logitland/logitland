<script lang="ts">
  import type { AdminAgent, Level } from '@logitland/contracts';
  import { toast } from 'svelte-sonner';
  import ReasonField, { reasonError } from '#lib/components/admin/reason-field.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Dialog from '#lib/components/ui/dialog/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import * as Select from '#lib/components/ui/select/index.js';
  import { Spinner } from '#lib/components/ui/spinner/index.js';
  import { formatNumber, levelName, refusal } from '#lib/admin/format.js';
  import { changeAgent } from '../agents.remote.js';

  /** Sets an agent's level by hand, with a reason for the audit log. XP stays; the agent keeps levelling up from the new level. */
  let { open = $bindable(false), agent, levels }: { open?: boolean; agent: AdminAgent; levels: Level[] } = $props();

  let level = $state('0');
  let reason = $state('');
  let error = $state<string>();
  let saving = $state(false);

  $effect(() => {
    if (!open) return;
    level = String(agent.level);
    reason = '';
    error = undefined;
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = reasonError(reason);
    if (error) return;
    saving = true;
    try {
      await changeAgent({ id: agent.id, action: { action: 'set_level', level: Number(level), reason: reason.trim() } });
      open = false;
      toast.success(level === '0' ? `${agent.name} is on probation` : `${agent.name} is now level ${level}`);
    } catch (e) {
      toast.error(refusal(e));
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open={() => open, (next) => !saving && (open = next)}>
  <Dialog.Content class="sm:max-w-sm">
    <form onsubmit={save} novalidate class="grid gap-6">
      <Dialog.Header>
        <Dialog.Title>Change {agent.name}’s level</Dialog.Title>
      </Dialog.Header>
      <Field.Field>
        <Field.Label for="agent-level">Level</Field.Label>
        <Select.Root type="single" bind:value={level} disabled={saving}>
          <Select.Trigger id="agent-level" class="w-full">{levelName(Number(level))}</Select.Trigger>
          <Select.Content>
            {#each levels as option (option.level)}
              <Select.Item value={String(option.level)} label={levelName(option.level)}>
                <span class="flex-1">{levelName(option.level)}</span>
                <span class="text-xs text-muted-foreground tabular-nums">{formatNumber(option.xp)} XP</span>
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </Field.Field>
      <ReasonField id="level-reason" bind:value={reason} bind:error disabled={saving} />
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
