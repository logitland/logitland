import {
  DEFAULT_SCENARIO,
  NOTICES,
  RECEIVERS,
  SENDERS,
  UPDATED,
  fieldFromCounts,
  healthPath,
  isScenario,
  postRanges,
  subscriptionField,
  type FieldCounts,
} from '#lib/fixtures/admin-health.js';
import { relay } from '#lib/server/relay.js';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const byStatus = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, num(n)])) : {};

export async function load({ parent, url }) {
  const { viewer } = await parent();
  const client = relay();

  if (!client) {
    // Fixtures mode shows the ingestion gap; ?scenario=normal|gap|mod switches it for review.
    const asked = url.searchParams.get('scenario');
    const scenario = isScenario(asked) ? asked : DEFAULT_SCENARIO;
    return {
      live: false,
      scenario,
      updated: UPDATED,
      notice: NOTICES[scenario] ?? null,
      path: healthPath(scenario),
      field: subscriptionField(scenario),
      posts: postRanges(scenario),
      senders: SENDERS,
      receivers: RECEIVERS,
    };
  }

  // Relay mode: the counts come from /internal/admin/health. The relay doesn't report incidents, request
  // rates, Discord rate-limit budgets, receiver problems or post history yet, so the notices are off and
  // those parts (Relay API, Discord and Event intake on the path, the post bars, Discord sending and
  // Receivers in trouble) stay fixtures.
  const h = await client.adminHealth(viewer.owner_id);
  const subs = byStatus(h.subscriptions);
  const deliveries = byStatus(h.deliveries_last_hour);
  // Subscriptions are counted by status, not by delivery health: verifying ones (waiting on the receiver's
  // challenge) show as retrying, and there is no failing count yet.
  const counts: FieldCounts = { ok: subs.active ?? 0, retry: subs.verifying ?? 0, fail: null, paused: subs.paused ?? 0 };
  const path = healthPath('normal').map((step) => {
    if (step.name === 'Jev/Laya') return { ...step, value: `${num(h.moderation_waiting)} waiting` };
    if (step.name === 'Callbacks')
      return { ...step, tick: undefined, value: `${num(h.deliveries_due)} due`, note: `${deliveries.retrying ?? 0} retrying · ${deliveries.failed ?? 0} failed, kept for replay` };
    return step;
  });
  return {
    live: true,
    scenario: 'normal' as const,
    updated: UPDATED,
    notice: null,
    path,
    field: fieldFromCounts(counts),
    posts: postRanges('normal'),
    senders: SENDERS,
    receivers: RECEIVERS,
  };
}
