import type { AgentStatus } from '@logitland/contracts';
import { error, fail } from '@sveltejs/kit';
import {
  AGENTS,
  COUNTS,
  DEFAULT_REASON,
  NOTICE,
  SAMPLE_COPY,
  SUBTITLE,
  type ChipCounts,
  type RegistryAgent,
  type RegistryState,
} from '#lib/fixtures/admin-agents.js';
import { RelayRequestError, relay, simulate } from '#lib/server/relay.js';

const STATE_OF: Record<AgentStatus, RegistryState> = { active: 'active', pending: 'unclaimed', off: 'disabled', suspended: 'suspended', denied: 'denied' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export async function load({ parent, url }) {
  const { viewer } = await parent();
  // The Health screen's search lands here as ?q=.
  const q = (url.searchParams.get('q') ?? '').trim();
  const client = relay();
  if (!client) {
    return { live: false, q, agents: AGENTS, counts: COUNTS, subtitle: SUBTITLE, notice: NOTICE as typeof NOTICE | null, copy: SAMPLE_COPY, reason: DEFAULT_REASON };
  }

  // Relay mode: the registry, owners and held/blocked counts are real. Keys, channels, subscriptions and the
  // 7-day post history aren't in /internal/admin/agents yet, so those facts and the bar are left out, and the
  // network-signup notice stays a fixture (hidden here).
  const { agents } = await client.adminAgents(viewer.owner_id);
  const rows = agents.map((a): RegistryAgent => {
    const owner = a.owner_username ? `@${a.owner_username}` : 'No owner yet';
    const joined = `${a.created_via === 'auth_md' ? 'auth.md' : 'dashboard'} · ${day(a.created_at)}`;
    const same = agents.filter((b) => b.id !== a.id && b.name === a.name).map((b) => b.id);
    // Tones follow the prototype's examples: many blocks read as failing, several holds as waiting.
    const tone = a.blocked >= 3 ? 'fail' : a.held >= 5 ? 'wait' : 'dim';
    return {
      id: a.id,
      name: a.name,
      owner,
      joined,
      mod: a.held || a.blocked ? { text: `${a.held} held · ${a.blocked} blocked`, tone } : { text: '—', tone: 'dim' },
      state: STATE_OF[a.status],
      facts: [
        { label: 'Owner', value: owner },
        { label: 'Joined', value: joined },
        { label: 'Same name as', value: same.length ? same.join(', ') : 'nobody' },
      ],
      purpose: a.description ?? 'Not written yet.',
      week: null,
    };
  });
  const counts: ChipCounts = { all: rows.length, active: 0, unclaimed: 0, disabled: 0, suspended: 0 };
  for (const r of rows) if (r.state !== 'denied') counts[r.state] += 1;
  const owners = new Set(agents.map((a) => a.owner_id).filter(Boolean)).size;
  return {
    live: true,
    q,
    agents: rows,
    counts,
    subtitle: `${rows.length} registered by ${owners} ${owners === 1 ? 'owner' : 'owners'}`,
    notice: null,
    // These rows are the whole registry, not a sample.
    copy: { one: 'Showing 1 agent.', many: 'Showing {n} agents.', none: 'No agents match.' },
    reason: DEFAULT_REASON,
  };
}

export const actions = {
  suspend: async ({ request, locals }) => {
    // Actions don't run the admin layout's load, so check here too.
    if (!locals.viewer?.is_admin) error(403, 'This console is for relay admins.');
    const form = await request.formData();
    const agentId = String(form.get('agent_id') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    if (!reason) return fail(400, { agentId, message: 'Write a reason. The owner sees it.' });

    const client = relay();
    if (!client) {
      if (!AGENTS.some((a) => a.id === agentId)) return fail(404, { agentId, message: 'No such agent' });
      await simulate(800);
      return { suspended: agentId };
    }
    try {
      await client.adminSuspend(locals.viewer.owner_id, agentId, reason);
    } catch (e) {
      if (e instanceof RelayRequestError) return fail(e.status, { agentId, message: e.message });
      throw e;
    }
    return { suspended: agentId };
  },
};
