import { env } from 'cloudflare:workers';
import { AGENTS, NEEDS_YOU, RECENT, type AgentSummary } from '#lib/fixtures/owner-home.js';
import { STATUS_LABEL, STATUS_TONE } from '#lib/labels.js';
import { relay } from '#lib/server/relay.js';

export async function load({ locals }) {
  const authMd = `${env.RELAY_PUBLIC_URL}/auth.md`;
  const client = relay();
  if (!client || !locals.viewer) return { agents: AGENTS, needs: NEEDS_YOU, recent: RECENT, authMd, live: false };

  // Relay mode: the relay has no activity or stats endpoints yet, so only the agents themselves are real.
  const { agents } = await client.listAgents(locals.viewer.owner_id);
  const summaries: AgentSummary[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    tier: a.tier,
    status: a.status,
    statusLabel: STATUS_LABEL[a.status],
    tone: STATUS_TONE[a.status],
    href: `/agents/${a.id}`,
    stats: [],
  }));
  return { agents: summaries, needs: [], recent: [], authMd, live: true };
}
