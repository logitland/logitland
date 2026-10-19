// A delivery from the relay's ledger as the owner's Deliveries screen shows it.
import { LIMITS, type DeliveryDetail } from '@logitland/contracts';
import type { Attempt, DeliveryItem } from '#lib/fixtures/deliveries.js';
import { clock, stamp } from '#lib/format.js';

const hms = (iso: string) => `${clock(iso)}:${iso.slice(17, 19)}`;

/** Why a failed delivery is not being retried. The relay retries timeouts, 408, 429 and 5xx; everything else ends the delivery on its first attempt. */
function whyStopped(d: DeliveryDetail): string {
  const code = d.last_status_code;
  if (code === 410) return 'The receiver said 410 Gone, so the relay stopped sending and ended the subscription.';
  if (code !== null && code >= 300 && code < 400) return 'The relay never follows redirects, so it didn’t retry.';
  if (code !== null && code >= 400 && code < 500 && code !== 408 && code !== 429)
    return 'The relay doesn’t retry an answer like that, because waiting wouldn’t change it.';
  const n = d.attempts;
  return `The relay gave up after ${n} ${n === 1 ? 'attempt' : 'attempts'}.`;
}

/** What each way of being dropped means: last_error holds the exact one, but not every drop records it. */
export const DROP_REASONS =
  'A delivery is dropped, not sent, when its subscription is paused, ended or removed, its agent is turned off, suspended or banned or loses messages:read, the channel closes to agents, or the message is removed before it goes out.';

function answer(d: DeliveryDetail): string {
  if (d.last_error) return d.last_status_code ? `${d.last_status_code}, ${d.last_error}` : d.last_error;
  return d.last_status_code ? `The receiver answered ${d.last_status_code}` : 'The receiver didn’t answer';
}

/** What each attempt returned, oldest first, with the scheduled next one at the end. */
export function attemptsOf(d: DeliveryDetail): Attempt[] {
  const log = d.attempt_log.map((a): Attempt => {
    const ok = a.status_code !== null && a.status_code >= 200 && a.status_code < 300;
    return {
      at: hms(a.started_at),
      result: a.status_code !== null ? String(a.status_code) : 'No answer',
      note: a.error ?? (ok ? 'OK' : a.status_code === 429 ? 'Told to slow down' : ''),
      ms: a.status_code !== null || a.duration_ms ? `${a.duration_ms} ms` : '',
      kind: ok ? 'ok' : a.status_code === 429 ? 'wait' : 'fail',
    };
  });
  if (d.status === 'retrying' && d.next_attempt_at) log.push({ at: hms(d.next_attempt_at), result: 'Next', note: 'scheduled', ms: '', kind: 'next' });
  return log;
}

/** A delivery from the owner list as the screen shows it. The relay keeps the ledger and each attempt, but not the request that was sent, so there are no headers or body. */
export function toItem(d: DeliveryDetail, now: number, channels?: string): DeliveryItem {
  const n = d.attempts;
  const tries = `${n} ${n === 1 ? 'attempt' : 'attempts'}`;
  const host = d.url_host;
  const facts = [
    { label: 'Receiver', value: host, mono: true },
    { label: 'Event', value: d.event_id, mono: true },
    { label: 'Seen', value: `${stamp(d.created_at, now)} UTC` },
    { label: 'Attempts', value: String(n) },
    { label: 'Subscription', value: d.subscription_id, mono: true },
    ...(channels ? [{ label: 'Subscribed to', value: channels, mono: true }] : []),
  ];
  const view = (row: DeliveryItem['row'], state: string, headline: string, extra: DeliveryItem['facts'] = []): DeliveryItem => ({
    id: d.id,
    eventType: d.event_type,
    when: stamp(d.created_at, now),
    agent: d.agent_name,
    channel: channels,
    ids: [d.id, d.event_id],
    count: n,
    act: null,
    action: '',
    primary: false,
    cursor: null,
    attempts: attemptsOf(d),
    headers: '',
    body: '',
    host,
    row,
    state,
    tone: row.tone,
    headline,
    facts: [...facts, ...extra],
  });

  switch (d.status) {
    case 'delivered':
      return view(
        { text: n > 1 ? `Delivered on attempt ${n}` : 'Delivered', tone: 'ok' },
        'Delivered',
        `Delivered after ${tries}. The receiver answered ${d.last_status_code ?? 'with success'}.`,
        d.delivered_at ? [{ label: 'Delivered', value: `${stamp(d.delivered_at, now)} UTC` }] : [],
      );
    case 'retrying':
      return view(
        { text: `Retrying · ${tries}`, tone: 'wait' },
        'Retrying',
        `${answer(d)}. ${d.next_attempt_at ? `Next attempt at ${clock(d.next_attempt_at)} UTC.` : 'The next attempt is scheduled.'} Waits double, with jitter, for up to ${LIMITS.deliveryMaxAttempts} attempts.`,
        d.next_attempt_at ? [{ label: 'Next attempt', value: `${clock(d.next_attempt_at)} UTC` }] : [],
      );
    case 'failed':
      return view(
        { text: 'Failed', tone: 'fail' },
        'Failed',
        `${answer(d)}. ${whyStopped(d)} A relay admin can replay it. ${LIMITS.pauseAfterFailedDeliveries} failures in a row pause the subscription.`,
      );
    case 'dropped':
      return view(
        { text: 'Dropped', tone: 'wait' },
        'Dropped',
        d.last_error ? `Dropped without being sent: ${d.last_error.replace(/\.$/, '')}.` : `Dropped without being sent. ${DROP_REASONS}`,
      );
    case 'pending':
      return view({ text: 'Queued', tone: 'wait' }, 'Queued', 'Waiting to be sent to the receiver, or held back while an admin has deliveries switched off.');
  }
}
