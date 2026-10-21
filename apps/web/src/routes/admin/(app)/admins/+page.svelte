<script lang="ts">
  import type { AdminPermission } from '@logitland/contracts';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import XIcon from '@lucide/svelte/icons/x';
  import { toast } from 'svelte-sonner';
  import SaveCard from '#lib/components/admin/save-card.svelte';
  import * as Avatar from '#lib/components/ui/avatar/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import { Checkbox } from '#lib/components/ui/checkbox/index.js';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import * as Field from '#lib/components/ui/field/index.js';
  import { refusal } from '#lib/admin/format.js';
  import { POWER_KEYS, POWER_LABELS } from '#lib/admin/labels.js';
  import { session } from '#lib/session.js';
  import { admins, saveRoles } from './admins.remote.js';

  type Grant = { roleId: string; powers: AdminPermission[] };

  const data = $derived(await admins());
  const saved = $derived<Grant[]>(data.roles.filter((r) => r.permissions.length).map((r) => ({ roleId: r.id, powers: r.permissions })));

  // Every change in the card is a draft until Save, including adding and removing roles. Undefined: nothing changed yet.
  let edited = $state<Grant[]>();
  const draft = $derived(edited ?? saved);
  let errors = $state<Record<string, string>>({});

  const key = (grants: Grant[]) => JSON.stringify(grants.map((g) => [g.roleId, POWER_KEYS.filter((p) => g.powers.includes(p))]));
  const dirty = $derived(key(draft) !== key(saved));
  const unmapped = $derived(data.roles.filter((r) => !draft.some((g) => g.roleId === r.id)));
  const roleName = (roleId: string) => `@${data.roles.find((r) => r.id === roleId)?.name ?? roleId}`;

  /** Edits a copy of the draft, so the saved grants stay as the relay sent them. */
  function edit(change: (grants: Grant[]) => Grant[]) {
    edited = change(structuredClone($state.snapshot(draft)));
  }

  function toggle(roleId: string, power: AdminPermission, on: boolean) {
    edit((grants) => grants.map((g) => (g.roleId === roleId ? { ...g, powers: on ? [...g.powers, power] : g.powers.filter((p) => p !== power) } : g)));
    delete errors[roleId];
  }

  function discard() {
    edited = undefined;
    errors = {};
  }

  async function save() {
    errors = Object.fromEntries(draft.filter((g) => g.powers.length === 0).map((g) => [g.roleId, `Give ${roleName(g.roleId)} at least one power, or remove it.`]));
    if (Object.keys(errors).length) return;
    // Roles whose powers changed, and roles removed from the card, which lose theirs.
    const changes = [
      ...draft.filter((g) => key([g]) !== key(saved.filter((s) => s.roleId === g.roleId))).map((g) => ({ id: g.roleId, permissions: g.powers })),
      ...saved.filter((s) => !draft.some((g) => g.roleId === s.roleId)).map((s) => ({ id: s.roleId, permissions: [] })),
    ];
    try {
      await saveRoles(changes);
      edited = undefined;
      toast.success('Saved admin roles');
    } catch (e) {
      toast.error(refusal(e));
    }
  }
</script>

<svelte:head><title>Admins · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Admins</h1>
</div>

<div class="mt-6 flex flex-col gap-8">
  <section aria-labelledby="team-heading">
    <h2 id="team-heading" class="text-sm font-medium">Developer team</h2>
    <ul class="mt-3 divide-y overflow-hidden rounded-xl border bg-card">
      {#each data.team as member (member.discord_user_id)}
        <li class="flex items-center gap-3 px-4 py-3">
          <Avatar.Root class="size-8 rounded-full">
            <Avatar.Fallback class="bg-discord text-discord-foreground">{member.name.slice(0, 1)}</Avatar.Fallback>
          </Avatar.Root>
          <div class="flex min-w-0 flex-1 items-baseline gap-2">
            <span class="truncate text-sm font-medium">{member.name}</span>
            <span class="truncate text-sm text-muted-foreground">@{member.username}</span>
          </div>
          {#if member.owner_id === session.person?.id}<Badge variant="outline">You</Badge>{/if}
        </li>
      {/each}
    </ul>
  </section>

  <SaveCard title="Server roles" {dirty} onDiscard={discard} onSave={save}>
    {#snippet action()}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class={buttonVariants({ variant: 'outline', size: 'sm' })} disabled={unmapped.length === 0}>
          <PlusIcon />Add role
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="max-h-72 w-48">
          {#each unmapped as role (role.id)}
            <DropdownMenu.Item onSelect={() => edit((grants) => [...grants, { roleId: role.id, powers: ['moderate'] }])}>@{role.name}</DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/snippet}

    {#if draft.length === 0}
      <Empty.Root class="border">
        <Empty.Header>
          <Empty.Title>No server roles have admin powers</Empty.Title>
        </Empty.Header>
      </Empty.Root>
    {:else}
      <ul class="-my-3 divide-y">
        {#each draft as grant (grant.roleId)}
          <li class="flex flex-col gap-3 py-3">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{roleName(grant.roleId)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                class="ml-auto"
                aria-label="Remove {roleName(grant.roleId)}"
                onclick={() => {
                  edit((grants) => grants.filter((g) => g.roleId !== grant.roleId));
                  delete errors[grant.roleId];
                }}
              >
                <XIcon />
              </Button>
            </div>
            <Field.Group class="flex-row flex-wrap gap-x-6 gap-y-3" aria-label="{roleName(grant.roleId)} powers">
              {#each POWER_KEYS as power (power)}
                <Field.Field orientation="horizontal" class="w-auto">
                  <Checkbox
                    id="{grant.roleId}-{power}"
                    checked={grant.powers.includes(power)}
                    onCheckedChange={(on) => toggle(grant.roleId, power, on)}
                    aria-invalid={errors[grant.roleId] ? true : undefined}
                  />
                  <Field.Label for="{grant.roleId}-{power}" class="font-normal">{POWER_LABELS[power]}</Field.Label>
                </Field.Field>
              {/each}
            </Field.Group>
            {#if errors[grant.roleId]}<Field.Error>{errors[grant.roleId]}</Field.Error>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </SaveCard>
</div>
