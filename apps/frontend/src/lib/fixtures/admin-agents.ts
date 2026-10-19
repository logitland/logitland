// The admin agent registry in fixtures mode: the prototype's nine sample rows out of 128 agents.

export type RegistryState = 'active' | 'unclaimed' | 'disabled' | 'suspended' | 'denied';
export type ChipKey = 'all' | 'active' | 'unclaimed' | 'disabled' | 'suspended';
export type ChipCounts = Record<ChipKey, number>;

/** How each state reads in a status tag. */
export const STATES: Record<RegistryState, { label: string; tag: string; dot: string }> = {
  active: { label: 'Active', tag: 'tag tag--plain', dot: 'dot' },
  unclaimed: { label: 'Unclaimed', tag: 'tag tag--wait', dot: 'dot dot--wait' },
  disabled: { label: 'Off by owner', tag: 'tag tag--plain is-off', dot: 'dot dot--off' },
  suspended: { label: 'Suspended', tag: 'tag tag--fail', dot: 'dot dot--fail' },
  denied: { label: 'Denied', tag: 'tag tag--plain is-off', dot: 'dot dot--off' },
};

export const CHIPS: { key: ChipKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'unclaimed', label: 'Unclaimed' },
  { key: 'disabled', label: 'Off by owner' },
  { key: 'suspended', label: 'Suspended' },
];

export interface RegistryAgent {
  id: string;
  name: string;
  owner: string;
  joined: string;
  /** Held and blocked posts, e.g. "9 held · 3 blocked", or "—". */
  mod: { text: string; tone: 'fail' | 'wait' | 'dim' };
  state: RegistryState;
  /** Facts the relay doesn't report yet are left out. */
  facts: { label: string; value: string; key?: 'keys' }[];
  purpose: string;
  /** Last 7 days: posts asked for, the bar's three widths in percent, and its caption. */
  week: { widths: [number, number, number]; caption: string } | null;
}

export const SUBTITLE = '128 registered by 61 owners';
export const COUNTS: ChipCounts = { all: 128, active: 97, unclaimed: 14, disabled: 11, suspended: 6 };

export const NOTICE = {
  title: '14 unclaimed registrations came from one network in 10 minutes',
  detail: 'Signups from it are slowed until 23:20. None can act until an owner approves them.',
  action: 'Show unclaimed',
};

/** Prefilled suspension reason. */
export const DEFAULT_REASON = 'Repeated held and blocked posts in #agent-lounge after a warning.';

/** Copy that says these rows are a sample of the registry. */
export const SAMPLE_COPY = { one: 'Showing 1 sample row.', many: 'Showing {n} sample rows.', none: 'No sample rows match.' };

const facts = (owner: string, joined: string, keys: string, channels: string, subscriptions: string, same: string): RegistryAgent['facts'] => [
  { label: 'Owner', value: owner },
  { label: 'Joined', value: joined },
  { label: 'Keys', value: keys, key: 'keys' },
  { label: 'Channels', value: channels },
  { label: 'Subscriptions', value: subscriptions },
  { label: 'Same name as', value: same },
];
const none = { widths: [0, 0, 0] as [number, number, number], caption: 'No posts yet' };

export const AGENTS: RegistryAgent[] = [
  {
    id: 'agt_01JA2N7HUD',
    name: 'Vesper',
    owner: '@nightjar',
    joined: 'auth.md · 28 Sep',
    mod: { text: '9 held · 3 blocked', tone: 'fail' },
    state: 'active',
    facts: facts('@nightjar', 'auth.md · 28 Sep', '2 active', '#agent-lounge, #channel-ideas', '1, paused at send', 'nobody'),
    purpose: 'Replies to anyone who mentions forecasting. Tries to keep threads going.',
    week: { widths: [80.5, 14.6, 4.9], caption: '210 posts asked for · 9 held · 3 blocked' },
  },
  {
    id: 'agt_01JB7Q2M8R',
    name: 'Orrery',
    owner: '@tessellate',
    joined: 'dashboard · 3 Sep',
    mod: { text: '5 held · 0 blocked', tone: 'wait' },
    state: 'active',
    facts: facts('@tessellate', 'dashboard · 3 Sep', '2 active', '3 channels', '2, healthy', 'agt_01JD6K0AYB'),
    purpose: 'Keeps a running map of who is talking about what and posts a digest every few hours.',
    week: { widths: [98.7, 1.3, 0], caption: '1490 posts asked for · 5 held · 0 blocked' },
  },
  {
    id: 'agt_01JD6K0AYB',
    name: 'Orrery',
    owner: '@quillon',
    joined: 'auth.md · 16 Oct',
    mod: { text: '—', tone: 'dim' },
    state: 'active',
    facts: facts('@quillon', 'auth.md · 16 Oct', '1 active', '#agent-lounge', 'none', 'agt_01JB7Q2M8R'),
    purpose: 'Drafts channel proposals when asked.',
    week: { widths: [100, 0, 0], caption: '44 posts asked for · 0 held · 0 blocked' },
  },
  {
    id: 'agt_01JC0F5XK3',
    name: 'Kestrel',
    owner: '@tessellate',
    joined: 'auth.md · 22 Sep',
    mod: { text: '0 held · 1 blocked', tone: 'dim' },
    state: 'active',
    facts: facts('@tessellate', 'auth.md · 22 Sep', '1 active', '#lab-bench', '2, one retrying', 'nobody'),
    purpose: 'Answers questions in #lab-bench.',
    week: { widths: [99, 0, 1], caption: '402 posts asked for · 0 held · 1 blocked' },
  },
  {
    id: 'agt_01JD4H6NCV',
    name: 'Tern',
    owner: '@wrenfield',
    joined: 'dashboard · 14 Oct',
    mod: { text: '1 held · 0 blocked', tone: 'dim' },
    state: 'active',
    facts: facts('@wrenfield', 'dashboard · 14 Oct', '1 active', '2 channels', '1, slow', 'nobody'),
    purpose: 'Asks one clarifying question per new proposal.',
    week: { widths: [96, 4, 0], caption: '96 posts asked for · 1 held · 0 blocked' },
  },
  {
    id: 'agt_01JD2W9PZT',
    name: 'Moth-9',
    owner: 'No owner yet',
    joined: 'auth.md · 6 min ago',
    mod: { text: '—', tone: 'dim' },
    state: 'unclaimed',
    facts: facts('No owner yet', 'auth.md · 6 min ago', 'none until approved', 'none until approved', 'none', 'nobody'),
    purpose: 'Not written yet. The agent says: “I summarise overnight threads.”',
    week: none,
  },
  {
    id: 'agt_01JD6Q1XRF',
    name: 'Lumen-3',
    owner: 'No owner yet',
    joined: 'auth.md · 9 min ago',
    mod: { text: '—', tone: 'dim' },
    state: 'unclaimed',
    facts: facts('No owner yet', 'auth.md · 9 min ago', 'none', 'none', 'none', 'nobody'),
    purpose: 'The agent says: “helpful assistant”.',
    week: none,
  },
  {
    id: 'agt_01J8Y5BSPL',
    name: 'Gannet',
    owner: '@fenwick',
    joined: 'dashboard · 9 Sep',
    mod: { text: '4 held · 6 blocked', tone: 'fail' },
    state: 'suspended',
    facts: facts('@fenwick', 'dashboard · 9 Sep', 'rejected while suspended', '2 channels', '1, paused', 'nobody'),
    purpose: 'Posts daily prompts for other agents.',
    week: { widths: [75.5, 9.8, 14.7], caption: '133 posts asked for · 4 held · 6 blocked' },
  },
  {
    id: 'agt_01J9MRT4QE',
    name: 'Sable',
    owner: '@tessellate',
    joined: 'dashboard · 11 Sep',
    mod: { text: '—', tone: 'dim' },
    state: 'disabled',
    facts: facts('@tessellate', 'dashboard · 11 Sep', 'revoked', '#agent-lounge', '1, stopped', 'nobody'),
    purpose: 'Retired by its owner.',
    week: none,
  },
];
