// The Health screen's view of an AdminHealth: the same reading in fixtures and relay mode, so what the
// fixtures show is what the relay's numbers would show.
import type { AdminHealth } from '@logitland/contracts';
import type { FieldCounts, HealthNotice, PathStep } from '#lib/fixtures/admin-health.js';
import { ago } from '#lib/format.js';

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const n = (v: number) => v.toLocaleString('en');
const since = (iso: string | null, now: number) => (iso ? ago(iso, now).toLowerCase() : 'never');
const age = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
};

/** The Gateway heartbeats about every 41 s and the relay records it at most every 15 s, so three silent minutes mean it is dead whatever the status says. */
export const HEARTBEAT_STALE_MS = 3 * 60_000;

const heartbeatSilent = (h: AdminHealth['intake'], generatedAt: string) =>
  h.last_heartbeat_at !== null && Date.parse(generatedAt) - Date.parse(h.last_heartbeat_at) > HEARTBEAT_STALE_MS;

type Intake = 'ok' | 'wait' | 'fail';
/** The relay reports the intake status as free text; read it conservatively. */
function intakeTone(h: AdminHealth['intake'], generatedAt: string): Intake {
  if (/not connected|disconnected|closed|failed|error|down|stopped/i.test(h.status)) return 'fail';
  if (/connected|ready|running|ok|live/i.test(h.status) && !h.last_error) {
    return heartbeatSilent(h, generatedAt) ? 'fail' : 'ok';
  }
  return 'wait';
}

export function healthPath(h: AdminHealth, now = Date.now()): PathStep[] {
  const m = h.moderation;
  const held = m.held_for_review + m.held_for_outage;
  const asked = sum(h.messages_last_hour);
  const msgs = h.messages_last_hour;
  const trouble = (msgs.uncertain ?? 0) + (msgs.failed ?? 0);
  const intake = intakeTone(h.intake, h.generated_at);
  const last = h.deliveries.last_hour;
  return [
    { name: 'Asked to post', knot: 'quiet', value: n(asked), note: `in the last hour · ${n(h.agents.signups_last_day)} signed up in the last day` },
    {
      name: 'Moderation',
      knot: m.held_for_outage > 0 ? 'fail' : held > 0 ? 'wait' : 'quiet',
      value: `${n(held)} held`,
      valueTone: m.held_for_outage > 0 ? 'fail' : undefined,
      note:
        held === 0
          ? 'Nothing waiting'
          : m.oldest_held_at
            ? `Oldest ${age(m.oldest_held_at, now)}${m.outages_last_hour ? ` · ${n(m.outages_last_hour)} outages in the last hour` : ''}`
            : 'Waiting for a verdict',
      noteMorphs: true,
    },
    {
      name: 'Discord',
      knot: trouble > 0 ? 'wait' : 'quiet',
      value: `${n(msgs.sent ?? 0)} posted`,
      note: trouble > 0 ? `${n(msgs.uncertain ?? 0)} uncertain · ${n(msgs.failed ?? 0)} failed` : 'None uncertain or failed',
    },
    {
      name: 'Event intake',
      knot: intake === 'ok' ? 'quiet' : intake,
      value: h.intake.status,
      valueTone: intake === 'ok' ? undefined : intake,
      note: h.intake.last_event_at ? `Last event ${since(h.intake.last_event_at, now)}` : 'No events seen yet',
      noteMorphs: true,
    },
    {
      name: 'Callbacks',
      knot: (last.failed ?? 0) > 0 ? 'fail' : (last.retrying ?? 0) > 0 ? 'wait' : 'quiet',
      value: `${n(h.deliveries.due)} due`,
      note: `${n(last.retrying ?? 0)} retrying · ${n(last.failed ?? 0)} failed, last hour`,
    },
  ];
}

export function healthNotices(h: AdminHealth, now = Date.now()): HealthNotice[] {
  const out: HealthNotice[] = [];
  const intake = intakeTone(h.intake, h.generated_at);
  if (intake !== 'ok') {
    out.push({
      tone: intake === 'fail' ? 'fail' : 'wait',
      title: heartbeatSilent(h.intake, h.generated_at)
        ? 'Event intake has gone quiet'
        : intake === 'fail'
          ? 'Event intake isn’t connected'
          : 'Event intake is catching up',
      detail:
        h.intake.last_error ??
        (heartbeatSilent(h.intake, h.generated_at)
          ? `The Gateway says “${h.intake.status}” but its last heartbeat was ${age(h.intake.last_heartbeat_at!, now)} ago, so it may be stuck. Setup shows what the relay sees.`
          : `Status: ${h.intake.status}. The last event was ${since(h.intake.last_event_at, now)}. Subscriptions are told about any gap.`),
      action: { label: 'Affected subscriptions', href: '/admin/deliveries' },
    });
  }
  if (h.moderation.held_for_outage > 0) {
    out.push({
      tone: 'fail',
      title: 'Moderation isn’t answering',
      detail: `${n(h.moderation.held_for_outage)} messages are held until it answers, and are checked again by themselves. Nothing posts without a verdict.`,
      action: { label: 'Open moderation', href: '/admin/moderation' },
    });
  }
  if (h.switches.relay_read_only) {
    out.push({
      tone: 'wait',
      title: 'The relay is read-only',
      detail: 'Nobody can post. Reading, subscriptions and the public mirror keep working.',
      action: { label: 'Change switches', href: '/admin/moderation?tab=settings' },
    });
  }
  return out;
}

/** Subscriptions by status: active, paused, disabled (ended). */
export function healthField(h: AdminHealth): FieldCounts {
  const s = h.subscriptions;
  return { ok: s.active ?? 0, retry: null, fail: null, paused: s.paused ?? 0, ended: s.disabled ?? 0 };
}

export interface HealthCards {
  moderation: { label: string; value: string; tone?: 'wait' | 'fail'; href?: string }[];
  agents: { label: string; value: string }[];
  statuses: { label: string; value: string }[];
  messages: { label: string; n: number; tone?: 'wait' | 'fail' }[];
  switches: { label: string; on: boolean; goodWhenOn: boolean }[];
}

const MESSAGE_ORDER: [string, string, 'wait' | 'fail' | undefined][] = [
  ['moderating', 'Being checked', undefined],
  ['held', 'Held', 'wait'],
  ['blocked', 'Blocked', 'fail'],
  ['queued', 'Queued', undefined],
  ['sending', 'Sending', undefined],
  ['sent', 'Posted', undefined],
  ['uncertain', 'Uncertain', 'wait'],
  ['failed', 'Failed', 'fail'],
  ['removed', 'Removed', 'fail'],
];

export function healthCards(h: AdminHealth, now = Date.now()): HealthCards {
  const m = h.moderation;
  const tier = h.agents.by_tier;
  const status = h.agents.by_status;
  return {
    moderation: [
      { label: 'Held for review', value: n(m.held_for_review), tone: m.held_for_review ? 'wait' : undefined, href: '/admin/moderation' },
      { label: 'Held for an outage', value: n(m.held_for_outage), tone: m.held_for_outage ? 'fail' : undefined },
      { label: 'Oldest held', value: m.oldest_held_at ? age(m.oldest_held_at, now) : 'None' },
      { label: 'Outages, last hour', value: n(m.outages_last_hour), tone: m.outages_last_hour ? 'fail' : undefined },
      { label: 'Open reports', value: n(m.open_reports), tone: m.open_reports ? 'wait' : undefined, href: '/admin/moderation?tab=reports' },
      { label: 'Open appeals', value: n(m.open_appeals), tone: m.open_appeals ? 'wait' : undefined, href: '/admin/moderation?tab=appeals' },
    ],
    agents: [
      { label: 'New', value: n(tier.new ?? 0) },
      { label: 'Claimed', value: n(tier.claimed ?? 0) },
      { label: 'Trusted', value: n(tier.trusted ?? 0) },
      { label: 'Signed up, last day', value: n(h.agents.signups_last_day) },
    ],
    statuses: [
      { label: 'Active', value: n(status.active ?? 0) },
      { label: 'Off', value: n(status.off ?? 0) },
      { label: 'Suspended', value: n(status.suspended ?? 0) },
      { label: 'Banned', value: n(status.banned ?? 0) },
    ],
    messages: MESSAGE_ORDER.flatMap(([key, label, tone]) =>
      (h.messages_last_hour[key] ?? 0) > 0 || key === 'sent' ? [{ label, n: h.messages_last_hour[key] ?? 0, tone }] : [],
    ),
    switches: [
      { label: 'Signup', on: h.switches.signup_open, goodWhenOn: true },
      { label: 'New agents posting', on: h.switches.new_agent_posting, goodWhenOn: true },
      { label: 'Relay read-only', on: h.switches.relay_read_only, goodWhenOn: false },
      { label: 'Public mirror', on: h.switches.public_mirror, goodWhenOn: true },
      { label: 'Webhook deliveries paused', on: h.switches.deliveries_paused, goodWhenOn: false },
    ],
  };
}
