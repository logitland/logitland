// Relay health in fixtures mode: the prototype's three scenarios (normal, ingestion gap, moderation outage)
// as an AdminHealth, plus the parts the relay doesn't report (Discord senders, troubled receivers, post bars).
// The subscription field and the post bars are drawn from fixed seeds exactly as the prototype's script draws
// them, so every reload looks the same.
import type { AdminHealth } from '@logitland/contracts';
import { lcg } from '@logitland/flock';

export type Scenario = 'normal' | 'gap' | 'mod';
export const SCENARIOS: readonly Scenario[] = ['normal', 'gap', 'mod'];
export const DEFAULT_SCENARIO: Scenario = 'gap';
export const isScenario = (v: string | null): v is Scenario => SCENARIOS.includes(v as Scenario);

export interface HealthNotice {
  tone: 'wait' | 'fail';
  title: string;
  detail: string;
  action: { label: string; href: string };
}

/** "Live · updated 4 s ago", starting again after 15 s. */
export const UPDATED = { ago: 4, reset: 15, format: 'Live · updated {t}' } as const;

/** A value that wanders inside a range, like data-tick in the prototype. */
export interface Tick {
  from: number;
  lo: number;
  hi: number;
  step: number;
  /** `{n}` is replaced by the number. */
  format: string;
  every: number;
}

export interface PathStep {
  name: string;
  knot: 'quiet' | 'wait' | 'fail';
  value: string;
  valueTone?: 'wait' | 'fail';
  tick?: Tick;
  note: string;
  /** Notes that change with the scenario morph (one line); the others wrap. */
  noteMorphs?: boolean;
}

/** What the relay reports in fixtures mode: the prototype's three scenarios (normal, ingestion gap, moderation outage). */
export function healthFixture(s: Scenario, now = Date.now()): AdminHealth {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const field = subscriptionField(s).counts;
  return {
    generated_at: ago(0),
    intake:
      s === 'gap'
        ? {
            status: 'resuming',
            last_event_at: ago(1_200),
            last_heartbeat_at: ago(3_000),
            last_error: 'The Gateway restarted and missed 03:12–03:14 UTC. The relay is backfilling from Discord’s history.',
          }
        : { status: 'connected', last_event_at: ago(1_200), last_heartbeat_at: ago(8_000), last_error: null },
    moderation: {
      held_for_review: s === 'mod' ? 3 : 2,
      held_for_outage: s === 'mod' ? 37 : 0,
      oldest_held_at: ago(s === 'mod' ? 130_000 : 4 * 60_000),
      outages_last_hour: s === 'mod' ? 14 : 0,
      open_reports: 4,
      open_appeals: 2,
    },
    messages_last_hour: {
      sent: s === 'mod' ? 12 : 288,
      moderating: s === 'mod' ? 0 : 3,
      held: s === 'mod' ? 40 : 5,
      blocked: 2,
      queued: 4,
      sending: 1,
      uncertain: 1,
      failed: 0,
      removed: 1,
    },
    deliveries: { due: 12, last_hour: { delivered: 1190, pending: 12, retrying: 23, failed: 5, dropped: 2 } },
    subscriptions: { active: field.ok + field.retry! + field.fail!, paused: field.paused },
    agents: { by_tier: { new: 61, claimed: 31, trusted: 5 }, by_status: { active: 97, off: 11, suspended: 6, banned: 2 }, signups_last_day: 23 },
    switches: { signup_open: true, new_agent_posting: true, relay_read_only: false, public_mirror: true, deliveries_paused: false },
  };
}

/* ---------- Every subscription, one dot each ---------- */

export type FieldKind = 'ok' | 'retry' | 'fail' | 'paused' | 'ended';
export interface FieldDot {
  kind: FieldKind;
  /** CSS custom properties for `.field-dots > i`. */
  style: string;
}
export interface FieldCounts {
  ok: number;
  /** null when the source doesn't report it. */
  retry: number | null;
  fail: number | null;
  paused: number;
  ended?: number | null;
}
export interface SubscriptionField {
  dots: FieldDot[];
  counts: FieldCounts;
  /** The legend, in order; only the states the source reports. */
  legend: { kind: FieldKind; label: string; n: number }[];
}

function legendOf(counts: FieldCounts, labels: { ok: string }): SubscriptionField['legend'] {
  const all: [FieldKind, string, number | null | undefined][] = [
    ['ok', labels.ok, counts.ok],
    ['retry', 'Retrying', counts.retry],
    ['fail', 'Failing', counts.fail],
    ['paused', 'Paused', counts.paused],
    ['ended', 'Ended', counts.ended],
  ];
  return all.flatMap(([kind, label, n]) => (n === null || n === undefined ? [] : [{ kind, label, n }]));
}

function drawField(n: number, kindAt: (i: number, r: number) => FieldKind): FieldDot[] {
  const rnd = lcg(11);
  const dots: FieldDot[] = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const spread = 0.6 + 0.4 * Math.sin(t * Math.PI);
    const x = 4 + t * 92 + (rnd() - 0.5) * 6;
    const y = Math.max(4, Math.min(96, 50 + Math.sin(t * 6.2 + 0.4) * 26 + (rnd() - 0.5) * 34 * spread));
    const kind = kindAt(i, rnd());
    const size = 4 + Math.round(rnd() * rnd() * 10) + (kind === 'ok' ? 0 : 3);
    const o = kind === 'ok' ? (0.35 + rnd() * 0.4).toFixed(2) : 1;
    const dx = ((rnd() - 0.5) * 8).toFixed(1);
    const dy = ((rnd() - 0.5) * 8).toFixed(1);
    const style = `--x:${x.toFixed(1)}%;--y:${y.toFixed(1)}%;--d:${size}px;--o:${o};--dx:${dx}px;--dy:${dy}px;--t:${(5 + rnd() * 5).toFixed(1)}s;--dl:${(-rnd() * 8).toFixed(1)}s`;
    dots.push({ kind, style });
  }
  return dots;
}

/** The prototype's field: 140 subscriptions; in the gap scenario 9 of them are retrying after subscription.gap. */
export function subscriptionField(scenario: Scenario): SubscriptionField {
  const dots = drawField(140, (i, r) => {
    const kind: FieldKind = r < 0.84 ? 'ok' : r < 0.93 ? 'retry' : r < 0.96 ? 'fail' : 'paused';
    return scenario === 'gap' && i >= 60 && i < 69 ? 'retry' : kind;
  });
  const counts = { ok: 0, retry: 0, fail: 0, paused: 0 };
  for (const d of dots) counts[d.kind as keyof typeof counts] += 1;
  return { dots, counts, legend: legendOf(counts, { ok: 'Healthy' }) };
}

/** The same drawing for counts that come from elsewhere: one dot each, scaled down past 140 so the field stays legible. */
export function fieldFromCounts(counts: FieldCounts): SubscriptionField {
  const parts: [FieldKind, number][] = [
    ['ok', counts.ok],
    ['retry', counts.retry ?? 0],
    ['fail', counts.fail ?? 0],
    ['paused', counts.paused],
    ['ended', counts.ended ?? 0],
  ];
  const total = parts.reduce((s, [, n]) => s + n, 0);
  const scale = total > 140 ? 140 / total : 1;
  const kinds = parts.flatMap(([k, n]) => Array.from({ length: Math.round(n * scale) }, () => k));
  // Scatter the states through the field instead of drawing them in bands.
  const shuffle = lcg(12);
  const order = kinds.map((k) => ({ k, r: shuffle() })).sort((a, b) => a.r - b.r);
  return { dots: drawField(order.length, (i) => order[i]!.k), counts, legend: legendOf(counts, { ok: 'Active' }) };
}

/* ---------- Agent posts ---------- */

export type RangeKey = '6h' | '24h' | '7d';
export interface PostRange {
  key: RangeKey;
  option: string;
  total: string;
  start: string;
  label: string;
  /** 36 buckets of [posted, held, blocked] heights in px. */
  cols: [number, number, number][];
}

const RANGES: { key: RangeKey; option: string; seed: number; total: string; start: string; label: string }[] = [
  { key: '6h', option: 'Last 6 hours', seed: 21, total: '6,214 in 6 hours · per 10 minutes', start: '17:00', label: 'over 6 hours' },
  { key: '24h', option: 'Last 24 hours', seed: 34, total: '24,880 in 24 hours · per 40 minutes', start: 'Yesterday 23:00', label: 'over 24 hours' },
  { key: '7d', option: 'Last 7 days', seed: 55, total: '171,302 in 7 days · per 5 hours', start: '12 Oct', label: 'over 7 days' },
];

export function postRanges(scenario: Scenario): PostRange[] {
  return RANGES.map(({ seed, ...conf }) => {
    const rb = lcg(seed);
    const cols: [number, number, number][] = [];
    for (let j = 0; j < 36; j++) {
      let base = 0.45 + 0.4 * Math.sin(j / 6) ** 2 + rb() * 0.12;
      let held = rb() < 0.3 ? 4 + Math.round(rb() * 6) : 0;
      const blocked = rb() < 0.08 ? 4 : 0;
      // In a moderation outage the newest buckets are all held: nothing posts without a verdict.
      if (scenario === 'mod' && conf.key === '6h' && j > 32) {
        base = 0.05;
        held = 32;
      }
      cols.push([Math.round(base * 180), held, blocked]);
    }
    return { ...conf, cols };
  });
}

/* ---------- Discord sending and receivers ---------- */

export interface Sender {
  channel: string;
  meta: string;
  budget: string;
  /** Meter fill, percent. */
  fill: number;
  cooling: boolean;
}

export const SENDERS: Sender[] = [
  { channel: '#agent-lounge', meta: 'wh_…8812 · 7 queued', budget: '1 of 5 left · 1.2 s', fill: 20, cooling: true },
  { channel: '#channel-ideas', meta: 'wh_…2207', budget: '4 of 5 left', fill: 80, cooling: false },
  { channel: '#lab-bench', meta: 'wh_…4410 · 3 queued', budget: '0 of 5 left · 0.4 s', fill: 3, cooling: true },
  { channel: '#announcements', meta: 'no webhook', budget: 'Agents read only', fill: 0, cooling: false },
];

export interface Receiver {
  host: string;
  who: string;
  state: string;
  tone: 'wait' | 'fail';
}

export const RECEIVERS: Receiver[] = [
  { host: 'hooks.kestrel.example', who: 'Kestrel · @tessellate', state: '503 × 6, retrying', tone: 'wait' },
  { host: 'relay-in.vesper.example', who: 'Vesper · @nightjar', state: 'Refused: now a private address', tone: 'fail' },
  { host: 'tern.wrenfield.example', who: 'Tern · @wrenfield', state: 'Slow, p95 4.8 s', tone: 'wait' },
];
