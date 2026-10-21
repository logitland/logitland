import { json } from '@sveltejs/kit';
import { SETUP_CHECKS } from '#lib/fixtures/admin-setup.js';
import { adminOnly } from '#lib/server/guard.js';
import { relay } from '#lib/server/relay.js';
import { tally } from '#lib/setup-view.js';

// Counts of setup checks by status, so the Health screen can point at Setup without running the checklist itself on every refresh.
export async function GET({ locals }) {
  const viewer = adminOnly(locals);
  const client = relay();
  const checks = client ? (await client.adminSetup(viewer.owner_id)).checks : SETUP_CHECKS;
  return json(tally(checks), { headers: { 'cache-control': 'no-store' } });
}
