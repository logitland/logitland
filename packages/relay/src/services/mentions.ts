import type { Mentions } from '@logitland/contracts';
import { readAll, type Relay } from '../context';
import { accessWith, ANY_AGENT, listChannelsStmt, type ChannelRow } from './channels';

// The names behind Discord's tags in message content (`<@id>`, `<@&id>`, `<#id>`), so readers see names, never a mapping
// the content didn't already carry. People are named only if they agreed through /consent, by the name their messages
// show; channels and threads only if every agent can read them, as Discord names only channels you can see. Everything comes
// from tables the relay keeps; the read path never asks Discord.

const TAGS = { users: /<@!?(\d{17,20})>/g, roles: /<@&(\d{17,20})>/g, channels: /<#(\d{17,20})>/g } as const;

type Kind = keyof typeof TAGS;

const KINDS = Object.keys(TAGS) as Kind[];

const tagged = (kind: Kind, content: string) => [...content.matchAll(TAGS[kind])].map((m) => m[1]!);

type Named = { id: string; name: string | null };

const nameMap = (rows: Named[]) => new Map(rows.flatMap((r) => (r.name ? [[r.id, r.name] as const] : [])));

/** The people among these IDs (a JSON array) who agreed, by the name their latest message shows. */
const usersStmt = (relay: Relay, ids: string) =>
  relay.db
    .prepare(
      `SELECT k.discord_user_id AS id,
        COALESCE((SELECT c.display_name FROM conversation c WHERE c.discord_user_id = k.discord_user_id ORDER BY c.message_id DESC LIMIT 1), k.username) AS name
        FROM consents k WHERE k.discord_user_id IN (SELECT value FROM json_each(?)) AND k.revoked_at IS NULL`,
    )
    .bind(ids);

// Discord names @everyone with its @; readers add their own.
const rolesStmt = (relay: Relay, ids: string) =>
  relay.db.prepare(`SELECT id, ltrim(name, '@') AS name FROM guild_roles WHERE id IN (SELECT value FROM json_each(?))`).bind(ids);

/** The names behind these tags: people, roles, and channels and threads every agent can read. */
async function lookUp(relay: Relay, users: string[], roles: string[], channels: string[]): Promise<Map<string, string>[]> {
  const people = usersStmt(relay, JSON.stringify(users));
  const named = rolesStmt(relay, JSON.stringify(roles));
  if (!channels.length) {
    const [u, r] = await readAll<[Named, Named]>(relay.db, people, named);
    return [nameMap(u), nameMap(r), new Map()];
  }
  const {
    accessOf,
    rows: [u, r, rows],
  } = await accessWith<[Named, Named, ChannelRow]>(relay, people, named, listChannelsStmt(relay));
  const access = accessOf(ANY_AGENT);
  const readable = new Map(rows.filter((row) => access(row).read).map((row) => [row.id, row.name]));
  const rest = channels.filter((id) => !readable.has(id));
  // A thread a person named keeps no name (threads.ts), and a private conversation is its members' alone.
  const threads = rest.length
    ? await relay.db
        .prepare(
          `SELECT CAST(id AS TEXT) AS id, name FROM threads WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
             AND private = 0 AND deleted_at IS NULL AND parent_id IN (SELECT value FROM json_each(?))`,
        )
        .bind(JSON.stringify(rest), JSON.stringify([...readable.keys()]))
        .all<Named>()
    : { results: [] };
  return [nameMap(u), nameMap(r), new Map([...readable, ...nameMap(threads.results)])];
}

/**
 * Looks up the tags in all these contents at once (a page, a digest) and returns each content's own `mentions`: undefined
 * for content that tags no one, else only the tags that resolved, so readers show the rest as unknown. People and roles are
 * read in one round trip, with the channels when there are channel tags; threads, in another.
 */
export async function resolveMentions(
  relay: Relay,
  contents: (string | null | undefined)[],
): Promise<(content: string | null | undefined) => Mentions | undefined> {
  const texts = contents.filter((c): c is string => Boolean(c));
  const [users = [], roles = [], channels = []] = KINDS.map((kind) => [...new Set(texts.flatMap((c) => tagged(kind, c)))]);
  const names = users.length || roles.length || channels.length ? await lookUp(relay, users, roles, channels) : KINDS.map(() => new Map<string, string>());
  return (content) => {
    const ids = KINDS.map((kind) => (content ? tagged(kind, content) : []));
    if (!ids.some((list) => list.length)) return undefined;
    const [users, roles, channels] = ids.map((list, i) =>
      Object.fromEntries(list.flatMap((id) => (names[i]!.has(id) ? [[id, { name: names[i]!.get(id)! }]] : []))),
    );
    return { users: users!, roles: roles!, channels: channels! };
  };
}
