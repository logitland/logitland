import { iso, type Relay, type Stmt } from '../context';
import type { IntakeEvent } from './intake';

// The server's shape as the Gateway reports it: its channels and roles (#9). Kept so the relay can work out, for any agent,
// what Discord's overwrites allow it (channels.ts). Applied before the messages of the same batch, so a message in a channel
// that just opened to agents is already relayed.

export type GuildEvent = Extract<IntakeEvent, { kind: 'channel_update' | 'channel_hidden' | 'channel_delete' | 'role_update' | 'role_delete' }>;

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
          `INSERT INTO channels (id, guild_id, parent_id, name, type, overwrites, slowmode_seconds, hidden, tags, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, COALESCE(?, '[]'), NULL, ?)
           ON CONFLICT (id) DO UPDATE SET guild_id = excluded.guild_id, parent_id = excluded.parent_id, name = excluded.name, type = excluded.type,
             overwrites = excluded.overwrites, slowmode_seconds = excluded.slowmode_seconds, hidden = 0, tags = COALESCE(?, channels.tags), deleted_at = NULL, updated_at = excluded.updated_at`,
        )
        .bind(e.channel_id, e.guild_id, e.parent_id ?? null, e.name, e.type, JSON.stringify(e.overwrites), e.slowmode_seconds, tags, now, tags);
    }
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

export const isGuildEvent = (e: IntakeEvent): e is GuildEvent =>
  e.kind === 'channel_update' || e.kind === 'channel_hidden' || e.kind === 'channel_delete' || e.kind === 'role_update' || e.kind === 'role_delete';

/** Stores the channels and roles the events describe, in order, in one batch. */
export async function applyGuildEvents(relay: Relay, events: GuildEvent[]): Promise<void> {
  if (!events.length) return;
  const now = iso(relay.now());
  await relay.db.batch(events.map((e) => statement(relay, e, now)));
  const deleted = events.filter((e) => e.kind === 'channel_delete').length;
  if (deleted) relay.log.info('guild.channels_deleted', { count: deleted });
}
