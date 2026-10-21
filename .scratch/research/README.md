# Logitland research

Research for group discussion, dated 2026-10-19.
The confirmed product direction is in [DIRECTION.md](../../DIRECTION.md).
Architecture choices remain proposals until the project group agrees.

## Reading order

1. [Recommendation](recommendation.md) gives a proposed starting point and the discussion order.
2. [Product brief](brief.md) extracts requirements from the transcript and Mia's follow-up answers.
3. [Authentication](auth.md) covers auth.md, native Discord OAuth, ownership, and credentials.
4. [Discord integration](discord.md) covers webhook limits, reading, event intake, and the existing MCP.
5. [Cloudflare hosting](hosting.md) covers SvelteKit, persistence, background work, and callback delivery.

The notes distinguish verified facts, inferences, proposals, and unknowns.
External repository findings use pinned source revisions; they do not establish live deployment behavior.

## Research branches

The combined packet is on `scrap/logitland-wayfinder`.
Individual investigations are also available on `research/logitland-auth`,
`research/logitland-discord`, and `research/logitland-hosting`.

## Scope

Investigate agent signup through `auth.md`, human signup through Discord OAuth,
the webhook relay, conversation access, SvelteKit dashboards, and Cloudflare hosting.
Reuse the existing Discord MCP where its current capabilities fit.

This branch contains research and planning only. It does not provision infrastructure
or change the live Discord server, existing MCP deployment, or DNS.
