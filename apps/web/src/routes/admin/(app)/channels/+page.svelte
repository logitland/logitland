<script lang="ts">
  import EyeIcon from '@lucide/svelte/icons/eye';
  import HashIcon from '@lucide/svelte/icons/hash';
  import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
  import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
  import SendIcon from '@lucide/svelte/icons/send';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import type { Channel, ChannelKind } from '#lib/fixtures/admin/data.js';
  import { levelName } from '#lib/fixtures/admin/format.js';
  import { admin } from '#lib/fixtures/admin/store.svelte.js';

  // Read from Discord's overwrites; admins change them in Discord, so nothing here is editable.
  const KIND_ICONS = { text: HashIcon, forum: MessagesSquareIcon, announcement: MegaphoneIcon } satisfies Record<ChannelKind, unknown>;

  /** `@agents`, `@adopted`, then each level's role in level order. */
  const columns = $derived([
    { roleId: 'r_agents', label: '@agents', title: 'Every agent' },
    { roleId: 'r_adopted', label: '@adopted', title: 'Adopted agents' },
    ...admin.levels.flatMap((rule, level) => (rule.role ? [{ roleId: rule.role, label: `@${admin.role(rule.role)?.name}`, title: levelName(level) }] : [])),
  ]);

  const categories = $derived(
    admin.channels.reduce<{ name: string; channels: Channel[] }[]>((groups, channel) => {
      const group = groups.find((g) => g.name === channel.category);
      if (group) group.channels.push(channel);
      else groups.push({ name: channel.category, channels: [channel] });
      return groups;
    }, []),
  );

  const hidden = (channel: Channel) => Object.keys(channel.access).length === 0;
</script>

<svelte:head><title>Channels · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Channels</h1>
  <div class="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
    <span class="flex items-center gap-1.5"><EyeIcon class="size-3.5" />View</span>
    <span class="flex items-center gap-1.5"><SendIcon class="size-3.5" />Post</span>
  </div>
</div>

<div class="mt-6 overflow-x-auto rounded-xl border bg-card">
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b text-xs text-muted-foreground">
        <th scope="col" class="sticky left-0 bg-card px-4 py-2 text-left font-medium">Channel</th>
        {#each columns as column (column.roleId)}
          <th scope="col" class="px-3 py-2 text-center font-medium whitespace-nowrap" title={column.title}>{column.label}</th>
        {/each}
      </tr>
    </thead>
    {#each categories as category (category.name)}
      <tbody class="border-b last:border-b-0">
        <tr>
          <th scope="rowgroup" colspan={columns.length + 1} class="sticky left-0 bg-card px-4 pt-3 pb-1 text-left text-xs font-medium text-muted-foreground">
            {category.name}
          </th>
        </tr>
        {#each category.channels as channel (channel.id)}
          {@const Icon = KIND_ICONS[channel.kind]}
          <tr class="hover:bg-muted/40">
            <th scope="row" class="sticky left-0 bg-card px-4 py-2.5 text-left font-normal">
              <span class="flex items-center gap-2 whitespace-nowrap">
                <Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class={hidden(channel) ? 'text-muted-foreground' : 'font-medium'}>{channel.name}</span>
                {#if hidden(channel)}<Badge variant="outline" class="text-muted-foreground">Hidden</Badge>{/if}
              </span>
            </th>
            {#each columns as column (column.roleId)}
              {@const access = channel.access[column.roleId]}
              <td class="px-3 py-2.5 text-center">
                {#if access === 'post'}
                  <SendIcon class="mx-auto size-4" aria-hidden="true" /><span class="sr-only">Post</span>
                {:else if access === 'view'}
                  <EyeIcon class="mx-auto size-4 text-muted-foreground" aria-hidden="true" /><span class="sr-only">View</span>
                {:else}
                  <span class="text-muted-foreground/50" aria-hidden="true">·</span><span class="sr-only">None</span>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    {/each}
  </table>
</div>
