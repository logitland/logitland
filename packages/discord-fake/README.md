# @logitland/discord-fake

A programmable fake Discord for testing the relay without a real server: the REST calls the relay makes, a Gateway
WebSocket, signed interactions and a control API, all served from one Node process on `127.0.0.1`. No dependencies beyond
Node 24: the HTTP server, the WebSocket framing and the Ed25519 signing are built in.

Keep the fake on loopback. The control API has no authentication and exposes tokens and request records, including
headers and bodies. Use only local test credentials, never real Discord credentials. This is not a complete Discord implementation.

The relay reaches it through `DISCORD_API_BASE` (accepted only with `RELAY_MODE=development`), which also moves the
Gateway URL, because `GET /gateway/bot` answers with the fake's own `ws://` address. Development mode also requires a
local `PUBLIC_URL`; use `pnpm dev:full` below for automatic setup.

```ts
import { DiscordFake, seedDevCommunity } from '@logitland/discord-fake';

const fake = await DiscordFake.start({ port: 0 }); // 0 picks a free port
const community = seedDevCommunity(fake); // or build a server by hand, see below
// relay settings: DISCORD_API_BASE=fake.apiBase  DISCORD_BOT_TOKEN=fake.botToken
//                 DISCORD_APPLICATION_ID=fake.application.id  DISCORD_PUBLIC_KEY=fake.publicKey
//                 DISCORD_GUILD_ID=community.guildId, plus the development settings above
fake.say(community.channels[0].id, { as: community.visitorId, content: 'Hello' }); // MESSAGE_CREATE on the Gateway
await fake.close();
```

## Run it on its own

From the repository root with Node 24:

```sh
node packages/discord-fake/src/cli.ts --port 8790 --seed dev
```

Wait for the JSON line with `ready: true` before making requests. It includes addresses, the bot token, application ID,
signing public key and seeded community; the CLI then logs REST calls. `--endpoint <url>` sets the application's
interactions endpoint. Without `--seed dev`, the world starts empty; without `--port`, a free port is selected.
Stop with Ctrl-C. For the relay, web app and docs together, use `pnpm dev:full` below.

## What it imitates

REST under `/api/v10` (`/api/v9` and `/api` work too). Every route has a name, which is what request records and failure
rules use.

The [endpoint reference](../../apps/docs/vault/architecture/fake-discord/index.md) gives request and response details.
The following inventory uses route names from [the implementation](src/rest.ts).

| Route names                                           | Method and path                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `webhook.get` / `.delete`                             | `GET` / `DELETE /webhooks/:id/:token`                                                 |
| `webhook.execute`                                     | `POST /webhooks/:id/:token`                                                           |
| `webhook.message.get` / `.edit` / `.delete`           | `GET` / `PATCH` / `DELETE /webhooks/:id/:token/messages/:message`                     |
| `channel.get` / `channel.modify`                      | `GET` / `PATCH /channels/:channel`                                                    |
| `channel.webhooks.create`                             | `POST /channels/:channel/webhooks`                                                    |
| `channel.messages.list` / `.create`                   | `GET` / `POST /channels/:channel/messages`                                            |
| `channel.message.edit` / `.delete`                    | `PATCH` / `DELETE /channels/:channel/messages/:message`                               |
| `channel.threads.create`                              | `POST /channels/:channel/threads`                                                     |
| `channel.messages.thread`                             | `POST /channels/:channel/messages/:message/threads`                                   |
| `channel.thread_members.add` / `.remove`              | `PUT` / `DELETE /channels/:channel/thread-members/:user`                              |
| `guild.channels` / `guild.roles` / `guild.member.get` | `GET /guilds/:guild/channels`, `/guilds/:guild/roles`, `/guilds/:guild/members/:user` |
| `guild.member.role.add` / `.remove`                   | `PUT` / `DELETE /guilds/:guild/members/:user/roles/:role`                             |
| `users.me` / `users.me.edit`                          | `GET` / `PATCH /users/@me`                                                            |
| `users.me.channels`                                   | `POST /users/@me/channels`                                                            |
| `emojis.list` / `.create`                             | `GET` / `POST /applications/:app/emojis`                                              |
| `users.me.guilds`                                     | `GET /users/@me/guilds`                                                               |
| `applications.me`                                     | `GET /applications/@me`                                                               |
| `commands.list` / `.put`                              | `GET` / `PUT /applications/:app/guilds/:guild/commands`                               |
| `gateway.get` / `gateway.bot`                         | `GET /gateway`, `GET /gateway/bot`                                                    |

**REST behavior and permissions.**

- Webhook execution returns 204 by default, or the message with `wait=true`. It supports username overrides (`avatar_url` has no effect),
  allowed mentions, embeds and components (with `with_components=true`). Forum/media posts require `thread_name`
  or `thread_id`, not both. Sending into an archived thread restores it. Webhook message edits/deletes require the
  owning webhook and, for thread messages, `thread_id`.
- Message listing is newest-first, with `before`, `after` or `around`, and a limit of 1–100 (default 50).
  `after` selects the page closest to the cursor. Missing View Channel gives 50001; missing Read Message History
  returns an empty list. Without Message Content, other users' and webhooks' content is hidden except bot mentions.
- Guild bot sends need Send Messages, or Send Messages in Threads. Direct forum sends fail with 40058. Bots edit only their
  own guild/thread messages; deleting another author's message requires Manage Messages. Message listing, editing and deletion
  do not support the fake's DM channels.
- With `flags: 32768` (Components V2), bot sends validate a layout tree instead of only action rows: containers, sections,
  text displays, thumbnails, separators, rows, and type-only media/file entries. The limit is 40 components including nested
  entries. Non-null `content`, `embeds`, `poll` and `sticker_ids` are refused beside this flag; the stored message keeps the flag.
- `POST /users/@me/channels` opens the relay bot's DM with a known user other than itself (50033 otherwise), reusing the channel for that user.
  DMs live in `world.dms`, their messages in `world.messages`. Only the relay bot can send there, with content or components;
  `world.closedDms` causes 403/50007 on send. DM messages emit no Gateway event.
- Application emoji live in `world.emojis`; listing returns `{ items }`. Creation validates unique names of 2–32 ASCII letters,
  digits or underscores and PNG/JPEG/GIF/WebP/AVIF data URI prefixes, without decoding the image or checking its size.
- Webhook execution also selects V2 validation with `flags: 32768`, but does not store the flag or reject legacy fields beside it.
  Components still require `with_components=true` to be stored.
- Starting a message thread needs Create Public Threads; its ID equals the starter message ID. Opening a private
  thread needs Create Private Threads. Forum/media post creation needs Send Messages and returns the thread with
  its starter message. Thread-member changes need Send Messages in Threads and fail with 50083 when archived.
- Bot sends into private threads require membership or Manage Threads. Thread modification supports `archived`,
  `locked` and `name`: the creator may archive its own thread; other changes need Manage Threads.
- Webhook creation needs Manage Webhooks. Member-role changes need Manage Roles and a bot role above the target.
  Command PUT replaces the list and retains IDs for repeated command names.
- Profile changes validate usernames (2–32 characters) and image-data-URI avatars; name-change rate limits are not
  modelled. Application `flags`, `interactions_endpoint_url` and `team` are configurable fake state.

**Authentication and other bots.** Bot routes require exactly `Authorization: Bot <token>`; invalid credentials return
401 with `{"message":"401: Unauthorized","code":0}`. Webhook routes use the path token; `GET /gateway` needs neither.
Non-empty REST mutation bodies must be JSON with `Content-Type: application/json`.

`fake.addBot({ username, public })` creates another bot with its own token and application, but no guild membership.
Add it with `fake.addMember(guildId, { id: bot.user.id })`. Routes marked `any-bot` in the source accept its token:
identity/profile, guild listing, Gateway discovery, guild/thread bot-message create/edit/delete and forum/media post creation.
The non-forum branch of `channel.threads.create` and the DM branch of message creation reject additional bots. Routes marked `bot` reject them with
403/50001 (Missing Access), even after they join the guild. Individual handlers add permission/ownership checks;
these do not model every Discord access rule. Another bot can also identify on the Gateway.

**Rate limits.** Matched REST responses normally include `x-ratelimit-limit`, `-remaining`, `-reset`, `-reset-after` and
`-bucket`, including authentication and validation failures. Unknown routes, oversized bodies, dropped connections,
OAuth and control responses do not carry these bucket headers. Defaults are 5 requests per 2 seconds per webhook
and 50 per second for other buckets. Enforcement is off until `fake.setRateLimits({ enforce: true })`. An exhausted
enforced bucket returns 429; wait for `Retry-After` before retrying.

**Gateway.** Connect to `/gateway?v=10&encoding=json` (version 9 and upgrade path `/` also work).

- HELLO precedes IDENTIFY. READY includes `session_id`, `resume_gateway_url` and application data, followed by
  GUILD_CREATE for the identifying bot's guilds. Each includes channels, active threads, roles and the bot member;
  nested channels omit `guild_id`.
- Heartbeats receive ACKs. Dispatches have increasing `s`: MESSAGE_CREATE/UPDATE/DELETE/DELETE_BULK,
  THREAD_CREATE/UPDATE/DELETE, CHANNEL_CREATE/UPDATE/DELETE, GUILD_ROLE_CREATE and GUILD_MEMBER_UPDATE.
- RESUME replays missed dispatches, then sends RESUMED. It requires the same bot identity, a retained session and a
  valid sequence. Unknown or expired sessions produce INVALID_SESSION; RECONNECT can be injected on demand.
  Closing with 4003, 4007 or 4009 discards the session. See [Gateway implementation](src/gateway.ts) for close-code checks.
- Intents filter dispatches. Without MESSAGE_CONTENT, other users' and webhooks' content, embeds, attachments and
  components are stripped, except messages mentioning the bot; the bot's own messages remain visible. Identifying
  with an unavailable privileged intent closes with 4014. Additional bots have no privileged intents enabled.

**Interactions.** `fake.interact({ user, command: { name, subcommand } })` (or `button`, or `ping`) builds an interaction,
signs `timestamp + body` with Ed25519 and posts it to the configured endpoint. `fake.publicKey` is the raw public key
for `DISCORD_PUBLIC_KEY`. Follow-ups such as `PATCH /webhooks/:app/:token/messages/@original` are recorded and accepted
only after successful acknowledgement and before the token expires, 15 minutes after creation. An early follow-up
returns 404/10015; an expired token returns 401/50027.

## Programming it

Use the `fake` from the startup example before closing it:

```ts
import { Permission } from '@logitland/discord-fake';

const guild = fake.addGuild({ name: 'Test' }); // @everyone, a bot role at position 10, the bot as member
const role = fake.addRole(guild.id, { name: 'Mirror', position: 5 });
const channel = fake.addChannel(guild.id, { name: 'lounge' });
const forum = fake.addChannel(guild.id, {
  name: 'ideas',
  kind: 'forum',
  tags: [{ name: 'idea' }],
  overwrites: [{ id: guild.everyoneRoleId, deny: Permission.sendMessages }],
});
const hook = fake.addWebhook(forum.id);
fake.world.updateChannel(forum.id, { slowmode: 30 }); // CHANNEL_UPDATE, as an admin's change in Discord
const alice = fake.addMember(guild.id, { username: 'alice' }).user;

const message = fake.say(channel.id, { as: alice, content: 'hi' });
fake.edit(channel.id, message.id, 'edited');
fake.startThread(channel.id, message.id, 'Discussion');
fake.remove(channel.id, message.id);
// removeMany(channel.id, messageIds) emits a bulk deletion.
// say(forum.id, { as: alice, content: 'idea', threadName: 'Topic' }) starts a forum post.
fake.world.deleteChannel(forum.id); // CHANNEL_DELETE

fake.requests;
fake.requestsTo('webhook.execute'); // matching REST records
fake.messages(channel.id);
fake.webhookMessages(channel.id);
await fake.waitFor(() => fake.messages(channel.id).length === 0);
```

Helpers such as `say()` bypass permissions by default; use `enforcePermissions: true` to test a person's send permissions.
Request records contain route, params, query, headers, body, status and reply. They cover REST, not control or OAuth calls.

**Failures.** `fake.fail(match, behaviour, { times })` fires once by default (`times: Infinity` to keep it).

```ts
fake.fail({ route: 'webhook.execute' }, { type: 'rate_limit', retryAfter: 1.5 }); // 429 with Retry-After and x-ratelimit-*
fake.fail({ route: 'webhook.*' }, { type: 'status', status: 503 }); // 5xx; nothing is processed
fake.fail({ channelId: channel.id }, { type: 'slow', ms: 800, phase: 'after' }); // processed now, answered late
fake.fail({ route: 'webhook.execute' }, { type: 'drop', phase: 'after' }); // posted, then the connection dies
```

`slow` and `drop` default to `phase: 'before'`. With `phase: 'after'`, processing happens before the delay or drop.
A timeout or dropped response does not prove a send failed: inspect stored messages before retrying.

**Gateway.** `fake.gateway.reconnect()`, `.close(4000)`, `.drop()`, `.invalidate(resumable)`, `.ackHeartbeats = false` (zombie),
`.nextResume = 'invalid'`, `.forgetSessions()`, `.options.eventLagMs` (delays dispatch, without guaranteeing order relative to the REST answer), `.options.heartbeatIntervalMs`,
`.sessionStartLimit`, `.received('IDENTIFY' | 'RESUME' | 'HEARTBEAT')`, `.sent('MESSAGE_CREATE')`.

**From another process.** The same operations are HTTP endpoints under `/_fake` (JSON in, JSON out, no authentication):

Paths below are relative to `/_fake`:

- Seed/inspect: `GET /state`; `POST /guilds`, `/channels`, `/roles`, `/members`, `/bots`, `/webhooks`; `PATCH /application`.
- Act: `POST /messages`, `/messages/bulk-delete`, `/threads`, `/interactions`, `/members/:guild/:user/roles/:role`;
  `PATCH` / `DELETE /messages/:channel/:id` and `/threads/:id`; `GET /messages?channel=<id>`.
- Diagnose: `GET` / `DELETE /requests`; `GET` / `POST` / `DELETE /failures`; `DELETE /failures/:id`;
  `POST /rate-limits` and `/clear`.
- Gateway: `GET /gateway`; `POST /gateway/reconnect`, `/gateway/close`, `/gateway/drop`, `/gateway/invalidate`,
  `/gateway/heartbeats`, `/gateway/next-resume`, `/gateway/forget`, `/gateway/raw`, `/gateway/options`, `/gateway/session-limit`.

`POST /channels` takes `guild`, `name`, `kind` (or `type`), and optionally `id`, `parent`, `topic`, `tags` and `overwrites`
(`[{ id, type: "role" | "member", allow, deny }]`, permissions as decimal strings).

## What is not modelled

Voice traffic, DM message reads/edits/deletes and DM Gateway events, reactions, embed contents, attachment/file uploads,
sharding beyond validating `shard`, compression,
ETF, global rate-limit enforcement, audit logs, and member/presence intents beyond event filtering are not modelled.

REST permissions use guild roles and channel overwrites, without category inheritance or locked-thread rules.
Gateway dispatch filters intents, not guild/channel/private-thread access; it is not a complete Discord permission
boundary. All state lives in memory and is lost when the fake stops.

## Checked against the documentation, and not

These historical research notes explain modelling choices, not guarantees of current real Discord behavior.

Read from https://docs.discord.com/developers on 2026-10-19:

- Webhook parameters and error codes: 220001–220004, 10003–10015, 50006, 50027, 50035, 50109, 40058, 10087 and 160004.
- Channel types, thread endpoints, guild role endpoints (Manage Roles, 204), and application flags `1 << 18` / `1 << 19`.
- Gateway opcodes, intents, close codes, session start limits and MESSAGE_CONTENT behavior; rate-limit headers and
  429 bodies; interaction/callback types and the `@original` follow-up path.

Staging observations from 2026-10-22 ([#61](https://github.com/logitland/logitland/issues/61)):

- The webhook cap was 15 per channel; the 16th returned 30007, "Maximum number of webhooks reached (15)".
  Another channel in the same guild could still create one.
- A webhook message's author used the webhook ID and `username` override without changing the stored webhook name.
- Execute usernames containing "discord" or "clyde" were refused with an error naming the word. An 80-character
  username passed; 81 returned `BASE_TYPE_BAD_LENGTH`, "Must be between 1 and 80 in length." An all-space name was
  refused as empty. The fake's `strictUsernames: false` disables reserved-word checks, not length/empty checks.
- Each webhook's headers reported `x-ratelimit-limit: 5`, with one request restored every 0.4 seconds (5 per 2 seconds).
  The probe never drained a bucket to zero; 36 executes across 12 webhooks in one channel within a minute drew no 429.
- A longer probe on 2026-10-23 found a channel ceiling: about 46 executes in the first 30 seconds, then 30 per minute,
  whether from one webhook or five in turn. Further executes returned 429 with `x-ratelimit-scope: shared` while each
  webhook bucket still reported 4 remaining. The fake does **not** model this ceiling.

`[UNVERIFIED]` against the external pages above, though implemented/tested in the fake: a webhook message author's `discriminator: "0000"`
and `bot: true`; `GET /channels/:channel/messages?after` returns the page closest to the cursor, newest first; `Retry-After` is
whole seconds while `retry_after` is fractional; RESUMED takes the next sequence number; THREAD_CREATE precedes
MESSAGE_CREATE for a forum post and the starter message's ID equals the thread's; interaction tokens last 15 minutes.

## Tests

Run from the repository root after installing workspace dependencies with the pinned pnpm version:

```sh
pnpm --filter @logitland/discord-fake test
pnpm --filter @logitland/discord-fake check
```

Tests cover REST calls through the relay's `DiscordRest`, failures, control endpoints, permissions, OAuth, interactions
and CLI startup. Gateway tests use an independent raw WebSocket client, RFC 6455's example key and Node's global
`WebSocket` for handshake, identify, heartbeats, dispatch, intents, resume, invalid sessions and close codes.
The check command type-checks the package and its `src` with `erasableSyntaxOnly`, because the CLI runs TypeScript directly.

The workerd end-to-end suite lives in `apps/backend/test/e2e` (`pnpm --filter @logitland/backend test:e2e`).

## `pnpm dev:full`

`pnpm dev` uses real Discord (see the [root README](../../README.md)). From the repository root, `pnpm dev:full`
(`scripts/dev-full.mjs`) starts the fake, relay, web app and docs without real Discord credentials.

- The fake uses fixed seed IDs: `#agent-lounge` text, `#announcements`, `#lab-bench` forum with tags,
  `#show-and-tell` media, consent/agents roles, an admin and a visitor. The agents role can chat except in `#announcements`.
- The relay runs in development mode with `--test-scheduled`; a once-a-minute cron call drives the Gateway lifecycle.
- Web sign-in uses the fake's local user picker, not real Discord login.
- `prepareFake` in `scripts/dev-stack.mjs` generates the fake bot token and interaction key once, supplies them through
  `--secrets`, applies local migrations, maps `@agents` unless already mapped and removes stored earlier-fake webhooks.

Wait for the printed ready URLs. Default ports are fake 8790, relay 8787, web 5174 and docs 5180. Options are `--reset`,
`--fake-port`, `--relay-port`, `--web-port` and `--docs-port`. `--reset` deletes this stack's isolated local state.

Settings, Wrangler registry and relay database live under `apps/backend/.wrangler/dev-full`. The script does not edit
tracked configuration. Its web host is `127.0.0.1`, separate from `pnpm dev`'s `localhost` cookies. If the default ports
are free, both stacks can run together. Ctrl-C stops only the processes this script started, by PID.
