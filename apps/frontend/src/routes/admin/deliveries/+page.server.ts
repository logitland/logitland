import { LIMITS, type AdminHealth, type AdminSubscription, type DeliveryDetail } from '@logitland/contracts';
import { fail } from '@sveltejs/kit';
import { DEMO_ADMIN } from '#lib/fixtures/community.js';
import {
  DISPATCH,
  DISPATCH_NOTE,
  FAILED,
  GAP_NOTICE,
  REFUSALS,
  RETRYING,
  STATUS_FILTERS,
  SUBSCRIPTIONS,
  SUB_FILTERS,
  type DeliveryStatusFilter,
  type DispatchStep,
  type FailedDelivery,
  type SubscriptionHealth,
} from '#lib/fixtures/admin-deliveries.js';
import { ago, stamp } from '#lib/format.js';
import { adminOnly, attempt, refused } from '#lib/server/guard.js';
import { relay, simulate } from '#lib/server/relay.js';

const n = (v: number) => v.toLocaleString('en');

function answerOf(d: DeliveryDetail): string {
  if (d.last_error) return d.last_status_code ? `${d.last_status_code}, ${d.last_error}` : d.last_error;
  return d.last_status_code ? String(d.last_status_code) : 'No answer';
}

function toRow(d: DeliveryDetail, now: number): FailedDelivery {
  return { id: d.id, eventType: d.event_type, host: d.url_host, agent: d.agent_name, answer: answerOf(d), when: stamp(d.created_at, now), selected: false };
}

/** What is waiting for a receiver, from the health summary. */
function dispatchOf(h: AdminHealth): DispatchStep[] {
  const last = h.deliveries.last_hour;
  const retrying = last.retrying ?? 0;
  const failed = last.failed ?? 0;
  return [
    { label: 'Due now', value: n(h.deliveries.due), note: 'sent on the next pass', knot: 'quiet' },
    { label: 'Waiting', value: n(last.pending ?? 0), note: 'created in the last hour', knot: 'quiet' },
    { label: 'Retrying', value: n(retrying), note: 'waits double, with jitter', knot: retrying ? 'wait' : 'quiet', tone: retrying ? 't-wait' : undefined },
    { label: 'Failed', value: n(failed), note: 'in the last hour, kept for replay', knot: failed ? 'fail' : 'quiet', tone: failed ? 't-fail' : undefined },
  ];
}

const ORDER = { retrying: 0, paused: 1, slow: 2, ended: 3, healthy: 4 } as const;

function healthOf(s: AdminSubscription, now: number): SubscriptionHealth {
  const waiting = s.pending_count;
  const rate = waiting ? `${n(waiting)} waiting` : '—';
  const rateTone = waiting ? ('t-wait' as const) : ('t-3' as const);
  const base = { host: s.url_host, agent: s.agent_name, owner: null, rate, rateTone, action: null };
  if (s.status === 'disabled')
    return { ...base, state: 'ended', stateLabel: 'Ended', tone: 'plain', dot: 'dot--off', detail: s.paused_reason ?? 'The relay ended this subscription' };
  if (s.status === 'paused') return { ...base, state: 'paused', stateLabel: 'Paused', tone: 'fail', dot: 'dot--fail', detail: s.paused_reason ?? 'Paused' };
  if (s.failure_streak > 0)
    return {
      ...base,
      state: 'retrying',
      stateLabel: 'Retrying',
      tone: 'wait',
      dot: 'dot--wait',
      detail: `${s.failure_streak} of ${LIMITS.pauseAfterFailedDeliveries} failed deliveries in a row`,
    };
  return {
    ...base,
    state: 'healthy',
    stateLabel: 'Healthy',
    tone: 'plain',
    dot: '',
    detail: s.last_delivered_at ? `Last delivered ${ago(s.last_delivered_at, now).toLowerCase()}` : 'Nothing delivered yet',
  };
}

export async function load({ locals, url }) {
  const wanted = url.searchParams.get('status');
  const status: DeliveryStatusFilter = STATUS_FILTERS.find((f) => f.value === wanted)?.value ?? 'failed';
  const before = url.searchParams.get('before') ?? undefined;
  const client = relay();
  const common = { filters: SUB_FILTERS, statuses: STATUS_FILTERS, status };

  if (!client || !locals.viewer) {
    const failed = status === 'failed' ? FAILED : status === 'retrying' ? RETRYING : [];
    return {
      ...common,
      dispatch: DISPATCH,
      dispatchNote: DISPATCH_NOTE,
      subscriptions: SUBSCRIPTIONS,
      refusals: REFUSALS,
      gap: GAP_NOTICE,
      failed,
      older: null as string | null,
      live: false,
    };
  }

  // Relay mode: deliveries and subscription health come from the relay, and the counts from its health summary.
  // Refusals and gap notices have no admin endpoint, so those parts stay empty. Pausing a receiver has no endpoint either.
  const id = locals.viewer.owner_id;
  const [page, subs, health] = await Promise.all([
    client.adminDeliveries(id, { status, before, limit: 50 }),
    client.adminSubscriptions(id, { limit: 100 }),
    client.adminHealth(id).catch(() => null),
  ]);
  const now = Date.now();
  const rows = subs.subscriptions.map((s) => healthOf(s, now)).sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  return {
    ...common,
    dispatch: health ? dispatchOf(health) : [],
    dispatchNote: '',
    subscriptions: rows,
    refusals: [],
    gap: null,
    failed: page.deliveries.map((d) => toRow(d, now)),
    older: page.next_before,
    live: true,
  };
}

const OUTCOME_LABEL = { delivered: 'Delivered on replay', retry: 'Will retry', failed: 'Failed again', dropped: 'Dropped', skipped: 'Skipped' } as const;

export const actions = {
  replay: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const ids = (await request.formData()).getAll('delivery').map(String).filter(Boolean);
    if (!ids.length) return fail(400, { message: 'Pick at least one delivery to replay.', replayed: {} as Record<string, string> });
    const client = relay();
    const replayed: Record<string, string> = {};
    if (!client) {
      await simulate(800);
      for (const id of ids) replayed[id] = OUTCOME_LABEL.delivered;
      return { replayed };
    }
    for (const id of ids) {
      const r = await attempt(() => client.adminReplay(viewer.owner_id, id));
      if (!r.ok) return refused(r.refusal, { replayed });
      replayed[id] = OUTCOME_LABEL[r.value.outcome];
    }
    return { replayed };
  },

  // Pausing a receiver is a fixtures-only simulation: the relay has no pause/resume endpoint.
  pause: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const host = String(form.get('host') ?? '');
    const paused = form.get('paused') === 'true';
    if (relay()) return fail(501, { message: 'The relay can’t pause deliveries yet.', host, paused: !paused });
    await simulate(700);
    return { host, paused, by: viewer.demo ? DEMO_ADMIN.username : viewer.username };
  },
};
