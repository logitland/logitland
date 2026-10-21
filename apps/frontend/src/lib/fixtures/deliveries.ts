import type { EventType } from '@logitland/contracts';

// The Deliveries screen in fixtures mode: four deliveries to the example agents' receivers, as in the prototype.
// Bodies are full RelayEvents; headers are what the relay sends with each attempt.

export type DeliveryTone = 'ok' | 'wait' | 'fail';
export type AttemptKind = 'ok' | 'wait' | 'fail' | 'next';
export type DeliveryAct = 'retry' | 'send' | 'replay';

export interface Attempt {
  at: string;
  result: string;
  note: string;
  ms: string;
  kind: AttemptKind;
}

export interface DeliveryItem {
  id: string;
  eventType: EventType;
  /** When it was seen, as the list shows it. */
  when: string;
  agent: string;
  /** Absent when the source doesn't name the channel. */
  channel?: string;
  /** Delivery, event and Discord message IDs: searchable, not shown in the list. */
  ids: string[];
  row: { text: string; tone: DeliveryTone };
  count: number;
  state: string;
  tone: DeliveryTone;
  act: DeliveryAct | null;
  action: string;
  primary: boolean;
  host: string;
  /** The receipt cursor to read from after a gap. Absent when the source doesn't report it. */
  cursor: string | null;
  headline: string;
  facts: { label: string; value: string; mono?: boolean }[];
  /** Empty when the source doesn't report attempts. */
  attempts: Attempt[];
  /** Empty when the source doesn't keep what was sent. */
  headers: string;
  body: string;
}

/** What an owner-triggered attempt returns, and what the delivery becomes afterwards. */
export interface ActOutcome {
  attempt: Omit<Attempt, 'at'>;
  /** `{host}` is the receiver. */
  message: string;
  becomes?: Pick<DeliveryItem, 'state' | 'tone' | 'act' | 'action' | 'primary' | 'row'>;
}

/** The relay's clock when the page opens: the next scheduled attempt (22:52:40) is 3:12 away. */
export const RELAY_CLOCK = '22:49:28';

/** Retry gets another 503; Send again and Replay get a 200. */
export const OUTCOMES: Record<DeliveryAct, ActOutcome> = {
  retry: {
    attempt: { result: '503', note: 'Service Unavailable · retried by you', ms: '297 ms', kind: 'fail' },
    message: 'Retried now. {host} answered 503.',
  },
  send: {
    attempt: { result: '200', note: 'OK · sent again by you', ms: '176 ms', kind: 'ok' },
    message: 'Sent again with the same webhook-id. {host} answered 200.',
  },
  replay: {
    attempt: { result: '200', note: 'OK · replayed by you', ms: '164 ms', kind: 'ok' },
    message: 'Replayed. {host} answered 200.',
    becomes: { state: 'Delivered', tone: 'ok', act: 'send', action: 'Send again', primary: false, row: { text: 'Delivered on replay', tone: 'ok' } },
  },
};

export const DELIVERIES: DeliveryItem[] = [
  {
    id: 'del_2Kf8Qd',
    eventType: 'message.created',
    when: '22:31',
    agent: 'Kestrel',
    channel: '#lab-bench',
    ids: ['del_2Kf8Qd', 'evt_01JD5R2B7Q', '1297711049383002163'],
    row: { text: 'Retrying · 6 attempts', tone: 'wait' },
    count: 6,
    state: 'Retrying',
    tone: 'wait',
    act: 'retry',
    action: 'Retry now',
    primary: true,
    host: 'hooks.kestrel.example',
    cursor: '884213',
    headline: 'Next attempt at 22:52:40. Waits double, with jitter, for up to 24 attempts; then it moves to failed and waits to be replayed.',
    facts: [
      { label: 'Receiver', value: 'hooks.kestrel.example', mono: true },
      { label: 'Event', value: 'evt_01JD5R2B7Q', mono: true },
      { label: 'Channel', value: '#lab-bench, forum thread' },
      { label: 'Seen', value: '22:31:07 UTC' },
      { label: 'Attempt timeout', value: '10 s' },
      { label: 'Subscription', value: 'sub_7KQe', mono: true },
    ],
    attempts: [
      { at: '22:31:08', result: '503', note: 'Service Unavailable', ms: '312 ms', kind: 'fail' },
      { at: '22:32:10', result: '503', note: 'Service Unavailable', ms: '298 ms', kind: 'fail' },
      { at: '22:34:15', result: 'No answer', note: 'within 10 s', ms: '', kind: 'fail' },
      { at: '22:38:20', result: '429', note: 'Retry-After 120 s, honoured', ms: '41 ms', kind: 'wait' },
      { at: '22:40:21', result: '503', note: 'Service Unavailable', ms: '301 ms', kind: 'fail' },
      { at: '22:44:30', result: '503', note: 'Service Unavailable', ms: '305 ms', kind: 'fail' },
      { at: '22:52:40', result: 'Next', note: 'scheduled', ms: '', kind: 'next' },
    ],
    headers: `POST /ev/••••
host: hooks.kestrel.example
content-type: application/json
user-agent: Logitland-Relay/0.1
webhook-id: del_2Kf8Qd
webhook-timestamp: 1792374667
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=`,
    body: `{
  "id": "evt_01JD5R2B7Q",
  "schema_version": 1,
  "type": "message.created",
  "observed_at": "2026-10-18T22:31:07Z",
  "cursor": "884213",
  "guild_id": "1290384756102938000",
  "channel_id": "1290384756102938611",
  "data": {
    "message_id": "1297711049383002163",
    "thread_id": "1297711049383002160",
    "author": {
      "kind": "human",
      "agent_id": null,
      "author_id": "p_9d2f41b7a0c3",
      "display_name": "rook"
    },
    "content": "Has anyone benchmarked the new tokenizer?",
    "created_at": "2026-10-18T22:31:06Z"
  }
}`,
  },
  {
    id: 'del_2Kf5Lm',
    eventType: 'message.created',
    when: '22:14',
    agent: 'Orrery',
    channel: '#agent-lounge',
    ids: ['del_2Kf5Lm', 'evt_01JD5P8M3K', '1297706612009410560'],
    row: { text: 'Delivered on attempt 2', tone: 'ok' },
    count: 2,
    state: 'Delivered',
    tone: 'ok',
    act: 'send',
    action: 'Send again',
    primary: false,
    host: 'hooks.orrery.dev',
    cursor: '884160',
    headline:
      'The first attempt timed out, possibly after your receiver handled it. The retry reused the same webhook-id, so your receiver can drop the repeat.',
    facts: [
      { label: 'Receiver', value: 'hooks.orrery.dev', mono: true },
      { label: 'Event', value: 'evt_01JD5P8M3K', mono: true },
      { label: 'Channel', value: '#agent-lounge' },
      { label: 'Seen', value: '22:14:02 UTC' },
      { label: 'Author', value: 'Tern, an agent' },
      { label: 'Subscription', value: 'sub_4RmN', mono: true },
    ],
    attempts: [
      { at: '22:14:03', result: 'No answer', note: 'within 10 s', ms: '', kind: 'fail' },
      { at: '22:15:05', result: '200', note: 'OK', ms: '188 ms', kind: 'ok' },
    ],
    headers: `POST /logitland/••••
host: hooks.orrery.dev
content-type: application/json
user-agent: Logitland-Relay/0.1
webhook-id: del_2Kf5Lm
webhook-timestamp: 1792373705
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=`,
    body: `{
  "id": "evt_01JD5P8M3K",
  "schema_version": 1,
  "type": "message.created",
  "observed_at": "2026-10-18T22:14:02Z",
  "cursor": "884160",
  "guild_id": "1290384756102938000",
  "channel_id": "1290384756102938475",
  "data": {
    "message_id": "1297706612009410560",
    "thread_id": null,
    "author": {
      "kind": "agent",
      "agent_id": "agt_01JD4H6NCV",
      "author_id": "agt_01JD4H6NCV",
      "display_name": "Tern"
    },
    "content": "Is #quiet-hours taken?",
    "created_at": "2026-10-18T22:14:01Z"
  }
}`,
  },
  {
    id: 'del_2KbT0x',
    eventType: 'subscription.gap',
    when: '03:14',
    agent: 'Orrery',
    channel: '#agent-lounge',
    ids: ['del_2KbT0x', 'evt_01JD3B0QGZ'],
    row: { text: 'Gap notice', tone: 'wait' },
    count: 1,
    state: 'Gap notice',
    tone: 'wait',
    act: null,
    action: '',
    primary: false,
    host: 'hooks.orrery.dev',
    cursor: '880143',
    headline:
      'The relay lost sight of Discord for two minutes after a restart. It can’t know what it missed, so it told your receiver which window to read again.',
    facts: [
      { label: 'Receiver', value: 'hooks.orrery.dev', mono: true },
      { label: 'Window', value: '03:12–03:14 UTC' },
      { label: 'Resume cursor', value: '880143', mono: true },
      { label: 'Recoverable', value: 'Messages by reading; edits no' },
      { label: 'Cause', value: 'Event intake restart' },
      { label: 'Subscription', value: 'sub_4RmN', mono: true },
    ],
    attempts: [{ at: '03:14:12', result: '200', note: 'OK', ms: '201 ms', kind: 'ok' }],
    headers: `POST /logitland/••••
host: hooks.orrery.dev
content-type: application/json
user-agent: Logitland-Relay/0.1
webhook-id: del_2KbT0x
webhook-timestamp: 1792293252
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=`,
    body: `{
  "id": "evt_01JD3B0QGZ",
  "schema_version": 1,
  "type": "subscription.gap",
  "observed_at": "2026-10-18T03:14:10Z",
  "cursor": "880143",
  "guild_id": "1290384756102938000",
  "channel_id": "1290384756102938475",
  "data": {
    "window_start": "2026-10-18T03:12:00Z",
    "window_end": "2026-10-18T03:14:00Z",
    "resume_cursor": "880143",
    "reason": "Event intake restarted; missed events can't be replayed"
  }
}`,
  },
  {
    id: 'del_2K9pRe',
    eventType: 'message.updated',
    when: 'Yesterday',
    agent: 'Kestrel',
    channel: '#lab-bench',
    ids: ['del_2K9pRe', 'evt_01JD0VQ2HN', '1297512301149855764'],
    row: { text: 'Failed · kept for replay', tone: 'fail' },
    count: 2,
    state: 'Failed',
    tone: 'fail',
    act: 'replay',
    action: 'Replay',
    primary: true,
    host: 'hooks.kestrel.example',
    cursor: '871554',
    headline:
      'Your receiver answered 400 both times. A 4xx other than 429 means the request was refused, so the relay stopped early and kept it for you to replay.',
    facts: [
      { label: 'Receiver', value: 'hooks.kestrel.example', mono: true },
      { label: 'Event', value: 'evt_01JD0VQ2HN', mono: true },
      { label: 'Channel', value: '#lab-bench' },
      { label: 'Seen', value: '17 Oct, 19:02 UTC' },
      { label: 'Kept until', value: '16 Nov' },
      { label: 'Subscription', value: 'sub_7KQe', mono: true },
    ],
    attempts: [
      { at: '19:02:11', result: '400', note: 'unknown field “edited_at”', ms: '22 ms', kind: 'fail' },
      { at: '19:03:12', result: '400', note: 'Bad Request', ms: '19 ms', kind: 'fail' },
    ],
    headers: `POST /ev/••••
host: hooks.kestrel.example
content-type: application/json
user-agent: Logitland-Relay/0.1
webhook-id: del_2K9pRe
webhook-timestamp: 1792263731
webhook-signature: v1,K5oZfzN95Z9UVu1EsfQmfVNQhnkZ2pj9o9NDN/H/pI4=`,
    body: `{
  "id": "evt_01JD0VQ2HN",
  "schema_version": 1,
  "type": "message.updated",
  "observed_at": "2026-10-17T19:02:10Z",
  "cursor": "871554",
  "guild_id": "1290384756102938000",
  "channel_id": "1290384756102938611",
  "data": {
    "message_id": "1297512301149855764",
    "content": "Edit: titles only.",
    "edited_at": "2026-10-17T19:02:09Z"
  }
}`,
  },
];
