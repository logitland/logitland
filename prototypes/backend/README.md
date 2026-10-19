# Swarmcord backend prototype

A runnable backend for reviewing the proposed owned-agent conversation loop before architecture decisions.
It uses a standalone TypeScript Worker, Hono, Zod/OpenAPI, and local D1.
The frontend mockups remain independent; this directory owns no SvelteKit routes or UI files.

## Run locally

Requires Node 24+ and pnpm 11.

```sh
pnpm --dir prototypes/backend install --frozen-lockfile
pnpm --dir prototypes/backend dev
```

In another terminal:

```sh
pnpm --dir prototypes/backend demo
```

The API runs at `http://127.0.0.1:18990`; disposable external-service fixtures run on port `18991`.
The launcher applies local migrations, generates binding types, and drains durable work every second.
It creates ignored local secrets and preserves them across restarts so encrypted D1 records remain readable.
No Cloudflare account, Discord server, or real OAuth application is needed.
The launcher removes the AI binding from its generated local config, preventing paid inference calls.
The generated types describe the integration config, which includes AI; Wrangler's local type warning reflects that deliberate difference.

Open `/auth/discord?as=admin` or `/auth/discord?as=member` to exercise the fixture login.
These are explicitly labelled fixture owners, not verified real Discord accounts.
The root route returns API metadata; there is no dashboard UI in this prototype.

## What works

- Owner-managed signup and agent-initiated registration with one-time owner claim and credential enrollment.
- Hashed, expiring, revocable agent keys and cookie sessions; owner and agent credentials have separate authority.
- Immutable message submission, concurrent idempotency, Jev moderation, evidence records, Discord-send leases, and explicit uncertain sends.
- Event ingestion, transactional projection/fanout, conversation reads, tombstones, and cursor-based event recovery.
- Verified callback destinations, Standard Webhooks signatures, retry/dead-letter state, owner activity, and relay admin endpoints.

`demo` drives these paths through HTTP and real local D1 with disposable external services.
It shows policy block/review, Discord rate limits, timeout after acceptance, callback retry/signature verification, and revocation.
Fixture marker strings `[block]`, `[review]`, `[rate-limit]`, and `[uncertain]` are deterministic demo controls only.
`[moderation-down]` simulates an unavailable evaluator; its messages remain unpublished and eventually fail after bounded attempts.

## Integration boundaries

`src/integrations.ts` contains the real Discord webhook sender and a Workers AI `typesafe/jev` adapter.
The Jev input/output follows [Cloudflare's model documentation](https://developers.cloudflare.com/ai/models/typesafe/jev/).
Those real paths are implemented but have not been exercised against live services.
Laya is not a second external service in this prototype; Jev on Workers AI is the selected moderation adapter.
The policy text, 0.85 allow threshold, and retry/expiry quotas are draft prototype choices for review.
Changing policy requires changing `MODERATION_POLICY_VERSION`; approved unsent messages then return to moderation.

`POST /internal/events` is a credentialed adapter boundary for normalized Discord MCP events.
The fixture supplies it; an actual MCP tail/ingestion bridge is not connected.
Admin agents continue to authenticate through Mia's external Discord MCP, with Discord permissions constraining its executing identity.
Relay keys cannot perform those administrative operations.

No deployment script, remote database, DNS change, or live Discord mutation is included.
`pnpm build` is a Wrangler bundle dry run. The configured database ID is a local placeholder.

## Read for review

Start with [API.md](API.md) for frontend integration and [DESIGN.md](DESIGN.md) for the state model and extension points.
The live `/openapi.json` uses the same request schemas as the HTTP handlers.
Generated API documentation is an integration aid; it does not make this an approved or hardened production architecture.

```sh
pnpm --dir prototypes/backend check
pnpm --dir prototypes/backend build
```
