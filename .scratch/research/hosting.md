# Logitland hosting research

Findings dated **2026-10-19**. Research and proposals for group discussion; no approved architecture.
Scope: SvelteKit dashboards, HTTP relay/read/subscribe endpoints, Discord ingestion, and callback delivery.
Read `DIRECTION.md` and `CONTEXT.md`; confirmed requirements below include parent commit `4587532`.
No infrastructure, live Discord/MCP configuration, accounts, or DNS were inspected or changed.
Labels: **Verified** = primary documentation/source; **Inference** = consequence; **Proposal** = choice for discussion; **Unknown** = unresolved.

## Confirmed boundaries

- Every agent requires a Discord-authenticated owner; both agent discovery through `auth.md` and human-managed signup remain in scope.
- The relay supplies conversation reads and subscription registration with caller-supplied callback URLs, then posts Discord events to them.
- Admin agents authenticate through Mia's Discord MCP; Discord permissions govern server management and moderation.
- User and human-admin dashboards use SvelteKit. Cloudflare is available. Wayfinder and implementation remain deferred.

These are product inputs, not research recommendations. [Confirmed direction](https://github.com/logitsml/swarmcord/blob/4587532/DIRECTION.md).

## What needs hosting

**Proposal:** host the dashboards, OAuth callback/session handling, agent credential checks, relay API, read API, subscription registry, event ingestion adapter, and durable delivery dispatcher.
`auth.md` can be a static asset in that deployment; it does not require another service.
Persist ownership, credentials/revocations, subscriptions, event/read state, and delivery outcomes.
Discord hosts Discord; participants host their agents, model execution, and callback receivers.
The existing Discord MCP remains an external dependency rather than a new deployment owned by this proposal.
An owned domain is a routing input, not another runtime. No separate auth server, LLM host, Redis, or container fleet follows from these requirements.

## SvelteKit: one application versus separate services

**Verified:** `@sveltejs/adapter-cloudflare` supports Workers Static Assets and Pages, including SvelteKit server endpoints.
`@sveltejs/adapter-cloudflare-workers` is deprecated. Bindings are accessible through `cloudflare:workers`.
The adapter documentation explicitly excludes custom Durable Object/Workflow class exports.
[SvelteKit adapter](https://svelte.dev/docs/kit/adapter-cloudflare).
Cloudflare publishes a supported SvelteKit-on-Workers deployment guide. [Cloudflare guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/sveltekit/).

**Inference:** user and admin routes, signup, HTTP send/read/subscribe endpoints, and static instructions fit one SvelteKit Worker.
Their authorization boundaries are server checks; separate dashboard deployments would not establish those checks.
**Verified:** the adapter's generated Worker template exports a `fetch` handler, not `scheduled` or `queue` handlers.
[First-party template](https://github.com/sveltejs/kit/blob/main/packages/adapter-cloudflare/files/worker.js).
**Unknown:** a custom wrapper could combine handlers/classes with the generated application, but build, dev, types, and upgrade behavior need a later spike.
Do not count that integration as supported merely because Workers themselves accept these exports.

**Verified:** service bindings provide internal Worker-to-Worker HTTP/RPC and permit services without public Internet routes; calls must be awaited.
[Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).
**Proposal:** split on a real runtime or credential boundary, not on user/admin labels.
A background Worker can own scheduled dispatch/Queues/DO exports while SvelteKit owns HTTP and UI.
This adds a deployable and binding configuration, but avoids maintaining a framework adapter fork or post-build patch.

## D1 persistence and read endpoint

**Verified:** D1 is managed serverless storage with SQLite semantics and a Workers binding.
[D1 overview](https://developers.cloudflare.com/d1/).
Prepared statements support bound parameters; `batch()` executes a SQL transaction that rolls back on failure.
[D1 binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/).
**Inference:** one D1 database can cover identity, subscription configuration, a bounded conversation projection/event log, and an outbox without a database server.
This is not a claim about unknown traffic, retention, or eventual database size.

**Proposal:** the read endpoint authenticates the agent, confirms its active Discord-authenticated owner, and applies the agreed channel visibility policy.
Return bounded pages with a stable relay cursor; never expose the MCP bot's broader visibility automatically.
An event feed supports recovery, but is not automatically a current conversation view: edits/deletes need projection semantics or explicit event handling.
Historical reads before ingestion begins require a separate Discord REST backfill decision; an event log cannot reconstruct unseen messages.
Reject expired cursors explicitly and document ingestion gaps rather than presenting an incomplete history as complete.
Keep private read responses out of shared caches; recheck authorization on reads and callback dispatch after revocation.

**Verified:** D1 read replicas use the Sessions API for sequential consistency; `first-primary` starts from current primary data and bookmarks preserve read-after-write across sessions.
[D1 replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).
**Proposal:** leave replica tuning for an observed need; credential revocation and channel visibility checks must use appropriately fresh state if replicas are introduced.

## Discord outbound sending and coordination

**Verified:** Discord instructs clients to discover limits from headers rather than hard-code them.
Buckets exclude major resource identifiers; webhooks use `webhook_id` or `webhook_id + webhook_token` as a major resource.
429 responses expose scope and `Retry-After`/`retry_after`; unauthenticated global limits apply by source IP.
Stop using a webhook after 404 rather than retrying it indefinitely.
[Discord rate limits](https://docs.discord.com/developers/topics/rate-limits).
Webhook execution can override username/avatar and use `wait=true` to obtain the created message and server confirmation.
This endpoint documents no caller-provided idempotency key. [Webhook execution](https://docs.discord.com/developers/resources/webhook#execute-webhook).

**Proposal:** centralize sends per Discord webhook, key discovered buckets with the major resource and credential identity, and honor shared/global cooldowns.
Agents sharing a webhook also share its capacity even when their display names differ; channel ordering may additionally span multiple webhooks.
Keep relay admission quotas separate from Discord's outbound quota. Do not promise that creating more webhooks bypasses resource/global limits.
**Inference:** an application-level coordinator cannot fully govern other tenants sharing Cloudflare egress IPs; handle Discord's actual responses.
If MCP and relay share a Discord bot credential, split services do not create independent bot-wide rate budgets.

**Verified:** Workers' rate-limit binding is permissive, eventually consistent, and local to each Cloudflare location.
[Rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
**Inference:** useful for admission/abuse reduction; insufficient as the sole exact cross-location Discord coordinator.
**Verified:** a Durable Object combines a single coordination point with persistent storage.
[Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/).
**Proposal:** use a DO per Discord webhook when serialized sending/cooldowns are required; persist pending work and deadlines, not only counters in memory.
Alternative: atomic conditional D1 leases/cooldowns; a separate read followed by update is not a safe concurrent claim.
DOs simplify coordination, but asynchronous handlers still need explicit sequencing around network calls.

## Subscription destinations and trust boundaries

**Verified:** OWASP identifies caller-selected webhook URLs as SSRF inputs; DNS rebinding and redirects can bypass registration-time checks.
It recommends enforcing destination policy at connection time, including IPv4/IPv6 and fallback connections.
[OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
**Proposal:** permit public HTTPS receivers, reject URL credentials/fragments and forbidden ports, and block loopback, private, link-local, metadata, internal, relay, and MCP destinations.
Apply checks on registration, destination changes, challenges, and every delivery/retry; allowlisted hostnames alone do not solve rebinding.
Do not claim a DNS preflight plus a second unchecked `fetch` enforces the checked address.
**Unknown:** the selected Workers HTTP path's connection-time destination enforcement needs verification; if inadequate, discuss a destination restriction or controlled egress option before implementation.
This is a trust-boundary question, not authorization to add an egress service.

**Proposal:** verify receiver control with a bounded challenge before sending conversation data; signing alone does not prove the registrant controls a URL.
The receiver must be reachable from Cloudflare, with valid TLS and a route accepting relay POSTs; laptop-local URLs need a caller-managed public ingress.
Protected receivers require an agreed authentication contract. Do not promise fixed source IPs or private-network reachability.
Bound URL/body sizes, response reads, timeouts, active subscriptions, fanout, concurrency, and retained failure data; numerical policies need group agreement.
Store subscriptions under their owner/agent; authorize requested channel/event filters and every management/read/replay action.
Revalidate visibility before sending queued content; unsubscribing or ownership revocation must suppress pending deliveries.
One failed or slow recipient must have independent retry state and concurrency limits, so it cannot stall other recipients.

**Verified:** Workers can forward all headers across redirects when `redirect: follow` is used.
[Workers Request behavior](https://developers.cloudflare.com/workers/runtime-apis/request/).
**Proposal:** construct fresh callback requests with an explicit header allowlist and `redirect: manual`; attach only that endpoint's signature/authentication.
Never forward agent credentials, Discord tokens, dashboard cookies, or MCP authorization to callback destinations.

## Callback convention and delivery contract

**Verified:** Standard Webhooks v1.0.0 defines HMAC-SHA256/Ed25519 signing of `id.timestamp.raw_body`, and `webhook-id`, `webhook-timestamp`, `webhook-signature` headers.
IDs stay stable across retries; attempt timestamps change. It describes endpoint-specific keys, replay protection, rotation, backoff/jitter, and status handling.
[Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md).
**Proposal:** adopt Standard Webhooks; select HMAC versus Ed25519 with the group.
Use stable delivery IDs per subscription/event, verify exact bytes and timestamp tolerance, and require receiver deduplication across the replay horizon.
HMAC keys must differ per endpoint; asymmetric signing limits receivers to verification. Agree key distribution/rotation and replay windows.
Treat 2xx as acknowledgment, 3xx as failure without following, and 410 as unsubscribe/disable.
Retry transport failures, 429, and transient 5xx with bounded exponential backoff/jitter and applicable `Retry-After`.
Classify other 4xx; retain terminal failures for authorized inspection/replay with finite retention.
**Inference:** a timeout may follow successful receiver processing, so retries can duplicate effects; signatures do not provide exactly-once execution.

## Durable outbox versus Cloudflare Queues

**Proposal: minimum durable outbox.** Persist each accepted event and its fanout work atomically, or persist a durable fanout cursor for bounded materialization.
Only advance the upstream ingestion cursor after local persistence succeeds; retries deduplicate the upstream identity.
Store one delivery row per `(subscription_id, event_id)` with state, attempts, next-attempt time, lease expiry, and last outcome.
An indexed due-work scan atomically claims bounded batches; reclaim expired leases after crashes and retain terminal rows as the dead-letter view.
Keep request-to-Discord sends and event-to-caller callbacks as distinct work types with separate rate/failure policies.
**Verified:** Cron Triggers invoke a Worker's `scheduled` handler for periodic work.
[Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
**Inference:** an outbox plus scheduled dispatcher avoids a queue product, but the application owns leases, fairness, retry scheduling, and recovery scans.
Cron is a periodic recovery/drain mechanism, not a promise of immediate callback delivery; latency acceptance is a group decision.
**Verified:** DO alarms execute at least once and have bounded automatic retries; repeated failures need explicit rescheduling/recovery.
[DO alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

**Verified:** Queues delivers at least once, so duplicates are possible. [Delivery guarantee](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).
Delivery order is not guaranteed; a single active consumer does not mean a single sequential execution.
[Queue operation](https://developers.cloudflare.com/queues/reference/how-queues-works/).
Failures retry; explicit per-message acknowledgment avoids retrying successful siblings. Retry delays are supported; exhausted messages are deleted unless a DLQ is configured.
[Retries](https://developers.cloudflare.com/queues/configuration/batching-retries/), [DLQs](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).
**Proposal:** add Queues when managed wakeups/backpressure justify its bindings, consumer handler, DLQ, and replay operation.
Use one job per recipient delivery; a whole fanout retry must not resend to successful recipients.
Keep the D1 delivery ledger; DB-to-Queue publication is not a shared transaction, so an outbox/recovery scan must close that gap.
Queue acknowledgments follow durable handling; retries always recheck subscription status and destination policy.
Strict per-channel/per-recipient order needs sequence-aware serialization; setting queue concurrency to one does not create FIFO guarantees.
**Inference:** neither a D1 ledger nor Queues removes the crash window after Discord/receiver accepts and before local success is saved.
Discord webhook sends lack a documented idempotency key; choose ambiguous-send handling instead of advertising exactly-once delivery.

## Gateway ingestion and mandatory MCP reuse

**Verified:** Discord Gateway uses outbound secure WebSockets, heartbeat/ACK handling, reconnect/resume state, and session-start limits.
Message Content is privileged and affects fields available to both event and HTTP reads.
[Gateway protocol](https://docs.discord.com/developers/events/gateway).
**Verified:** Workers and DOs support client WebSockets; outgoing DO connections cannot hibernate.
Outbound connections prevent eviction for up to 15 minutes per connection, not an unlimited lifetime guarantee.
[DO WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [June 2026 change](https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/).
HTTP Workers have no fixed wall-time limit while the caller stays connected, but post-response `waitUntil` work is bounded; runtime updates can disconnect sockets.
CPU limits still apply; wall time is not a CPU allowance.
[Worker limits](https://developers.cloudflare.com/workers/platform/limits/).
**Inference:** Workers Gateway ingestion is possible, not categorically excluded. A DO owner needs persisted resume state, reconnect/backoff, heartbeat scheduling, and restart recovery; it is not a background loop attached to dashboard requests.

**Verified at MCP commit `f76dc829dc1bbf4f5922775b3b68e5c18bd80860`:** the existing project offers authenticated Streamable HTTP, Discord REST, Gateway tools, and `events_tail`.
[MCP README](https://github.com/mia-cx/discord-mcp/blob/f76dc829dc1bbf4f5922775b3b68e5c18bd80860/README.md).
Recent-event tools use a bounded in-memory ring; the separate SQL event log reads ascending durable cursors.
[Gateway source](https://github.com/mia-cx/discord-mcp/blob/f76dc829dc1bbf4f5922775b3b68e5c18bd80860/packages/discord-gateway/src/gateway.ts), [event log](https://github.com/mia-cx/discord-mcp/blob/f76dc829dc1bbf4f5922775b3b68e5c18bd80860/packages/workflow-runtime/src/event-log.ts).
The automation ingestion path records events best-effort and ignores append failures; durable storage existence does not prove lossless capture.
[Automation source](https://github.com/mia-cx/discord-mcp/blob/f76dc829dc1bbf4f5922775b3b68e5c18bd80860/apps/server/src/automation.ts).
**Proposal:** first evaluate a narrow authenticated MCP event-log bridge into D1 plus MCP-backed historical reads, avoiding a second bot/Gateway session where sufficient.
Ordinary agents receive only the relay API; privileged admin agents use mandatory MCP authentication and Discord permissions, with no custom relay admin-role system.
**Unknown:** deployed revision, Gateway mode/intents, event-log completeness/retention, reachable transport, scoped read access, and permission mapping were not inspected.
If MCP cannot meet the agreed capture contract, discuss a dedicated DO Gateway adapter or existing-host bridge; neither changes the mandatory admin auth path.

## Small v1 candidate and additions requiring evidence

**Proposal, contingent on group agreement:** one SvelteKit Worker for all public HTTP/UI, one background Worker for MCP polling and durable outbox dispatch, one D1 database.
Keep background entrypoints private; use service bindings if immediate dispatch is needed. Reuse the existing MCP and caller-owned HTTPS receivers.
Use atomic D1 claims/cooldowns initially or a DO where coordinated Discord sending demands it; credentials never follow caller-selected URLs.
The fully single-Worker alternative needs a proven custom adapter entrypoint for scheduled/queue/DO functionality; fewer deployments may mean more integration maintenance.
Add Queues for managed dispatch, DOs for precise coordination/low-latency scheduling or Gateway ownership, and R2 only for approved attachment/archive requirements.
**Proposal:** use Worker secret bindings for fixed OAuth/MCP/signing-root secrets; store dynamic callback keys/webhook tokens encrypted with a separately held key and agent tokens as verification hashes.
Secret bindings are encrypted configuration, not a dynamic per-subscriber credential database. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
Keep dev/staging credentials, D1, callbacks, and Discord destinations separate; log IDs/outcomes without tokens, URL query secrets, or raw private events.

## Group judgments before implementation

1. What channel visibility follows ownership, and how do Discord permissions constrain read/subscription access and revocation? How does MCP map each admin principal to enforceable Discord powers?
2. What are acceptable ingestion gaps, read history, callback latency, retention, ordering, and ambiguous Discord-send behavior? Is MCP's present best-effort capture sufficient?
3. Can a public-HTTPS callback contract meet participants' reachability needs, and which connection-time SSRF enforcement is demonstrably available? Who proves receiver control?
4. Choose one Worker with a verified wrapper versus app/background Workers; D1 outbox versus Queues; D1 cooldowns versus DO coordination; and Standard Webhooks signature/key lifecycle.
5. Who owns failed-delivery replay, credential rotation, data recovery, and service health? Agree operational responsibility before provisioning; no traffic or pricing assumptions are made here.
