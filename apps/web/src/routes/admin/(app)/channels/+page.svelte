<script lang="ts">
  import type { ChannelType } from '@logitland/contracts';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import HashIcon from '@lucide/svelte/icons/hash';
  import ImageIcon from '@lucide/svelte/icons/image';
  import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
  import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
  import SendIcon from '@lucide/svelte/icons/send';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { SvelteSet } from 'svelte/reactivity';
  import { levelName } from '#lib/admin/format.js';
  import { cn } from '#lib/utils.js';
  import { channels } from './channels.remote.js';

  // Worked out from Discord's overwrites; admins change them in Discord, so nothing here is editable.
  const KIND_ICONS = { text: HashIcon, forum: MessagesSquareIcon, announcement: MegaphoneIcon, media: ImageIcon } satisfies Record<ChannelType, unknown>;
  const ADOPTIONS = [
    { key: 'orphan', label: 'Orphan' },
    { key: 'adopted', label: 'Adopted' },
  ] as const;

  const groups = $derived(await channels());
  /** Every channel lists the same levels, lowest first. */
  const levels = $derived(groups[0]?.channels[0]?.levels.map((l) => l.level) ?? []);
  /** Categories folded shut, as in Discord's sidebar. */
  const collapsed = new SvelteSet<string>();
  const toggle = (id: string) => (collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id));
</script>

<svelte:head><title>Channels · Logitland</title></svelte:head>

<div class="flex min-h-9 items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Channels</h1>
  <div class="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
    <span class="flex items-center gap-1.5"><EyeIcon class="size-3.5" />View</span>
    <span class="flex items-center gap-1.5"><SendIcon class="size-3.5" />Post</span>
  </div>
</div>

{#if groups.length === 0}
  <Empty.Root class="mt-6 border">
    <Empty.Header>
      <Empty.Title>No channels yet</Empty.Title>
    </Empty.Header>
  </Empty.Root>
{:else}
  <!-- `relative` keeps the cells' sr-only labels inside the scroller instead of widening the page on phones. -->
  <div class="relative mt-6 overflow-x-auto rounded-xl border bg-card">
    <table class="w-full border-collapse text-sm">
      <thead class="text-xs text-muted-foreground">
        <tr>
          <th scope="col" rowspan="2" class="sticky left-0 border-b bg-card px-4 py-2 text-left align-bottom font-medium">Channel</th>
          {#each levels as level (level)}
            <th scope="colgroup" colspan="2" class="px-3 pt-2 text-center font-medium whitespace-nowrap">{levelName(level)}</th>
          {/each}
        </tr>
        <tr class="border-b">
          {#each levels as level (level)}
            {#each ADOPTIONS as adoption (adoption.key)}
              <th scope="col" class="px-2 pb-2 text-center font-normal whitespace-nowrap">{adoption.label}</th>
            {/each}
          {/each}
        </tr>
      </thead>
      {#each groups as group (group.id)}
        {@const open = !group.id || !collapsed.has(group.id)}
        <tbody>
          {#if group.id}
            <tr>
              <th scope="colgroup" colspan={levels.length * ADOPTIONS.length + 1} class="sticky left-0 bg-card px-2 pt-4 pb-1 text-left">
                <button
                  type="button"
                  aria-expanded={open}
                  onclick={() => toggle(group.id!)}
                  class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <ChevronDownIcon class={cn('size-3.5 transition-transform', !open && '-rotate-90')} aria-hidden="true" />
                  {group.name}
                </button>
              </th>
            </tr>
          {/if}
          {#each open ? group.channels : [] as channel (channel.id)}
            {@const Icon = KIND_ICONS[channel.type]}
            <tr>
              <th scope="row" class="sticky left-0 bg-card px-4 py-2.5 text-left font-normal">
                <span class="flex items-center gap-2 whitespace-nowrap">
                  <Icon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span class={channel.hidden ? 'text-muted-foreground' : 'font-medium'}>{channel.name}</span>
                  {#if channel.hidden}<Badge variant="outline" class="text-muted-foreground">Hidden</Badge>{/if}
                </span>
              </th>
              {#each channel.levels as access (access.level)}
                {#each ADOPTIONS as adoption (adoption.key)}
                  {@const can = access[adoption.key]}
                  <td class="px-2 py-2.5 text-center">
                    {#if can.post}
                      <SendIcon class="mx-auto size-4" aria-hidden="true" /><span class="sr-only">Post</span>
                    {:else if can.view}
                      <EyeIcon class="mx-auto size-4 text-muted-foreground" aria-hidden="true" /><span class="sr-only">View</span>
                    {:else}
                      <span class="text-muted-foreground/50" aria-hidden="true">·</span><span class="sr-only">None</span>
                    {/if}
                  </td>
                {/each}
              {/each}
            </tr>
          {/each}
        </tbody>
      {/each}
    </table>
  </div>
{/if}
