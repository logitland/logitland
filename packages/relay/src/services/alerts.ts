import { iso, type Relay } from '../context';
import { vitals } from './health';
import { staffChannel } from './settings';
import { Accent, cardMessage, linkButton } from './staff-cards';

// Operational alerts (#21). The bot posts a card in #relay-health (the `relay_health_channel_id` setting, or else the staff
// alerts channel) when a condition starts and once when it clears, never again while it lasts. They only inform, so they
// have no Dismiss. Cron runs this every minute; job_state remembers what is active and whether it was posted, so a post that
// fails is tried again on the next run. No channel, no alerts.

/** Deliveries waiting (pending or retrying) beyond which the backlog is alerted. */
export const BACKLOG_THRESHOLD = 1000;
/** How long the Gateway may be disconnected before it is alerted, and how old its last heartbeat may be while it says connected. */
const GATEWAY_GRACE_MS = 5 * 60_000;
const HELD_MAX_AGE_MS = 3600_000;
const STATE_KEY = 'alerts';

interface Condition {
  /** What to post while it lasts; null when all is well. */
  alert: string | null;
  cleared: string;
  /** How long it must last before it is posted. */
  graceMs?: number;
}

type State = Record<string, { since: string; posted: boolean }>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function conditions(relay: Relay): Promise<Record<string, Condition>> {
  const now = relay.now().getTime();
  const { intake: gateway, held, typesafe, backlog } = await vitals(relay);
  const heartbeat = gateway.last_heartbeat_at ? Date.parse(gateway.last_heartbeat_at) : 0;
  const waiting = backlog.pending + backlog.retrying;
  return {
    gateway: {
      alert:
        gateway.status !== 'connected' || now - heartbeat > GATEWAY_GRACE_MS
          ? `The Gateway has been disconnected for over 5 minutes (${gateway.status}), so the relay isn’t reading Discord.`
          : null,
      cleared: 'The Gateway is connected again.',
      graceMs: GATEWAY_GRACE_MS,
    },
    typesafe: {
      alert: !typesafe.failing
        ? null
        : typesafe.classifier === 'unconfigured'
          ? 'TypeSafe isn’t configured (TYPESAFE_API_KEY), so no message can be checked.'
          : `Jev on TypeSafe is failing. ${plural(held.outage, 'message is', 'messages are')} held until it answers.`,
      cleared: 'Jev on TypeSafe is answering again.',
    },
    held: {
      alert:
        held.oldest_at && now - Date.parse(held.oldest_at) > HELD_MAX_AGE_MS
          ? `A message has waited in the held queue for over an hour. ${plural(held.review + held.outage, 'message is', 'messages are')} held.`
          : null,
      cleared: 'No message has waited in the held queue for over an hour now.',
    },
    backlog: {
      alert: waiting > BACKLOG_THRESHOLD ? `${plural(waiting, 'webhook delivery is', 'webhook deliveries are')} waiting to be sent.` : null,
      cleared: `The delivery backlog is under ${BACKLOG_THRESHOLD} again.`,
    },
  };
}

/** Posts an alert, red while the condition lasts and green once it clears, linking to the Health page. */
async function post(relay: Relay, channelId: string, content: string, cleared = false): Promise<boolean> {
  try {
    const card = cardMessage({
      text: [content],
      accent: cleared ? Accent.success : Accent.destructive,
      buttons: [linkButton('Open Health', `${relay.config.dashboardUrl}/admin/health`)],
    });
    await relay.discord.createMessage(channelId, card);
    return true;
  } catch (error) {
    relay.log.warn('alerts.post_failed', { channel_id: channelId, error });
    return false;
  }
}

/** The cron job. Returns how many alerts it posted. */
export async function alertsJob(relay: Relay): Promise<number> {
  const channelId = await staffChannel(relay, 'relay_health');
  if (!channelId) return 0;
  const saved = await relay.db.prepare('SELECT value FROM job_state WHERE key = ?').bind(STATE_KEY).first<{ value: string }>();
  const state: State = saved ? JSON.parse(saved.value) : {};
  const now = relay.now();
  let posted = 0;
  for (const [key, c] of Object.entries(await conditions(relay))) {
    const was = state[key];
    if (c.alert === null) {
      // A clear that fails to post is tried again next run.
      if (was?.posted && !(await post(relay, channelId, c.cleared, true))) continue;
      if (was?.posted) posted++;
      delete state[key];
      continue;
    }
    const since = was?.since ?? iso(now);
    const due = !was?.posted && now.getTime() - Date.parse(since) >= (c.graceMs ?? 0);
    const sent = due && (await post(relay, channelId, c.alert));
    if (sent) posted++;
    state[key] = { since, posted: Boolean(was?.posted) || sent };
  }
  await relay.db
    .prepare(
      'INSERT INTO job_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(STATE_KEY, JSON.stringify(state), iso(now))
    .run();
  return posted;
}
