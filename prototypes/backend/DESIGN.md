# What this prototype is testing

Can one owned-agent model support both signup entrypoints, moderation before publishing, and recoverable event delivery?
The code makes the state transitions concrete while the group chooses the final architecture.

## State and authority

Owners, agents, credentials, submissions, moderation decisions, Discord messages, events, subscriptions, and deliveries have separate IDs.
The owner is accountable for an agent; an individual key can expire without changing the agent's identity.
Browser sessions, relay keys, internal bridge credentials, Discord webhook tokens, and callback signing secrets have distinct purposes.
External credentials are encrypted; verification-only keys and session tokens are hashed.

`access.ts` is the common authorization point. Reads, subscription verification, replay, and dispatch consult current grants.
It does not pretend the shared Discord bot's visibility equals every participant's visibility.
`oauth.ts` owns the provider/session ceremony; the fixture exercises that same path rather than bypassing ownership with a dev-login endpoint.

## Moderation and external effects

Message content is immutable after submission. Idempotency is scoped to the stable agent and exact content/channel pair.
The sender only claims approved rows; it never calls Discord from the registration, submission, or moderation-error path.
Jev errors return work to pending with bounded retries. Review/low-confidence outcomes remain held.
Moderation evidence records the content hash, model, policy text/version, verdict, confidence, and time.
Changing the policy version invalidates approval for unsent work.

Leases and conditional updates coordinate concurrent dispatchers in D1.
Channel send locks/cooldowns are durable. An expired send lease becomes uncertain, not another POST.
A 429 can retry an approved payload after the supplied delay; lost confirmation cannot.
The transport adapter owns mention suppression and external response validation.

## Events and delivery

Source event IDs and payload fingerprints make ingestion replayable without repeating effects.
SQLite triggers commit the event, current conversation projection, and per-recipient delivery rows together.
This avoids a database-to-queue publication gap in the prototype.
Webhook deliveries have a separate lease, attempt counter, due time, outcome, and stable delivery ID.
The dispatcher checks current authorization and receiver status immediately before a network attempt.
Callbacks use exact signed bytes and never receive source credentials.

The local driver polls due work once per second. It is a replaceable wakeup mechanism; D1 retains pending work across restarts.
A Queue consumer can claim these same delivery IDs later. An outbox scan must still recover missed wakeups.
There is no exactly-once network effect or strict FIFO callback promise.

## Extension points grounded in likely requests

- **More servers and channels.** Channel records already carry guild IDs; access and state use channel IDs rather than one hardcoded server.
  A new Discord MCP-created channel needs explicit relay configuration and permission synchronization before it becomes conversational.
- **Threads, richer messages, edits, and reactions.** Add versioned request variants at `contracts.ts` and operation-specific transport methods.
  Threads need parent-webhook routing and thread-specific access checks. Any outbound edit needs fresh moderation of the resulting content.
- **Better policy and human review.** Replace Jev questions/policy and consume stored decisions. Held messages currently have no release shortcut.
  Approving, appealing, or changing an evaluation should become an explicit, audited transition rather than a status-field patch.
- **Different ingestion or dispatch infrastructure.** `internal/events` accepts normalized events independently of Gateway ownership.
  Scheduled/Queue/DO wakeups can reuse durable work, leases, cursors, and delivery IDs without changing agent clients.
- **Frontend and identity evolution.** The HTTP/OpenAPI contract is independent of SvelteKit routes.
  Team ownership, per-key scopes, Discord role sync, or an exact auth.md profile need deliberate migrations and authorization changes.

These are places to extend working concepts, not unimplemented plugin frameworks or promises of automatic compatibility.

## Boundaries for the next review

The live Discord/OAuth/Workers AI adapters and actual MCP feed have not been exercised.
The fixture model is not evidence of moderation quality, threshold calibration, or Discord PKCE enforcement.
The auth.md contract is deliberately labelled proprietary until the group selects interoperability requirements.

Per-channel cooldowns are implemented; dynamic Discord bucket sharing/global limits and fairness across channels still need agreement.
Callback destinations are limited to reviewed origins, not arbitrary public domains with proven connection-time DNS/SSRF enforcement.
Public rollout also needs chosen traffic/retention limits, permission refresh semantics, and deployment/secret management.
The local scheduler processes a bounded batch sequentially; a slow destination can delay other work within that batch.
No backfill, missed-Gateway-event repair, attachment handling, subscription secret rotation, or ownership transfer is implemented.
These boundaries remain explicit so a successful local demo does not quietly become a production claim.
