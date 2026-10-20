<script lang="ts">
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
  import { ADMINS, POWER_KEYS, POWER_LABELS, type Power, type RoleGrant } from '#lib/fixtures/admin/data.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  const team = ADMINS.filter((a) => a.team);

  // Every change in the card is a draft until Save, including adding and removing roles.
  let draft = $state<RoleGrant[]>(structuredClone($state.snapshot(admin.grants)));
  let errors = $state<Record<string, string>>({});

  const key = (grants: RoleGrant[]) => JSON.stringify(grants.map((g) => [g.roleId, POWER_KEYS.filter((p) => g.powers.includes(p))]));
  const dirty = $derived(key(draft) !== key(admin.grants));
  const unmapped = $derived(admin.serverRoles.filter((r) => r.kind === 'staff' && !draft.some((g) => g.roleId === r.id)));
  const roleName = (roleId: string) => `@${admin.role(roleId)?.name}`;

  function toggle(grant: RoleGrant, power: Power, on: boolean) {
    grant.powers = on ? [...grant.powers, power] : grant.powers.filter((p) => p !== power);
    delete errors[grant.roleId];
  }

  function add(roleId: string) {
    draft.push({ roleId, powers: ['moderate'] });
  }

  function remove(roleId: string) {
    draft = draft.filter((g) => g.roleId !== roleId);
    delete errors[roleId];
  }

  function discard() {
    draft = structuredClone($state.snapshot(admin.grants));
    errors = {};
  }

  async function save() {
    errors = Object.fromEntries(draft.filter((g) => g.powers.length === 0).map((g) => [g.roleId, `Give ${roleName(g.roleId)} at least one power, or remove it.`]));
    if (Object.keys(errors).length) return;
    await admin.saveGrants(draft);
    toast.success('Saved admin roles');
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
      {#each team as member (member.id)}
        <li class="flex items-center gap-3 px-4 py-3">
          <Avatar.Root class="size-8 rounded-full">
            <Avatar.Fallback class="bg-discord text-discord-foreground">{member.name.slice(0, 1)}</Avatar.Fallback>
          </Avatar.Root>
          <div class="flex min-w-0 flex-1 items-baseline gap-2">
            <span class="truncate text-sm font-medium">{member.name}</span>
            <span class="truncate text-sm text-muted-foreground">@{member.handle}</span>
          </div>
          {#if member.id === admin.admin?.id}<Badge variant="outline">You</Badge>{/if}
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
        <DropdownMenu.Content align="end" class="w-48">
          {#each unmapped as role (role.id)}
            <DropdownMenu.Item onSelect={() => add(role.id)}>@{role.name}</DropdownMenu.Item>
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
          {@const holders = admin.holders(grant.roleId)}
          <li class="flex flex-col gap-3 py-3">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{roleName(grant.roleId)}</span>
              {#if holders.length}
                <span class="truncate text-sm text-muted-foreground">{holders.map((h) => h.name).join(', ')}</span>
              {/if}
              <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Remove {roleName(grant.roleId)}" onclick={() => remove(grant.roleId)}>
                <XIcon />
              </Button>
            </div>
            <Field.Group class="flex-row flex-wrap gap-x-6 gap-y-3" aria-label="{roleName(grant.roleId)} powers">
              {#each POWER_KEYS as power (power)}
                <Field.Field orientation="horizontal" class="w-auto">
                  <Checkbox
                    id="{grant.roleId}-{power}"
                    checked={grant.powers.includes(power)}
                    onCheckedChange={(on) => toggle(grant, power, on)}
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
