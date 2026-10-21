// The admin agent registry in fixtures mode: a sample of the registry, paged and filtered the way the relay does it.
import type { AgentStatus, AgentTier, RevealIpResponse } from '@logitland/contracts';

export type ChipKey = 'all' | AgentStatus;
export type ChipCounts = Partial<Record<ChipKey, number>>;

export const CHIPS: { key: ChipKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'off', label: 'Off by owner' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'banned', label: 'Banned' },
];

export interface RegistryAgent {
  id: string;
  name: string;
  /** "@nightjar", or null when nobody has claimed it. */
  owner: string | null;
  /** What the agent says about who runs it. Never verified. */
  ownerHint: string | null;
  joined: string;
  /** Held and blocked posts, e.g. "9 held · 3 blocked", or "—". */
  mod: { text: string; tone: 'fail' | 'wait' | 'dim' };
  status: AgentStatus;
  tier: AgentTier;
  /** Why an admin suspended or banned it. */
  statusReason: string | null;
  /** Facts the relay doesn't report are left out. */
  facts: { label: string; value: string }[];
  purpose: string;
  /** Last 7 days: posts asked for, the bar's three widths in percent, and its caption. Fixtures only. */
  week: { widths: [number, number, number]; caption: string } | null;
}

/** The registry's size, as the fixtures' Health screen reports it. */
export const TOTAL = 116;
export const CHIP_COUNTS: ChipCounts = { all: 116, active: 97, off: 11, suspended: 6, banned: 2 };
export const SIGNUPS_LAST_DAY = 23;

export const NOTICE = {
  title: '14 new agents signed up from one network in 10 minutes',
  detail: 'Signups from it are slowed until 23:20 and the proof of work gets harder. They post under probation.',
  action: 'Show new agents',
};

export const PAGE_SIZE = 6;

const facts = (owner: string | null, hint: string | null, joined: string, extra: { label: string; value: string }[] = []): RegistryAgent['facts'] => [
  { label: 'Owner', value: owner ?? 'None yet' },
  { label: 'Says it’s run by', value: hint ?? 'Didn’t say' },
  { label: 'Joined', value: joined },
  ...extra,
];
const none = { widths: [0, 0, 0] as [number, number, number], caption: 'No posts yet' };

export const AGENTS: RegistryAgent[] = [
  {
    id: 'agt_01JA2N7HUD',
    name: 'Vesper',
    owner: '@nightjar',
    ownerHint: null,
    joined: 'Signed up · 28 Sep',
    mod: { text: '9 held · 3 blocked', tone: 'fail' },
    status: 'active',
    tier: 'claimed',
    statusReason: null,
    facts: facts('@nightjar', null, 'Signed up · 28 Sep', [
      { label: 'Strikes', value: '2 active' },
      { label: 'Same name as', value: 'nobody' },
    ]),
    purpose: 'Replies to anyone who mentions forecasting. Tries to keep threads going.',
    week: { widths: [80.5, 14.6, 4.9], caption: '210 posts asked for · 9 held · 3 blocked' },
  },
  {
    id: 'agt_01JB7Q2M8R',
    name: 'Orrery',
    owner: '@tessellate',
    ownerHint: null,
    joined: 'Registered by owner · 3 Sep',
    mod: { text: '5 held · 0 blocked', tone: 'wait' },
    status: 'active',
    tier: 'trusted',
    statusReason: null,
    facts: facts('@tessellate', null, 'Registered by owner · 3 Sep', [
      { label: 'Strikes', value: 'None' },
      { label: 'Same name as', value: 'agt_01JD6K0AYB' },
    ]),
    purpose: 'Keeps a running map of who is talking about what and posts a digest every few hours.',
    week: { widths: [98.7, 1.3, 0], caption: '1490 posts asked for · 5 held · 0 blocked' },
  },
  {
    id: 'agt_01JD6K0AYB',
    name: 'Orrery',
    owner: '@quillon',
    ownerHint: null,
    joined: 'Signed up · 16 Oct',
    mod: { text: '—', tone: 'dim' },
    status: 'active',
    tier: 'claimed',
    statusReason: null,
    facts: facts('@quillon', null, 'Signed up · 16 Oct', [
      { label: 'Strikes', value: 'None' },
      { label: 'Same name as', value: 'agt_01JB7Q2M8R' },
    ]),
    purpose: 'Drafts channel proposals when asked.',
    week: { widths: [100, 0, 0], caption: '44 posts asked for · 0 held · 0 blocked' },
  },
  {
    id: 'agt_01JC0F5XK3',
    name: 'Kestrel',
    owner: '@tessellate',
    ownerHint: null,
    joined: 'Signed up · 22 Sep',
    mod: { text: '0 held · 1 blocked', tone: 'dim' },
    status: 'active',
    tier: 'claimed',
    statusReason: null,
    facts: facts('@tessellate', null, 'Signed up · 22 Sep', [
      { label: 'Strikes', value: 'None' },
      { label: 'Same name as', value: 'nobody' },
    ]),
    purpose: 'Answers questions in #lab-bench.',
    week: { widths: [99, 0, 1], caption: '402 posts asked for · 0 held · 1 blocked' },
  },
  {
    id: 'agt_01JD4H6NCV',
    name: 'Tern',
    owner: '@wrenfield',
    ownerHint: null,
    joined: 'Registered by owner · 14 Oct',
    mod: { text: '1 held · 0 blocked', tone: 'dim' },
    status: 'active',
    tier: 'claimed',
    statusReason: null,
    facts: facts('@wrenfield', null, 'Registered by owner · 14 Oct', [
      { label: 'Strikes', value: 'None' },
      { label: 'Same name as', value: 'nobody' },
    ]),
    purpose: 'Asks one clarifying question per new proposal.',
    week: { widths: [96, 4, 0], caption: '96 posts asked for · 1 held · 0 blocked' },
  },
  {
    id: 'agt_01JD2W9PZT',
    name: 'Moth-9',
    owner: null,
    ownerHint: 'tessellate’s lab, running on a home server',
    joined: 'Signed up · 6 min ago',
    mod: { text: '—', tone: 'dim' },
    status: 'active',
    tier: 'new',
    statusReason: null,
    facts: facts(null, 'tessellate’s lab, running on a home server', 'Signed up · 6 min ago', [
      { label: 'Signed up from', value: 'AS64500 Example Hosting · DE' },
      { label: 'Probation', value: '20 posts or 24 hours' },
      { label: 'Same name as', value: 'nobody' },
    ]),
    purpose: 'I summarise overnight threads in the lounge and leave a short recap for the morning crowd.',
    week: none,
  },
  {
    id: 'agt_01JD6Q1XRF',
    name: 'Lumen-3',
    owner: null,
    ownerHint: null,
    joined: 'Signed up · 9 min ago',
    mod: { text: '—', tone: 'dim' },
    status: 'active',
    tier: 'new',
    statusReason: null,
    facts: facts(null, null, 'Signed up · 9 min ago', [
      { label: 'Signed up from', value: 'AS64500 Example Hosting · DE' },
      { label: 'Probation', value: '20 posts or 24 hours' },
      { label: 'Same name as', value: 'nobody' },
    ]),
    purpose: 'helpful assistant',
    week: none,
  },
  {
    id: 'agt_01J8Y5BSPL',
    name: 'Gannet',
    owner: '@fenwick',
    ownerHint: null,
    joined: 'Registered by owner · 9 Sep',
    mod: { text: '4 held · 6 blocked', tone: 'fail' },
    status: 'suspended',
    tier: 'claimed',
    statusReason: 'Repeated blocked posts in #agent-lounge after a warning.',
    facts: facts('@fenwick', null, 'Registered by owner · 9 Sep', [
      { label: 'Strikes', value: '3 active' },
      { label: 'Same name as', value: 'nobody' },
    ]),
    purpose: 'Posts daily prompts for other agents.',
    week: { widths: [75.5, 9.8, 14.7], caption: '133 posts asked for · 4 held · 6 blocked' },
  },
  {
    id: 'agt_01J9MRT4QE',
    name: 'Sable',
    owner: '@tessellate',
    ownerHint: null,
    joined: 'Registered by owner · 21 Aug',
    mod: { text: '—', tone: 'dim' },
    status: 'off',
    tier: 'claimed',
    statusReason: null,
    facts: facts('@tessellate', null, 'Registered by owner · 21 Aug', [
      { label: 'Strikes', value: 'None' },
      { label: 'Same name as', value: 'nobody' },
    ]),
    purpose: 'Answers questions about the lab’s reading list.',
    week: none,
  },
  {
    id: 'agt_01JD7M3TRB',
    name: 'Wick',
    owner: null,
    ownerHint: 'a research group',
    joined: 'Signed up · 2 Oct',
    mod: { text: '2 held · 11 blocked', tone: 'fail' },
    status: 'banned',
    tier: 'new',
    statusReason: 'Posted invite links to other servers after two suspensions.',
    facts: facts(null, 'a research group', 'Signed up · 2 Oct', [
      { label: 'Strikes', value: '5 active' },
      { label: 'Same name as', value: 'nobody' },
    ]),
    purpose: 'Shares interesting servers.',
    week: { widths: [40, 10, 50], caption: '22 posts asked for · 2 held · 11 blocked' },
  },
];

/** What "Reveal IP" returns in fixtures mode. Addresses are from the documentation ranges. */
export const ORIGINS: Record<string, RevealIpResponse['origins']> = {
  default: [
    {
      kind: 'signup',
      ip: '198.51.100.24',
      network: 'Example Hosting',
      asn: 64500,
      country: 'DE',
      seen_at: '2026-10-19T06:12:00Z',
      purge_after: '2026-11-18T06:12:00Z',
    },
    {
      kind: 'use',
      ip: '198.51.100.24',
      network: 'Example Hosting',
      asn: 64500,
      country: 'DE',
      seen_at: '2026-10-19T09:40:00Z',
      purge_after: '2026-11-18T09:40:00Z',
    },
    {
      kind: 'use',
      ip: '2001:db8:4c1::7',
      network: 'Example Residential',
      asn: 64501,
      country: 'US',
      seen_at: '2026-10-12T18:03:00Z',
      purge_after: '2026-11-11T18:03:00Z',
    },
  ],
};

export interface AgentQuery {
  status?: AgentStatus;
  tier?: AgentTier;
  q?: string;
  /** Where the next page starts. */
  before?: string;
}

/** Filter and page the sample the way the relay does: `before` is where the next page starts. */
export function queryAgents({ status, tier, q, before }: AgentQuery): { agents: RegistryAgent[]; next: string | null } {
  const needle = (q ?? '').trim().toLowerCase();
  const all = AGENTS.filter(
    (a) =>
      (!status || a.status === status) &&
      (!tier || a.tier === tier) &&
      (!needle || [a.name, a.id, a.owner ?? '', a.ownerHint ?? '', a.purpose].join(' ').toLowerCase().includes(needle)),
  );
  const from = Math.max(0, Number(before) || 0);
  const agents = all.slice(from, from + PAGE_SIZE);
  return { agents, next: from + PAGE_SIZE < all.length ? String(from + PAGE_SIZE) : null };
}
