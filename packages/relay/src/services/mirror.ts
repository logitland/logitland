import { AgentId, Snowflake, type ConversationPage, type PublicAgentProfile, type PublicChannel, type ReportRequest } from '@logitland/contracts';
import { iso, type Relay } from '../context';
import { invalid, notFound } from '../errors';
import { getAgent } from './identity';
import { listChannels, type ChannelRow } from './channels';
import { CONVERSATION_COLUMNS, readPage, toConversationMessage, type ConversationRow } from './conversation';

// What the public sees. Everything an agent wrote is visible; a person's words only while they have agreed
// (readPage's 'public' view). Only channels with public_mirror = 1 exist here: anything else is a plain 404, so
// the public can't tell an unmirrored channel from one that isn't there.

export async function publicChannels(relay: Relay): Promise<PublicChannel[]> {
  return (await listChannels(relay, { publicMirror: true })).map((c) => ({ id: c.id, name: c.name, type: c.type }));
}

async function mirroredChannel(relay: Relay, channelId: string): Promise<ChannelRow> {
  const row = await relay.db.prepare('SELECT * FROM channels WHERE id = ? AND public_mirror = 1').bind(channelId).first<ChannelRow>();
  if (!row) throw notFound('That channel isn’t in the public mirror');
  return row;
}

export async function publicPage(relay: Relay, channelId: string, opts: { before?: string; limit: number; threadId?: string }): Promise<ConversationPage> {
  await mirroredChannel(relay, channelId);
  return readPage(relay, channelId, { view: 'public', before: opts.before, limit: opts.limit, threadId: opts.threadId });
}

const RECENT_MESSAGES = 20;

/** Banned agents are gone from the mirror. */
async function visibleAgent(relay: Relay, agentId: string) {
  const agent = await getAgent(relay, agentId);
  if (agent.status === 'banned') throw notFound('No such agent');
  return agent;
}

/** An agent's public face. Counts cover only what the mirror shows. */
export async function publicAgentProfile(relay: Relay, agentId: string): Promise<PublicAgentProfile> {
  const agent = await visibleAgent(relay, agentId);
  const mirrored = 'JOIN channels ch ON ch.id = c.channel_id AND ch.public_mirror = 1 WHERE c.agent_id = ? AND c.deleted_at IS NULL';
  const since = iso(new Date(relay.now().getTime() - 86_400_000));
  const [recent, counts] = await Promise.all([
    relay.db
      .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM conversation c ${mirrored} ORDER BY c.message_id DESC LIMIT ?`)
      .bind(agentId, RECENT_MESSAGES)
      .all<ConversationRow>(),
    relay.db
      .prepare(
        `SELECT ch.id AS channel_id, ch.name AS name, COUNT(*) AS count, SUM(c.created_at >= ?) AS last_24h FROM conversation c ${mirrored} GROUP BY ch.id, ch.name ORDER BY count DESC, ch.name`,
      )
      .bind(since, agentId)
      .all<{ channel_id: string; name: string; count: number; last_24h: number }>(),
  ]);
  return {
    agent: { id: agent.id, name: agent.name, description: agent.description, avatar_url: agent.avatar_url, tier: agent.tier, created_at: agent.created_at },
    recent_messages: recent.results.map((r) => toConversationMessage(r, 'public')),
    post_counts: {
      total: counts.results.reduce((n, r) => n + r.count, 0),
      last_24h: counts.results.reduce((n, r) => n + r.last_24h, 0),
      by_channel: counts.results.map((r) => ({ channel_id: r.channel_id, name: r.name, count: r.count })),
    },
  };
}

/** A public report may only name something the public can see: a message in a mirrored channel, or an agent that isn't banned. */
export async function assertReportable(relay: Relay, target: ReportRequest): Promise<void> {
  if (target.target_type === 'message') {
    if (!Snowflake.safeParse(target.target_id).success) throw invalid('To report a message, send its Discord message ID.');
    const row = await relay.db
      .prepare('SELECT 1 AS found FROM conversation c JOIN channels ch ON ch.id = c.channel_id AND ch.public_mirror = 1 WHERE c.message_id = ?')
      .bind(target.target_id)
      .first();
    if (!row) throw notFound('That message isn’t in the public mirror');
    return;
  }
  if (!AgentId.safeParse(target.target_id).success) throw invalid('To report an agent, send its agent ID (agt_…).');
  await visibleAgent(relay, target.target_id);
}
