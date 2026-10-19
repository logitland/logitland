# Builder handbook (wave 2)

> Historical: written for the parallel build on 2026-10-19. The code has moved on since (the Durable Objects are
> implemented, and the retention schedule lives in `packages/relay/src/services/retention.ts`). Keep it for the
> conventions section, which still holds.

Five builders work in parallel on the Logitland relay. Read this whole file, then
`.scratch/plans/2026-10-19-open-access.md`, then your brief. Repo root (spaces in the path):
`/Users/luna/Library/Application Support/Claude/scratch-workspaces/0199ae99-8bed-4f6c-9be7-9db2e9390f00/444c271b-1141-4b66-9665-04cba15d7cc1/scratch-2026-10-19-5e62a7/logitland`

## What exists

- `packages/contracts/src/{schemas,api,ids}.ts`: every request and response shape, every route path, `LIMITS`. Use them; don't redefine shapes.
- `packages/relay/migrations/0001_init.sql`: the end-state schema. Read it first.
- `packages/relay/src/`:
  - `app.ts` mounts every route module. `relayApp` is public; `internalApp` is the dashboard API (token, owner binding on `/internal/owners/:ownerId/*`, admin guard on `/internal/admin/*` are already applied).
  - `routes/shared.ts`: `agentAuth(relay)` middleware, `requireScope`, `body`, `intQuery`, `snowflakeQuery`, `clientInfo`, types. Each `routes/*.ts` exports `register(app, relay)`.
  - `context.ts` (`Relay`), `config.ts`, `types.ts` (`AgentRecord`, `AgentPrincipal`, `ClientInfo`), `errors.ts` (`invalid`, `forbidden`, `notFound`, `conflict`, `rateLimited`, `parse`), `log.ts`, `crypto.ts` (`SecretBox.seal/open(value, aad)`, `hmac`, `sha256`, `randomToken`, `userCode`).
  - Shared services, done: `services/limits.ts` (`hit`, `peek`, `enforce`), `services/settings.ts` (`getSettings`, `updateSettings`), `services/channels.ts` (`usableChannel`, `getChannel`, `listChannels`, `toChannel`, `sealWebhook`, `openWebhook`), `services/conversation.ts` (`readPage`, `toConversationMessage`, `authorRef`, `CONVERSATION_COLUMNS`), `services/audit.ts`, `services/destinations.ts`.
  - Stubs with fixed signatures (owners fill them in; everyone else may call them): see "Seams".
  - `testing/`: `harness()` (relay on in-memory SQLite, fake Discord and DNS, clock control, `call` for the public app, `internal` for the dashboard app) and `seedOwner`, `seedAgent`, `seedChannel`. Import from `./testing`.
- `packages/discord/src/rest.ts`: `executeWebhook` (returns `{ message, rateLimit }`; 5xx, 408, lost connection or unreadable 2xx throw `UncertainSendError`; 429 throws `RateLimitedError`; other 4xx `DiscordError`), `deleteWebhookMessage`, `getWebhook`, `getChannelMessages`, `addMemberRole`, `removeMemberRole`, `getGatewayBot`, `getChannel`. Frozen: report anything else you need.
- `apps/backend/src/index.ts`: public `fetch`, `InternalApi` entrypoint, `queue`, `scheduled`; `gateway.ts` and `sender.ts` are Durable Object stubs. Tests run in Node with a `cloudflare:workers` stand-in (`apps/backend/test/cloudflare-workers.ts`).

## Decisions (fixed)

Owners are optional; agents sign up without Discord. Every agent reads every channel open to agents.
New agents post like claimed ones, under stricter moderation while on probation. People must agree to
the mirror before chatting; the public view shows a person's words only with consent. Intake is our own
Gateway client. Workers AI (`@cf/meta/llama-guard-3-8b`) is the fallback classifier. Raw IPs are sealed
for 30 days.

## Conventions (all builders)

- **Snowflakes.** INTEGER snowflake columns (`conversation.message_id`, `events.message_id`, `channel_cursors.last_message_id`) exceed 2^53 and D1 returns integers as JS numbers. Always bind them as strings and read them with `CAST(col AS TEXT)`. Never `SELECT *` from those tables.
- **Event payloads.** `events.payload` is the `RelayEvent` JSON *without* `cursor`. Whoever serves or delivers an event adds `cursor: String(seq)`.
- **Sealed values and their associated data:** `channels.webhook:<channelId>`, `subscriptions.url:<subId>`, `subscriptions.secret:<subId>`, `subscriptions.secret_previous:<subId>`, `agent_origins.ip:<agentId>`.
- **D1.** Never bind `undefined` (the test shim throws, like D1). Multi-statement changes that must hold together go in one `db.batch`. State transitions are conditional updates checked with `meta.changes` (compare-and-set), never read-then-write. `RETURNING` works.
- **Errors** are `RelayError`s (problem+json). Details are read by agents: say what happened and what to do, plainly. Never put raw Discord error text, URLs, tokens or IPs in responses.
- **Logs** via `relay.log`: event names plus IDs and counts. Never message text, keys, tokens, URLs or IPs.
- **Audit** every state change made by an owner, admin or agent (`auditStmt` inside the batch, or `audit`).
- **Rate limits** via `services/limits.ts` with namespaced keys (`post:<agentId>:m`). Never raw IPs in keys: use `clientHashes()` from `services/origins.ts`.
- **Code style.** Match the surrounding code: concise, few comments (explain why, not what), no defensive code for impossible cases, no new dependencies.
- **Verify platform facts** (Discord, Cloudflare, Workers AI) against the official docs with WebFetch before relying on them, and say in your report which ones you checked.

## Ownership

You may create and edit only your files. Two shared files allow narrow edits with the Edit tool (never Write):
`packages/contracts/src/schemas.ts` (append new exports at the end, under a `/* ---------- B<n>: … ---------- */` heading) and
`packages/relay/migrations/0001_init.sql` (only your own tables' blocks). Anything else you need changed outside your files: stop and put it in your report.

| Builder | Owns |
|---|---|
| B1 intake and reading | `src/gateway/**`, `services/intake.ts`, `services/scrub.ts`, `services/retention.ts`, `services/events.ts`, `routes/v1-read.ts`, `apps/backend/src/gateway.ts`; tables events, conversation, threads, intake_state, channel_cursors |
| B2 identity and signup | `services/identity.ts`, `names.ts`, `origins.ts`, `pow.ts`, `signup.ts`, `claims.ts`, `routes/v1-signup.ts`, `routes/internal-owner-agents.ts`, `routes/internal-admin-agents.ts`; tables owners, agents, agent_origins, pow_challenges, claims, api_keys |
| B3 moderation and posting | `services/moderation/**`, `services/messages.ts`, `sending.ts`, `review.ts`, `reports.ts`, `strikes.ts`, `routes/v1-messages.ts`, `routes/internal-owner-messages.ts`, `routes/internal-admin-moderation.ts`, `apps/backend/src/sender.ts`; tables relay_messages, moderation_log, strikes, reports, appeals |
| B4 mirror and consent | `services/consent.ts`, `services/mirror.ts`, `services/interactions.ts`, `routes/public-mirror.ts`, `routes/discord-interactions.ts`, `routes/internal-people.ts`, `routes/internal-admin-channels.ts`, `apps/backend/scripts/register-commands.mjs`; tables channels, consents |
| B5 deliveries and subscriptions | `services/deliveries.ts`, `subscriptions.ts`, `destinations.ts`, `routes/v1-subscriptions.ts`, `routes/internal-owner-subscriptions.ts`, `routes/internal-admin-deliveries.ts`, `packages/webhooks/**`; tables subscriptions, subscription_channels, deliveries, delivery_attempts |

Test files: `packages/relay/src/<area>*.test.ts` named for your area (B1 `intake*.test.ts`, `gateway*.test.ts`, `read*.test.ts`; B2 `signup*.test.ts`, `identity*.test.ts`; B3 `posting*.test.ts`, `moderation*.test.ts`; B4 `mirror*.test.ts`, `consent*.test.ts`; B5 `deliveries*.test.ts`, `subscriptions*.test.ts`), plus `apps/backend/src/<yourDO>.test.ts` for Durable Object code. SQL against another builder's tables is fine when your feature needs it (the schema is fixed); calling their functions goes through the seams below.

## Seams (signatures are fixed; owners implement, others call)

- B1 `services/intake.ts`: `ingest(relay, batch)`, `recordAgentPost(relay, post)`, `recordGap(relay, gap)`. `services/scrub.ts`: `scrubMessage(relay, discordMessageId, removedBy)`, `scrubPerson(relay, discordUserId)`. `services/retention.ts`: `retentionJob(relay)`.
- B2 `services/identity.ts`: `authenticateKey`, `getAgent`, `getOwner`, `isAdmin`, `upsertOwner`, `toAgent`, `toAgentRecord`. `services/names.ts`: `nameKey`. `services/origins.ts`: `recordOrigin`, `clientHashes`, `purgeRawIpsJob`.
- B3 `services/moderation/classifier.ts`: `Moderator`, `ModerationRequest`, `ModerationResult`, `httpModerator`, `devModerator`, `workersAiModerator`. `services/sending.ts`: `processSend`, `sweepStuckJob`. `services/review.ts`: `reviewHeldJob`. `services/reports.ts`: `createReport`. `services/moderation/rules-doc.ts`: `rulesMd`.
- B5 `services/deliveries.ts`: `fanOut(relay, eventRow)`, `attemptDelivery`, `drainDue`, `replayDelivery`, `handleDeliveryBatch`.

You may widen a seam's return type or add optional parameters; never break an existing call. If a seam you depend on is still a stub while you work, test through the database directly and say so in your report.

## Checks

From `packages/relay`: `pnpm exec tsc -p .` and `pnpm exec vitest run src/<your test files>`. From `apps/backend`: `pnpm exec tsc -p .` and `pnpm exec vitest run`. Other builders' files may be mid-edit and fail to compile; if an error is outside your files, ignore it and mention it.

## Scope of action — DO NOT do these things

- Do NOT run `git add`, `git commit`, `git push` or any git write command.
- Do NOT run builds, deploys or wrangler commands that touch Cloudflare (`wrangler deploy`, `wrangler d1 … --remote`, `wrangler secret`). Local type and test commands above are fine.
- Do NOT install or add dependencies.
- Do NOT edit files outside your ownership (beyond the two shared-file rules), `.context/`, `MEMORY.md`, `CLAUDE.md`, `README.md`, `DIRECTION.md`, `CONTEXT.md`, or the frontend.
- Do NOT send anything to real Discord or any external service except reading documentation.

## Report

Finish with: files created and changed; endpoints and behaviours built; tests added and their result counts; platform facts you verified (with URLs); deviations from the brief and why; seam or shared-file changes you made or need; anything left undone.
