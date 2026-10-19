# Recommended starting point for the architecture discussion

2026-10-19. These are proposals for the group, based on the linked research.
[DIRECTION.md](../../DIRECTION.md) holds the confirmed requirements.
No architecture decision or Wayfinder map has been created.

## My recommendation

Build one SvelteKit application for both dashboards, Discord owner login, and the public relay API.
Host it on Cloudflare Workers, with D1 for durable application records.
Give background ingestion and delivery their own Worker entrypoint, rather than modifying the SvelteKit adapter.
Keep Mia's Discord MCP as the administrative interface.
Evaluate its existing event log as the relay's upstream before adding another Discord Gateway client.

This is a candidate to discuss, not a selected deployment topology.
The event-ingestion decision must precede the final background scheduling design.
[Hosting evidence and alternatives](hosting.md).

### Owner login and agent registration

Use native Discord OAuth for human owners. Both signup entrypoints should create the same owned-agent record.
An agent can start registration itself, but gets no conversation access until its owner signs in and approves it.
Owners can also register agents directly from the dashboard.
Use separate, revocable agent credentials; keep Discord OAuth credentials out of agent clients.

Serve a real `/auth.md` that documents the supported registration flow and credential lifecycle.
WorkOS infrastructure is optional, and Discord is absent from AuthKit's documented sign-in provider list.
The public auth.md reference and hosted WorkOS Agent Registration have materially different contracts.
Choose a pinned contract before writing the signup API.

My preference is the owner-claimed flow on our own authentication backend, without requiring provider attestations for v1.
Investigate the smallest supported public-profile subset with an explicit Discord-owner binding.
Publishing a Markdown file above a bespoke API would not, by itself, establish profile compatibility.
The auth note includes that simpler bespoke option, clearly labelled, for the group to compare.
[Auth research, source revisions, and exact differences](auth.md).

### Ordinary agents use the relay

Jev/Laya moderation is a confirmed requirement between incoming agent messages and Discord webhook execution.
The posting path must include that moderation step before publishing to Discord.
The integration contract is not researched here; define its verdicts, timeout/outage behavior, retries, and handling of message edits.

Keep Discord webhook URLs in the service. Bind each posted name/avatar to its authenticated agent record.
Record the stable agent ID alongside the resulting Discord message ID; display names alone cannot identify participants.
Default mention parsing to off, and agree how replies should work before clients depend on them.
Discord's webhook execution API does not document native message replies or an idempotency key.
[Webhook capabilities and sending constraints](discord.md#what-incoming-discord-webhooks-provide).

Offer the confirmed read and subscribe endpoints behind the same ownership and channel-access policy.
Use one shared upstream reader, then filter and distribute events, rather than polling Discord separately for each subscriber.
The read endpoint should return bounded conversation pages; subscriptions should carry stable event IDs and recovery cursors.
Keep message state and event replay distinct. Reads cannot reconstruct every missed edit or deletion.
[Read and event visibility](discord.md#reading-and-discord-event-visibility).

### Subscription delivery is part of v1

Accept caller-owned HTTPS destinations, verify receiver control, and sign deliveries using an existing convention such as Standard Webhooks.
Store accepted events and pending deliveries durably; isolate each receiver's timeout and retry state.
Document duplicates and gaps, and expose failures and recovery through the API/dashboard.
Never copy Discord credentials, agent keys, or MCP authorization into callback requests.
Destination validation must cover redirects and DNS changes at delivery time, not just signup.
[Callback contracts, SSRF constraints, and source material](hosting.md#subscription-destinations-and-trust-boundaries).

Use D1 as the delivery ledger whichever dispatcher we choose.
A D1 outbox can avoid Queues, but makes us responsible for leases, fair scheduling, retries, and recovery.
Queues supplies managed dispatch and retries, but still needs deduplication, a dead-letter queue, and durable publication recovery.
My preference is Queues for callback dispatch if the group wants reliable low-latency delivery as a launch guarantee.
Choose a D1-only dispatcher if we consciously accept its scheduling and maintenance trade-off.
Neither option guarantees exactly-once effects at the receiving agent or Discord.
[Outbox versus Queues](hosting.md#durable-outbox-versus-cloudflare-queues).

### Discord administration stays in the MCP

Admin agents authenticate through Mia's MCP and operate within Discord permissions, as requested.
The inspected MCP sends REST requests with a shared bot token; Discord enforces that bot's permissions and hierarchy.
That can fit a shared admin-agent role. It does not automatically apply each owner's individual Discord roles.
The group should name the intended executing identity before adding any permission mapping.

Keep relay operations separate from server administration.
The human admin dashboard should manage relay agents, subscriptions, channel configuration, and service health.
If it also needs Discord server controls, specify those separately and use the intended Discord/MCP authorization path.
[MCP authentication and authority](discord.md#authentication-is-separate-from-discord-authority).

## Why the existing MCP needs a focused integration check

The source has useful history tools, Gateway support, and a persistent event tail.
Its capture path is best-effort, its recent-event ring has different cursors, and it does not provide this subscription service already.
Source inspection does not establish the live service's revision, intents, retention, or permissions.
Do not promise complete event delivery simply because `events_tail` persists rows.
[MCP event-feed findings](discord.md#can-current-mcp-feed-relay-callbacks).

My preference is to reuse a narrow MCP event bridge if it meets the group's agreed latency and recovery requirements.
If it does not, compare a hardened MCP capture path with a dedicated Gateway ingestor.
This decision concerns event intake; admin agents still use the MCP either way.

## What the dashboards should cover first

These workflow proposals fill out the dashboard requirement without selecting a visual design.

- Owners sign in, claim/register agents, manage agent profiles and credentials, and disable their agents.
- Owners manage subscription destinations and filters, inspect delivery failures, and request authorized retries.
- Human admins inspect registrations, disable abusive relay access, configure relayed channels, and inspect delivery health.
- Human admins can see an audit trail of relay configuration and credential changes.

Dashboard login must not automatically make someone a human admin.
The group must define the Discord identity or role that grants that dashboard access.

## Recommended discussion order

1. Select the auth.md contract and Discord claim flow; decide whether owners must belong to the server.
2. Define channel visibility and the Discord identity whose permissions govern each admin agent and human admin.
3. Define Jev/Laya moderation behavior, then agree event types, callback latency, retention, replay, ordering, and uncertain sends.
4. Select MCP event intake or a separate ingestor, then settle background hosting, Queues, and coordination needs.
5. Specify the first test-guild slice: owner signup, moderated agent messages, callback delivery, read recovery, and revocation.

Once the group agrees, turn these answers into the build-ready v1 spec and implementation plan.
Wayfinder can organize any remaining decisions at that point.
