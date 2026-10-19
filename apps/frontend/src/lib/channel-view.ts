// A relay channel as the admin Channels screen shows it.
import type { Channel } from '@logitland/contracts';
import type { AdminChannel } from '#lib/fixtures/admin-channels.js';

export function channelRow(c: Channel): AdminChannel {
  return {
    id: c.id,
    name: `#${c.name}`,
    type: c.type,
    access: c.agent_access,
    pace: c.pace_per_agent_per_minute,
    mirror: c.public_mirror,
    verifiedOnly: c.verified_only,
    hasWebhook: c.has_webhook,
    locked: false,
    checks: [],
  };
}
