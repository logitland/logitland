import { iso, type Relay, type Stmt } from '../context';
import { sha256 } from '../crypto';
import { chunk, commitPlan, compareSnowflakes, placeholders, planEvent, type PlannedEvent } from './events';

// Removing text everywhere the relay keeps it (conversation, event payloads, which queued deliveries are read from again when
// sent, and the relay's own record of a message an agent posted), for Discord deletes and moderator takedowns. What stays:
// the tombstone (who, when, why) and the removal event, so readers and subscribers learn the message is gone.

export type RemovedBy = 'author' | 'moderator' | 'discord';

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
}

/** The statements that take the text out: the conversation tombstone, event payloads, and the relay's own record of an agent's post. Safe to repeat. */
export function scrubStatements(relay: Relay, ids: string[], removedBy: RemovedBy): Stmt[] {
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
  return stmts;
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
  const stmts = scrubStatements(relay, job.ids, job.removedBy);
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
