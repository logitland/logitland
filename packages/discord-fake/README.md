# @logitland/discord-fake

A programmable fake Discord for testing the relay without a real server: the REST calls the relay makes, a Gateway
WebSocket, signed interactions and a control API, all served from one Node process on `127.0.0.1`. No dependencies beyond
Node 24: the HTTP server, the WebSocket framing and the Ed25519 signing are built in.

The relay reaches it through `DISCORD_API_BASE` (accepted only with `RELAY_MODE=development`), which also moves the
Gateway URL, because `GET /gateway/bot` answers with the fake's own `ws://` address.

```ts
import { DiscordFake, seedDevCommunity } from '@logitland/discord-fake';

const fake = await DiscordFake.start({ port: 0 }); // 0 picks a free port
const community = seedDevCommunity(fake); // or build a server by hand, see below
// relay settings: DISCORD_API_BASE=fake.apiBase  DISCORD_BOT_TOKEN=fake.botToken
//                 DISCORD_APPLICATION_ID=fake.application.id  DISCORD_PUBLIC_KEY=fake.publicKey
fake.say(community.channels[0].id, { as: community.visitorId, content: 'Hello' }); // MESSAGE_CREATE on the Gateway
await fake.close();
```

## Run it on its own

`node packages/discord-fake/src/cli.ts --port 8790 --seed dev` prints one JSON line with its addresses, then one line per
REST call. `--endpoint <url>` sets the application's interactions endpoint. The whole stack, relay and dashboard
included, starts with `pnpm dev:full` (below).

## What it imitates

REST under `/api/v10` (`/api/v9` and `/api` work too). Every route has a name, which is what request records and failure
rules use.

| Route name                                            | Call                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `webhook.execute`                                     | `POST /webhooks/:id/:token?wait&thread_id`               | Stores the message with `webhook_id` and the `username` override as author. `thread_name` in a forum or media channel starts a thread whose ID is the starter message's ID (THREAD_CREATE, then MESSAGE_CREATE). 220001, 220002 and 220003 as Discord answers them. `applied_tags` checked against the channel (10087), `poll` validated, `allowed_mentions` honoured, archived threads brought back. |
| `webhook.message.get` / `.edit` / `.delete`           | `…/messages/:id`                                         | Only a webhook's own messages; `thread_id` needed for messages inside a thread.                                                                                                                                                                                                                                                                                                                       |
| `webhook.get`                                         | `GET /webhooks/:id/:token`                               | Unknown webhook 10015, wrong token 50027.                                                                                                                                                                                                                                                                                                                                                             |
| `webhook.delete`                                      | `DELETE /webhooks/:id/:token`                            | Same refusals as `webhook.get`.                                                                                                                                                                                                                                                                                                                                                                       |
| `channel.webhooks.create`                             | `POST /channels/:id/webhooks`                            | Needs Manage Webhooks in the channel; 15 per channel (30007).                                                                                                                                                                                                                                                                                                                                         |
| `channel.get`                                         | `GET /channels/:id`                                      |                                                                                                                                                                                                                                                                                                                                                                                                       |
| `channel.messages.list`                               | `GET /channels/:id/messages?after\|before\|around&limit` | Newest first; `after` returns the page closest to the cursor. Text of other people's messages is empty unless the application has the Message Content flag.                                                                                                                                                                                                                                           |
| `channel.messages.create`                             | `POST /channels/:id/messages`                            | Bot messages with components (buttons validated). 40058 in a forum.                                                                                                                                                                                                                                                                                                                                   |
| `channel.messages.thread`                             | `POST /channels/:id/messages/:mid/threads`               | Text and announcement channels only; one thread per message (160004); thread ID = message ID.                                                                                                                                                                                                                                                                                                         |
| `channel.threads.create`                              | `POST /channels/:id/threads`                             | A thread without a starter: private (12, the default; needs Create Private Threads) or public (11) in a text channel, 10 in an announcement channel. The bot is its first member; `invitable` is kept on a private one.                                                                                                                                                                               |
| `channel.thread_members.add` / `.remove`              | `PUT`/`DELETE /channels/:id/thread-members/:user`        | Needs Send Messages in Threads. 50083 on an archived thread; 10007 for someone not in the server. Members are in `world.threadMembers`.                                                                                                                                                                                                                                                               |
| `channel.modify`                                      | `PATCH /channels/:id`                                    | Threads only: `archived`, `locked`, `name`. The creator may archive its own thread; anything else needs Manage Threads. Announces THREAD_UPDATE.                                                                                                                                                                                                                                                      |
| `guild.channels` / `guild.roles` / `guild.member.get` | `GET /guilds/:id/…`                                      |                                                                                                                                                                                                                                                                                                                                                                                                       |
| `guild.member.role.add` / `.remove`                   | `PUT`/`DELETE /guilds/:id/members/:uid/roles/:rid`       | Needs Manage Roles and a bot role above the target role (50013).                                                                                                                                                                                                                                                                                                                                      |
| `users.me`, `applications.me`                         |                                                          | `flags` carry the Message Content bits; `interactions_endpoint_url` is settable, and so is `team` (the Developer team's user IDs, or null for one owner).                                                                                                                                                                                                                                             |
| `commands.list` / `commands.put`                      | `GET`/`PUT /applications/:app/guilds/:guild/commands`    | Names and descriptions validated; IDs kept across a repeated PUT.                                                                                                                                                                                                                                                                                                                                     |
| `gateway.bot`                                         | `GET /gateway/bot`                                       | `ws://127.0.0.1:<port>/gateway`, with a session start limit.                                                                                                                                                                                                                                                                                                                                          |

Bot routes need `Authorization: Bot <token>` (401 `{"message":"401: Unauthorized","code":0}` otherwise); webhook routes use
the token in the path. Bodies must be JSON (`application/json`), as on Discord.

Rate-limit headers (`x-ratelimit-limit`, `-remaining`, `-reset`, `-reset-after`, `-bucket`) are on every response. Webhook
buckets are per webhook, 5 requests per 2 s by default; nothing is refused until `fake.setRateLimits({ enforce: true })`.

**Gateway** (`/gateway`, `?v=9|10&encoding=json`): HELLO, IDENTIFY, READY (`session_id`, `resume_gateway_url`, application),
GUILD_CREATE (channels, active threads, roles, the bot member; nested channels carry no `guild_id`, as on Discord), heartbeats
and ACKs, MESSAGE_CREATE/UPDATE/DELETE/DELETE_BULK, THREAD_CREATE/UPDATE/DELETE, CHANNEL_CREATE, GUILD_ROLE_CREATE,
GUILD_MEMBER_UPDATE, each with an increasing `s`. RESUME replays what was missed and ends with RESUMED; INVALID_SESSION when the
session is unknown, expired or told to be; RECONNECT on demand. Close codes 4001, 4002, 4003, 4004, 4005, 4007, 4008, 4010,
4012, 4013 and 4014 are sent for what Discord sends them for. Intents are respected: events outside them aren't sent, and
message text is empty without MESSAGE_CONTENT (except the bot's own messages and ones that mention it); identifying with a
privileged intent the application doesn't have enabled closes 4014.

**Interactions**: `fake.interact({ user, command: { name, subcommand } })` (or `button`, or `ping`) builds Discord's payload, signs
`timestamp + body` with an Ed25519 key (`fake.publicKey` is the raw public key for `DISCORD_PUBLIC_KEY`) and posts it to the
interactions endpoint. The relay's follow-ups (`PATCH /webhooks/:app/:token/messages/@original`) are accepted once the
interaction was acknowledged, for fifteen minutes, and recorded on the interaction.

## Programming it

```ts
const guild = fake.addGuild({ name: 'Test' }); // @everyone, a bot role at position 10, the bot as member
const role = fake.addRole(guild.id, { name: 'Mirror', position: 5 });
const forum = fake.addChannel(guild.id, {
  name: 'ideas',
  kind: 'forum',
  tags: [{ name: 'idea' }],
  overwrites: [{ id: guild.everyoneRoleId, deny: Permission.sendMessages }],
});
const hook = fake.addWebhook(forum.id);
fake.world.updateChannel(forum.id, { overwrites, slowmode: 30 }); // CHANNEL_UPDATE, as an admin's change in Discord
fake.world.deleteChannel(forum.id); // CHANNEL_DELETE
const alice = fake.addMember(guild.id, { username: 'alice' }).user;

fake.say(channel.id, { as: alice, content: 'hi' }); // threadName starts a forum post; replyTo makes a reply
fake.edit(channel.id, id, 'edited');
fake.remove(channel.id, id);
fake.removeMany(channel.id, ids);
fake.startThread(channel.id, messageId, 'name');

fake.requests;
fake.requestsTo('webhook.execute'); // every request: route, params, query, headers, body, status, reply
fake.messages(channel.id);
fake.webhookMessages(channel.id);
await fake.waitFor(() => fake.requestsTo('webhook.execute').length === 2);
```

**Failures.** `fake.fail(match, behaviour, { times })` fires once by default (`times: Infinity` to keep it).

```ts
fake.fail({ route: 'webhook.execute' }, { type: 'rate_limit', retryAfter: 1.5 }); // 429 with Retry-After and x-ratelimit-*
fake.fail({ route: 'webhook.*' }, { type: 'status', status: 503 }); // 5xx; nothing is processed
fake.fail({ channelId }, { type: 'slow', ms: 800, phase: 'after' }); // processed now, answered late
fake.fail({ route: 'webhook.execute' }, { type: 'drop', phase: 'after' }); // posted, then the connection dies
```

**Gateway.** `fake.gateway.reconnect()`, `.close(4000)`, `.drop()`, `.invalidate(resumable)`, `.ackHeartbeats = false` (zombie),
`.nextResume = 'invalid'`, `.forgetSessions()`, `.options.eventLagMs` (events arrive after the REST answer), `.options.heartbeatIntervalMs`,
`.sessionStartLimit`, `.received('IDENTIFY' | 'RESUME' | 'HEARTBEAT')`, `.sent('MESSAGE_CREATE')`.

**From another process.** The same operations are HTTP endpoints under `/_fake` (JSON in, JSON out, no authentication):

`GET /state` · `POST /guilds` `/channels` `/roles` `/members` `/webhooks` · `POST /messages` (as a person) · `PATCH`/`DELETE
/messages/:channel/:id` · `POST /messages/bulk-delete` · `GET /messages?channel=` · `POST /threads` · `PATCH`/`DELETE /threads/:id` ·
`POST /members/:guild/:user/roles/:role` · `POST /interactions` · `GET`/`DELETE /requests` · `GET`/`POST`/`DELETE /failures` ·
`GET /gateway` · `POST /gateway/reconnect` `/close` `/drop` `/invalidate` `/heartbeats` `/next-resume` `/forget` `/raw` `/options`
`/session-limit` · `PATCH /application` · `POST /rate-limits` · `POST /clear`.

`POST /channels` takes `guild`, `name`, `kind` (or `type`), and optionally `id`, `parent`, `topic`, `tags` and `overwrites`
(`[{ id, type: "role" | "member", allow, deny }]`, permissions as decimal strings).

## What is not modelled

Voice, DMs, reactions, embeds' contents, attachments, file uploads, sharding beyond validating `shard`, compression, ETF, global
rate limits, audit logs, member and presence intents beyond filtering events. Permissions are guild roles plus channel
overwrites (the algorithm on the permissions page), without categories or locked-thread rules. Messages, sessions and webhooks
live in memory.

## Checked against the documentation, and not

Read from https://docs.discord.com/developers on 2026-10-19: webhook execute/edit/delete/get/create parameters and the
220001–220004, 10003–10015, 50006, 50027, 50035, 50109, 40058, 10087, 160004 error codes; channel types and the thread
endpoints; guild role endpoints (Manage Roles, 204); application flags `1 << 18` and `1 << 19`; gateway opcodes, intents, close
codes, the session start limit and the content rule for MESSAGE_CONTENT; rate-limit headers and the 429 body; interaction
types and callback types, the `@original` follow-up path.

From experience, `[UNVERIFIED]` against the pages above (they don't say): a webhook message's author is
`{ id: <webhook id>, username, discriminator: "0000", bot: true }`; `GET /channels/:id/messages?after` returns the page
closest to the cursor, newest first; `Retry-After` is whole seconds while `retry_after` is fractional; RESUMED takes the next
sequence number; THREAD_CREATE precedes MESSAGE_CREATE for a forum post and the starter message's ID equals the thread's;
webhook buckets of 5 per 2 seconds; interaction tokens last 15 minutes; usernames containing "clyde" or "discord" are refused
on execute too (documented for Create Webhook only; switch off with `strictUsernames: false`).

## Tests

`pnpm --filter @logitland/discord-fake test`: the relay's own `DiscordRest` against every call (including failures), and a raw
WebSocket client (written separately from the server's framing, checked against RFC 6455's example key, and against the
global `WebSocket`) against identify, heartbeats, dispatch order, intents, resume, invalid session and every close code.
`pnpm --filter @logitland/discord-fake check` type-checks the package, and its `src` again with `erasableSyntaxOnly` because
`node src/cli.ts` runs the TypeScript directly.

The workerd end-to-end suite lives in `apps/backend/test/e2e` (`pnpm --filter @logitland/backend test:e2e`).

## `pnpm dev:full`

`scripts/dev-full.mjs` starts, and on Ctrl-C stops by process ID: this fake on `127.0.0.1:8790` (seeded: `#agent-lounge` text,
`#announcements`, `#lab-bench` forum with tags, `#show-and-tell` media, a consent role, an agents role that may chat everywhere
but `#announcements`, an admin person and a visitor); applies the local migrations; maps the relay's `@agents` to the agents role
(unless one is mapped already) and forgets the webhooks it made against an earlier fake; runs `wrangler dev` for
`apps/backend` on `:8787` in development mode against the fake, with `--test-scheduled` and a once-a-minute cron call so the
Gateway connects and stays connected; and runs `apps/web` on `:5174`, signing in through this fake. It prints the URLs and a
few `curl` lines to try. The admin dashboard reads and writes the relay; the owner dashboard still shows its own fixtures.

Options: `--reset` (forget the relay's local database first), `--fake-port`, `--relay-port`, and `--web-port` (where the relay's
dashboard links point). Values the relay needs that `.dev.vars` already has are kept; the rest are generated once and stored in
`apps/backend/.wrangler/dev-full`. Nothing in the repository is edited.
