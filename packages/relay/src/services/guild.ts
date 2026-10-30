import { iso, type Relay, type Stmt } from '../context';
import { forget } from '../memo';
import { GUILD_ROLES } from './channels';
import { commitPlan, planEvent, type PlannedEvent } from './events';
import { refreshShowcase } from './showcase';
import type { IntakeEvent } from './intake';

// The server's shape as the Gateway reports it: its channels and roles (#9). Kept so the relay can work out, for any agent,
// what Discord's overwrites allow it (channels.ts). Applied before the messages of the same batch, so a message in a channel
// that just opened to agents is already relayed.

export type GuildEvent = Extract<
  IntakeEvent,
  { kind: 'channel_update' | 'channel_hidden' | 'channel_delete' | 'category_update' | 'category_delete' | 'role_update' | 'role_delete' }
>;
const GUILD_KINDS = new Set<IntakeEvent['kind']>([
  'channel_update',
  'channel_hidden',
  'channel_delete',
  'category_update',
  'category_delete',
  'role_update',
  'role_delete',
]);

/** A hidden channel's real name isn't known; this stands in until Discord sends it. */
const HIDDEN_NAME = 'hidden channel';

function statement(relay: Relay, e: GuildEvent, now: string): Stmt {
  switch (e.kind) {
    case 'role_update':
      return relay.db
        .prepare(
          'INSERT INTO guild_roles (id, guild_id, name, permissions, position, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, permissions = excluded.permissions, position = excluded.position, updated_at = excluded.updated_at',
        )
        .bind(e.role_id, e.guild_id, e.name, e.permissions, e.position, now);
    case 'role_delete':
      return relay.db.prepare('DELETE FROM guild_roles WHERE id = ?').bind(e.role_id);
    case 'channel_update': {
      // Forum and media tags come with the update; a channel that stopped being a forum has none. A forum update without
      // them keeps the ones stored.
      const tags = e.tags ? JSON.stringify(e.tags) : e.type === 'text' || e.type === 'announcement' ? '[]' : null;
      return relay.db
        .prepare(
          `INSERT INTO channels (id, guild_id, parent_id, name, type, overwrites, slowmode_seconds, position, hidden, tags, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, COALESCE(?, '[]'), NULL, ?)
           ON CONFLICT (id) DO UPDATE SET guild_id = excluded.guild_id, parent_id = excluded.parent_id, name = excluded.name, type = excluded.type,
             overwrites = excluded.overwrites, slowmode_seconds = excluded.slowmode_seconds, position = excluded.position, hidden = 0, tags = COALESCE(?, channels.tags), deleted_at = NULL, updated_at = excluded.updated_at`,
        )
        .bind(
          e.channel_id,
          e.guild_id,
          e.parent_id ?? null,
          e.name,
          e.type,
          JSON.stringify(e.overwrites),
          e.slowmode_seconds,
          e.position ?? 0,
          tags,
          now,
          tags,
        );
    }
    case 'category_update':
      return relay.db
        .prepare(
          `INSERT INTO categories (id, guild_id, name, position, deleted_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, position = excluded.position, deleted_at = NULL, updated_at = excluded.updated_at`,
        )
        .bind(e.category_id, e.guild_id, e.name, e.position, now);
    case 'category_delete':
      return relay.db.prepare('UPDATE categories SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?').bind(now, now, e.category_id);
    case 'channel_hidden':
      return relay.db
        .prepare(
          `INSERT INTO channels (id, guild_id, name, type, hidden, updated_at) VALUES (?, ?, ?, ?, 1, ?)
           ON CONFLICT (id) DO UPDATE SET hidden = 1, updated_at = excluded.updated_at`,
        )
        .bind(e.channel_id, e.guild_id, HIDDEN_NAME, e.type, now);
    case 'channel_delete':
      return relay.db.prepare('UPDATE channels SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?').bind(now, now, e.channel_id);
  }
}

export const isGuildEvent = (e: IntakeEvent): e is GuildEvent => GUILD_KINDS.has(e.kind);

/**
 * Stores the channels and roles the events describe, in order, in one batch. A deleted channel's subscriptions end (#9): the
 * channel.deleted event is the last thing they deliver.
 */
export async function applyGuildEvents(relay: Relay, events: GuildEvent[]): Promise<void> {
  if (!events.length) return;
  const now = iso(relay.now());
  const stmts = events.map((e) => statement(relay, e, now));
  const planned: { at: number; event: PlannedEvent }[] = [];
  for (const e of events) {
    if (e.kind !== 'channel_delete') continue;
    const channel = await relay.db
      .prepare('SELECT guild_id FROM channels WHERE id = ? AND deleted_at IS NULL')
      .bind(e.channel_id)
      .first<{ guild_id: string }>();
    if (!channel) continue;
    const event = planEvent(relay, {
      type: 'channel.deleted',
      guildId: channel.guild_id,
      channelId: e.channel_id,
      messageId: null,
      sourceKey: `channel-deleted:${e.channel_id}`,
      data: { channel_id: e.channel_id },
    });
    planned.push({ at: stmts.length, event });
    stmts.push(
      event.stmt,
      relay.db.prepare("UPDATE subscriptions SET ended_at = ? WHERE kind = 'channel' AND channel_id = ? AND ended_at IS NULL").bind(now, e.channel_id),
    );
  }
  await commitPlan(relay, stmts, planned);
  forget(GUILD_ROLES);
  if (planned.length) relay.log.info('guild.channels_deleted', { count: planned.length });
  // Which channels every agent can read may have changed, and the home page shows only those.
  await refreshShowcase(relay);
}
