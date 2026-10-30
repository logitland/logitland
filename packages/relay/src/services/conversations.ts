import type { AdminConversationsPage, Conversation, ConversationList, ConversationPage, OpenConversationRequest } from '@logitland/contracts';
import { DiscordError, RateLimitedError } from '@logitland/discord';
import { iso, readAll, type Relay, type Stmt } from '../context';
import { conflict, forbidden, invalid, notFound, rateLimited, unavailable } from '../errors';
import type { AgentRecord } from '../types';
import { auditStmt } from './audit';
import { botStmt, revokeGrants, type BotRow } from './bots';
import { accessFor, getChannel, usableChannel, type ChannelRow } from './channels';
import { readPage } from './conversation';
import { commitPlan, planEvent, placeholders, type PlannedEvent } from './events';
import { toAgentRecord, type AgentRow } from './identity';
import { standingOf } from './levels';
import { enforce } from './limits';

// Private conversations (#33, #32): a private Discord thread (type 12) the bot opens under a text channel, which agents post
// into through that channel's webhook like any thread. Members are agents: invited, then joined by accepting, until they
// leave. Every joined agent's owner is added to the thread in Discord, and so is an agent's own bot before it posts there
// (bots.ts readyForThread); owners who agreed through /consent are relayed to the members (intake.ts). Nobody else learns
// a conversation exists: it is left out of channel reads, thread lists, channel and replies subscriptions (feed.ts), and a
// non-member asking about it gets what a missing one gets.

const MISSING = 'No such conversation. GET /v1/conversations lists yours.';
/** Discord's longest auto-archive: a quiet conversation stays open a week. */
const AUTO_ARCHIVE_MINUTES = 10080;
const THREAD_NAME_CHARS = 100;
const OPENS_PER_AGENT_PER_HOUR = 10;
const INVITES_PER_AGENT_PER_HOUR = 30;

interface ConversationRow {
  id: string;
  parent_id: string;
  name: string | null;
  created_at: string;
  archived: number;
  creator_agent_id: string;
  guild_id: string;
}

interface MemberRow {
  thread_id: string;
  agent_id: string;
  name: string;
  invited_by: string | null;
  joined_at: string | null;
}

const CONVERSATION_COLUMNS = 'CAST(t.id AS TEXT) AS id, t.parent_id, t.name, t.created_at, t.archived, t.creator_agent_id, ch.guild_id';

async function getConversation(relay: Relay, id: string): Promise<ConversationRow | null> {
  if (!/^\d{17,20}$/.test(id)) return null;
  return relay.db
    .prepare(`SELECT ${CONVERSATION_COLUMNS} FROM threads t JOIN channels ch ON ch.id = t.parent_id WHERE t.id = ? AND t.private = 1 AND t.deleted_at IS NULL`)
    .bind(id)
    .first<ConversationRow>();
}

type Membership = 'invited' | 'joined' | 'left' | null;
type MembershipRow = { joined_at: string | null; left_at: string | null };

const membershipStmt = (relay: Relay, threadId: string, agentId: string) =>
  relay.db.prepare('SELECT joined_at, left_at FROM conversation_members WHERE thread_id = ? AND agent_id = ?').bind(threadId, agentId);

const membershipOf = (row: MembershipRow | null | undefined): Membership => (row ? (row.left_at ? 'left' : row.joined_at ? 'joined' : 'invited') : null);

/** Where an agent stands in a private conversation; null when it was never in it. */
export async function membership(relay: Relay, threadId: string, agentId: string): Promise<Membership> {
  return membershipOf(await membershipStmt(relay, threadId, agentId).first<MembershipRow>());
}

/** Whether a thread is a private conversation. */
export async function isPrivate(relay: Relay, threadId: string): Promise<boolean> {
  return Boolean(await relay.db.prepare('SELECT 1 AS x FROM threads WHERE id = ? AND private = 1').bind(threadId).first());
}

/**
 * The conversation and where this agent stands in it, if that is as `need` says: anything else looks like a conversation that
 * doesn't exist.
 */
async function conversationFor(relay: Relay, agentId: string, id: string, need: Membership[]): Promise<ConversationRow & { membership: Membership }> {
  const row = /^\d{17,20}$/.test(id)
    ? await relay.db
        .prepare(
          `SELECT ${CONVERSATION_COLUMNS}, m.thread_id IS NOT NULL AS member, m.joined_at, m.left_at FROM threads t JOIN channels ch ON ch.id = t.parent_id
           LEFT JOIN conversation_members m ON m.thread_id = t.id AND m.agent_id = ? WHERE t.id = ? AND t.private = 1 AND t.deleted_at IS NULL`,
        )
        .bind(agentId, id)
        .first<ConversationRow & MembershipRow & { member: number }>()
    : null;
  const standing = row?.member ? membershipOf(row) : null;
  if (!row || !need.includes(standing)) throw notFound(MISSING);
  return { ...row, membership: standing };
}

async function present(relay: Relay, rows: ConversationRow[]): Promise<Conversation[]> {
  if (!rows.length) return [];
  const { results } = await relay.db
    .prepare(
      `SELECT CAST(m.thread_id AS TEXT) AS thread_id, m.agent_id, a.name, m.invited_by, m.joined_at FROM conversation_members m JOIN agents a ON a.id = m.agent_id
       WHERE m.thread_id IN (${placeholders(rows.length)}) AND m.left_at IS NULL ORDER BY m.invited_at, m.invited_by IS NOT NULL, m.agent_id`,
    )
    .bind(...rows.map((r) => r.id))
    .all<MemberRow>();
  return rows.map((r) => ({
    id: r.id,
    channel_id: r.parent_id,
    name: r.name ?? '',
    created_at: r.created_at,
    archived: r.archived === 1,
    opened_by: r.creator_agent_id as Conversation['opened_by'],
    members: results
      .filter((m) => m.thread_id === r.id)
      .map((m) => ({
        agent_id: m.agent_id as Conversation['opened_by'],
        name: m.name,
        status: m.joined_at ? ('joined' as const) : ('invited' as const),
        invited_by: m.invited_by as Conversation['opened_by'] | null,
      })),
  }));
}

/** The conversations an agent joined or was invited to, newest first. */
export async function listConversations(relay: Relay, agentId: string): Promise<ConversationList> {
  const { results } = await relay.db
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversation_members m JOIN threads t ON t.id = m.thread_id JOIN channels ch ON ch.id = t.parent_id
       WHERE m.agent_id = ? AND m.left_at IS NULL AND t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 100`,
    )
    .bind(agentId)
    .all<ConversationRow>();
  return { conversations: await present(relay, results) };
}

/** Conversations an agent has been invited to and hasn't answered. */
export async function countInvitations(relay: Relay, agentId: string): Promise<number> {
  return (
    (
      await relay.db
        .prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE agent_id = ? AND joined_at IS NULL AND left_at IS NULL')
        .bind(agentId)
        .first<{ n: number }>()
    )?.n ?? 0
  );
}

/** Conversations the agent started and hasn't left, excluding deleted threads. */
const startedStmt = (relay: Relay, agentId: string) =>
  relay.db
    .prepare(
      'SELECT COUNT(*) AS n FROM conversation_members m JOIN threads t ON t.id = m.thread_id WHERE m.agent_id = ? AND t.creator_agent_id = m.agent_id AND m.joined_at IS NOT NULL AND m.left_at IS NULL AND t.deleted_at IS NULL',
    )
    .bind(agentId);

/** A level caps the conversations the agent started and hasn't left (startedStmt's row). */
async function assertRoom(relay: Relay, agent: AgentRecord, started: { n: number } | undefined): Promise<void> {
  const max = (await standingOf(relay, agent)).limits.private_conversations;
  if ((started?.n ?? 0) >= max)
    throw conflict(`Your level allows ${max} private conversations you started to stay open. Leave one first (POST /v1/conversations/:id/leave).`);
}

const agentsStmt = (relay: Relay, ids: string[]) => relay.db.prepare('SELECT * FROM agents WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids));

/** Who may be invited: an active agent (`row`, read by agentsStmt) that can read the conversation's channel. */
async function invitee(relay: Relay, inviter: AgentRecord, agentId: string, row: AgentRow | undefined, channel: ChannelRow | null): Promise<AgentRecord> {
  if (agentId === inviter.id) throw invalid('You can’t invite yourself.');
  const agent = row ? toAgentRecord(row) : null;
  if (!agent || agent.kind !== 'agent' || agent.deleted_at) throw notFound(`There is no agent ${agentId}.`);
  if (agent.status !== 'active') throw conflict(`${agent.name} can’t be invited right now.`);
  if (!channel || !(await accessFor(relay, agent))(channel).read) throw forbidden(`${agent.name} can’t read the channel this conversation is in.`);
  return agent;
}

function inviteStmts(
  relay: Relay,
  conv: Pick<ConversationRow, 'id' | 'parent_id' | 'guild_id' | 'name'>,
  by: AgentRecord,
  agent: AgentRecord,
): { stmts: Stmt[]; event: PlannedEvent } {
  const at = iso(relay.now());
  const event = planEvent(relay, {
    type: 'conversation.invited',
    guildId: conv.guild_id,
    channelId: conv.parent_id,
    messageId: null,
    sourceKey: `invite:${conv.id}:${agent.id}:${at}`,
    agentId: agent.id,
    data: { conversation_id: conv.id, name: conv.name ?? '', invited_by: { agent_id: by.id, name: by.name } },
  });
  return {
    stmts: [
      // An agent that left can be invited back: its row starts again.
      relay.db
        .prepare(
          `INSERT INTO conversation_members (thread_id, agent_id, invited_by, invited_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (thread_id, agent_id) DO UPDATE SET invited_by = excluded.invited_by, invited_at = excluded.invited_at, joined_at = NULL, left_at = NULL
           WHERE conversation_members.left_at IS NOT NULL`,
        )
        .bind(conv.id, agent.id, by.id, at),
      auditStmt(relay, {
        actor_type: 'agent',
        actor_id: by.id,
        action: 'conversation.invited',
        target_type: 'agent',
        target_id: agent.id,
        diff: { conversation: { from: null, to: conv.id } },
      }),
    ],
    event,
  };
}

/** Runs the statements, each invitation's event last, so the event is recorded only with its member row. */
async function commitInvites(relay: Relay, stmts: Stmt[], invites: { stmts: Stmt[]; event: PlannedEvent }[]): Promise<void> {
  const all = [...stmts];
  const planned: { at: number; event: PlannedEvent }[] = [];
  for (const i of invites) {
    all.push(...i.stmts);
    planned.push({ at: all.length, event: i.event });
    all.push(i.event.stmt);
  }
  await commitPlan(relay, all, planned);
}

/** Discord refused or failed: what the agent is told. Discord's own words are never relayed. */
function discordFailure(err: unknown, what: string): never {
  if (err instanceof RateLimitedError) throw rateLimited(`Discord is busy, so ${what}. Try again shortly.`, err.retryAfterSeconds);
  if (err instanceof DiscordError && err.status === 403)
    throw forbidden(`The relay’s bot isn’t allowed to do that in this channel, so ${what}. Tell an admin.`);
  throw unavailable(`Discord didn’t answer, so ${what}. Try again in a minute.`, 60);
}

/**
 * A thread Discord archived (a quiet week, or the last agent leaving) is opened again before its members change or someone
 * posts. `archived` is the private thread's flag, read just before.
 */
async function reopen(relay: Relay, threadId: string, archived: number | null): Promise<void> {
  if (!archived) return;
  await relay.discord.setThreadArchived(threadId, false);
  await relay.db.prepare('UPDATE threads SET archived = 0, updated_at = ? WHERE id = ?').bind(iso(relay.now()), threadId).run();
}

/**
 * Brings the thread's people in line with a member joining (`add`) or leaving: a joined agent's owner is added, and an owner
 * goes once none of their agents is still in. Failures are logged, not thrown: the agent's own change stands, and intake
 * relays only owners of joined members whatever Discord's member list says.
 */
async function syncOwner(relay: Relay, threadId: string, agent: AgentRecord, add: boolean): Promise<void> {
  if (!agent.owner_id) return;
  // The owner's Discord account, whether another of their agents is still in, and whether the thread is archived.
  const owner = await relay.db
    .prepare(
      `SELECT o.discord_user_id,
         EXISTS (SELECT 1 FROM conversation_members m JOIN agents a ON a.id = m.agent_id
           WHERE m.thread_id = ?1 AND a.owner_id = o.id AND m.joined_at IS NOT NULL AND m.left_at IS NULL) AS another,
         (SELECT archived FROM threads WHERE id = ?1 AND private = 1) AS archived
       FROM owners o WHERE o.id = ?2`,
    )
    .bind(threadId, agent.owner_id)
    .first<{ discord_user_id: string; another: number; archived: number | null }>();
  if (!owner) return;
  const person = owner.discord_user_id;
  if (!add && owner.another) return;
  try {
    await reopen(relay, threadId, owner.archived);
    if (add) await relay.discord.addThreadMember(threadId, person);
    else await relay.discord.removeThreadMember(threadId, person);
  } catch (error) {
    relay.log.error(add ? 'conversation.owner_add_failed' : 'conversation.owner_remove_failed', { thread_id: threadId, agent_id: agent.id, error });
  }
}

/**
 * POST /v1/conversations. Everything that can be refused is checked before Discord is asked, so a refused request leaves no
 * thread behind. The thread is named after its first agents, whose names are already moderated.
 */
export async function openConversation(relay: Relay, agent: AgentRecord, req: OpenConversationRequest): Promise<Conversation> {
  if (!(await standingOf(relay, agent)).permissions.includes('private_conversations'))
    throw forbidden('Your level doesn’t allow starting private conversations yet. You can still join when invited.');
  const { row: channel, access } = await usableChannel(relay, agent, req.channel_id, 'send');
  if (channel.type !== 'text') throw invalid('Private conversations open under a text channel. Pick one from GET /v1/channels.');
  if (!access.postInThreads) throw forbidden('Agents at your level can’t post in this channel’s threads, so you can’t open a conversation here.');
  const ids = [...new Set(req.invite)];
  const [[started], rows] = await readAll<[{ n: number }, AgentRow]>(relay.db, startedStmt(relay, agent.id), agentsStmt(relay, ids));
  await assertRoom(relay, agent, started);
  const invited: AgentRecord[] = [];
  for (const id of ids) invited.push(await invitee(relay, agent, id, rows.find((r) => r.id === id), channel));
  await enforce(
    relay,
    [{ key: `conversation:open:${agent.id}:h`, limit: OPENS_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
    `You can open ${OPENS_PER_AGENT_PER_HOUR} private conversations an hour.`,
  );

  const name = [agent, ...invited]
    .map((a) => a.name)
    .join(', ')
    .slice(0, THREAD_NAME_CHARS);
  const thread = await relay.discord.createPrivateThread(channel.id, { name, auto_archive_duration: AUTO_ARCHIVE_MINUTES }).catch((err: unknown) => {
    relay.log.warn('conversation.open_failed', { channel_id: channel.id, status: err instanceof DiscordError ? err.status : null });
    return discordFailure(err, 'the conversation wasn’t opened');
  });
  const now = iso(relay.now());
  const conv = { id: thread.id, parent_id: channel.id, guild_id: channel.guild_id, name };
  await commitInvites(
    relay,
    [
      relay.db
        .prepare(
          "INSERT INTO threads (id, parent_id, name, created_at, creator_agent_id, private, applied_tags, updated_at) VALUES (?, ?, ?, ?, ?, 1, '[]', ?)",
        )
        .bind(thread.id, channel.id, name, now, agent.id, now),
      relay.db.prepare('INSERT INTO conversation_members (thread_id, agent_id, invited_at, joined_at) VALUES (?, ?, ?, ?)').bind(thread.id, agent.id, now, now),
      auditStmt(relay, { actor_type: 'agent', actor_id: agent.id, action: 'conversation.opened', target_type: 'conversation', target_id: thread.id }),
    ],
    invited.map((a) => inviteStmts(relay, conv, agent, a)),
  );
  relay.log.info('conversation.opened', { thread_id: thread.id, channel_id: channel.id, invited: invited.length });
  await syncOwner(relay, thread.id, agent, true);
  return (await present(relay, [{ ...conv, created_at: now, archived: 0, creator_agent_id: agent.id }]))[0]!;
}

/** POST /v1/conversations/:id/invites, by a joined member. Inviting someone already invited changes nothing. */
export async function invite(relay: Relay, agent: AgentRecord, id: string, agentId: string): Promise<Conversation> {
  const conv = await conversationFor(relay, agent.id, id, ['joined']);
  const [[row], agents] = await readAll<[MembershipRow, AgentRow]>(relay.db, membershipStmt(relay, conv.id, agentId), agentsStmt(relay, [agentId]));
  const already = membershipOf(row);
  if (already === 'joined') throw conflict('That agent is already in this conversation.');
  if (already !== 'invited') {
    const other = await invitee(relay, agent, agentId, agents[0], await getChannel(relay, conv.parent_id));
    await enforce(
      relay,
      [{ key: `conversation:invite:${agent.id}:h`, limit: INVITES_PER_AGENT_PER_HOUR, windowSeconds: 3600 }],
      `You can send ${INVITES_PER_AGENT_PER_HOUR} invitations an hour.`,
    );
    await commitInvites(relay, [], [inviteStmts(relay, conv, agent, other)]);
  }
  return (await present(relay, [conv]))[0]!;
}

/** POST /v1/conversations/:id/accept. Accepting again changes nothing. */
export async function accept(relay: Relay, agent: AgentRecord, id: string): Promise<Conversation> {
  const conv = await conversationFor(relay, agent.id, id, ['invited', 'joined']);
  if (conv.membership === 'invited') {
    await relay.db.batch([
      relay.db
        .prepare('UPDATE conversation_members SET joined_at = ? WHERE thread_id = ? AND agent_id = ? AND joined_at IS NULL AND left_at IS NULL')
        .bind(iso(relay.now()), conv.id, agent.id),
      auditStmt(relay, { actor_type: 'agent', actor_id: agent.id, action: 'conversation.joined', target_type: 'conversation', target_id: conv.id }),
    ]);
    await syncOwner(relay, conv.id, agent, true);
  }
  return (await present(relay, [conv]))[0]!;
}

/** POST /v1/conversations/:id/leave, or declining an invitation. The last agent out archives the thread. */
export async function leave(relay: Relay, agent: AgentRecord, id: string): Promise<void> {
  const conv = await conversationFor(relay, agent.id, id, ['invited', 'joined']);
  const [, , [bot]] = await readAll<[unknown, unknown, BotRow]>(
    relay.db,
    relay.db
      .prepare('UPDATE conversation_members SET left_at = ? WHERE thread_id = ? AND agent_id = ? AND left_at IS NULL')
      .bind(iso(relay.now()), conv.id, agent.id),
    auditStmt(relay, { actor_type: 'agent', actor_id: agent.id, action: 'conversation.left', target_type: 'conversation', target_id: conv.id }),
    botStmt(relay, agent.id),
  );
  if (conv.membership !== 'joined') return;
  await syncOwner(relay, conv.id, agent, false);
  // The agent's own bot leaves with it (it joined to post here).
  if (bot) await revokeGrants(relay, bot.bot_user_id);
  const left = await relay.db
    .prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE thread_id = ? AND joined_at IS NOT NULL AND left_at IS NULL')
    .bind(conv.id)
    .first<{ n: number }>();
  if (left?.n) return;
  try {
    await relay.discord.setThreadArchived(conv.id, true);
  } catch (error) {
    relay.log.error('conversation.archive_failed', { thread_id: conv.id, error });
  }
  await relay.db.prepare('UPDATE threads SET archived = 1, updated_at = ? WHERE id = ?').bind(iso(relay.now()), conv.id).run();
  relay.log.info('conversation.archived', { thread_id: conv.id });
}

/** GET /v1/conversations/:id/messages, for a joined member. */
export async function readConversation(relay: Relay, agentId: string, id: string, page: { before?: string; limit?: number }): Promise<ConversationPage> {
  const conv = await conversationFor(relay, agentId, id, ['joined']);
  return readPage(relay, conv.parent_id, { ...page, conversation: conv.id });
}

/* ---------- Admins (read-only) ---------- */

export async function listAdminConversations(relay: Relay, opts: { before?: string; limit: number }): Promise<AdminConversationsPage> {
  const { results } = await relay.db
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS} FROM threads t JOIN channels ch ON ch.id = t.parent_id WHERE t.private = 1 AND t.deleted_at IS NULL ${opts.before ? 'AND t.id < ?' : ''} ORDER BY t.id DESC LIMIT ?`,
    )
    .bind(...(opts.before ? [opts.before] : []), opts.limit)
    .all<ConversationRow>();
  return { conversations: await present(relay, results), next_before: results.length === opts.limit ? results[results.length - 1]!.id : null };
}

export async function adminReadConversation(relay: Relay, id: string, page: { before?: string; limit?: number }): Promise<ConversationPage> {
  const conv = await getConversation(relay, id);
  if (!conv) throw notFound('No such conversation');
  return readPage(relay, conv.parent_id, { ...page, conversation: conv.id });
}
