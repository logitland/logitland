import type { Showcase } from '@logitland/contracts';
import { relay } from '#lib/server/relay.js';

// The live channels come from the relay, and re-read on `home:showcase` (see live-channel.svelte). Without the relay the
// home page still works, minus the live channels. `at` is the server's clock, so ages render the same on both sides.
export const load = async (event) => {
  event.depends('home:showcase');
  const showcase = await relay<Showcase>(event, '/internal/showcase').catch((err: unknown) => {
    console.error('home.showcase_failed', err);
    return null;
  });
  return { showcase, at: Date.now() };
};
