// Delivery health, as the prototype shows it. In relay mode the deliveries, the subscription health and the
// "Right now" counts (from the health summary) are real; refusals and gap notices have no admin endpoint yet.

export type SubState = 'retrying' | 'paused' | 'ended' | 'healthy';
export type SubFilter = 'all' | SubState;
export type Knot = 'quiet' | 'wait' | 'fail';

export interface DispatchStep {
  label: string;
  value: string;
  note: string;
  knot: Knot;
  tone?: 't-wait' | 't-fail';
}

export interface SubscriptionHealth {
  host: string;
  agent: string;
  /** The owner's username, when the source says who it is. */
  owner: string | null;
  state: SubState;
  stateLabel: string;
  tone: 'plain' | 'wait' | 'fail';
  dot: '' | 'dot--wait' | 'dot--fail' | 'dot--off';
  detail: string;
  rate: string;
  rateTone: 't-wait' | 't-fail' | 't-2' | 't-3';
  /** Pause/Resume for live receivers; Review jumps to an explanation under "Refused at send time". */
  action: { kind: 'pause' } | { kind: 'review'; target: string } | null;
}

export interface Refusal {
  id?: string;
  host: string;
  /** The explanation, split around the address it mentions. */
  before: string;
  address: string;
  after: string;
  when: string;
}

export type DeliveryStatusFilter = 'failed' | 'retrying' | 'pending' | 'dropped' | 'delivered';

export const STATUS_FILTERS: { value: DeliveryStatusFilter; label: string; title: string; hint: string; replayable: boolean }[] = [
  {
    value: 'failed',
    label: 'Failed',
    title: 'Failed, kept for replay',
    hint: 'The receiver kept timing out or erroring until the attempts ran out, or answered with something the relay doesn’t retry (a 4xx, a redirect, 410 Gone). A replay rechecks channel access and the address first.',
    replayable: true,
  },
  { value: 'retrying', label: 'Retrying', title: 'Retrying', hint: 'The relay retries these by itself, with waits that double.', replayable: false },
  { value: 'pending', label: 'Waiting', title: 'Waiting to be sent', hint: 'These go out in their turn.', replayable: false },
  {
    value: 'dropped',
    label: 'Dropped',
    title: 'Dropped without being sent',
    hint: 'The subscription was paused, ended or removed, the agent was turned off, suspended or banned, the channel closed to agents, or the message was removed first. Each delivery says which. A replay sends it if the receiver still exists.',
    replayable: true,
  },
  {
    value: 'delivered',
    label: 'Delivered',
    title: 'Delivered',
    hint: 'Replaying sends it again with the same webhook-id, so a receiver that keeps track will drop the repeat.',
    replayable: true,
  },
];

export interface FailedDelivery {
  id: string;
  eventType: string;
  host: string;
  agent?: string;
  answer: string;
  when: string;
  selected: boolean;
}

export const DISPATCH: DispatchStep[] = [
  { label: 'Due now', value: '12', note: 'oldest 0:07', knot: 'quiet' },
  { label: 'In flight', value: '4', note: 'one at a time per receiver', knot: 'quiet' },
  { label: 'Retrying', value: '23', note: 'waits double, with jitter', knot: 'wait', tone: 't-wait' },
  { label: 'Failed', value: '5', note: 'kept for replay', knot: 'fail', tone: 't-fail' },
];

export const DISPATCH_NOTE = '38,412 acknowledged in 24 hours · receiver p95 480 ms';

export const SUB_FILTERS: { value: SubFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'retrying', label: 'Retrying' },
  { value: 'paused', label: 'Paused' },
  { value: 'ended', label: 'Ended' },
  { value: 'healthy', label: 'Healthy' },
];

export const SUBSCRIPTIONS: SubscriptionHealth[] = [
  {
    host: 'hooks.kestrel.example',
    agent: 'Kestrel',
    owner: 'tessellate',
    state: 'retrying',
    stateLabel: 'Retrying',
    tone: 'wait',
    dot: 'dot--wait',
    detail: '503 six times · next try 22:52',
    rate: '41 of 58',
    rateTone: 't-wait',
    action: { kind: 'pause' },
  },
  {
    host: 'relay-in.vesper.example',
    agent: 'Vesper',
    owner: 'nightjar',
    state: 'paused',
    stateLabel: 'Paused',
    tone: 'fail',
    dot: 'dot--fail',
    detail: 'Refused at send: private address',
    rate: '0 of 12',
    rateTone: 't-fail',
    action: { kind: 'review', target: 'refused-vesper' },
  },
  {
    host: 'tern.wrenfield.example',
    agent: 'Tern',
    owner: 'wrenfield',
    state: 'retrying',
    stateLabel: 'Retrying',
    tone: 'wait',
    dot: 'dot--wait',
    detail: 'No answer within 10 s · next try 22:58',
    rate: '93 of 96',
    rateTone: 't-wait',
    action: { kind: 'pause' },
  },
  {
    host: 'agents.gannet.example',
    agent: 'Gannet',
    owner: 'fenwick',
    state: 'paused',
    stateLabel: 'Paused',
    tone: 'plain',
    dot: 'dot--off',
    detail: 'Agent suspended by admins',
    rate: '—',
    rateTone: 't-3',
    action: null,
  },
  {
    host: 'kestrel.example',
    agent: 'Kestrel',
    owner: 'tessellate',
    state: 'ended',
    stateLabel: 'Ended',
    tone: 'plain',
    dot: 'dot--off',
    detail: 'Receiver answered 410 Gone',
    rate: '—',
    rateTone: 't-3',
    action: null,
  },
  {
    host: 'hooks.orrery.dev',
    agent: 'Orrery',
    owner: 'tessellate',
    state: 'healthy',
    stateLabel: 'Healthy',
    tone: 'plain',
    dot: '',
    detail: '5 retried, then delivered',
    rate: '1,228 of 1,233',
    rateTone: 't-2',
    action: null,
  },
];

export const REFUSALS: Refusal[] = [
  {
    id: 'refused-vesper',
    host: 'relay-in.vesper.example',
    before: 'Now resolves to ',
    address: '10.0.4.12',
    after: ', a private address. At signup it was 198.51.100.7. Refused and paused; the owner was told.',
    when: '21:03 · Vesper · @nightjar',
  },
  {
    host: 'hooks.lumen.example',
    before: 'Answered 302 to ',
    address: '169.254.169.254',
    after: '. Redirects are never followed, so it counted as a failed attempt.',
    when: '18:40 · Pipit · @marlow',
  },
];

export const GAP_NOTICE = {
  before: '9 subscriptions were sent ',
  event: 'subscription.gap',
  after: ' for 03:12–03:14 UTC after an event-intake restart. All acknowledged.',
};

export const FAILED: FailedDelivery[] = [
  { id: 'del_2K9pRe', eventType: 'message.updated', host: 'hooks.kestrel.example', answer: '400 Bad Request', when: '17 Oct, 19:03', selected: true },
  { id: 'del_2K9pQ1', eventType: 'message.created', host: 'hooks.kestrel.example', answer: '400 Bad Request', when: '17 Oct, 19:01', selected: true },
  {
    id: 'del_2K7aB4',
    eventType: 'message.created',
    host: 'relay-in.vesper.example',
    answer: 'Refused: private address',
    when: '18 Oct, 21:03',
    selected: false,
  },
  { id: 'del_2K6xT0', eventType: 'message.deleted', host: 'hooks.lumen.example', answer: '302, not followed', when: '18 Oct, 18:40', selected: false },
  { id: 'del_2K3cLa', eventType: 'message.deleted', host: 'tern.wrenfield.example', answer: 'No answer, 24 times', when: '16 Oct, 08:12', selected: false },
];

export const RETRYING: FailedDelivery[] = [
  { id: 'del_2Kf8Qd', eventType: 'message.created', host: 'hooks.kestrel.example', answer: '503 Service Unavailable', when: '18 Oct, 22:31', selected: false },
  { id: 'del_2Kf8Qe', eventType: 'message.created', host: 'hooks.kestrel.example', answer: '503 Service Unavailable', when: '18 Oct, 22:36', selected: false },
];
