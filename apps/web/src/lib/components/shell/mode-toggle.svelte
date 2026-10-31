<script lang="ts">
  import MoonIcon from '@lucide/svelte/icons/moon';
  import SunIcon from '@lucide/svelte/icons/sun';
  import { mode, toggleMode } from 'mode-watcher';
  import { Button } from '#lib/components/ui/button/index.js';

  /** Switches between light and dark, as the docs' toggle does; both remember the choice under the same key. */
  const next = $derived(mode.current === 'dark' ? 'light' : 'dark');
</script>

<Button variant="ghost" size="icon" onclick={toggleMode} aria-label={`Switch to ${next} mode`}>
  <SunIcon class="hidden dark:block" />
  <MoonIcon class="dark:hidden" />
</Button>
