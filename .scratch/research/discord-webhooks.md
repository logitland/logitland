# Discord webhook behaviour

Research date: **2026-10-20**. Answers issue [#8](https://github.com/logitsml/swarmcord/issues/8).
Sources are Discord's own docs at [docs.discord.com/developers](https://docs.discord.com/developers). Each page was read from its source file in
[discord/discord-api-docs](https://github.com/discord/discord-api-docs) at commit
[`fd75e22`](https://github.com/discord/discord-api-docs/tree/fd75e22e8c327f60c3ceaa366878c8b223043142) (2026-10-19), so the text is exact.
The repo comparison reads `origin/monorepo` at `674aff1`. No Discord call was made.

Labels: **verified** is stated by Discord's docs; **inferred** follows from them; **unknown** is not documented.

## Answer in brief

- One webhook per channel serves every agent: `username` and `avatar_url` are per message. **Verified.**
- A webhook is bound to one channel and posts only into that channel and its threads and forum posts. Another channel needs another webhook. **Verified** that `thread_id` is "within a webhook's channel"; **inferred** that no other channel is reachable.
- Discord caps webhooks at **15** (error 30007). A channel-per-webhook design is far below it. The cap's scope (channel or guild) is not documented. **Verified** number, **unknown** scope.
- Posting needs only the webhook URL. Creating, listing, deleting and moving webhooks need `MANAGE_WEBHOOKS`. Reading needs `VIEW_CHANNEL`, `READ_MESSAGE_HISTORY` and the Message Content intent.
- **New channels:** the Gateway sends `CHANNEL_CREATE`, but from **2026-11-16** a bot that cannot view a channel gets only an obfuscated copy (name `___hidden___`) and `GET /guilds/{id}/channels` omits it. The relay must check the new `CHANNEL_OBFUSCATED` flag.
- Execution rate limits are not documented. Read the headers, as the relay already does.

## 1. Binding, threads, forum posts, moving

| Finding | Label | Source |
| --- | --- | --- |
| A webhook object has one nullable `channel_id` ("the channel id this webhook is for"). | verified | [Webhook structure](https://docs.discord.com/developers/resources/webhook#webhook-object-webhook-structure) |
| `thread_id` (query): "Send a message to the specified thread within a webhook's channel. The thread will automatically be unarchived." | verified | [Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook) |
| Forum or media channel: the post needs `thread_id` (existing post) or `thread_name` (creates one). `applied_tags` also requires a forum or media channel. | verified | same |
| Error 220001 (neither), 220002 (both), 220003 "Webhooks can only create threads in forum channels", 220004 "Webhook services cannot be used in forum channels". | verified | [JSON error codes](https://docs.discord.com/developers/topics/opcodes-and-status-codes) |
| A webhook cannot start a thread in a text or announcement channel; a bot starts it from a message (`POST /channels/{id}/messages/{id}/threads`, one per message; not for forum or media). | verified (220003 plus the thread route) | [Start Thread from Message](https://docs.discord.com/developers/resources/channel) |
| Locked thread: only `MANAGE_THREADS` can unarchive it (verified); a webhook post there is refused with 160005 "Thread is locked" or 50083 (error codes are verified, the link to webhook posts is inferred). Ordinary archived threads unarchive on post. | verified / inferred | [Threads](https://docs.discord.com/developers/topics/threads) |
| `PATCH /webhooks/{id}` accepts `channel_id` ("the new channel id this webhook should be moved to"), needs `MANAGE_WEBHOOKS`, fires `WEBHOOKS_UPDATE`. The token form `PATCH /webhooks/{id}/{token}` does not accept `channel_id`. | verified | [Modify Webhook](https://docs.discord.com/developers/resources/webhook#modify-webhook) |
| Which permission the bot needs in the destination channel, and whether a thread or forum channel is a valid target, is not stated. | unknown | |
| Moving is unsafe for the relay: its `channels.webhook_id` maps one webhook to one channel, and intake classifies `MESSAGE_CREATE` by `webhook_id === channel.webhook_id`. After a move, old messages in the old channel keep the same `webhook_id`, so they would read as the new channel's agent posts or as foreign. A webhook per channel needs no move. | inferred | repo (section 7) |

Recommendation: create one webhook per relayed channel, never move one.

## 2. `username` and `avatar_url`

- `username` "override the default username of the webhook"; `avatar_url` "override the default avatar of the webhook". Both are per call. **Verified** ([Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook)).
- The docs give no length limit, forbidden substrings or rate limit for the override. The only name rules on the webhook page are for *Create Webhook*: 1 to 80 characters, no `clyde` or `discord` (case-insensitive), nickname guidelines. **Verified** for the default name; the override obeying the same rules is **inferred** and not stated, so the length and substring limits for overrides are **unknown**.
- General username rules (2 to 32 characters, no `@ # : ``` discord`, not `everyone` or `here`) are for user accounts and are not documented to apply to overrides. **Verified** text, applicability **unknown**. A name such as "Discord Helper" for an agent must be treated as possibly refused or rewritten until tested on a scratch webhook.
- `avatar_url` is a URL Discord fetches. Whether Discord caches it, how long, and what happens on a dead URL is **unknown**. Treat avatar URLs as permanent and immutable (new URL when the image changes).
- Mention safety: `allowed_mentions` controls parsing; in webhooks "only user mentions are parsed" by default ([Message](https://docs.discord.com/developers/resources/message), allowed mentions). **Verified.**

## 3. Limits

| Limit | Value | Label | Source |
| --- | --- | --- | --- |
| Webhooks | Error 30007 "Maximum number of webhooks reached (15)". Scope (per channel or per guild) is not stated; the number is. | verified (15), unknown (scope) | [error codes](https://docs.discord.com/developers/topics/opcodes-and-status-codes) |
| `content` | up to 2000 characters | verified | [Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook) |
| Embeds | up to 10 per message; 6000 characters across all embed text; title 256, description 4096 | verified | [Message](https://docs.discord.com/developers/resources/message) |
| Webhook `flags` | only `SUPPRESS_EMBEDS`, `SUPPRESS_NOTIFICATIONS`, `IS_COMPONENTS_V2` can be set | verified | Execute Webhook |
| `IS_COMPONENTS_V2` | the message can then carry only `components`; `content`, `embeds`, files, `poll` return 400 | verified | Execute Webhook |
| Components | non-application-owned webhooks ignore `components` unless `with_components=true`, and then only non-interactive ones | verified | Execute Webhook |
| Files | 20 MiB since 2026-09-03 (users, bots, webhooks, interaction responses) | verified | [Changelog](https://docs.discord.com/developers/change-log) (September 3, 2026) |
| Global rate limit | 50 requests per second per bot; with no `Authorization` header the limit applies to the **IP address** | verified | [Rate limits](https://docs.discord.com/developers/topics/rate-limits#global-rate-limit) |
| Per-route limits | not published; read `X-RateLimit-*` headers. Top-level resources are `channel_id`, `guild_id`, and `webhook_id` or `webhook_id + webhook_token`. | verified | Rate limits |
| Execute Webhook limit (per webhook, per channel) | **not documented anywhere** in the rate-limit page, the webhook page or the changelog | unknown | |
| Invalid requests | 10,000 per 10 minutes (401, 403, 429; shared-scope 429s excluded) before a Cloudflare ban. A webhook that returns 404 must not be used again. | verified | Rate limits |
| 429 | rely on `Retry-After` or `retry_after`; do not call an exhausted bucket before reset | verified | Rate limits |

Inference: webhook executions carry no bot token, so they are counted against the relay's egress **IP** in the global limit and the 10,000-invalid-request limit. On Cloudflare Workers the egress IP is shared with other tenants. Both limits are exposed through headers and 429s, which `readRateLimit` already parses.

`wait=true` returns the saved message (default `false`, and then "a message that is not saved does not return an error"). Execute Webhook has no nonce or idempotency key. **Verified.**

## 4. Bot permissions

| Action | Needs | Label | Source |
| --- | --- | --- | --- |
| Create, modify, delete a webhook; list channel and guild webhooks; Get Webhook by ID | `MANAGE_WEBHOOKS` (bit 29). Get Webhook is exempt when the application owns the webhook. | verified | [Webhook](https://docs.discord.com/developers/resources/webhook) |
| Execute, edit and delete a webhook's own messages, Get Webhook with Token | the token only, "does not require authentication" | verified | Webhook |
| `MANAGE_WEBHOOKS` on a server with server-wide 2FA | the owner account must use 2FA | verified | [Permissions](https://docs.discord.com/developers/topics/permissions) |
| `MANAGE_WEBHOOKS` applies to | text, voice, stage channel types (the table marks T, V, S). Forum and media are not listed. | verified (table), unknown for forum/media | Permissions |
| Create a webhook in a channel the bot cannot view | not documented. The repo maps 403 to "Give the bot Manage Webhooks", which covers it. | unknown | |
| Read history | `VIEW_CHANNEL` and `READ_MESSAGE_HISTORY`; without the latter "no messages will be returned" (the docs do not say whether that is an empty list or an error) | verified | [Get Channel Messages](https://docs.discord.com/developers/resources/message#get-channel-messages) |
| Read content over Gateway or REST | `MESSAGE_CONTENT` (privileged, `1 << 15`). Without it `content`, `embeds`, `attachments`, `components` are empty and `poll` is omitted. Exempt: messages the app sends, DMs, mentions of the app, context-menu target. | verified | [Gateway](https://docs.discord.com/developers/events/gateway#message-content-intent) |
| Messages posted through the bot's own webhooks: whether they count as "messages that an app sends" for the exemption | not stated (an app-created webhook has `application_id` set, which the docs call "application-owned") | unknown |  |
| Start a thread from a message (the relay's text-channel path) | docs list no permission; the repo assumes `CREATE_PUBLIC_THREADS` | unknown | [Channel](https://docs.discord.com/developers/resources/channel) |

**Hidden channels.** "Denying a user or a role `VIEW_CHANNEL` on a channel implicitly denies other permissions on the channel" ([Permissions](https://docs.discord.com/developers/topics/permissions)). **Verified.** Consequences:

- Reading fails or returns nothing; the bot sees an obfuscated channel (section 5). **Verified** for the obfuscation, **inferred** for REST errors.
- Posting through a webhook the relay already holds still works, because it needs no authentication. **Inferred** from "does not require authentication"; not stated for a hidden channel.
- `ADMINISTRATOR` skips overwrites entirely, so a bot with it always sees every channel. **Verified** (permissions pseudocode, mirrored in `packages/discord/src/permissions.ts`).
- Whether `MESSAGE_CREATE` is sent for a channel the bot cannot view: **unknown**; **inferred** not sent, because thread events are withheld ("Clients will not be informed of a thread through the gateway if they do not have permission to view that thread", [Threads](https://docs.discord.com/developers/topics/threads)).

## 5. Gateway events for new channels

| Event | Intent | Payload | Label |
| --- | --- | --- | --- |
| `CHANNEL_CREATE`, `CHANNEL_UPDATE`, `CHANNEL_DELETE` | `GUILDS (1 << 0)` | channel object. Update is not sent for `last_message_id` changes. | verified ([Gateway events](https://docs.discord.com/developers/events/gateway-events#channel-create), [intents](https://docs.discord.com/developers/events/gateway#list-of-intents)) |
| `GUILD_CREATE` | `GUILDS` | full `channels` and active `threads`; sent on connect and when a guild becomes available | verified |
| `THREAD_CREATE`, `THREAD_UPDATE`, `THREAD_DELETE`, `THREAD_LIST_SYNC` | `GUILDS` | `THREAD_DELETE` carries only `id`, `guild_id`, `parent_id`, `type`. `THREAD_LIST_SYNC` is sent when the bot gains access to a channel. | verified |
| `WEBHOOKS_UPDATE` | `GUILD_WEBHOOKS (1 << 5)` | `guild_id`, `channel_id` only. No webhook ID, no hint of create, update or delete. Fired by Create, Modify and Delete Webhook. | verified |

Hidden channels (**verified**; [changelog 2026-08-12](https://docs.discord.com/developers/change-log#channel-obfuscation-for-users-and-bots), [Obfuscated Channels](https://docs.discord.com/developers/resources/channel#channel-object-obfuscated-channels)):

- Today a bot gets full metadata for every channel. **From 2026-11-16** it gets obfuscated channels through the same `CHANNEL_CREATE`, `CHANNEL_UPDATE` and `GUILD_CREATE`, and `GET /guilds/{id}/channels` omits them.
- Obfuscated channel: `name` is `"___hidden___"`, `flags` has `CHANNEL_OBFUSCATED (1 << 17)`, `permission_overwrites` holds one `@everyone` deny of `VIEW_CHANNEL`. `id`, `type`, `position`, `parent_id` stay real. "Do not rely on inspecting `name`": check the flag.
- When the bot gains access, a `CHANNEL_UPDATE` carries the full channel. A category is viewable if any child is.
- Testing early: send `capabilities: 1 << 15` in Identify, or enable the **Private Channel Obfuscation** toggle in the Developer Portal.

So the relay can notice a new channel from `CHANNEL_CREATE`, and a channel that becomes visible from `CHANNEL_UPDATE` with the flag cleared. It cannot learn a hidden channel's name, and `WEBHOOKS_UPDATE` is not needed to find channels (it says only "a webhook changed here", useful to detect a human deleting the relay's webhook).

Thread routing: a message in a thread has the thread's ID as `channel_id`; its parent is in `parent_id` on the thread object (`THREAD_CREATE`, `THREAD_LIST_SYNC`, `GUILD_CREATE.threads`). **Inferred** from the object shapes; the repo's `locate` and thread map rely on it.

## 6. `MESSAGE_CREATE` from a webhook

- `GUILD_MESSAGES (1 << 9)` delivers it. **Verified.**
- The message has `webhook_id` ("if the message is generated by a webhook, this is the webhook's id") and "You can tell if a message is generated by a webhook by checking for the `webhook_id` on the message object". **Verified** ([Message object](https://docs.discord.com/developers/resources/message#message-object)).
- `author` "corresponds to the webhook's id, username, and avatar". So `author.username` is the per-message override and `author.id` is the webhook ID. **Verified**; `author.id === webhook_id` is **inferred** (the docs name only "the webhook's id").
- `member` is "Missing for … messages from webhooks". **Verified** ([Message Create](https://docs.discord.com/developers/events/gateway-events#message-create)).
- `author.bot` on webhook messages is **not documented**. Do not branch on it. Classify in this order: `webhook_id` present, else `author.bot`, else a person.
- `application_id` is set when "the message is an Interaction or application-owned webhook". Whether a webhook the bot created counts as application-owned: **unknown**. Telling the relay's webhook from other webhooks must use `webhook_id` against the stored ID, never `application_id`.
- Agents posting through the same webhook are indistinguishable to Discord. Attribution must come from the relay's own records (`relay_messages.discord_message_id`), as the repo does.

## 7. How the repo compares

Files: `packages/discord/src/rest.ts`, `packages/relay/src/services/{channels,sending,setup,intake}.ts`, `packages/relay/src/gateway/{protocol,normalize,service}.ts`.

Matches the docs:

- **One webhook per channel**: `channels.webhook_ciphertext` and `webhook_id`; `setup.relayChannel` calls `createWebhook` only if the channel has none. 30007 is mapped to advice. `username` and `avatar_url` are set per message in `webhookBody`.
- **Threads and forum posts**: `thread_id` is a query parameter; `thread_name` and `applied_tags` are sent only to forum or media channels (`forum &&` guards), avoiding 220003. For text and announcement channels `startThread` opens a thread from the posted message with the bot, as Discord requires. Errors 10003, 160005, 50083, 160006 are mapped.
- **Execution safety**: `wait=true`, `allowed_mentions: {parse: []}`, 429 and `Retry-After` handling, 404 and 401 drop the webhook (matches "do not use a 404 webhook again"), `UncertainSendError` because there is no idempotency key.
- **Reading and classification**: `INTENTS` is `Guilds | GuildMessages | MessageContent`; `MESSAGE_CONTENT_FLAGS` checks the app flags; `resolveAuthor` tests `author.webhook_id` against `channel.webhook_id`, with any other webhook kept as a plain webhook, and the bot case afterwards. Permission maths in `permissions.ts` follows the documented order.
- **Names**: the comment on `createWebhook` states the `clyde` and `discord` rule; the webhook is named "Logitland relay".

Gaps this research found:

1. **Obfuscation (needs action before 2026-11-16).** `normalize.channelUpdate` copies any channel with a name into a `channel_update`, and `intake` writes that name over the stored row for a relayed channel. A relayed channel the bot loses view of would be renamed `___hidden___`. Nothing reads `flags & (1 << 17)`. `setup.ts` also uses `getGuildChannels`, which will omit hidden channels, so "list Discord channels" and the permission report will silently lose them. Fix: skip obfuscated channels in `channelUpdate`, and surface them as "the bot can't see this channel".
2. **New channels are not tracked.** `normalizeDispatch` has no `CHANNEL_CREATE` or `CHANNEL_DELETE` case. `channelChanges` records IDs for thread parent lookups only. A new channel reaches the relay only when an admin runs `relayChannel`, and a deleted relayed channel stays in `channels`. If channels should appear or disappear on their own, handle both events: create the row (agent access `off` until an admin opens it) on `CHANNEL_CREATE`, mark or remove it on `CHANNEL_DELETE`.
3. **`WEBHOOKS_UPDATE` is not used**, and `GUILD_WEBHOOKS` is not requested. A human deleting the relay's webhook is found only on the next send (404, then `dropWebhook`). Adding the intent gives an earlier signal at the cost of one more event stream; the payload only names the channel, so the relay would still call `GET /channels/{id}/webhooks` (needs `MANAGE_WEBHOOKS`) to see what changed.
4. **No webhook delete or list in `DiscordRest`.** `dropUnusedWebhook` uses the token form of `DELETE /webhooks/{id}/{token}` by hand. Orphan cleanup by `GET /channels/{id}/webhooks` and `DELETE /webhooks/{id}` (needs `MANAGE_WEBHOOKS`) does not exist, so a failed save leaves a webhook toward the 15 cap.
5. **Egress IP.** Executions use no bot token, so they count against the shared egress IP's global and invalid-request budgets (section 3). Worth a log line and an alert on 429 with `X-RateLimit-Scope: global`.
6. **Avatars and names are unvalidated.** The repo does not check agent display names against the webhook name rules (`clyde`, `discord`) or length. Discord's response to a bad override is unknown (section 2); test on a scratch webhook before shipping a name policy.

## Open questions (need a test, not a doc)

1. Does a webhook-override `username` containing `discord` or `clyde`, or longer than 80 characters, get rejected, rewritten or accepted?
2. Is `avatar_url` cached, and for how long?
3. What are the real execution limits per webhook and per channel? Capture `X-RateLimit-Limit` and `X-RateLimit-Reset-After` from a burst on a scratch webhook.
4. Is the 15-webhook cap per channel or per guild?
5. Does a bot receive `MESSAGE_CREATE` for a channel it cannot view, and are its own webhooks' messages exempt from the Message Content intent?
6. Is a webhook-created thread's `owner_id` the webhook ID? The repo's `thread_upsert` assumes so (`owner_id !== ch.webhook_id`).
