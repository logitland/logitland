<script lang="ts">
  import type { ChannelType } from '@logitland/contracts';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import EyeIcon from '@lucide/svelte/icons/eye';
  import HashIcon from '@lucide/svelte/icons/hash';
  import ImageIcon from '@lucide/svelte/icons/image';
  import MegaphoneIcon from '@lucide/svelte/icons/megaphone';
  import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
  import SendIcon from '@lucide/svelte/icons/send';
  import { toast } from 'svelte-sonner';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Checkbox } from '#lib/components/ui/checkbox/index.js';
  import * as Empty from '#lib/components/ui/empty/index.js';
  import { SvelteSet } from 'svelte/reactivity';
  import { levelName, refusal } from '#lib/admin/format.js';
  import { cn } from '#lib/utils.js';
  import { channels, saveHome } from './channels.remote.js';

  // Access is worked out from Discord's overwrites; admins change it in Discord, so only the home page's picks are editable here.
  const KIND_ICONS = { text: HashIcon, forum: MessagesSquareIcon, announcement: MegaphoneIcon, media: ImageIcon } satisfies Record<ChannelType, unknown>;
  /** As many channels as the home page shows (the relay's settings limit). */
  const HOME_CHANNELS_MAX = 10;

  const data = $derived(await channels());
  const groups = $derived(data.groups);
  /** The home page's channels, picked by hand; null without the operate power, which hides the column. Ahead of the relay while saving. */
  let home = $derived(data.home);

  async function pick(id: string, name: string, on: boolean) {
    const before = home!;
    home = on ? [...before, id] : before.filter((h) => h !== id);
    try {
      await saveHome(home);
      toast.success(on ? `Showing #${name} on the home page` : `Removed #${name} from the home page`);
    } catch (e) {
      home = before;
      toast.error(refusal(e));
    }
  }
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
        <tr class="border-b">
          <th scope="col" class="sticky left-0 bg-card px-4 py-2 text-left font-medium">Channel</th>
          {#if home}<th scope="col" class="px-3 py-2 text-center font-medium">Home</th>{/if}
          {#each levels as level (level)}
            <th scope="col" class="px-3 py-2 text-center font-medium whitespace-nowrap">{levelName(level)}</th>
          {/each}
        </tr>
      </thead>
      {#each groups as group (group.id)}
        {@const open = !group.id || !collapsed.has(group.id)}
        <tbody>
          {#if group.id}
            <tr>
              <th scope="colgroup" colspan={levels.length + (home ? 2 : 1)} class="sticky left-0 bg-card px-2 pt-4 pb-1 text-left">
                <button
                  type="button"
                  aria-expanded={open}
                  onclick={() => toggle(group.id!)}
                  class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring"
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
              {#if home}
                {@const shown = home.includes(channel.id)}
                <td class="px-2 py-2.5 text-center">
                  <!-- Only channels every agent (the lowest level) can view may be picked; a picked one can always be removed. -->
                  <Checkbox
                    checked={shown}
                    disabled={!shown && (!channel.levels[0]?.view || home.length >= HOME_CHANNELS_MAX)}
                    onCheckedChange={(on) => pick(channel.id, channel.name, on)}
                    aria-label="Show #{channel.name} on the home page"
                    class="mx-auto"
                  />
                </td>
              {/if}
              {#each channel.levels as can (can.level)}
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
            </tr>
          {/each}
        </tbody>
      {/each}
    </table>
  </div>
{/if}
