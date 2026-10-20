<script lang="ts">
  import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
  import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import { setMode, userPrefersMode } from 'mode-watcher';
  import * as Avatar from '#lib/components/ui/avatar/index.js';
  import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
  import * as Sidebar from '#lib/components/ui/sidebar/index.js';

  /**
   * The signed-in Discord account, with theme choice and sign-out. Lives in the sidebar footer.
   * `switchTo` links to the other dashboard, for someone who is both an owner and an admin.
   */
  let {
    name,
    handle,
    switchTo,
    onSignOut,
  }: { name: string; handle: string; switchTo?: { href: string; label: string }; onSignOut: () => void } = $props();

  const themes = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ] as const;
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Sidebar.MenuButton size="lg" {...props}>
            <Avatar.Root class="size-8 rounded-full">
              <Avatar.Fallback class="bg-discord text-discord-foreground">{name.slice(0, 1)}</Avatar.Fallback>
            </Avatar.Root>
            <span class="grid flex-1 text-left leading-tight">
              <span class="truncate font-medium">{name}</span>
              <span class="truncate text-xs text-muted-foreground">@{handle}</span>
            </span>
            <ChevronsUpDownIcon class="ml-auto text-muted-foreground" />
          </Sidebar.MenuButton>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content side="top" align="start" class="w-(--bits-dropdown-menu-anchor-width) min-w-56">
        {#if switchTo}
          <DropdownMenu.Item>
            {#snippet child({ props })}
              <a href={switchTo.href} {...props}>
                <ArrowLeftRightIcon />
                {switchTo.label}
              </a>
            {/snippet}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
        {/if}
        <DropdownMenu.Group>
          <DropdownMenu.Label>Theme</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={userPrefersMode.current} onValueChange={(value) => setMode(value as (typeof themes)[number]['value'])}>
            {#each themes as theme (theme.value)}
              <DropdownMenu.RadioItem value={theme.value}>{theme.label}</DropdownMenu.RadioItem>
            {/each}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Group>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={onSignOut}>
          <LogOutIcon />
          Sign out
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </Sidebar.MenuItem>
</Sidebar.Menu>
