<script lang="ts">
  import { afterNavigate } from '$app/navigation';
  import { useSidebar } from '#lib/components/ui/sidebar/index.js';

  // The mobile sidebar is a sheet; following a link inside it should reveal the page.
  const sidebar = useSidebar();
  afterNavigate(() => sidebar.setOpenMobile(false));
</script>
