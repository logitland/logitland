import type { Author } from '@logitland/contracts';
import { z } from 'zod';
import { iso, type Relay, type Stmt } from '../context';
import { hmac, sha256 } from '../crypto';
import { auditStmt } from './audit';
import { authorRef } from './conversation';
import { chunk, commitPlan, compareSnowflakes, fanOutAll, MAX_PARAMS, placeholders, planEvent, snowflakeTime, type PlannedEvent } from './events';
import type { EventRow } from './deliveries';
import { contentHash } from './moderation/rows';
import { planRemoval, scrubStatements, type RemovedBy } from './scrub';
import { awardSent } from './xp/award';

// Normalised Discord events in, the event log and the conversation projection out. Every event has a
// deterministic source_key, so replaying a Gateway resume, a backfill or a retried batch records nothing twice,
// and only a newly recorded event fans out to subscribers.
//
// A person's message is kept only when it replies to an agent's message and they had agreed through /consent by the time
// they wrote it. Every other human message is dropped here: no row, no event, no text. Backfill goes through the same path.
// Agents, bots and webhooks are kept as they are.

const Snowflake = z.string().regex(/^\d{17,20}$/);
// Discord sends microsecond precision and an offset; the relay stores one format so strings compare in time order.
const Timestamp = z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString());
const Located = { channel_id: Snowflake, thread_id: Snowflake.nullish() };

// The shape the admin console saves with a channel (ChannelTag in packages/contracts).
const ChannelTag = z.object({ id: Snowflake, name: z.string().max(100), moderated: z.boolean() });

export const IntakeEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message_create'),
    ...Located,
    message_id: Snowflake,
    author: z.object({
      id: Snowflake,
      username: z.string().max(100),
      global_name: z.string().max(100).nullish(),
      bot: z.boolean().nullish(),
      webhook_id: Snowflake.nullish(),
    }),
    content: z.string(),
    timestamp: Timestamp,
    edited_timestamp: Timestamp.nullish(),
    reply_to: Snowflake.nullish(),
  }),
  z.object({ kind: z.literal('message_update'), ...Located, message_id: Snowflake, content: z.string().optional(), edited_timestamp: Timestamp }),
  z.object({ kind: z.literal('message_delete'), ...Located, message_id: Snowflake }),
  z.object({ kind: z.literal('message_delete_bulk'), ...Located, message_ids: z.array(Snowflake).min(1).max(100) }),
  z.object({
    kind: z.literal('thread_upsert'),
    thread_id: Snowflake,
    parent_id: Snowflake,
    name: z.string().max(200).nullish(),
    /** The Discord user who made the thread (Discord's owner_id). */
    owner_id: Snowflake.nullish(),
    created_at: Timestamp.nullish(),
    archived: z.boolean().nullish(),
    locked: z.boolean().nullish(),
    applied_tags: z.array(Snowflake).max(20).nullish(),
  }),
  z.object({ kind: z.literal('thread_delete'), thread_id: Snowflake, parent_id: Snowflake }),
  // Every active thread Discord listed (in these channels, or everywhere): any other thread the relay knows has been archived.
  z.object({ kind: z.literal('thread_sync'), parent_ids: z.array(Snowflake).nullable(), active_ids: z.array(Snowflake) }),
  z.object({
    kind: z.literal('channel_update'),
    channel_id: Snowflake,
    name: z.string().min(1).max(100),
    type: z.enum(['text', 'announcement', 'forum', 'media']),
    tags: z.array(ChannelTag).optional(),
  }),
]);
export type IntakeEvent = z.output<typeof IntakeEvent>;
export type IntakeEventInput = z.input<typeof IntakeEvent>;

/** Events are validated one by one inside `ingest`, so a single bad event never rejects the rest. */
export const IntakeBatch = z.object({
  source: z.string().min(1).max(40),
  events: z.array(z.unknown()),
  /** The messages are old (a first look at a channel): keep them for readers, but announce nothing to subscribers. */
  history: z.boolean().optional(),
});
export type IntakeBatch = z.infer<typeof IntakeBatch>;

/** Events per round of work. A round costs about three D1 queries per event, well inside D1's 1,000 per invocation. */
const EVENTS_PER_ROUND = 100;
/** How long after a send the Gateway can still beat the HTTP response and need matching by content. */
const ATTRIBUTION_WINDOW_MS = 10 * 60_000;

interface Relayed {
  guild_id: string;
  webhook_id: string | null;
  name: string;
  type: 'text' | 'announcement' | 'forum' | 'media';
  agent_access: string;
}

interface Context {
  relayed: Map<string, Relayed & { id: string }>;
  /** Every channel the relay has a row for, closed ones too: deletes are applied there, quietly, so text removed in Discord never comes back. */
  known: Map<string, Relayed & { id: string }>;
  history: boolean;
}

interface Tomb {
  observed_at: string;
  removed_by: RemovedBy | null;
}

interface Known {
  edited_at: string | null;
  deleted: boolean;
}

interface Sent {
  id: string;
  agent_id: string;
  name: string;
  /** What the agent asked to reply to; the Gateway echo of a webhook message can't carry it. */
  reply_to: string | null;
}

type Create = Extract<IntakeEvent, { kind: 'message_create' }>;

async function sourceKey(e: IntakeEvent): Promise<string | null> {
  switch (e.kind) {
    case 'message_create':
      return `create:${e.message_id}`;
    case 'message_update':
      return `update:${e.message_id}:${e.edited_timestamp}`;
    case 'message_delete':
      return `delete:${e.message_id}`;
    case 'message_delete_bulk':
      return `bulk:${await sha256([...e.message_ids].sort(compareSnowflakes).join(','))}`;
    default:
      return null;
  }
}

/** An event condition: this person agreed by `when` and hasn't withdrawn. */
const agreedWhen = (discordUserId: string, when: string) => ({
  sql: 'EXISTS (SELECT 1 FROM consents k WHERE k.discord_user_id = ? AND k.revoked_at IS NULL AND k.granted_at <= ?)',
  args: [discordUserId, when],
});

const bigger = (a: string | undefined, b: string) => (a === undefined || compareSnowflakes(b, a) > 0 ? b : a);

export interface IngestResult {
  /** Events newly written to the log. */
  recorded: number;
  deliveries: number;
  /** Events that were repeats, stale, or for channels agents can't use. */
  ignored: number;
  /** Events that failed validation. */
  invalid: number;
}

export async function ingest(relay: Relay, batch: IntakeBatch): Promise<IngestResult> {
  const { source, events: raw, history } = IntakeBatch.parse(batch);
  const total: IngestResult = { recorded: 0, deliveries: 0, ignored: 0, invalid: 0 };
  const events: IntakeEvent[] = [];
  for (const r of raw) {
    const parsed = IntakeEvent.safeParse(r);
    if (parsed.success) events.push(parsed.data);
    else total.invalid++;
  }
  if (!events.length) return total;
  const { results } = await relay.db.prepare('SELECT id, guild_id, webhook_id, name, type, agent_access FROM channels').all<Relayed & { id: string }>();
  const ctx: Context = {
    relayed: new Map(results.filter((c) => c.agent_access !== 'off').map((c) => [c.id, c])),
    known: new Map(results.map((c) => [c.id, c])),
    history: history ?? false,
  };
  for (const part of chunk(events, EVENTS_PER_ROUND)) {
    const r = await ingestRound(relay, ctx, part);
    total.recorded += r.recorded;
    total.deliveries += r.deliveries;
    total.ignored += r.ignored;
  }
  if (total.invalid) relay.log.warn('intake.invalid_events', { source, count: total.invalid });
  if (total.recorded) relay.log.info('intake.batch', { source, ...total });
  return total;
}

async function ingestRound(relay: Relay, ctx: Context, events: IntakeEvent[]): Promise<Omit<IngestResult, 'invalid'>> {
  const { relayed } = ctx;
  const out = { ignored: 0 };
  const keyed: { e: IntakeEvent; key: string | null }[] = [];
  for (const e of events) {
    const removal = e.kind === 'message_delete' || e.kind === 'message_delete_bulk' || e.kind === 'thread_delete';
    const places = removal ? ctx.known : relayed;
    const relevant = e.kind === 'thread_sync' ? true : 'parent_id' in e ? places.has(e.parent_id) : places.has(e.channel_id);
    if (relevant) keyed.push({ e, key: await sourceKey(e) });
    else out.ignored++;
  }

  // Everything the round needs to know about the current state, in a handful of queries.
  const keys = new Set<string>();
  const messageIds = new Set<string>();
  for (const { e, key } of keyed) {
    if (key) keys.add(key);
    if (e.kind === 'message_create') keys.add(`delete:${e.message_id}`);
    else if (e.kind === 'message_update' || e.kind === 'message_delete') messageIds.add(e.message_id);
    else if (e.kind === 'message_delete_bulk') for (const id of e.message_ids) messageIds.add(id);
  }
  const seen = new Set<string>();
  const tombs = new Map<string, Tomb>();
  for (const part of chunk([...keys], MAX_PARAMS)) {
    const { results } = await relay.db
      .prepare(
        `SELECT source_key, observed_at, json_extract(payload, '$.data.removed_by') AS removed_by FROM events WHERE source_key IN (${placeholders(part.length)})`,
      )
      .bind(...part)
      .all<{ source_key: string; observed_at: string; removed_by: RemovedBy | null }>();
    for (const r of results) {
      seen.add(r.source_key);
      if (r.source_key.startsWith('delete:')) tombs.set(r.source_key.slice('delete:'.length), { observed_at: r.observed_at, removed_by: r.removed_by });
    }
  }
  const known = new Map<string, Known>();
  for (const part of chunk([...messageIds], MAX_PARAMS)) {
    const { results } = await relay.db
      .prepare(`SELECT CAST(c.message_id AS TEXT) AS id, c.edited_at, c.deleted_at FROM conversation c WHERE c.message_id IN (${placeholders(part.length)})`)
      .bind(...part)
      .all<{ id: string; edited_at: string | null; deleted_at: string | null }>();
    for (const r of results) known.set(r.id, { edited_at: r.edited_at, deleted: r.deleted_at !== null });
  }
  const ours = keyed.flatMap(({ e, key }) =>
    e.kind === 'message_create' && e.author.webhook_id && e.author.webhook_id === relayed.get(e.channel_id)?.webhook_id && !seen.has(key!)
      ? [e.message_id]
      : [],
  );
  const sent = new Map<string, Sent>();
  for (const part of chunk(ours, MAX_PARAMS)) {
    const { results } = await relay.db
      .prepare(
        `SELECT m.discord_message_id AS did, m.id, m.agent_id, a.name, m.reply_to FROM relay_messages m JOIN agents a ON a.id = m.agent_id WHERE m.discord_message_id IN (${placeholders(part.length)})`,
      )
      .bind(...part)
      .all<Sent & { did: string }>();
    for (const r of results) sent.set(r.did, r);
  }
  // A person's message is kept only if it replies to an agent and they had agreed by the time they wrote it: when each person
  // in the round agreed (for those who still have), and which of the messages they reply to are agents'.
  const fromPeople = keyed.flatMap(({ e }) => (e.kind === 'message_create' && !e.author.bot && !e.author.webhook_id ? [e] : []));
  const agreedAt = new Map<string, string>();
  for (const part of chunk([...new Set(fromPeople.map((e) => e.author.id))], MAX_PARAMS)) {
    const { results } = await relay.db
      .prepare(`SELECT discord_user_id, granted_at FROM consents WHERE revoked_at IS NULL AND discord_user_id IN (${placeholders(part.length)})`)
      .bind(...part)
      .all<{ discord_user_id: string; granted_at: string }>();
    for (const r of results) agreedAt.set(r.discord_user_id, r.granted_at);
  }
  const agentMessages = new Set<string>();
  const targets = [...new Set(fromPeople.flatMap((e) => (e.reply_to && agreedAt.has(e.author.id) ? [e.reply_to] : [])))];
  for (const part of chunk(targets, MAX_PARAMS)) {
    const { results } = await relay.db
      .prepare(`SELECT CAST(message_id AS TEXT) AS id FROM conversation WHERE author_kind = 'agent' AND message_id IN (${placeholders(part.length)})`)
      .bind(...part)
      .all<{ id: string }>();
    for (const r of results) agentMessages.add(r.id);
  }

  const stmts: Stmt[] = [];
  const planned: { at: number; event: PlannedEvent }[] = [];
  const cursors = new Map<string, string>();
  const removed: string[] = [];
  const createdHere: { id: string; thread: string | null }[] = [];
  const record = (event: PlannedEvent) => {
    planned.push({ at: stmts.length, event });
    stmts.push(event.stmt);
  };

  // Work through the round in order, so the log keeps Discord's order.
  for (const { e, key } of keyed) {
    const where = 'parent_id' in e ? e.parent_id : 'channel_id' in e ? e.channel_id : '';
    const ch = (e.kind === 'thread_sync' ? undefined : (relayed.get(where) ?? ctx.known.get(where))) as Relayed & { id: string };
    // Closed to agents: removals are still applied, but nobody is told.
    const closed = ch?.agent_access === 'off';
    switch (e.kind) {
      case 'thread_upsert': {
        const flag = (v: boolean | null | undefined) => (v == null ? null : Number(v));
        const tags = e.applied_tags ? JSON.stringify(e.applied_tags) : null;
        const now = iso(relay.now());
        const created = e.created_at ?? snowflakeTime(e.thread_id);
        // A title is the words of whoever named the thread, so it is kept only when the relay's webhook (an agent's forum
        // post) or the bot (a thread started from an agent's message) made the thread. A person's title is never stored.
        const named = Number(e.owner_id == null || e.owner_id === ch.webhook_id || e.owner_id === relay.config.discord.applicationId);
        // Two statements rather than ON CONFLICT: the count, time and creator below are read only when the thread is new.
        stmts.push(
          relay.db
            .prepare(
              `UPDATE threads SET parent_id = ?, name = CASE WHEN ? = 1 THEN COALESCE(?, name) END,
                 archived = COALESCE(?, archived), locked = COALESCE(?, locked), applied_tags = COALESCE(?, applied_tags), updated_at = ? WHERE id = ?`,
            )
            .bind(e.parent_id, named, e.name ?? null, flag(e.archived), flag(e.locked), tags, now, e.thread_id),
          // A thread that was written about before it was announced starts with the count, time and creator of what is already stored.
          relay.db
            .prepare(
              `INSERT OR IGNORE INTO threads (id, parent_id, name, created_at, archived, locked, message_count, last_message_at, creator_agent_id, applied_tags, updated_at)
               SELECT ?, ?, CASE WHEN ? = 1 THEN ? END, ?, COALESCE(?, 0), COALESCE(?, 0), (SELECT COUNT(*) FROM conversation WHERE thread_id = ? AND deleted_at IS NULL),
                 (SELECT MAX(created_at) FROM conversation WHERE thread_id = ?), (SELECT agent_id FROM conversation WHERE message_id = ? AND author_kind = 'agent'), COALESCE(?, '[]'), ?
               WHERE NOT EXISTS (SELECT 1 FROM threads WHERE id = ?)`,
            )
            .bind(
              e.thread_id,
              e.parent_id,
              named,
              e.name ?? null,
              created,
              flag(e.archived),
              flag(e.locked),
              e.thread_id,
              e.thread_id,
              e.thread_id,
              tags,
              now,
              e.thread_id,
            ),
        );
        break;
      }

      case 'thread_delete': {
        stmts.push(
          relay.db
            .prepare('UPDATE threads SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?')
            .bind(iso(relay.now()), iso(relay.now()), e.thread_id),
        );
        // Deleting a thread deletes its messages in Discord; the Gateway may not say so message by message, and readers must not keep the text.
        const { results: inThread } = await relay.db
          .prepare('SELECT CAST(message_id AS TEXT) AS id FROM conversation WHERE thread_id = ? AND deleted_at IS NULL')
          .bind(e.thread_id)
          .all<{ id: string }>();
        const ids = [...new Set([...inThread.map((r) => r.id), ...createdHere.filter((c) => c.thread === e.thread_id).map((c) => c.id)])];
        for (const part of chunk(ids, 100)) {
          record(await planRemoval(relay, { ids: part, guildId: ch.guild_id, channelId: e.parent_id, removedBy: 'discord', kind: 'bulk', fan: !closed }));
          for (const id of part) {
            const k = known.get(id);
            if (k) k.deleted = true;
          }
          removed.push(...part);
        }
        break;
      }

      case 'thread_sync': {
        const parents = e.parent_ids ? e.parent_ids.filter((id) => relayed.has(id)) : [...relayed.keys()];
        if (!parents.length) break;
        stmts.push(
          relay.db
            .prepare(
              'UPDATE threads SET archived = 1, updated_at = ? WHERE archived = 0 AND deleted_at IS NULL AND parent_id IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT value FROM json_each(?))',
            )
            .bind(iso(relay.now()), JSON.stringify(parents), JSON.stringify(e.active_ids)),
        );
        break;
      }

      case 'channel_update': {
        const current = relayed.get(e.channel_id)!;
        if (current.name !== e.name || current.type !== e.type) {
          // A forum that became a text channel can no longer take new-thread posts; a plain rename keeps the access.
          const forumLike = (t: string) => t === 'forum' || t === 'media';
          const access = current.agent_access === 'post_new_threads' && forumLike(current.type) && !forumLike(e.type) ? 'post' : current.agent_access;
          stmts.push(
            relay.db
              .prepare(
                "UPDATE channels SET name = ?, type = ?, agent_access = CASE WHEN agent_access = 'post_new_threads' AND type IN ('forum', 'media') AND ? NOT IN ('forum', 'media') THEN 'post' ELSE agent_access END, updated_at = ? WHERE id = ?",
              )
              .bind(e.name, e.type, e.type, iso(relay.now()), e.channel_id),
            auditStmt(relay, {
              actor_type: 'system',
              actor_id: 'gateway',
              action: 'channel.synced',
              target_type: 'channel',
              target_id: e.channel_id,
              reason: 'Discord changed the channel',
              diff: {
                name: { from: current.name, to: e.name },
                type: { from: current.type, to: e.type },
                ...(access !== current.agent_access ? { agent_access: { from: current.agent_access, to: access } } : {}),
              },
            }),
          );
          current.name = e.name;
          current.type = e.type;
          current.agent_access = access;
        }
        // Forum and media tags come with the update; a channel that stopped being a forum has none. Saved the way the admin console saves them.
        const tags = e.tags ?? (e.type === 'text' || e.type === 'announcement' ? [] : undefined);
        if (tags) {
          const json = JSON.stringify(tags);
          stmts.push(
            relay.db.prepare('UPDATE channels SET tags = ?, updated_at = ? WHERE id = ? AND tags IS NOT ?').bind(json, iso(relay.now()), e.channel_id, json),
          );
        }
        break;
      }

      case 'message_create': {
        if (seen.has(key!)) {
          out.ignored++;
          break;
        }
        seen.add(key!);
        const cursorKey = e.thread_id ?? e.channel_id;
        cursors.set(cursorKey, bigger(cursors.get(cursorKey), e.message_id));
        const who = await resolveAuthor(relay, ch, e, sent, agreedAt, agentMessages);
        if (!who) {
          // A person's message that isn't a consenting reply to an agent: dropped, not stored.
          out.ignored++;
          break;
        }
        if (who.kind === 'agent') agentMessages.add(e.message_id);
        // A delete that came first leaves a tombstone: the late create is kept as a removed message, without its text.
        const tomb = tombs.get(e.message_id);
        const reply_to = e.reply_to ?? who.reply_to;
        stmts.push(createStmt(relay, e, who, { content: e.content, reply_to, edited_at: e.edited_timestamp ?? null }));
        if (tomb || ctx.history) out.ignored++;
        else {
          record(
            planEvent(relay, {
              type: 'message.created',
              guildId: ch.guild_id,
              channelId: e.channel_id,
              messageId: e.message_id,
              sourceKey: key!,
              // A delete committed after this round read the tombstones still wins: the text is never logged or sent.
              unless: `delete:${e.message_id}`,
              // So does a person withdrawing after this round read their agreement.
              ...(who.discord_user_id ? { when: agreedWhen(who.discord_user_id, e.timestamp) } : {}),
              data: {
                message_id: e.message_id,
                thread_id: e.thread_id ?? null,
                author: { kind: who.kind, agent_id: who.agent_id, author_id: who.author_ref, display_name: who.display_name } satisfies Author,
                content: e.content,
                created_at: e.timestamp,
                ...(reply_to ? { reply_to } : {}),
              },
            }),
          );
        }
        known.set(e.message_id, { edited_at: e.edited_timestamp ?? null, deleted: Boolean(tomb) });
        createdHere.push({ id: e.message_id, thread: e.thread_id ?? null });
        break;
      }

      case 'message_update': {
        const k = known.get(e.message_id);
        // A message the relay holds takes only newer edits; one it has never seen (a dropped person's message, say) is logged
        // without telling subscribers, and without its text, since nothing says who wrote it.
        if (seen.has(key!) || k?.deleted || (k?.edited_at && e.edited_timestamp <= k.edited_at)) {
          out.ignored++;
          break;
        }
        seen.add(key!);
        record(
          planEvent(relay, {
            type: 'message.updated',
            guildId: ch.guild_id,
            channelId: e.channel_id,
            messageId: e.message_id,
            sourceKey: key!,
            data: { message_id: e.message_id, ...(e.content === undefined || !k ? {} : { content: e.content }), edited_at: e.edited_timestamp },
            fan: Boolean(k),
            // A person who withdrew since the round read their message gets no new text recorded or sent.
            when: {
              sql: 'NOT EXISTS (SELECT 1 FROM conversation c WHERE c.message_id = ? AND c.discord_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM consents k WHERE k.discord_user_id = c.discord_user_id AND k.revoked_at IS NULL))',
              args: [e.message_id],
            },
          }),
        );
        if (k) {
          stmts.push(
            e.content === undefined
              ? relay.db
                  .prepare('UPDATE conversation SET edited_at = ? WHERE message_id = ? AND deleted_at IS NULL AND (edited_at IS NULL OR edited_at < ?)')
                  .bind(e.edited_timestamp, e.message_id, e.edited_timestamp)
              : relay.db
                  .prepare(
                    'UPDATE conversation SET content = ?, edited_at = ? WHERE message_id = ? AND deleted_at IS NULL AND (edited_at IS NULL OR edited_at < ?)',
                  )
                  .bind(e.content, e.edited_timestamp, e.message_id, e.edited_timestamp),
          );
          k.edited_at = e.edited_timestamp;
        }
        break;
      }

      case 'message_delete':
      case 'message_delete_bulk': {
        if (seen.has(key!)) {
          out.ignored++;
          break;
        }
        seen.add(key!);
        const ids = e.kind === 'message_delete' ? [e.message_id] : e.message_ids;
        // Told to subscribers only if the relay held one of the messages; otherwise the event is just the tombstone.
        record(
          await planRemoval(relay, {
            ids,
            guildId: ch.guild_id,
            channelId: e.channel_id,
            removedBy: 'discord',
            kind: e.kind === 'message_delete' ? 'single' : 'bulk',
            fan: !closed && ids.some((id) => known.has(id)),
          }),
        );
        for (const id of ids) {
          const k = known.get(id);
          if (k) k.deleted = true;
          // A bulk delete is one event for the lot; a message the relay doesn't hold yet (a backfill or seed page not yet written)
          // needs a tombstone of its own, or its create would bring the text back. They are kept like single deletes.
          if (e.kind === 'message_delete_bulk' && !k && !seen.has(`delete:${id}`)) {
            seen.add(`delete:${id}`);
            record(await planRemoval(relay, { ids: [id], guildId: ch.guild_id, channelId: e.channel_id, removedBy: 'discord', kind: 'single', fan: false }));
          }
          tombs.set(id, { observed_at: iso(relay.now()), removed_by: 'discord' });
        }
        removed.push(...ids);
        break;
      }
    }
  }
  // The text goes in the same transaction as everything else, after the creates and edits it may apply to.
  stmts.push(...scrubStatements(relay, removed, 'discord'));
  for (const [channelId, messageId] of cursors) stmts.push(cursorStmt(relay, channelId, messageId));
  const r = await commitPlan(relay, stmts, planned);
  return { recorded: r.recorded, deliveries: r.deliveries, ignored: out.ignored };
}

/** The newest message seen per channel (or thread), for backfill after a gap. Compared as integers. */
function cursorStmt(relay: Relay, channelId: string, messageId: string): Stmt {
  return relay.db
    .prepare(
      'INSERT INTO channel_cursors (channel_id, last_message_id, updated_at) VALUES (?, CAST(? AS INTEGER), ?) ON CONFLICT (channel_id) DO UPDATE SET last_message_id = excluded.last_message_id, updated_at = excluded.updated_at WHERE excluded.last_message_id > channel_cursors.last_message_id',
    )
    .bind(channelId, messageId, iso(relay.now()));
}

interface Who {
  kind: Author['kind'];
  agent_id: string | null;
  author_ref: string;
  discord_user_id: string | null;
  display_name: string;
  relay_message_id: string | null;
  /** What the relay knows an agent's message replies to; the Gateway's echo of a webhook message can't say. */
  reply_to: string | null;
}

/** Who wrote a message, or null for a person's message the relay doesn't keep (anything but a consenting reply to an agent). */
async function resolveAuthor(
  relay: Relay,
  channel: Relayed,
  e: Create,
  sent: Map<string, Sent>,
  agreedAt: Map<string, string>,
  agentMessages: ReadonlySet<string>,
): Promise<Who | null> {
  const a = e.author;
  if (a.webhook_id) {
    // One of our channel webhooks is an agent; any other webhook is just a webhook.
    const agent = channel.webhook_id && a.webhook_id === channel.webhook_id ? (sent.get(e.message_id) ?? (await settleSend(relay, e))) : null;
    if (agent)
      return {
        kind: 'agent',
        agent_id: agent.agent_id,
        author_ref: agent.agent_id,
        discord_user_id: null,
        display_name: agent.name,
        relay_message_id: agent.id,
        reply_to: agent.reply_to,
      };
    return {
      kind: 'webhook',
      agent_id: null,
      author_ref: `w_${a.webhook_id}`,
      discord_user_id: null,
      display_name: a.username,
      relay_message_id: null,
      reply_to: null,
    };
  }
  const display_name = a.global_name ?? a.username;
  if (a.bot)
    return {
      kind: 'bot',
      agent_id: null,
      author_ref: `b_${(await hmac(relay.config.hashKey, `bot:${a.id}`)).slice(0, 20)}`,
      discord_user_id: null,
      display_name,
      relay_message_id: null,
      reply_to: null,
    };
  const granted = agreedAt.get(a.id);
  if (granted === undefined || granted > e.timestamp || !e.reply_to || !agentMessages.has(e.reply_to)) return null;
  return {
    kind: 'human',
    agent_id: null,
    author_ref: await authorRef(relay, a.id),
    discord_user_id: a.id,
    display_name,
    relay_message_id: null,
    reply_to: null,
  };
}

/**
 * The conversation row for a create. A delete event that exists when the statement runs makes it a tombstone with no text,
 * decided here and not from what the round read earlier: a scrub that commits in between can't be overwritten by the late create.
 */
function createStmt(relay: Relay, e: Create, who: Who, v: { content: string; reply_to: string | null; edited_at: string | null }): Stmt {
  return relay.db
    .prepare(
      `INSERT OR IGNORE INTO conversation (message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, relay_message_id, created_at, edited_at, deleted_at, removed_by, reply_to)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN d.id IS NULL THEN ? END, ?, ?, ?, d.observed_at, CASE WHEN d.id IS NOT NULL THEN COALESCE(json_extract(d.payload, '$.data.removed_by'), 'discord') END, ?
       FROM (SELECT 1) LEFT JOIN events d ON d.source_key = ?`,
    )
    .bind(
      e.message_id,
      e.channel_id,
      e.thread_id ?? null,
      who.kind,
      who.agent_id,
      who.author_ref,
      who.discord_user_id,
      who.display_name,
      v.content,
      who.relay_message_id,
      e.timestamp,
      v.edited_at,
      v.reply_to,
      `delete:${e.message_id}`,
    );
}

/**
 * The Gateway can deliver a webhook message before the HTTP response that tells the sender its Discord ID.
 * Match it to a send still waiting: same channel, same text, an agent named like the webhook user, and attempted within the
 * last ten minutes (updated_at moves when a send starts, so a message released from review long after it was written still
 * matches). A send in flight is preferred to one the relay was unsure about. Claiming the row with a compare-and-set also
 * settles sends the relay was unsure about, the way the sender does: Discord's own timestamp is when the post was confirmed
 * (edits are allowed for 24 hours from it), and the reason the send was in doubt no longer applies.
 */
async function settleSend(relay: Relay, e: Create): Promise<Sent | null> {
  const { results } = await relay.db
    .prepare(
      `SELECT m.id, m.agent_id, a.name, m.reply_to FROM relay_messages m JOIN agents a ON a.id = m.agent_id
       WHERE m.channel_id = ? AND m.status IN ('sending', 'uncertain') AND m.discord_message_id IS NULL AND m.content_hash = ? AND lower(a.name) = lower(?) AND m.updated_at >= ?
       ORDER BY m.status = 'sending' DESC, m.created_at LIMIT 3`,
    )
    .bind(e.channel_id, await contentHash(e.content), e.author.username, iso(new Date(relay.now().getTime() - ATTRIBUTION_WINDOW_MS)))
    .all<Sent>();
  for (const candidate of results) {
    const claimed = await relay.db
      .prepare(
        "UPDATE relay_messages SET status = 'sent', discord_message_id = ?, sent_at = COALESCE(sent_at, ?), status_reason = NULL, updated_at = ? WHERE id = ? AND status IN ('sending', 'uncertain') AND discord_message_id IS NULL",
      )
      .bind(e.message_id, e.timestamp, iso(relay.now()), candidate.id)
      .run();
    if (claimed.meta.changes === 1) {
      relay.log.info('intake.send_settled', { relay_message_id: candidate.id, agent_id: candidate.agent_id });
      await awardSent(relay, candidate.id);
      return candidate;
    }
  }
  return null;
}

export interface AgentPost {
  discordMessageId: string;
  channelId: string;
  threadId: string | null;
  agentId: string;
  displayName: string;
  content: string;
  relayMessageId: string;
  createdAt: string;
  /** The Discord message this one answers. Webhooks can't reply natively, so only the relay knows. (`reply_to` is accepted too.) */
  replyTo?: string | null;
  reply_to?: string | null;
}

/** Called by the posting pipeline once Discord confirms an agent's post, so agent messages never depend on the Gateway. */
export async function recordAgentPost(relay: Relay, post: AgentPost): Promise<void> {
  const channel = await relay.db.prepare('SELECT guild_id FROM channels WHERE id = ?').bind(post.channelId).first<{ guild_id: string }>();
  if (!channel) {
    relay.log.warn('intake.agent_post_unknown_channel', { channel_id: post.channelId, relay_message_id: post.relayMessageId });
    return;
  }
  const key = `create:${post.discordMessageId}`;
  const created = new Date(post.createdAt).toISOString();
  const replyTo = post.replyTo ?? post.reply_to ?? null;
  const tomb = await relay.db
    .prepare("SELECT observed_at, json_extract(payload, '$.data.removed_by') AS removed_by FROM events WHERE source_key = ?")
    .bind(`delete:${post.discordMessageId}`)
    .first<{ observed_at: string; removed_by: RemovedBy | null }>();
  const stmts: Stmt[] = [
    // The Gateway may have stored this message as a generic webhook first. Upgrade that, and add what only the relay knows
    // (the reply) to an agent's row; never downgrade an agent, human or bot.
    relay.db
      .prepare(
        `INSERT INTO conversation (message_id, channel_id, thread_id, author_kind, agent_id, author_ref, discord_user_id, display_name, content, relay_message_id, created_at, deleted_at, removed_by, reply_to)
         VALUES (?, ?, ?, 'agent', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (message_id) DO UPDATE SET
           author_kind = 'agent',
           agent_id = excluded.agent_id,
           author_ref = excluded.author_ref,
           discord_user_id = NULL,
           display_name = excluded.display_name,
           relay_message_id = COALESCE(conversation.relay_message_id, excluded.relay_message_id),
           reply_to = COALESCE(conversation.reply_to, excluded.reply_to)
         WHERE conversation.author_kind = 'webhook' OR (conversation.author_kind = 'agent' AND conversation.agent_id = excluded.agent_id)`,
      )
      .bind(
        post.discordMessageId,
        post.channelId,
        post.threadId,
        post.agentId,
        post.agentId,
        post.displayName,
        tomb ? null : post.content,
        post.relayMessageId,
        created,
        tomb?.observed_at ?? null,
        tomb ? (tomb.removed_by ?? 'discord') : null,
        replyTo,
      ),
    cursorStmt(relay, post.threadId ?? post.channelId, post.discordMessageId),
  ];
  const planned: { at: number; event: PlannedEvent }[] = [];
  if (!tomb) {
    const event = planEvent(relay, {
      type: 'message.created',
      guildId: channel.guild_id,
      channelId: post.channelId,
      messageId: post.discordMessageId,
      sourceKey: key,
      data: {
        message_id: post.discordMessageId,
        thread_id: post.threadId,
        author: { kind: 'agent', agent_id: post.agentId, author_id: post.agentId, display_name: post.displayName } satisfies Author,
        content: post.content,
        created_at: created,
        ...(replyTo ? { reply_to: replyTo } : {}),
      },
    });
    planned.push({ at: 0, event });
    stmts.unshift(event.stmt);
  }
  await commitPlan(relay, stmts, planned);
}

/**
 * Records a subscription.gap event per channel (fanned out like any event), e.g. after a Gateway session is lost
 * or a paused subscription resumes. Returns how many were newly recorded.
 */
export async function recordGap(
  relay: Relay,
  gap: { channelIds: string[]; windowStart: string; windowEnd: string; reason: string; subscriptionId?: string },
): Promise<number> {
  const start = new Date(gap.windowStart).toISOString();
  const end = new Date(gap.windowEnd).toISOString();
  const channels: { id: string; guild_id: string }[] = [];
  for (const part of chunk(gap.channelIds, MAX_PARAMS)) {
    const { results } = await relay.db
      .prepare(`SELECT id, guild_id FROM channels WHERE id IN (${placeholders(part.length)})`)
      .bind(...part)
      .all<{ id: string; guild_id: string }>();
    channels.push(...results);
  }
  // A gap for a subscription that was paused covers events the log already holds, so "resume after the gap" would skip them:
  // it resumes after the last event from before the window instead. A Gateway gap is followed by what is backfilled, so it
  // resumes after itself.
  const before = gap.subscriptionId
    ? ((await relay.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE observed_at < ?').bind(start).first<{ seq: number }>())?.seq ?? 0)
    : null;
  const stmts: Stmt[] = [];
  const events: { at: number; event: PlannedEvent }[] = [];
  for (const c of channels) {
    const event = planEvent(relay, {
      type: 'subscription.gap',
      guildId: c.guild_id,
      channelId: c.id,
      messageId: null,
      sourceKey: `gap:${gap.subscriptionId ? `${gap.subscriptionId}:` : ''}${c.id}:${start}:${end}`,
      data: { window_start: start, window_end: end, resume_cursor: before === null ? '0' : String(before), reason: gap.reason },
      ...(gap.subscriptionId ? { subscriptionId: gap.subscriptionId } : {}),
    });
    events.push({ at: stmts.length, event });
    // Resume after the gap event itself: what was backfilled follows it in the log.
    stmts.push(event.stmt);
    if (before === null)
      stmts.push(relay.db.prepare("UPDATE events SET payload = json_set(payload, '$.data.resume_cursor', CAST(seq AS TEXT)) WHERE id = ?").bind(event.row.id));
  }
  if (!stmts.length) return 0;
  const results = await relay.db.batch(stmts);
  const fresh: EventRow[] = [];
  for (const { at, event } of events) {
    if (results[at]!.meta.changes !== 1) continue;
    const row = await relay.db.prepare('SELECT payload FROM events WHERE id = ?').bind(event.row.id).first<{ payload: string }>();
    fresh.push({ ...event.row, payload: row!.payload });
  }
  await fanOutAll(relay, fresh);
  relay.log.info('intake.gap', { channels: fresh.length });
  return fresh.length;
}

export interface IntakeStateRow {
  status: string;
  session_id: string | null;
  seq: number | null;
  resume_url: string | null;
  last_event_at: string | null;
  last_heartbeat_at: string | null;
  last_error: string | null;
}

/** The Gateway's row in intake_state, which the admin health page reads. */
export async function saveIntakeState(relay: Relay, s: IntakeStateRow, source = 'gateway'): Promise<void> {
  await relay.db
    .prepare(
      `INSERT INTO intake_state (source, status, session_id, seq, resume_url, last_event_at, last_heartbeat_at, last_error, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source) DO UPDATE SET status = excluded.status, session_id = excluded.session_id, seq = excluded.seq, resume_url = excluded.resume_url,
         last_event_at = excluded.last_event_at, last_heartbeat_at = excluded.last_heartbeat_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
    )
    .bind(source, s.status, s.session_id, s.seq, s.resume_url, s.last_event_at, s.last_heartbeat_at, s.last_error, iso(relay.now()))
    .run();
}
