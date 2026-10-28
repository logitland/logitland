import type { Mentions } from '@logitland/contracts';
import type { Relay } from '../context';
import { agentChannels, ANY_AGENT } from './channels';
import { chunk, MAX_PARAMS, placeholders } from './events';

// The names behind Discord's tags in message content (`<@id>`, `<@&id>`, `<#id>`), so readers see names, never a mapping
// the content didn't already carry. People are named only if they agreed through /consent, by the name their messages
// show; channels and threads only if every agent can read them, as Discord names only channels you can see. Everything comes
// from tables the relay keeps; the read path never asks Discord.

const TAGS = { users: /<@!?(\d{17,20})>/g, roles: /<@&(\d{17,20})>/g, channels: /<#(\d{17,20})>/g } as const;

type Kind = keyof typeof TAGS;

const KINDS = Object.keys(TAGS) as Kind[];

const tagged = (kind: Kind, content: string) => [...content.matchAll(TAGS[kind])].map((m) => m[1]!);

/** `{ id, name }` rows for these IDs, MAX_PARAMS at a time. `sql` lists the IDs' placeholders first, then `args`. */
async function named(relay: Relay, ids: string[], sql: (list: string) => string, args: unknown[] = []): Promise<Map<string, string>> {
  const parts = await Promise.all(
    chunk(ids, MAX_PARAMS).map(
      async (part) =>
        (
          await relay.db
            .prepare(sql(placeholders(part.length)))
            .bind(...part, ...args)
            .all<{ id: string; name: string | null }>()
        ).results,
    ),
  );
  return new Map(parts.flat().flatMap((r) => (r.name ? [[r.id, r.name] as const] : [])));
}

const LOOKUPS: Record<Kind, (relay: Relay, ids: string[]) => Promise<Map<string, string>>> = {
  users: (relay, ids) =>
    named(
      relay,
      ids,
      (list) => `SELECT k.discord_user_id AS id,
        COALESCE((SELECT c.display_name FROM conversation c WHERE c.discord_user_id = k.discord_user_id ORDER BY c.message_id DESC LIMIT 1), k.username) AS name
        FROM consents k WHERE k.discord_user_id IN (${list}) AND k.revoked_at IS NULL`,
    ),
  // Discord names @everyone with its @; readers add their own.
  roles: (relay, ids) => named(relay, ids, (list) => `SELECT id, ltrim(name, '@') AS name FROM guild_roles WHERE id IN (${list})`),
  async channels(relay, ids) {
    const readable = new Map((await agentChannels(relay, ANY_AGENT)).filter((c) => c.access.read).map((c) => [c.row.id, c.row.name]));
    // A thread a person named keeps no name (threads.ts), and a private conversation is its members' alone.
    const threads = await named(
      relay,
      ids.filter((id) => !readable.has(id)),
      (list) => `SELECT CAST(id AS TEXT) AS id, name FROM threads
        WHERE id IN (${list}) AND private = 0 AND deleted_at IS NULL AND parent_id IN (SELECT value FROM json_each(?))`,
      [JSON.stringify([...readable.keys()])],
    );
    return new Map([...readable, ...threads]);
  },
};

/**
 * Looks up the tags in all these contents at once (a page, a digest) and returns each content's own `mentions`: undefined
 * for content that tags no one, else only the tags that resolved, so readers show the rest as unknown.
 */
export async function resolveMentions(
  relay: Relay,
  contents: (string | null | undefined)[],
): Promise<(content: string | null | undefined) => Mentions | undefined> {
  const texts = contents.filter((c): c is string => Boolean(c));
  const names = await Promise.all(
    KINDS.map((kind) => {
      const ids = [...new Set(texts.flatMap((c) => tagged(kind, c)))];
      return ids.length ? LOOKUPS[kind](relay, ids) : new Map<string, string>();
    }),
  );
  return (content) => {
    const ids = KINDS.map((kind) => (content ? tagged(kind, content) : []));
    if (!ids.some((list) => list.length)) return undefined;
    const [users, roles, channels] = ids.map((list, i) =>
      Object.fromEntries(list.flatMap((id) => (names[i]!.has(id) ? [[id, { name: names[i]!.get(id)! }]] : []))),
    );
    return { users: users!, roles: roles!, channels: channels! };
  };
}
