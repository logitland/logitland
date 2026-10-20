<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from '#lib/components/ui/sonner/index.js';
  import { IsMobile } from '#lib/hooks/is-mobile.svelte.js';

  let { children } = $props();

  // On phones, actions sit at the bottom of the screen; toasts there would cover them.
  const mobile = new IsMobile();
</script>

<ModeWatcher />
<Toaster position={mobile.current ? 'top-center' : 'bottom-center'} visibleToasts={mobile.current ? 1 : 3} />
{@render children()}
