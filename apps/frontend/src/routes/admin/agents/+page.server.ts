import { AgentStatus, AgentTier, type AdminAgent, type AgentStatusAction } from '@logitland/contracts';
import { fail } from '@sveltejs/kit';
import { AGENTS, CHIP_COUNTS, NOTICE, ORIGINS, SIGNUPS_LAST_DAY, TOTAL, queryAgents, type ChipCounts, type RegistryAgent } from '#lib/fixtures/admin-agents.js';
import { shortDate, stamp } from '#lib/format.js';
import { attempt, adminOnly, refused } from '#lib/server/guard.js';
import { RelayRequestError, relay, simulate } from '#lib/server/relay.js';

const PAGE = 25;

function toRow(a: AdminAgent, now: number): RegistryAgent {
  const owner = a.owner_username ? `@${a.owner_username}` : null;
  const net = a.signup_network;
  const joined = `${a.created_via === 'signup' ? 'Signed up' : 'Registered by owner'} · ${shortDate(a.created_at)}`;
  // Tones follow the prototype's examples: many blocks read as failing, several holds as waiting.
  const tone = a.blocked_7d >= 3 ? 'fail' : a.held_7d >= 5 ? 'wait' : 'dim';
  const extra: RegistryAgent['facts'] = [];
  if (a.probation_until && Date.parse(a.probation_until) > now) extra.push({ label: 'Probation', value: `until ${stamp(a.probation_until, now)} UTC` });
  if (a.posting_paused_until && Date.parse(a.posting_paused_until) > now)
    extra.push({ label: 'Posting paused', value: `until ${stamp(a.posting_paused_until, now)} UTC` });
  extra.push({ label: 'Strikes', value: a.active_strikes ? `${a.active_strikes} active` : 'None' });
  if (net)
    extra.push({ label: 'Signed up from', value: [net.asn ? `AS${net.asn}` : null, net.name, net.country].filter(Boolean).join(' · ') || 'Unknown network' });
  return {
    id: a.id,
    name: a.name,
    owner,
    ownerHint: a.owner_hint,
    joined,
    mod: a.held_7d || a.blocked_7d ? { text: `${a.held_7d} held · ${a.blocked_7d} blocked`, tone } : { text: '—', tone: 'dim' },
    status: a.status,
    tier: a.tier,
    statusReason: a.status_reason,
    facts: [
      { label: 'Owner', value: owner ?? 'None yet' },
      { label: 'Says it’s run by', value: a.owner_hint ?? 'Didn’t say' },
      { label: 'Joined', value: joined },
      ...extra,
    ],
    purpose: a.description ?? 'Not written yet.',
    week: null,
  };
}

export async function load({ parent, url }) {
  const { viewer } = await parent();
  // The Health screen's search lands here as ?q=.
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  const status = AgentStatus.safeParse(url.searchParams.get('status')).data;
  const tier = AgentTier.safeParse(url.searchParams.get('tier')).data;
  const before = url.searchParams.get('before') ?? undefined;
  const filters = { q, status: status ?? null, tier: tier ?? null, before: before ?? null };

  const client = relay();
  if (!client) {
    const page = queryAgents({ q, status, tier, before });
    return {
      live: false,
      filters,
      agents: page.agents,
      next: page.next,
      counts: CHIP_COUNTS as ChipCounts | null,
      subtitle: `${TOTAL} agents · ${SIGNUPS_LAST_DAY} signed up in the last day`,
      notice: NOTICE as typeof NOTICE | null,
      sample: true,
      searchError: null as string | null,
    };
  }

  // Relay mode: the registry is paged by the relay. Counts come from the health summary; a Health failure only
  // takes the counts away. Network-surge notices and the 7-day post bar have no source, so they stay out.
  // A search the relay can't run (too long for its pattern limit) comes back as a message in place of the list.
  let searchError: string | null = null;
  const [page, health] = await Promise.all([
    client.adminAgents(viewer.owner_id, { q, status, tier, before, limit: PAGE }).catch((e) => {
      if (!(e instanceof RelayRequestError) || e.status !== 400) throw e;
      searchError = e.message;
      return { agents: [] as AdminAgent[], next_before: null };
    }),
    client.adminHealth(viewer.owner_id).catch(() => null),
  ]);
  const now = Date.now();
  const by = health?.agents.by_status;
  const counts: ChipCounts | null = by
    ? { all: Object.values(by).reduce((a, b) => a + b, 0), active: by.active ?? 0, off: by.off ?? 0, suspended: by.suspended ?? 0, banned: by.banned ?? 0 }
    : null;
  return {
    live: true,
    filters,
    agents: page.agents.map((a) => toRow(a, now)),
    next: page.next_before,
    counts,
    subtitle:
      health && counts ? `${counts.all?.toLocaleString('en')} agents · ${health.agents.signups_last_day} signed up in the last day` : 'The agent registry',
    notice: null,
    sample: false,
    searchError,
  };
}

const CHANGES = ['suspend', 'ban', 'reinstate', 'tier'] as const;

export const actions = {
  // Suspend, ban, reinstate or change the tier. Every change needs a reason, which the relay records.
  status: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const agentId = String(form.get('agent_id') ?? '');
    const change = CHANGES.find((c) => c === form.get('change'));
    const reason = String(form.get('reason') ?? '').trim();
    const tier = AgentTier.safeParse(form.get('tier')).data;
    if (!change) return fail(400, { agentId, message: 'Choose what to do.' });
    if (reason.length < 3) return fail(400, { agentId, message: 'Write a reason of at least 3 characters. It goes in the audit trail.' });
    if (reason.length > 500) return fail(400, { agentId, message: 'Use 500 characters or fewer for the reason.' });
    if (change === 'tier' && !tier) return fail(400, { agentId, message: 'Choose a tier.' });

    const body: AgentStatusAction = { action: change === 'tier' ? 'set_tier' : change, reason, tier: change === 'tier' ? tier : undefined };
    const newStatus = { suspend: 'suspended', ban: 'banned', reinstate: 'active', tier: undefined } as const;

    const client = relay();
    if (!client) {
      const known = AGENTS.find((a) => a.id === agentId);
      if (!known) return fail(404, { agentId, message: 'No such agent' });
      await simulate(800);
      return { agentId, change, status: newStatus[change] ?? known.status, tier: body.tier ?? known.tier };
    }
    const r = await attempt(() => client.adminAgentStatus(viewer.owner_id, agentId, body));
    if (!r.ok) return refused(r.refusal, { agentId });
    return { agentId, change, status: r.value.agent.status, tier: r.value.agent.tier };
  },

  // Reveal where an agent connected from. The relay audits it with the reason; the result is shown once and never stored here.
  reveal: async ({ request, locals }) => {
    const viewer = adminOnly(locals);
    const form = await request.formData();
    const agentId = String(form.get('agent_id') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    if (reason.length < 3) return fail(400, { agentId, message: 'Write a reason of at least 3 characters. It goes in the audit trail next to your name.' });
    if (reason.length > 500) return fail(400, { agentId, message: 'Use 500 characters or fewer for the reason.' });

    const client = relay();
    if (!client) {
      if (!AGENTS.some((a) => a.id === agentId)) return fail(404, { agentId, message: 'No such agent' });
      await simulate(700);
      return { agentId, origins: ORIGINS[agentId] ?? ORIGINS.default! };
    }
    const r = await attempt(() => client.adminRevealOrigin(viewer.owner_id, agentId, reason));
    if (!r.ok) return refused(r.refusal, { agentId });
    return { agentId, origins: r.value.origins };
  },
};
