import { DiscordError, RateLimitedError, type DiscordMessage } from '@logitland/discord';
import { iso, type Relay } from '../context';
import { MAX_PARAMS, chunk, compareSnowflakes, placeholders } from '../services/events';
import { ingest, type IntakeEventInput } from '../services/intake';
import { messageCreated } from './normalize';

// After a lost session, what Discord holds beyond the newest message the relay saw is fetched over REST and fed
// through the normal intake path as creates. Edits and deletions made during the gap can't be recovered.

const PAGE = 100;

export interface BackfillResult {
  /** Where each place still has more to fetch: Discord channel (or thread) ID to the newest message ID fetched so far. */
  remaining: Record<string, string>;
  pages: number;
  messages: number;
  /** Set when Discord rate limited the run; try again after this many seconds. */
  retryAfterSeconds?: number;
}

/**
 * `from` maps a Discord channel ID (a thread's own ID for thread messages) to the newest message ID already seen.
 * Stops after `maxPages` REST pages in total, or when `stop` says so (asked before each page; the D1 query budget), and
 * returns what is left for the next run.
 */
export async function backfill(relay: Relay, from: Record<string, string>, maxPages: number, stop?: () => boolean): Promise<BackfillResult> {
  const remaining = { ...from };
  let pages = 0;
  let messages = 0;

  const keys = Object.keys(from);
  const { results: open } = await relay.db.prepare("SELECT id FROM channels WHERE agent_access != 'off'").all<{ id: string }>();
  const relayed = new Set(open.map((c) => c.id));
  const parents = new Map<string, string>();
  for (const part of chunk(
    keys.filter((k) => !relayed.has(k)),
    MAX_PARAMS,
  )) {
    const { results } = await relay.db
      .prepare(`SELECT CAST(id AS TEXT) AS id, parent_id FROM threads WHERE id IN (${placeholders(part.length)})`)
      .bind(...part)
      .all<{ id: string; parent_id: string }>();
    for (const t of results) if (relayed.has(t.parent_id)) parents.set(t.id, t.parent_id);
  }

  for (const key of keys) {
    // Anything that isn't a relayed channel or a thread of one has nothing to recover.
    if (!relayed.has(key) && !parents.has(key)) {
      delete remaining[key];
      continue;
    }
    const threads = parents.has(key) ? new Map([[key, parents.get(key)!]]) : new Map<string, string>();
    let after = from[key]!;
    for (;;) {
      if (pages >= maxPages || stop?.()) return { remaining, pages, messages };
      let page;
      try {
        page = await relay.discord.getChannelMessages(key, { after, limit: PAGE });
      } catch (err) {
        if (err instanceof RateLimitedError) return { remaining, pages, messages, retryAfterSeconds: err.retryAfterSeconds };
        // A thread that was deleted or a channel the bot can no longer see: there is nothing to fetch.
        if (err instanceof DiscordError && (err.status === 403 || err.status === 404)) {
          relay.log.warn('backfill.unavailable', { channel_id: key, status: err.status });
          delete remaining[key];
          break;
        }
        throw err;
      }
      pages++;
      messages += page.length;
      // Discord lists a page newest first; oldest first keeps the log in the order things were said.
      const ordered = [...page].sort((a, b) => compareSnowflakes(a.id, b.id));
      const events = ordered.flatMap((m) => messageCreated({ ...m, channel_id: key }, threads) ?? []) as IntakeEventInput[];
      if (events.length) await ingest(relay, { source: 'backfill', events });
      if (ordered.length) {
        after = ordered[ordered.length - 1]!.id;
        remaining[key] = after;
      }
      if (page.length < PAGE) {
        delete remaining[key];
        break;
      }
    }
  }
  return { remaining, pages, messages };
}

export interface SeedResult {
  /** Places looked at this run. */
  places: number;
  messages: number;
  /** More places are waiting for the next run. */
  more: boolean;
  retryAfterSeconds?: number;
}

/**
 * A relayed channel (or a live thread in one) the relay has never seen a message from has no cursor. Its latest page is
 * fetched once, so the mirror isn't empty on the day a channel is added. The messages are kept for readers but not
 * announced: they're history, not news. Looking is recorded by a cursor row (0 for a place with nothing in it, or that the bot
 * can't read; openGap starts those at the window's start, not at the channel's first message).
 * Forum and media channels have no messages of their own; their posts are the threads.
 */
export async function seedHistory(relay: Relay, maxPlaces: number): Promise<SeedResult> {
  const { results } = await relay.db
    .prepare(
      `SELECT id AS place, NULL AS parent FROM channels
         WHERE agent_access != 'off' AND type IN ('text', 'announcement') AND id NOT IN (SELECT channel_id FROM channel_cursors)
       UNION ALL
       SELECT CAST(t.id AS TEXT), t.parent_id FROM threads t JOIN channels c ON c.id = t.parent_id
         WHERE c.agent_access != 'off' AND t.archived = 0 AND t.deleted_at IS NULL AND CAST(t.id AS TEXT) NOT IN (SELECT channel_id FROM channel_cursors)
       LIMIT ?`,
    )
    .bind(maxPlaces + 1)
    .all<{ place: string; parent: string | null }>();
  const out: SeedResult = { places: 0, messages: 0, more: results.length > maxPlaces };
  for (const { place, parent } of results.slice(0, maxPlaces)) {
    let page: DiscordMessage[];
    try {
      page = await relay.discord.getChannelMessages(place, { limit: PAGE });
    } catch (err) {
      if (err instanceof RateLimitedError) return { ...out, more: true, retryAfterSeconds: err.retryAfterSeconds };
      if (!(err instanceof DiscordError && (err.status === 403 || err.status === 404))) throw err;
      // The bot can't read it. Say so once, and don't ask again every minute.
      relay.log.warn('seed.unavailable', { channel_id: place, status: err.status });
      page = [];
    }
    const ordered = [...page].sort((a, b) => compareSnowflakes(a.id, b.id));
    const events = ordered.flatMap((m) => messageCreated({ ...m, channel_id: place }, new Map(parent ? [[place, parent]] : [])) ?? []) as IntakeEventInput[];
    if (events.length) await ingest(relay, { source: 'seed', events, history: true });
    await relay.db
      .prepare('INSERT OR IGNORE INTO channel_cursors (channel_id, last_message_id, updated_at) VALUES (?, CAST(? AS INTEGER), ?)')
      .bind(place, ordered.length ? ordered[ordered.length - 1]!.id : '0', iso(relay.now()))
      .run();
    out.places++;
    out.messages += page.length;
  }
  return out;
}
