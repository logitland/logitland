import { iso, type Relay, type Stmt } from '../context';
import { sha256 } from '../crypto';
import { chunk, commitPlan, compareSnowflakes, placeholders, planEvent, type PlannedEvent } from './events';

// Removing text everywhere the relay keeps it (conversation, event payloads, queued deliveries, and the relay's own
// record of a message an agent posted), for Discord deletes, moderator takedowns and people withdrawing their consent. What
// stays: the tombstone (who, when, why) and the removal event, so readers and subscribers learn the message is gone. A person
// withdrawing also takes their name out of the reply lines agents wrote to them.

export type RemovedBy = 'author' | 'moderator' | 'discord';

/** What a person who withdrew becomes in tombstones and event payloads. */
export const FORMER_PARTICIPANT = 'Former participant';
export const REMOVED_AUTHOR_REF = 'p_removed';

// 4 leading parameters plus the IDs stay under D1's limit of 100 per query.
const IDS_PER_STATEMENT = 80;

export interface ScrubJob {
  /** Discord message IDs, all in one channel. */
  ids: string[];
  /** Null scrubs the text but records no event (a channel the relay no longer lists has no guild to name). */
  guildId: string | null;
  channelId: string;
  removedBy: RemovedBy;
  /** One `message.deleted` per message, or one `message.bulk_deleted` for the lot. */
  kind: 'single' | 'bulk';
  /** Tell subscribers. By default only when the relay held at least one of the messages. */
  fan?: boolean;
  /** A person withdrawing: the tombstones also stop saying who they were. */
  anonymise?: boolean;
}

/** Makes messages stop saying who wrote them: the Discord ID, name and pseudonym go from the conversation and from event payloads. */
export function anonymiseStatements(relay: Relay, ids: string[]): Stmt[] {
  const stmts: Stmt[] = [];
  for (const part of chunk(ids, IDS_PER_STATEMENT)) {
    const marks = placeholders(part.length);
    stmts.push(
      relay.db
        .prepare(
          `UPDATE conversation SET discord_user_id = NULL, display_name = '${FORMER_PARTICIPANT}', author_ref = '${REMOVED_AUTHOR_REF}' WHERE message_id IN (${marks})`,
        )
        .bind(...part),
      relay.db
        .prepare(
          `UPDATE events SET payload = json_set(payload, '$.data.author.display_name', '${FORMER_PARTICIPANT}', '$.data.author.author_id', '${REMOVED_AUTHOR_REF}')
           WHERE message_id IN (${marks}) AND type = 'message.created' AND json_type(payload, '$.data.author') = 'object'`,
        )
        .bind(...part),
    );
  }
  return stmts;
}

/** The statements that take the text out: the conversation tombstone, event payloads, the relay's own record of an agent's post and queued deliveries. Safe to repeat. */
export function scrubStatements(relay: Relay, ids: string[], removedBy: RemovedBy, opts: { anonymise?: boolean } = {}): Stmt[] {
  const now = iso(relay.now());
  const stmts: Stmt[] = [];
  for (const part of chunk(ids, IDS_PER_STATEMENT)) {
    const marks = placeholders(part.length);
    // A Discord delete never overrides who removed a message first (a moderator, say); an explicit scrub does.
    stmts.push(
      relay.db
        .prepare(
          `UPDATE conversation SET content = NULL, deleted_at = COALESCE(deleted_at, ?), removed_by = CASE WHEN ? = 'discord' THEN COALESCE(removed_by, ?) ELSE ? END WHERE message_id IN (${marks})`,
        )
        .bind(now, removedBy, removedBy, removedBy, ...part),
      // Edits without text have no content key, and must not gain one.
      relay.db
        .prepare(
          `UPDATE events SET payload = json_set(payload, '$.data.content', '') WHERE message_id IN (${marks}) AND type IN ('message.created', 'message.updated') AND json_type(payload, '$.data.content') = 'text'`,
        )
        .bind(...part),
      // The relay's own copy of a post an agent made: its text, thread title and reply line go too (the hash stays).
      relay.db
        .prepare(`UPDATE relay_messages SET content = NULL, thread_name = NULL, reply_prefix = NULL WHERE discord_message_id IN (${marks})`)
        .bind(...part),
      // The title of a thread an agent started is its starter's words (the thread's ID is the starter's ID).
      relay.db.prepare(`UPDATE threads SET name = NULL WHERE creator_agent_id IS NOT NULL AND name IS NOT NULL AND id IN (${marks})`).bind(...part),
      relay.db
        .prepare(
          `UPDATE deliveries SET status = 'dropped', next_attempt_at = NULL, last_error = 'The message was removed before it was delivered'
           WHERE id IN (
             SELECT d.id FROM events e JOIN deliveries d INDEXED BY deliveries_event ON d.event_id = e.id
             WHERE e.message_id IN (${marks}) AND e.type IN ('message.created', 'message.updated') AND d.status IN ('pending', 'retrying'))`,
        )
        .bind(...part),
    );
  }
  return opts.anonymise ? [...stmts, ...anonymiseStatements(relay, ids)] : stmts;
}

/** The removal event: `message.deleted` for one message, `message.bulk_deleted` for several. */
export async function planRemoval(relay: Relay, job: Omit<ScrubJob, 'guildId'> & { guildId: string }): Promise<PlannedEvent> {
  if (job.kind === 'single') {
    const id = job.ids[0]!;
    return planEvent(relay, {
      type: 'message.deleted',
      guildId: job.guildId,
      channelId: job.channelId,
      messageId: id,
      sourceKey: `delete:${id}`,
      data: { message_id: id, removed_by: job.removedBy },
      fan: job.fan,
    });
  }
  const sorted = [...job.ids].sort(compareSnowflakes);
  return planEvent(relay, {
    type: 'message.bulk_deleted',
    guildId: job.guildId,
    channelId: job.channelId,
    messageId: null,
    sourceKey: `bulk:${await sha256(sorted.join(','))}`,
    data: { message_ids: sorted },
    fan: job.fan,
  });
}

/** Blanks the text, drops queued deliveries and records the removal, in one transaction. Safe to repeat. */
export async function scrubIds(relay: Relay, job: ScrubJob): Promise<{ recorded: boolean; deliveries: number }> {
  const stmts = scrubStatements(relay, job.ids, job.removedBy, { anonymise: job.anonymise });
  if (job.guildId === null) {
    await relay.db.batch(stmts);
    return { recorded: false, deliveries: 0 };
  }
  let fan = job.fan;
  if (fan === undefined) {
    let held = 0;
    for (const part of chunk(job.ids, IDS_PER_STATEMENT)) {
      held +=
        (
          await relay.db
            .prepare(`SELECT COUNT(*) AS n FROM conversation WHERE message_id IN (${placeholders(part.length)})`)
            .bind(...part)
            .first<{ n: number }>()
        )?.n ?? 0;
    }
    fan = held > 0;
  }
  const event = await planRemoval(relay, { ...job, guildId: job.guildId, fan });
  const { recorded, deliveries } = await commitPlan(relay, [...stmts, event.stmt], [{ at: stmts.length, event }]);
  return { recorded: recorded > 0, deliveries };
}

/**
 * Removes one message everywhere. `where` is only needed when the relay may not hold the message yet (a takedown
 * racing the Gateway): it lets the removal leave a tombstone so a late create doesn't bring the text back.
 */
export async function scrubMessage(relay: Relay, discordMessageId: string, removedBy: RemovedBy, where?: { channelId: string }): Promise<void> {
  const known =
    (await relay.db
      .prepare('SELECT channel_id, guild_id FROM events WHERE message_id = ? LIMIT 1')
      .bind(discordMessageId)
      .first<{ channel_id: string; guild_id: string }>()) ??
    (await relay.db
      .prepare('SELECT c.channel_id, h.guild_id FROM conversation c JOIN channels h ON h.id = c.channel_id WHERE c.message_id = ?')
      .bind(discordMessageId)
      .first<{ channel_id: string; guild_id: string }>());
  const channel =
    known ??
    (where
      ? await relay.db
          .prepare('SELECT id AS channel_id, guild_id FROM channels WHERE id = ?')
          .bind(where.channelId)
          .first<{ channel_id: string; guild_id: string }>()
      : null);
  if (!channel) {
    relay.log.warn('scrub.unknown_message', { removed_by: removedBy });
    return;
  }
  await scrubIds(relay, { ids: [discordMessageId], guildId: channel.guild_id, channelId: channel.channel_id, removedBy, kind: 'single' });
}

/** At most this many messages per call; a person with more can call again. */
const PERSON_LIMIT = 5000;

// An agent's reply starts with a line naming the person it answers (see the posting pipeline's reply line). A name never
// contains '*', so the first '** · ' ends it.
const REPLY_OPEN = '-# ↪ Replying to **';
const REPLY_CLOSE = '** · ';
const isReplyLine = (col: string) => `instr(${col}, '${REPLY_OPEN}') = 1 AND instr(${col}, '${REPLY_CLOSE}') > 0`;
const unnamed = (col: string) => `'${REPLY_OPEN}a person' || substr(${col}, instr(${col}, '${REPLY_CLOSE}'))`;
/** Agent messages that reply to a message the person wrote and the relay still knows as theirs; one placeholder, the person's Discord ID. */
const REPLIES_TO_PERSON = `SELECT r.message_id, r.relay_message_id FROM conversation r WHERE r.author_kind = 'agent' AND r.reply_to IN (SELECT CAST(p.message_id AS TEXT) FROM conversation p WHERE p.discord_user_id = ?)`;

/**
 * What still names a person after their messages are gone: the reply lines agents wrote to them (in the conversation, the
 * posting records and event payloads) become "a person". Run before the messages are anonymised, while they can still be
 * found by the person's ID. Safe to repeat.
 */
function unnameStatements(relay: Relay, discordUserId: string): Stmt[] {
  const text = "json_extract(payload, '$.data.content')";
  return [
    relay.db
      .prepare(
        `UPDATE conversation SET content = ${unnamed('content')} WHERE author_kind = 'agent' AND ${isReplyLine('content')}
           AND reply_to IN (SELECT CAST(p.message_id AS TEXT) FROM conversation p WHERE p.discord_user_id = ?)`,
      )
      .bind(discordUserId),
    // Sends not yet in the conversation (still being moderated or sent) carry the line too.
    relay.db
      .prepare(
        `UPDATE relay_messages SET reply_prefix = ${unnamed('reply_prefix')} WHERE reply_prefix IS NOT NULL AND ${isReplyLine('reply_prefix')}
           AND (id IN (SELECT relay_message_id FROM (${REPLIES_TO_PERSON}) WHERE relay_message_id IS NOT NULL)
             OR (status IN ('moderating', 'held', 'queued', 'sending', 'uncertain', 'blocked', 'failed') AND reply_to IN (SELECT CAST(p.message_id AS TEXT) FROM conversation p WHERE p.discord_user_id = ?)))`,
      )
      .bind(discordUserId, discordUserId),
    relay.db
      .prepare(
        `UPDATE events SET payload = json_set(payload, '$.data.content', ${unnamed(text)}) WHERE type IN ('message.created', 'message.updated')
           AND json_type(payload, '$.data.content') = 'text' AND ${isReplyLine(text)} AND message_id IN (SELECT message_id FROM (${REPLIES_TO_PERSON}))`,
      )
      .bind(discordUserId),
  ];
}

/**
 * Removes every reply the relay holds of a person (one `message.bulk_deleted` per channel) and makes what remains
 * anonymous: tombstones, event payloads and agents' reply lines stop naming them. Messages already removed are anonymised too.
 * `messages` counts the ones removed now.
 */
export async function scrubPerson(relay: Relay, discordUserId: string): Promise<{ messages: number; more: boolean }> {
  await relay.db.batch(unnameStatements(relay, discordUserId));
  const { results } = await relay.db
    .prepare(
      'SELECT CAST(message_id AS TEXT) AS id, channel_id, deleted_at IS NULL AS live FROM conversation WHERE discord_user_id = ? ORDER BY message_id LIMIT ?',
    )
    .bind(discordUserId, PERSON_LIMIT)
    .all<{ id: string; channel_id: string; live: number }>();
  const live = new Map<string, string[]>();
  const gone: string[] = [];
  for (const r of results) {
    if (r.live) live.set(r.channel_id, [...(live.get(r.channel_id) ?? []), r.id]);
    else gone.push(r.id);
  }
  for (const [channelId, ids] of live) {
    const channel = await relay.db.prepare('SELECT guild_id FROM channels WHERE id = ?').bind(channelId).first<{ guild_id: string }>();
    await scrubIds(relay, { ids, guildId: channel?.guild_id ?? null, channelId, removedBy: 'author', kind: 'bulk', fan: true, anonymise: true });
  }
  if (gone.length) await relay.db.batch(anonymiseStatements(relay, gone));
  const removed = results.length - gone.length;
  relay.log.info('scrub.person', { messages: removed, anonymised: gone.length, channels: live.size });
  return { messages: removed, more: results.length === PERSON_LIMIT };
}
