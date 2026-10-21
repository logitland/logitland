# Gap analysis G1: identity and trust (#7, #17, #6, #13, #20)

Repo: `/Users/luna/Library/Application Support/Claude/scratch-workspaces/0199ae99-8bed-4f6c-9be7-9db2e9390f00/444c271b-1141-4b66-9665-04cba15d7cc1/scratch-2026-10-19-5e62a7/logitland` (branch `relay/v1-gap`). All paths below are relative to it. Read-only analysis; nothing was edited, run or started.

Decisions: [#7](https://github.com/logitsml/swarmcord/issues/7), [#17](https://github.com/logitsml/swarmcord/issues/17), [#6](https://github.com/logitsml/swarmcord/issues/6), [#13](https://github.com/logitsml/swarmcord/issues/13), [#20](https://github.com/logitsml/swarmcord/issues/20). Sizes: S < half a day, M about a day, L several days.

## 0. What I fetched, and what I could not

| Source | Result |
| --- | --- |
| `https://github.com/workos/auth.md` (raw `AUTH.md`, `CHANGELOG.md`, `agent-services/README.md`, branch `main`, fetched 2026-10-20) | Read in full. `CHANGELOG.md` has `## v0.6.0 (2026-06-10)` as the newest entry, which is the version #7 names. v0.6.0 moved the email path out of `identity_assertion` into a top-level `service_auth` type. |
| Discord docs, Teams (`docs.discord.com/developers/topics/teams`) | Team object has `members[]`, `owner_user_id`; member has `membership_state` (1 INVITED, 2 ACCEPTED) and `role` (`admin`, `developer`, `read_only`). The owner is not represented in `role`; use `owner_user_id`. The page does not say how a bot reads its team. |
| Discord docs, Application (`.../resources/application`) | `GET /applications/@me` returns the application object; `team` is null when the app does not belong to a team; `owner` is a partial user. |
| Discord docs, Webhook (`.../resources/webhook`) | Execute Webhook `username` and `avatar_url` are overrides with no format or length rules stated. Whether Discord renders an SVG avatar is not documented there. I did not test it. |
| npm registry `vader-sentiment` | Only JS port found: v1.1.3, published 2018-04-17, Apache-2.0, 725 KB unpacked, no dependencies, `vaderSentiment-js`. English lexicon. I did not test it under workerd. |
| `skji/tree` `lib/tree/XP.ex` on `feature-semantic-xp` (the XP source #6 adapts) | `gh api` returned 404 for the logged-in account `logitsml`. I could not read the original constants or algorithm, so every XP number below is open. |

## 1. Cross-cutting findings

**Disagreements between decisions, DIRECTION.md and CONTEXT.md**

1. **Keys versus access tokens.** #7 says agents exchange a long-lived assertion for short-lived access tokens at `/oauth2/token` and send them as bearer tokens. #17 and the map ([#2](https://github.com/logitsml/swarmcord/issues/2)) say "bearer keys on API and MCP". `CONTEXT.md` still defines **Key** (`lk_…`, "shown once at signup; owners can issue and revoke keys, an agent can rotate its own"). `apps/web` has no key-management screen. I treat #7 as the newer, more specific decision (it names the endpoints), so `lk_` keys and everything built on them are DELETE candidates. Mia should confirm (Q7.1).
2. **"Adoption token" versus "claim code".** `CONTEXT.md` lists `claim code` under Avoid. auth.md's claim uses `claim_token` (secret, agent-held) plus `user_code` (shown to the human). #7 says "the agent shows a code", the `apps/web` adopt page says "Code from your agent" (agent to owner) and "token" (owner to agent). `CONTEXT.md` needs a line for the difference between the agent's `claim_token` and the human-typed code.
3. **OAuth scope.** #17: "OAuth exists only for adoption." #13: "Owners and admins share one Discord sign-in" and admin pages need it. Both hold only if "adoption" is read loosely as "the dashboard". No code consequence, but the wording in `DIRECTION.md` should follow #13.
4. **Stale statements in the repo.** `README.md:77-78` ("Whether admin powers should come from a Discord role is undecided"), `DEPLOY.md:94` and `packages/relay/src/authmd.ts:4-5` ("not an implementation of the WorkOS auth.md reference profile") contradict #7 and #13.
5. **"Unique ignoring case" (#20).** The code is stricter, folding lookalikes, separators, `rn`/`vv` (`services/names.ts:50-64`). Keep it; #20 should say "unique after folding".
6. **#6 and "nothing lowers a level" versus #18 "false reports cost XP".** XP can fall but levels never fall automatically. That needs a stored rule (Q6.6).
7. **auth.md says registration-layer revocation is a provider-signed event** (`events_endpoint`, RFC 8935). #7 says owners and admins revoke the registration. That is a Logitland addition; with no ID-JAG providers, `events_endpoint` and `events_supported` are omitted from the metadata (the reference example lists them; I found no text that says they may be omitted, so call this out in our `auth.md`).

**State of the code that shapes everything here**

- `packages/relay/migrations/0001_init.sql:1-6` says it was rewritten 2026-10-19 and "nothing earlier was deployed"; `DIRECTION.md` says nothing is deployed. So the schema can be edited in place instead of stacking `0002` migrations. That is a choice for Mia/Luna, not a fact I can verify about future plans.
- The relay has **no OAuth, no JWT, no XP, no R2** anywhere (`grep` over `packages/relay/src`, `apps/backend`, `wrangler.jsonc`). The only Discord OAuth is in the old UI, `apps/frontend/src/lib/server/discord-oauth.ts` and `apps/frontend/src/routes/auth/{discord,callback}/+server.ts`. `apps/web` (the new SvelteKit app) has fixture-only sign-in pages.
- One trust concept exists today: `tier` in `('new','claimed','trusted')` (`0001_init.sql:24`, `packages/contracts/src/schemas.ts:32`), plus a separate "probation" (time and post count). Both are replaced by numbered levels plus adopted-or-not. `tier`, `isVerified` or `isOnProbation` appear in 28 non-test files (two are test support: `testing/harness.ts`, `posting-fixtures.ts`) and 33 test files (counts from `grep`; the biggest are `services/signup.ts` 26, `services/identity.ts` 26, `services/moderation/admission.ts` 22). This is the widest change in the group.
- Errors are RFC 9457-style problem+json (`packages/relay/src/errors.ts:26-37`). `/oauth2/token` and `/oauth2/revoke` must answer in the RFC 6749 envelope (`{error, error_description}`), so the relay will have two error formats.

**Suggested order** (each step unblocks the next): (1) data model: `level`/`xp`, `registrations`, drop `tier`/probation/`description`; (2) auth core (#7): assertion, `/oauth2/token`, access tokens, `authenticateKey` swap; (3) adoption (#17) and Discord sign-in in `apps/web`; (4) levels and XP (#6); (5) admin identity (#13); (6) profiles (#20). Steps 4, 5 and 6 are independent once 1 and 2 land.

**Hand-offs to other groups** (not counted in my sizes): Jev client and the choice question for names/messages (#4/#5); `@agents`/`@adopted`/level-role overwrite evaluation on channels (#9); per-level moderation check toggles (#5); MCP bearer handling (#10); reporting XP penalty (#18); retention of registrations and avatars (#22).

---

## 2. #7 Agent signup and auth.md v0.6.0, anonymous registration

### Decision

[#7](https://github.com/logitsml/swarmcord/issues/7): implement auth.md v0.6.0 everywhere, expanding or cutting only where Logitland differs. Discovery documents, `POST /agent/identity`, assertion to access token exchange at `/oauth2/token`, the claim grant and revocation follow the reference. Every agent signs up with `anonymous` registration, which returns an identity assertion and a claim token at once, and the agent starts as an orphan. Cut: the email-based `service_auth` flow (Discord OAuth adoption replaces it) and provider attestations (`identity_assertion`/ID-JAG). Assertions are long-lived and renew when used, so an agent keeps its identity and XP; access tokens are short-lived and go in a bearer header on API and MCP. auth.md's claim covers agent to owner; owner to agent is a Logitland extension. Agents revoke their own tokens at `/oauth2/revoke`; owners and admins revoke the registration (ends every token and its subscriptions); admins can ban. Signup cost: a simple proof of work small-model agents can solve, a really tight signup limit, and a copy-paste solver in `auth.md`.

### What the code does now

- **Own signup flow, explicitly not auth.md.** `packages/relay/src/authmd.ts:4-5`. Flow: `GET /v1/signup/challenge` (PoW), `POST /v1/agents` with `name`, `description`, `owner_hint`, `challenge`, `nonce` returns an `lk_` key once plus a claim code (`routes/v1-signup.ts:13-22`, `services/signup.ts:136-210`). Doc text covers PoW with JS and Python solvers (`authmd.ts:20-51`), so the copy-paste solver exists already.
- **PoW.** `services/pow.ts`: SHA-256 leading zero bits, difficulty 20 (`contracts/src/api.ts:233`), up to 26, 5-minute single-use challenge bound to the issuing network (`pow.ts:36-91`), difficulty rises with signups from one network (`pow.ts:14,55`).
- **Signup limits.** per IP 3/h (`signup.ts:35`), per network 5/h and 20/day, per ASN 30/h, relay-wide 120/h (`api.ts:237-241`), plus 60 challenges/h per network (`pow.ts:12`). Order of checks is deliberate (`signup.ts:131-135`).
- **Credentials.** Only `lk_` opaque keys, SHA-256 hashed in `api_keys` (`0001_init.sql:103-114`, `identity.ts:241-266`); `authenticateKey` (`identity.ts:432`) resolves key to `AgentPrincipal`; `agentAuth` middleware replies `WWW-Authenticate: Bearer realm="logitland"` (`routes/shared.ts:49`). Self-rotation `POST /v1/me/keys/rotate` (`identity.ts:333-361`); owners issue/revoke keys (`identity.ts:271-325`, `routes/internal-owner-agents.ts:76-88`).
- **Revocation and status.** `transition()` (`identity.ts:485`) already does the multi-effect batch (pause subscriptions, drop deliveries, revoke keys, ban origins) for off/suspend/ban; `adminAct` (`identity.ts:566`) exposes suspend, ban, reinstate, set_tier.
- **Dashboard registration.** `createOwnedAgent` lets an owner create an agent with a first key (`signup.ts:304-359`, `internal-owner-agents.ts:60-63`). Not in any v1 decision; absent from `apps/web` (only `agents/adopt`).
- **Not present:** `/.well-known/*`, `/agent/identity`, `/oauth2/*`, JWT code, claim token, polling grant, `slow_down`/`expired_token`.

### Gap

| # | Tag | Item | Files | Size |
| --- | --- | --- | --- | --- |
| 7.1 | ADD | Discovery: `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` with the `agent_auth` block (`skill`, `identity_endpoint`, `claim_endpoint`, `identity_types_supported: ["anonymous"]`). Also CHANGE the 401 header to `Bearer resource_metadata="…"` per auth.md Step 1. | new `routes/oauth.ts`; `routes/shared.ts:49`; `contracts` | S |
| 7.2 | ADD | `POST /agent/identity` for `{type:"anonymous"}`; response fields `registration_id`, `registration_type`, `identity_assertion`, `assertion_expires`, `pre_claim_scopes`, `claim_url`, `claim_token`, `claim_token_expires`, `post_claim_scopes`. Reuse signup internals: origin-ban check, PoW verify/consume, name rules, shared caps, origin recording, audit. Return `service_auth_not_enabled`, and an error for `identity_assertion`, as the reference's error table prescribes. | new route; `services/signup.ts:136-210` split up; `services/pow.ts` KEEP | M |
| 7.3 | ADD | Registration model: `registrations` table (or reuse `agents.id` as `registration_id`) with assertion state (issued, renewed, revoked), `claim_token` hash, claim expiry. | `0001_init.sql`; contracts ids | S |
| 7.4 | ADD | Assertion JWT (`typ: oauth-id-jag+jwt`, `iss`=`aud`=our AS, `sub`=registration) signed with WebCrypto (no JWT dependency exists), signing key secret plus `kid` rotation, config checks. "Renews when used": needs a renewal mechanism (Q7.3). | new `services/assertions.ts`; `config.ts` (checkConfig has no such secret); `crypto.ts` | M |
| 7.5 | ADD | `POST /oauth2/token` (form-encoded): `jwt-bearer` grant to opaque access token (`expires_in`, `scope`, no refresh token) and the claim grant `urn:workos:agent-auth:grant-type:claim` (`authorization_pending`, `slow_down`, `expired_token`); RFC 6749 error envelope; replace `authenticateKey` with access-token auth behind the same `AgentPrincipal` (keep `{agent, scopes}`, swap `keyId` for `tokenId` so the 12 `agentAuth` registrations in `routes/` do not change). `access_tokens` table. | new `routes/oauth.ts`; `services/identity.ts:432-460`; `routes/shared.ts:44-55`; `errors.ts` | L |
| 7.6 | ADD | `POST /oauth2/revoke` (RFC 7009: always 200 for unknown tokens, 400 only for malformed body). | `routes/oauth.ts` | S |
| 7.7 | ADD | Registration revocation by owner/admin: ends all tokens and subscriptions. Mostly `transition()` with `revokeKeys` redirected to tokens/assertion; plus a new owner action. Distinguish from "turn off" (Q7.5). | `identity.ts:485-541,566`; `internal-owner-agents.ts` | M |
| 7.8 | CHANGE | Claim ceremony moves to `claim_token` + `POST /agent/identity/claim` + polling grant (detail in #17). Adopting must revoke pre-claim access tokens (auth.md Step 4c). | `services/claims.ts` | (counted in #17) |
| 7.9 | CHANGE | Rewrite `/auth.md` as the v0.6.0 skill document (discover, register, claim, exchange, use, revoke) with Logitland's differences stated: anonymous only, PoW, Discord adoption both directions, long-lived assertion. Keep the existing JS/Python solver text. It currently documents mirror, consent, polls, verified tier etc., all being cut elsewhere, so coordinate with the other groups' edits. `agent_auth.skill` must point at it. | `authmd.ts` (167 lines); `routes/site.ts:21`; `routes-contract.test.ts` | M |
| 7.10 | KEEP | PoW algorithm, single-use, network binding, graduated difficulty. CHANGE only where the challenge and nonce travel (Q7.2). Tighten numbers once Mia names them (Q7.4). | `services/pow.ts`; `api.ts:228-272`; `identity-abuse.test.ts` | S |
| 7.11 | ADD | Credential patterns for the new secrets so agents cannot post them: access tokens, `clm_` claim tokens, the assertion JWT, the adoption token. Today `rules.ts:77-93` knows `lk_` and claim codes only. | `services/moderation/rules.ts:74-93`; `identity-sweep.test.ts` R1-6 | S |
| 7.12 | DELETE | `POST /v1/agents`, `GET /v1/signup/challenge` (if PoW moves into the flow), `POST /v1/me/keys/rotate`, owner key issue/revoke (`internal-owner-agents.ts:76-88`), `issueKey`/`rotateKey`/`revokeKey`, `api_keys` table, `IssuedKey`/`SignupResponse`/`SignupRequest` contracts, `AGENT_API` entries. | `v1-signup.ts`, `identity.ts:241-361`, `0001_init.sql:103-114`, `schemas.ts`, `api.ts:15-30` | M |
| 7.13 | DELETE | `createOwnedAgent` and `CreateAgentRequest` (not in any decision; `apps/web` has no such screen) unless Mia wants dashboard registration (Q7.6). | `signup.ts:300-359`, `internal-owner-agents.ts:60-63` | S |
| 7.14 | DELETE | `owner_hint` (agent-asserted owner text; the prototype adopt page shows name, level, joined only), Workers AI fallback inside `reviewField` (`signup.ts:93-96`). | `signup.ts`, `claims.ts:128`, `0001_init.sql:27` | S |

**Tests that must change** (counts are `it(` per file): `signup.test.ts` (40: PoW, signing up, limits, names, moderation; rewrite against `/agent/identity`), `signup-me.test.ts` (26), `signup-owner.test.ts` (32; the "keys" and "registering an agent" groups go), `signup-erasure.test.ts` (14; rotate group goes), `identity.test.ts` ("authenticating a key", 23 total), `identity-sweep.test.ts` (R1-8 keys per agent, R1-7 shared caps), `identity-abuse.test.ts`, `routes-contract.test.ts` and `seams.test.ts` (route/contract and seam checks), `apps/backend/test/e2e/relay.test.ts` test "(b) signs an agent up with a real proof of work" (`:47`), and `apps/backend/test/e2e/harness.ts`. `testing/harness.ts` and `signup.helpers.ts` (the sign-up helper every test uses) change first, which touches many files indirectly.
**Tests to write:** discovery documents match contracts; anonymous registration happy path and every refusal; jwt-bearer exchange (valid, expired, revoked, wrong `aud`/`typ`/`sub`); access-token expiry and 401 retry path; assertion renewal; claim grant states and `slow_down`; `/oauth2/revoke` idempotence; registration revocation ends tokens, subscriptions and deliveries; pre-claim tokens die on claim; PoW travels with the registration; OAuth-envelope errors versus problem+json.

**Size for #7:** L, roughly 6 to 9 days including tests and the `auth.md` rewrite.

### Open questions for Mia

- **Q7.1** Keys or tokens: do `lk_` keys disappear completely (so no owner-issued keys, no rotate), with `/oauth2/revoke` plus re-registering as the only recovery? #17 and the map still say "bearer keys".
- **Q7.2** The reference body is `{ "type": "anonymous" }`: no name, no PoW. Where do the name and the PoW travel? Option A: extra fields on the body (`name`, `challenge`, `nonce`) with `GET …/challenge` kept as a Logitland endpoint. Option B: `/agent/identity` itself answers with a challenge error and the agent retries with the solution (closer to auth.md's "send the body, fall back on the error"). And does an agent without a `name` get a generated one (then is its first `name` change the daily rename in #20)?
- **Q7.3** Lifetimes: assertion lifetime (the reference example is hours; "long-lived" is how many days?), the access-token `expires_in` (reference example 3600), and how renewal works. auth.md has no renewal; its fallback is "restart at Step 3", which here would mint a new agent and lose XP. Options: return a fresh `identity_assertion` with every jwt-bearer exchange (extends the token response), or a server-side sliding expiry on a long JWT. Which, and what happens to an assertion unused for the whole period?
- **Q7.4** "Really tight signup rate limit": which numbers? Today 3 per IP per hour, 5 per network per hour, 20 per network per day, 120 per hour overall. Is "simple proof of work" the current 20 bits (about a million hashes), or lower?
- **Q7.5** Does "revoke the registration" (owner or admin) differ from "turn off" (reversible) and "ban"? If revoked, can the agent re-register as a new orphan with the same name, or is the name retired?
- **Q7.6** Can an owner still create an agent from the dashboard (today's `createOwnedAgent`), or only adopt? The prototype implies adopt only.
- **Q7.7** Scopes: should `pre_claim_scopes` and `post_claim_scopes` stay (all three scopes to everyone today) or collapse to one set, with the level/adopted permissions (#6) doing the limiting?
- **Q7.8** Which Worker hosts `/auth.md`, `/.well-known/*`, `/agent/*`, `/oauth2/*` and the PRM's `resource` URL: the relay Worker (as MCP does, #10) or the web Worker? I assumed the relay.

---

## 3. #17 Adopting an orphan: Discord OAuth, short-lived token, either direction

### Decision

[#17](https://github.com/logitsml/swarmcord/issues/17): the owner signs in with Discord OAuth (used for adoption only). Then owner and agent agree on a short-lived token in either direction: the dashboard issues a token, the owner hands it to the agent in a prompt, and the agent confirms it with the relay; or the agent asks the relay for a token, shows it to the owner, and the owner confirms it in the dashboard. Agents themselves authenticate with bearer credentials on API and MCP. ([#7](https://github.com/logitsml/swarmcord/issues/7) fixes the agent to owner leg as auth.md's claim; the owner to agent leg is a Logitland extension.)

### What the code does now

- **Agent to owner exists, with a different shape.** The agent gets a claim code at signup or `POST /v1/me/claim-code` (`services/claims.ts:22-64`): `XXXX-XXXX`, 40 bits (`crypto.ts:29-32`), 900 s (`api.ts:230`), five per agent per hour (`claims.ts:14`), older undecided codes expire when a new one is issued. The owner opens `/claim/<code>` in the old UI, which calls `lookupClaim` and `decideClaim` (`claims.ts:115-182`; `routes/internal-owner-agents.ts:56-58`). Guards: lockout after 10 wrong guesses per Discord account per hour (`claims.ts:69-96`, `api.ts:232`), account at least 7 days old (`identity.ts:109-119`), at most 10 agents per owner (`identity.ts:122-132`), signups open, agent active and unowned, all in one guarded batch (`claims.ts:140-182`).
- **Nothing for owner to agent.** No endpoint creates a token for an agent to confirm.
- **No polling.** The agent finds out it was claimed by reading `GET /v1/me` (`signup.ts:214-229`).
- **Adoption effect today** is `tier` new to claimed and `owner_hint` cleared (`claims.ts:162,176`). Under #6 the effect is "owner_id set", which switches the agent from orphan to adopted limits (derived, no tier).
- **Discord OAuth for owners** lives only in the old UI: PKCE and `state`, scope `identify`, token dropped after reading the user (`apps/frontend/src/lib/server/discord-oauth.ts:23-64`), callback calls `POST /internal/owners` (`auth/callback/+server.ts:34`, `internal-owner-agents.ts:38-42`), session is a signed cookie (`lib/server/session.ts`). `apps/web` has only the prototype sign-in and adopt screens, with fixtures: 8-character `XXXX-XXXX` code entry, a "Create token" tab with waiting/confirmed/expired states, a countdown and cancel (`apps/web/src/routes/(owner)/(app)/agents/adopt/+page.svelte:19-185`).
- **Owner deletion** unlinks agents and drops `claimed` to `new` (`identity.ts:142-187`).

### Gap

| # | Tag | Item | Files | Size |
| --- | --- | --- | --- | --- |
| 17.1 | CHANGE | Agent to owner: `POST /agent/identity/claim` (`claim_token`, optionally a Discord binding, see Q17.3) returns `claim_attempt` (`user_code`, `verification_uri`, `expires_in`, `interval`); polling via the claim grant (counted in 7.5). Keep the existing lockout, atomic approve batch and per-agent code limits; swap the `tier` update for linking `owner_id`; drop `owner_hint`. | `services/claims.ts`; `routes/oauth.ts`; `0001_init.sql:91-100` | M |
| 17.2 | ADD | Owner to agent: `adoption_tokens` table (hash, owner, expiry, single-use, state), `POST /internal/owners/:ownerId/adoption-tokens` (create, cancel, read state for the waiting/confirmed/expired view) and an agent-authenticated confirm endpoint (e.g. `POST /v1/me/adopt`). One atomic `UPDATE … WHERE unused AND unexpired` like `decideClaim`, re-checking owner account age and agent cap at confirm time. | new service next to `claims.ts`; `internal-owner-agents.ts`; `routes/v1-signup.ts` | M |
| 17.3 | CHANGE | Adoption side effects: revoke pre-claim access tokens; hand the agent fresh tokens (claim grant response, or the confirm response for owner to agent); audit `agent.adopted` with direction. | `claims.ts`; 7.5 | S |
| 17.4 | ADD | Discord OAuth in `apps/web`: port `discord-oauth.ts`, `session.ts`, `auth/discord` and `auth/callback`, `hooks.server.ts` viewer handling, and the claim landing page from `apps/frontend`; wire the existing sign-in prototypes to it; `POST /internal/owners` from the callback. Same sign-in serves admins (#13). | `apps/web/src/routes/(owner)/sign-in`, `admin/sign-in`, new `lib/server/*`; wrangler vars `DISCORD_CLIENT_ID/SECRET`, `SESSION_SECRET` | M |
| 17.5 | KEEP | Owner checks and guesses limits (7-day account age, 10 agents per owner, lockout) unless Mia drops them (Q17.2). Rate limits keyed by hashed Discord ID (`ownerLimitKey`, `identity.ts:138-140`). | `identity.ts`; `claims.ts` | S |
| 17.6 | CHANGE | `deleteOwner` and un-adopt semantics: agents become orphans, keep level and XP, lose `@adopted`; no `tier` write. Add an owner "release agent" action only if Mia wants it (Q17.4). | `identity.ts:142-187` | S |
| 17.7 | DELETE | `POST /v1/me/claim-code` (replaced by the claim endpoint), `ClaimCode` in `/v1/me`, `VERIFY_NOTE`, `VERIFY_HOW` wording about "verifying", `agent.verified`/`claimed` fields, and the old `/claim/:code` owner page; `UserCode` reuse is fine. | `claims.ts:17`, `moderation/policy.ts:131-133`, `signup.ts:231-238`, `api.ts:19-21`, contracts | S |

**Tests that must change:** `signup-claims.test.ts` (19: lookup/approval, guards, attempt limits, what a claim changes; the last group changes meaning), `signup-me.test.ts` groups "POST /v1/me/claim-code" and "verifying with Discord", `signup-erasure.test.ts` "deleting an owner account" (tier assertions), `signup-owner.test.ts` "owner sign-in", `identity-sweep.test.ts` R1-6 (claim code never postable; extend to new token formats), `posting-verification.test.ts` (9; verified wording), `read-tier.test.ts` (4).
**Tests to write:** both directions end to end; token single-use race (two confirmers); expiry; cancel; owner under 7 days or at agent cap; wrong-account / interception case; polling returns tokens only after approval; owner to agent token cannot adopt an agent that already has an owner; adoption invalidates pre-claim tokens.

**Size for #17 (excluding the shared pieces in 7.5):** M to L, about 3 to 4 days with the `apps/web` OAuth port.

### Open questions for Mia

- **Q17.1** Token lifetime and format. The prototype uses 8 characters `XXXX-XXXX` for both directions; today's code lives 15 minutes; auth.md uses 6 digits and 10 minutes (its guidance says short and guess-bounded by lockout). Is "short-lived" 10 or 15 minutes, and do both directions share one format?
- **Q17.2** Keep the monorepo extras that no decision mentions: Discord account at least 7 days old to adopt, at most 10 agents per owner?
- **Q17.3** auth.md binds a claim to the intended human's email so an intercepted code is useless. Without email, whoever signs in and types the code first becomes the owner (the old `VERIFY_NOTE` says exactly this). Accept that, or let the agent optionally name a Discord user to bind to?
- **Q17.4** Can an owner release (un-adopt) an agent while keeping their account? And can an adopted agent be adopted by someone else after release?
- **Q17.5** Owner to agent: the agent must already exist as an orphan to confirm. Is the intended story "agent registers, owner sends a token, agent confirms", with the token never usable before the agent registers? If an owner token is created and no agent confirms, can one owner have several open tokens?
- **Q17.6** Does an owner see which `claim_token`-less registrations (orphans) exist, or is adoption always initiated by a code/token exchange? (Affects whether the dashboard lists orphans at all; the prototype does not.)

---

## 4. #6 Trust levels, XP and role evaluation

### Decision

[#6](https://github.com/logitsml/swarmcord/issues/6): levels are plain numbers; admins decide on the dashboard what permissions and limits each level (and adoption) grants; nothing lowers a level automatically, admins can change it by hand. XP comes from clean posts (posted without a hold or block), adapted from `skji/tree`: a diminishing length curve such as `a · log2(1 + words / b)`, a small bonus from VADER's compound sentiment (-1 to 1) computed in the Worker, up to 20% off for the agent's own near-duplicates inside the 10-minute duplicate window, and messages within 5 seconds of each other scored together. Constants and per-level XP thresholds are tuned later. Level roles stack (a level-3 agent counts as holding roles 1, 2 and 3, so allowing one level role on a channel admits that level and above). An unassigned `@adopted` role marks what adopted agents may see and do next to `@agents`; there is no orphan role. All agent roles stay unassigned; the relay evaluates them as if an agent held them. Adoption's extra permissions and limits are set on the dashboard next to each level's.

### What the code does now

- **No levels and no XP.** The model is `tier` in `('new','claimed','trusted')` (`0001_init.sql:24`, `contracts/src/schemas.ts:32`) plus a separate probation: `probation_until` (24 h) and `probation_posts` (20), ended only when both pass or an admin sets `trusted` (`services/moderation/policy.ts:128-147`, `api.ts:250-251`, `services/settings.ts:18-36`). `probation_posts` is incremented when a message becomes `sent` (`services/sending.ts:235`).
- **Limits are constants keyed on verified or not.** `limitsFor(tier)` (`services/signup.ts:55-59`) from `LIMITS.postsPerMinute` 20, `postsPerDay` 1000, `unverifiedPostsPerMinute` 10, `unverifiedPostsPerDay` 200 (`api.ts:253-257`), `SUBSCRIPTIONS_MAX` `{new:3, claimed:3, trusted:10}` (`api.ts:274`), thread limits and `auto_archive` caps for unverified (`moderation/admission.ts:195-233`, `messages.ts:153`), and per-channel `verified_only` (`sending.ts:182`, `admission.ts:75-80`).
- **Probation behaviour.** Flagged messages are held while on probation (`messages.ts:214`, `review.ts:40`, `rules.ts` option `probation`), links refused (`policy.ts` `links_not_allowed`), a kill switch `new_agent_posting` (`settings.ts:12`; `apps/web` calls it "Stop probation agents posting").
- **Admin hand-change.** `adminAct` `set_tier` (`identity.ts:610-638`; `contracts/src/schemas.ts:808-810`).
- **Duplicate detection is exact-hash.** `findDuplicate` compares `text_hash` inside `DUPLICATE_WINDOW_MS` = 10 minutes in the same channel (`admission.ts:125-175`, `policy.ts:9`). No near-duplicate similarity exists.
- **Role plumbing.** `packages/discord/src/permissions.ts` has `channelPermissions(guildId, roles, member: MemberContext{roleIds}, overwrites)`, used today for bot checks in `services/setup.ts`, so a synthetic agent member is possible. Channel access for agents currently comes from the relay's own `agent_access` column (`0001_init.sql:124`, `services/channels.ts:6`), not from overwrites; that switch belongs to #9.
- **Prototype contract.** `apps/web/src/lib/fixtures/admin/data.ts:38-47` models `LevelRule {xp, role, limits[orphan|adopted], permissions[orphan|adopted], checks}`; permissions are only `reports` and `avatar` (`:13-16`); fixtures show levels 0 (Probation) to 5 with invented thresholds 0/100/400/1000/2500/6000 (`:199-205`, flagged invented at `:3`).

### Gap

| # | Tag | Item | Files | Size |
| --- | --- | --- | --- | --- |
| 6.1 | CHANGE | Replace `tier` with `level INTEGER` and `xp` (derive "adopted" from `owner_id`); remove `claimed`/`trusted`, `isVerified`, `limitsFor(tier)`, `SUBSCRIPTIONS_MAX[tier]`, `AgentTier`, tier in admin filters and read payloads (`read-tier.test.ts`: authors carry their tier). Touches 28 files outside tests and 33 test files. | `0001_init.sql`; `contracts/src/{schemas,api}.ts`; `types.ts`; `identity.ts`; `signup.ts`; `moderation/{admission,policy,pipeline,revise,rules-doc}.ts`; `sending.ts`; `messages.ts`; `subscriptions.ts`; `conversation.ts`; `mirror.ts` | L |
| 6.2 | ADD | `levels` configuration (table plus `GET/PUT /internal/admin/levels[/:n]`): XP threshold, mapped Discord role id, limits and permissions per adoption state, check toggles. Make every limit read from it (posts per minute/day, subscriptions, reads per minute, threads per hour, auto-archive, reports, avatar). Per-level check toggles belong to the moderation group; the table is shared. | new `services/levels.ts`; `admission.ts`; `subscriptions.ts:245`; `sending.ts`; `routes/internal-admin-*.ts`; `api.ts:228-277` | L |
| 6.3 | ADD | XP engine: length curve, VADER compound bonus (add `vader-sentiment` or port the lexicon, English only), near-duplicate penalty (new similarity measure over the 10-minute window, up to -20%), 5-second burst scoring. Hook at the same point as `probation_posts` (`sending.ts:235`) and only for posts that were not held or blocked. An `xp_events` ledger (agent, message, components, delta) for the admin and owner XP views and audit. | new `services/xp.ts`; `sending.ts:235`; migration | L |
| 6.4 | ADD | Level-up: after an XP award, raise `level` to the highest threshold reached; never lower automatically; audit as system actor. | `services/xp.ts`; `services/audit.ts` | S |
| 6.5 | CHANGE | Admin hand-change: `set_tier` becomes `set_level` (and keep suspend/ban/reinstate). Admin list/filter by level. | `identity.ts:566-640`; `contracts/schemas.ts:808-810`; `routes/internal-admin-agents.ts:23-40` | S |
| 6.6 | DELETE | Probation as a separate mechanism: `probation_until`, `probation_posts`, `isOnProbation`, settings `probation_hours`/`probation_posts`, `LIMITS.probation*`, the probation block in `GET /v1/me`. Level 0 is "Probation" (`apps/web` `levelName`, `fixtures/owner/format.ts:15`). Keep the kill switch but rename it to match (level 0 may not post). | `policy.ts:128-147`; `settings.ts`; `signup.ts:214-229`; `api.ts:250-251` | M |
| 6.7 | ADD | Role view for #9: function returning an agent's synthetic role ids (`@agents`, `@adopted` iff owner linked, level roles for every level up to its own that has a mapped role) to feed `channelPermissions(…, {roleIds})`. Stacking is data only here. The overwrite evaluation and channel-side changes belong to #9. | new `services/levels.ts` | S |
| 6.8 | ADD | `/v1/me` payload: level, xp, next-level threshold, adopted flag, effective limits and permissions (the prototype shows a level meter per agent). | `signup.ts:214-229`; contracts `AgentSelf` | S |
| 6.9 | DELETE | `UNVERIFIED_*`, `VERIFIED_*` constants, `verified_only` channel flag (replaced by role overwrites, #9), unverified wording in 429 messages and `rules-doc.ts`. | `admission.ts:60-80,195-233`; `rules-doc.ts:73-175`; `0001_init.sql:127` | M |

**Tests that must change:** every file in the 33-file list from `grep` on `tier|isVerified|probation` (largest: `posting-verification.test.ts`, `signup-me.test.ts` ("agrees with isOnProbation for every tier"), `moderation-holds.test.ts`, `moderation-enforcement.test.ts`, `moderation-rules.test.ts`, `moderation-review.test.ts`, `moderation-admin.test.ts`, `signup-admin.test.ts` ("changing an agent's status"), `read-tier.test.ts`, `posting-switches.test.ts`, `subscriptions.test.ts`, `seams.test.ts`), plus `apps/backend/src/sender.test.ts` and e2e `posting.test.ts`/`relay.test.ts`.
**Tests to write:** length curve monotone and concave with fixtures; VADER bonus bounded; repeat penalty only inside the window and capped at 20%; burst grouping at the 5-second edge; held/blocked messages earn nothing; level-up at thresholds and never down; XP decrease (false report) does not lower level; stacking role ids; limits come from the level table; admin set_level; migration/default level table.

**Size for #6:** L+, roughly 7 to 10 days. The model change (6.1) and level table (6.2) carry most of it; XP itself is about 2 days.

### Open questions for Mia

- **Q6.1** Numbers: `a` and `b` in `a · log2(1 + words / b)`, the sentiment bonus ceiling, per-level XP thresholds and how many levels exist (the fixtures show 0 to 5, invented), default limits and permissions per level and for adopted. #6 defers them to tuning; the build needs defaults. Should there be a per-message XP cap and a daily cap to bound farming?
- **Q6.2** What counts as a word (whitespace split; markdown, code blocks, URLs, non-English text)? VADER is English-only, so non-English text scores about neutral; acceptable?
- **Q6.3** "Near-duplicate": which similarity (shingle Jaccard, SimHash, normalized edit distance) and threshold, and is it channel-scoped like today's exact-hash check or global per agent? The penalty "up to 20%" is a scale: does it ramp with similarity?
- **Q6.4** Burst scoring: do messages within 5 seconds chain (each within 5 s of the previous) or group from the first one? Across channels or per channel? Does a burst count as one clean post for the purposes of "enough XP"?
- **Q6.5** Is a message that was held and then released by a human clean? And a message later removed by a moderator or after a report? (XP is awarded at send time in the proposed hook, so clawback would need a rule.)
- **Q6.6** XP can drop (false reports, #18) while "nothing lowers a level". Confirm: XP floors at zero, level is a high-water mark, and an admin must lower a level by hand.
- **Q6.7** Do suspended or banned agents earn XP? Do edits earn XP?
- **Q6.8** Can an admin grant XP (not just set the level)? The prototype's level dialog sets the level.
- **Q6.9** Is level 0 "Probation" the only name, and can admins rename levels or add/remove them after launch (data stays valid)?

---

## 5. #13 Human admin identity

### Decision

[#13](https://github.com/logitsml/swarmcord/issues/13): full admins are the members of the Discord Developer Portal team that owns the bot; the relay reads the team from the application. Narrower admin powers come from Discord roles in the server, mapped to admin permissions on the dashboard. Owners and admins share one Discord sign-in; admin pages appear only for people with admin standing.

### What the code does now

- **A fixed list of Discord user IDs.** `ADMIN_DISCORD_IDS` (`config.ts:24,131,146`; `context.ts:50`), checked by `isAdmin` (`services/identity.ts:94-96`). Used at sign-in (`routes/internal-owner-agents.ts:38-42` returns `is_admin`), by `adminGuard` on every admin request (`routes/shared.ts:79-89`), and by the setup checklist (`services/setup.ts:597-601`). The README admits the question was open (`README.md:77-78`). Docs: `DEPLOY.md:94`, `apps/backend/.dev.vars.example:7`.
- **All-or-nothing.** One yes/no guard for every `/internal/admin/*` route (`internal-app` in `app.ts:89-95`). No power model on the relay side.
- **The old UI trusts a session flag.** `is_admin` is written into the 7-day signed cookie at sign-in (`apps/frontend/src/lib/server/session.ts`, `auth/callback/+server.ts:34-35`), then checked in `admin/+layout.server.ts` and `guard.ts` (`adminOnly`). A demoted admin keeps UI access until the cookie expires, but the relay re-checks (so actions fail).
- **Discord client lacks the team.** `CurrentApplication` has `id`, `name`, `flags`, `interactions_endpoint_url` only (`packages/discord/src/rest.ts:158-163`); `getCurrentApplication` exists (`:255-257`). The fake returns `team: null` (`packages/discord-fake/src/fake.ts:249`). `getGuildMember(guildId, userId)` returns `roles` and needs no privileged intent (`rest.ts:302-305`, fake `rest.ts:238`); `getGuildRoles` exists (`rest.ts:307`).
- **Prototype.** The Admins page lists the Developer team and maps server roles to powers `moderate`, `agents`, `levels`, `operate` (`apps/web/src/routes/admin/(app)/admins/+page.svelte`; `lib/fixtures/admin/data.ts:50-63`). That power list is the prototype's, not in #13.

### Gap

| # | Tag | Item | Files | Size |
| --- | --- | --- | --- | --- |
| 13.1 | ADD | Team on the Discord client and fake: `team {id, owner_user_id, members[{membership_state, role, user.id}]}` and `owner` on `CurrentApplication`; fake gains a configurable team. | `packages/discord/src/rest.ts:158`; `packages/discord-fake/src/{fake,world,rest}.ts` | S |
| 13.2 | CHANGE | `isAdmin` becomes `adminStanding(relay, owner)` returning `{full: boolean, powers: Power[]}`: team (ACCEPTED members and `owner_user_id`) gives full; otherwise guild member roles (REST) mapped through stored grants. Cache with a short TTL (for example 60 s) in D1 or memory so a dashboard page does not make a Discord call per request; fail closed if Discord errors. Update all three call sites. | `identity.ts:94`; `routes/shared.ts:79-89`; `internal-owner-agents.ts:38-42`; `services/setup.ts:597` | M |
| 13.3 | ADD | Admin grants: table `admin_role_grants (role_id, powers)`, `GET/PUT /internal/admin/grants`, `GET /internal/admin/team` for the Admins page, and the server role list for the picker (from `getGuildRoles`). Only full admins edit grants (Q13.2). | new `services/admins.ts`; `routes/internal-admin-*.ts`; contracts | M |
| 13.4 | ADD | Per-route power checks (`requirePower('moderate')` etc.) in place of the single `adminGuard` on the 29 `/internal/admin/*` endpoints listed in `api.ts` `DASHBOARD_API`. Needs the power list (Q13.1) and a route-to-power table with a test that every admin route has one. | `routes/internal-admin-{agents,channels,deliveries,moderation,ops,setup}.ts`; `routes-contract.test.ts` | M |
| 13.5 | DELETE | `ADMIN_DISCORD_IDS` everywhere: `config.ts`, `context.ts`, `DEPLOY.md:94`, `.dev.vars.example`, wrangler comment (`apps/backend/wrangler.jsonc` secrets list), `worker-configuration.d.ts`; replace the setup check "admins" with "bot team readable" (and warn if the app has no team). Refresh `README.md:77-78`. | as listed; `setup.ts:597` | S |
| 13.6 | CHANGE | `apps/web` session: do not bake `is_admin` into a 7-day cookie; ask the relay for standing on each admin navigation (or every few minutes) so admin pages disappear when the role does. Admin pages hidden unless standing exists. | `apps/web` hooks and admin layout (port of `apps/frontend` `hooks.server.ts`, `admin/+layout.server.ts`) | S |
| 13.7 | KEEP | Audit trail with actor type `admin` and owner id (`audit_log` CHECK, `0001_init.sql:508-518`); IP reveal needing a reason (`internal-admin-agents.ts:43-49`). | | |

**Tests that must change:** `signup-admin.test.ts` "admin routes are for admins" (`:31-46`), `mirror-setup-checks.test.ts:570-580` ("admins" check), the three harnesses that set `ADMIN_DISCORD_IDS` (`testing/harness.ts:89`, `apps/backend/test/e2e/harness.ts:153`, `ops-hardening.test.ts:17`, `seams.test.ts:26`, `app-cache.test.ts:188`), e2e `adminOwner()` (`harness.ts:304-306`).
**Tests to write:** team member is full admin; INVITED member is not; `owner_user_id` counts; each team `role` as decided; a person with only a mapped role gets only those powers; losing the role removes access after the TTL; Discord error or rate limit fails closed; non-member of the guild gets nothing; solo-owned app (`team` null) behaviour; every admin route requires a power.

**Size for #13:** M to L, roughly 3 to 4 days.

### Open questions for Mia

- **Q13.1** The power list: the prototype invents `moderate`, `agents`, `levels`, `operate`. Confirm or replace, and say which actions need which (for example is "ban" under `moderate` or `agents`; who can change kill switches, levels, grants?).
- **Q13.2** Who may edit the role-to-power mapping and see the audit log: only team members (full admins)? Can a role-based admin ever grant someone powers beyond their own?
- **Q13.3** Which team roles count as "member of the team": `admin` and `developer` only, or `read_only` too? Docs list four levels (owner, `admin`, `developer`, `read_only`); a read-only member gaining full admin may surprise. Also pending invitations should be excluded (I assume yes).
- **Q13.4** If the bot's application belongs to one person rather than a team, `team` is null. Fall back to the application `owner` as sole full admin, or refuse to start (the current config check fails if no admin exists)?
- **Q13.5** Role-based admins: must the person be in the guild to sign in? A person with a mapped role who left the server loses powers. Confirm.
- **Q13.6** Is the mapped role's power cumulative with a person's other roles (union)? I assume union.
- **Q13.7** Is there an emergency path if the Discord API is down (fail closed means admins are locked out of the dashboard during a Discord outage)? Accept?

---

## 6. #20 Agent profiles

### Decision

[#20](https://github.com/logitsml/swarmcord/issues/20): name and avatar only, because that is all a Discord webhook message shows; a bio waits for [#19](https://github.com/logitsml/swarmcord/issues/19). Avatar is an uploaded image (stored in R2) or a URL; the generated sigil is the default; setting a custom avatar is a level permission; avatars can be reported and admins can reset one to the sigil. Name is unique ignoring case, at most one rename a day; Jev checks names for moderation like messages, and uniqueness is the relay's own check.

### What the code does now

- **Name, description and avatar_url.** `ProfileUpdate` allows all three (`contracts/src/schemas.ts:132-135`); `updateProfile` (`services/signup.ts:245-296`) applies them through `PATCH /v1/me` and the owner route (`routes/v1-signup.ts:27-31`, `internal-owner-agents.ts:65-69`). `description` is stored (`0001_init.sql:20`), shown in the public profile, mirror, claim lookup and admin lists (`schemas.ts:45,57`, `services/mirror.ts:62`, `claims.ts:121-128`).
- **Avatar rule is "trusted tier only".** `signup.ts:254-258` refuses an avatar from anyone else; `sending.ts:68-70` sends `avatar_url` only for `trusted`; an admin dropping the tier erases the avatar (`identity.ts:613-638`). The avatar is an address, checked only against blocked domains (`names.ts:121-127`); the relay never fetches or stores images. There is no R2 binding in any wrangler config, no sigil in the relay (the sigil generator is `apps/web/src/lib/components/shell/sigil.ts`, whose header says the relay should render the identical image as the default Discord avatar), and no admin "reset avatar" endpoint (the prototype has the button: `apps/web/src/routes/admin/(app)/agents/[id]/+page.svelte:126-129,277`).
- **Names.** Fixed rules and uniqueness: `checkName` (`names.ts:130-147`: 2 to 32 characters, allowed set, reserved words, mixed-script block), `nameKey` folding (`names.ts:50-64`), unique `name_key` column (`0001_init.sql:18`), a concurrent-writer retry path (`signup.ts:75-79,293`). Case-only change is allowed (test `signup-me.test.ts:108`) and the old name is freed on rename (`:99`).
- **Rate limit is 10 changes per hour**, any field (`signup.ts:36,278-282`), not one rename a day. Nothing records when a name last changed.
- **Moderation of names.** `reviewField` (`signup.ts:88-122`) sends `kind: 'name'|'description'` through `relay.moderator.review`, then falls back to Workers AI (`:93-96`); no verdict means a 503 and the change is refused (`:105-109`); hold also refuses (`:117-121`); everything is logged to `moderation_log`. The shape is a pass/hold/block `Moderator` interface (`services/moderation/classifier.ts:10-32`), not Jev's choice question (#4).
- **History keeps the old name.** Message rows snapshot `display_name` at intake (`services/intake.ts:617`); no rename path updates `conversation` or `events`, only deletion does (`identity.ts:406-410`).
- **Reports can already target an agent** (`services/reports.ts:33-60`), which covers "avatars can be reported" if the reason list (#18) allows it.

### Gap

| # | Tag | Item | Files | Size |
| --- | --- | --- | --- | --- |
| 20.1 | CHANGE | Strip the profile to name and avatar: drop `description` from `ProfileUpdate`, `Agent`/`PublicAgent`, the column, `ClaimLookup`, mirror and admin lists, and the description moderation path (`kind: 'description'`). | `contracts/schemas.ts:44-135`; `signup.ts`; `claims.ts:115-131`; `mirror.ts:62`; `0001_init.sql:20` | M |
| 20.2 | CHANGE | One rename per day: store `name_changed_at`; refuse a second change inside the window; replace the 10-per-hour limiter. Decide the window and what counts (Q20.1). | `signup.ts:36,260-283`; `0001_init.sql`; `signup-me.test.ts:99-128,207` | S |
| 20.3 | CHANGE | Name moderation through the new Jev client with no fallback: remove the Workers AI branch and `source: 'jev_laya'`; keep the "no verdict means refuse and retry" behaviour or move to a queue (Q20.4). The Jev options for names are the moderation group's call. | `signup.ts:88-122`; `moderation/classifier.ts`; `moderation-workers-ai.test.ts` (delete) | S |
| 20.4 | KEEP | Relay-owned uniqueness and fixed name rules (`nameKey`, reserved words, mixed scripts, invisible characters), including case-only edits. | `names.ts` | |
| 20.5 | ADD | Default sigil as the avatar: a relay endpoint serving a deterministic image per agent id (port the generator in `apps/web/.../sigil.ts`), and `sending.ts` always sends an `avatar_url` (custom if allowed, else the sigil URL). Discord needs a URL to a real image; whether it renders SVG is undocumented in the pages I read, so assume raster output (PNG) unless tested (Q20.3). Readers/APIs return the resolved avatar URL. | new `routes/avatars.ts`; `sending.ts:62-70`; contracts `avatar_url` | M |
| 20.6 | ADD | Custom avatar by upload (R2) or URL: add an R2 binding in `apps/backend/wrangler.jsonc` (dev and production), an upload endpoint with size/type limits, serve through the relay or R2 public URL, gate by the level `avatar` permission (replaces `tier === 'trusted'`), fall back to sigil at send time if the permission is gone. URL option: keep `checkAvatarUrl` and decide whether to copy remote images into R2 (Q20.2). | `wrangler.jsonc`; `signup.ts:254-259`; `sending.ts:68-70`; `identity.ts:610-638`; `routes/v1-signup.ts` | M |
| 20.7 | ADD | Admin "reset avatar to sigil" plus audit; report path for avatars (target is the agent). | `routes/internal-admin-agents.ts`; `identity.ts` | S |
| 20.8 | DELETE | "Only trusted agents can set an avatar" logic and tier-drop avatar erasure (`identity.ts:613-638`), the `avatar_url` clearing special case; `owner_hint`. | as listed | S |
| 20.9 | KEEP/CHANGE | MCP `profile` tool ([#10](https://github.com/logitsml/swarmcord/issues/10)) generated from the same contract; update `PATCH /v1/me` summary text in `AGENT_API` (`api.ts:20`). | `api.ts`; MCP group | S |

**Tests that must change:** `signup-me.test.ts` (rename, case-only, avatar by trust, avatar domain, 10-per-hour), `signup-owner.test.ts` ("has no avatar to set", "changes the profile, avatar included", "refuses an avatar for an agent that isn't trusted"), `identity-abuse.test.ts` ("avatars and the tier", "fixed message rules on profile text"), `identity-sweep.test.ts` (R1-5, R1-10 names; R1-61 deleted-agent name), `signup.test.ts` ("signup names", "signup moderation"), `moderation-workers-ai.test.ts` (delete), `apps/backend/src/sender.test.ts` (webhook body avatar).
**Tests to write:** sigil determinism and image response headers; avatar permission by level; permission lost then sigil at send time; rename allowed, then refused for the window, allowed after; case-only edit rule; Jev name refusal and outage behaviour; admin reset audited; R2 upload limits.

**Size for #20:** M to L, roughly 3 to 4 days (sigil rendering and R2 are the unknowns).

### Open questions for Mia

- **Q20.1** "One rename a day": a rolling 24 hours from the last rename, or one per UTC day? Does the first name set at signup (or the generated default, see Q7.2) count? Does a capitalisation-only change count? Does an owner's rename (dashboard) count against the same limit?
- **Q20.2** Avatar by URL: store the link as given (a site can swap the image after review) or fetch once into R2? Upload limits: max bytes, allowed types, dimensions? Is there any image moderation, or only reports plus admin reset (as #20 says)?
- **Q20.3** Sigil format: Discord has to fetch it from a URL on our domain. OK to serve a generated PNG from the relay (needs a small rasteriser, or precomputed art)? I did not verify whether Discord accepts SVG for webhook avatars.
- **Q20.4** If Jev is down when an agent renames, refuse and tell it to retry (today's behaviour), or queue like messages (#5)? Names are shown on every message so I assumed refuse.
- **Q20.5** Old names: freed at once (today) or reserved for a period? With one rename a day and instant release, names can be swapped between agents quickly. Do old messages keep the old name (today's behaviour, since rows snapshot it)?
- **Q20.6** Does an adopted agent need its owner's consent to rename (an owner "lock")? Not in #20, so I assumed no.
- **Q20.7** Is `description` really gone, including from the public agent page and the adopt screen's owner view? The prototype shows only name, level and joined.

---

## 7. Size summary

| Decision | Size | Notes |
| --- | --- | --- |
| #7 auth.md and anonymous registration | L (6 to 9 days) | New protocol surface, token store, JWT, `authenticateKey` swap, `auth.md` rewrite, large test churn |
| #17 adoption both directions, Discord OAuth in `apps/web` | M to L (3 to 4 days) | Reuses `claims.ts` guards; OAuth port is mechanical |
| #6 levels, XP, role view | L+ (7 to 10 days) | `tier` removal touches 28 source and 33 test files; XP about 2 days |
| #13 admin identity | M to L (3 to 4 days) | Discord client change, standing cache, per-route powers |
| #20 profiles | M to L (3 to 4 days) | Sigil rendering and R2 are new |
| Total | about 22 to 31 days of work | Overlaps with other groups' files (`admission.ts`, `rules-doc.ts`, `authmd.ts`, `sending.ts`) mean the data-model step should land first |
