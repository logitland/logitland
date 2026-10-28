<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { COLOR_MODE_KEY, MIGRATE_COLOR_MODE_SCRIPT } from '@logitland/tokens/color-mode';
  import { Toaster } from '#lib/components/ui/sonner/index.js';
  import { IsMobile } from '#lib/hooks/is-mobile.svelte.js';

  let { children } = $props();

  // On phones, actions sit at the bottom of the screen; toasts there would cover them.
  const mobile = new IsMobile();
</script>

<!-- Before ModeWatcher's own head script, which reads the key the migration fills. -->
<svelte:head>{@html `<script>${MIGRATE_COLOR_MODE_SCRIPT}</script>`}</svelte:head>
<!-- The docs (Svartz) read and write this key too, so a colour mode chosen in one carries to the other. -->
<ModeWatcher modeStorageKey={COLOR_MODE_KEY} />
<Toaster position={mobile.current ? 'top-center' : 'bottom-center'} visibleToasts={mobile.current ? 1 : 3} />
{@render children()}
