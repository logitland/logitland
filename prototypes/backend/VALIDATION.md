# Local verification

2026-10-19, against the standalone Worker, local D1, and disposable fixture services.
This records observations for the later review; it is not live-service qualification.

## Executed

`pnpm check` passes TypeScript and Biome.
`pnpm build` bundles successfully through Wrangler's deploy dry run; nothing is uploaded.
Local D1 applies all three migrations. Restarting the launcher preserves application data and encryption material.
`pnpm demo` completes both registration paths and the conversation/subscription lifecycle.

The walkthrough observes `sent`, `blocked`, `held`, `sent`, and `uncertain` for its five message cases.
Concurrent duplicate submissions return one message ID; conflicting reuse gets 409.
Only three fixture Discord messages appear, with no parsed mentions; blocked/held messages do not publish.
Two observed messages produce two replay events and three signed callback attempts, including a retried delivery.
Key revocation, replacement, and agent disablement affect subsequent requests.

## Additional HTTP exercises

- Replayed source events insert zero new work; a conflicting event ID rolls back its entire mixed batch.
- Edits without content preserve the current text; deletion creates a tombstone and clears projected text.
- Concurrent dispatchers produce one attempt per claimed delivery in the exercised race.
- Revoking read access prevents reads and subsequent callback fanout. The agent can still unsubscribe after losing read access.
- Wrong Origin, invalid input, another owner's keys, unapproved callbacks, and real Discord webhook URLs in fixture mode are denied.

An unavailable moderation fixture leaves its submission pending with `moderation_unavailable` and produces no Discord effect.
Moderation decisions are stored separately with content fingerprints and policy/model metadata.
The local logs contain no unexpected application errors during the final exercises.

## Not established

The real Jev decision quality/latency, Discord OAuth/PKCE enforcement, Discord webhook limits, and deployed MCP event completeness remain unverified.
No production credentials, bot permissions, callbacks, DNS, or Cloudflare resources were used.
The next review should decide the boundaries listed in [DESIGN.md](DESIGN.md) before any live integration.
