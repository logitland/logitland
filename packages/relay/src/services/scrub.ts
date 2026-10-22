import { iso, type Relay, type Stmt } from '../context';
import { sha256 } from '../crypto';
import { inPrivateSql } from './conversation';
import { chunk, commitPlan, compareSnowflakes, placeholders, planEvent, type PlannedEvent } from './events';
import { isReplyLine, unnamedReplyLine } from './replies';

// Removing text everywhere the relay keeps it (conversation, event payloads, which queued deliveries are read from again when
// sent, and the relay's own record of a message an agent posted), for Discord deletes, moderator takedowns and people
// withdrawing their consent. What
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

/**
 * Makes messages stop saying who wrote them: the Discord ID, name, username, avatar and pseudonym go from the conversation,
 * and the name and pseudonym from event payloads.
 */
export function anonymiseStatements(relay: Relay, ids: string[]): Stmt[] {
  const stmts: Stmt[] = [];
  for (const part of chunk(ids, IDS_PER_STATEMENT)) {
    const marks = placeholders(part.length);
    stmts.push(
      relay.db
        .prepare(
          `UPDATE conversation SET discord_user_id = NULL, display_name = '${FORMER_PARTICIPANT}', author_username = NULL, author_avatar = NULL, author_ref = '${REMOVED_AUTHOR_REF}' WHERE message_id IN (${marks})`,
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

/** The statements that take the text out: the conversation tombstone, event payloads, and the relay's own record of an agent's post. Safe to repeat. */
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
      // The title of a thread an agent started is its starter's words (the thread's ID is the starter's ID).
      relay.db.prepare(`UPDATE threads SET name = NULL WHERE creator_agent_id IS NOT NULL AND name IS NOT NULL AND id IN (${marks})`).bind(...part),
    );
    // The relay's own copy of a post an agent made: its text, thread title and reply line go too (the hash stays). A
    // moderator's removal keeps it a year for appeals (#30 Q7, retention.ts).
    if (removedBy !== 'moderator')
      stmts.push(
        relay.db
          .prepare(`UPDATE relay_messages SET content = NULL, thread_name = NULL, reply_prefix = NULL WHERE discord_message_id IN (${marks})`)
          .bind(...part),
      );
  }
  return opts.anonymise ? [...stmts, ...anonymiseStatements(relay, ids)] : stmts;
}

/** The removal event: `message.deleted` for one message, `message.bulk_deleted` for several. */
export async function planRemoval(relay: Relay, job: Omit<ScrubJob, 'guildId'> & { guildId: string }): Promise<PlannedEvent> {
  if (job.kind === 'single') {
    const id = job.ids[0]!;
    // A removed reply to an agent goes to that agent's replies subscription too, which had its text.
    const replied = await relay.db
      .prepare('SELECT p.agent_id FROM conversation c JOIN conversation p ON p.message_id = c.reply_to WHERE c.message_id = ? AND p.agent_id IS NOT NULL')
      .bind(id)
      .first<{ agent_id: string }>();
    return planEvent(relay, {
      type: 'message.deleted',
      guildId: job.guildId,
      channelId: job.channelId,
      messageId: id,
      sourceKey: `delete:${id}`,
      data: { message_id: id, removed_by: job.removedBy },
      replyAgentId: replied?.agent_id ?? null,
      silent: job.fan === false,
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
    silent: job.fan === false,
  });
}

/** Blanks the text and records the removal, in one transaction. Safe to repeat. */
export async function scrubIds(relay: Relay, job: ScrubJob): Promise<{ recorded: boolean }> {
  const stmts = scrubStatements(relay, job.ids, job.removedBy, { anonymise: job.anonymise });
  if (job.guildId === null) {
    await relay.db.batch(stmts);
    return { recorded: false };
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
  const { recorded } = await commitPlan(relay, [...stmts, event.stmt], [{ at: stmts.length, event }]);
  return { recorded: recorded > 0 };
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

/**
 * What still names a person after their messages are gone: the reply lines agents' posts carry to them (mention and quote)
 * become "a person" in the posting records. The conversation and events hold agents' text without the line (`reply_to`
 * instead), so nothing else names them. Run before the messages are anonymised, while they can still be found by the
 * person's ID. Safe to repeat.
 */
function unnameStatements(relay: Relay, discordUserId: string): Stmt[] {
  return [
    relay.db
      .prepare(
        `UPDATE relay_messages SET reply_prefix = ${unnamedReplyLine('reply_prefix')} WHERE reply_prefix IS NOT NULL AND ${isReplyLine('reply_prefix')}
           AND reply_to IN (SELECT CAST(p.message_id AS TEXT) FROM conversation p WHERE p.discord_user_id = ?)`,
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
  // Grouped by channel, and apart for each private conversation (#33): one removal event goes only where its messages went.
  const { results } = await relay.db
    .prepare(
      `SELECT CAST(c.message_id AS TEXT) AS id, c.channel_id, c.deleted_at IS NULL AS live, CASE WHEN ${inPrivateSql('c')} THEN c.thread_id ELSE '' END AS place
       FROM conversation c WHERE c.discord_user_id = ? ORDER BY c.message_id LIMIT ?`,
    )
    .bind(discordUserId, PERSON_LIMIT)
    .all<{ id: string; channel_id: string; live: number; place: string }>();
  const live = new Map<string, { channelId: string; ids: string[] }>();
  const gone: string[] = [];
  for (const r of results) {
    const key = `${r.channel_id}:${r.place}`;
    if (r.live) live.set(key, { channelId: r.channel_id, ids: [...(live.get(key)?.ids ?? []), r.id] });
    else gone.push(r.id);
  }
  for (const { channelId, ids } of live.values()) {
    const channel = await relay.db.prepare('SELECT guild_id FROM channels WHERE id = ?').bind(channelId).first<{ guild_id: string }>();
    await scrubIds(relay, { ids, guildId: channel?.guild_id ?? null, channelId, removedBy: 'author', kind: 'bulk', fan: true, anonymise: true });
  }
  if (gone.length) await relay.db.batch(anonymiseStatements(relay, gone));
  const removed = results.length - gone.length;
  relay.log.info('scrub.person', { messages: removed, anonymised: gone.length, channels: live.size });
  return { messages: removed, more: results.length === PERSON_LIMIT };
}
