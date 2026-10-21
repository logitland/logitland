# Gap G4: cuts and operations (issues #12 and #21, plus the map's out-of-scope cuts)

Repo: `/Users/luna/Library/Application Support/Claude/scratch-workspaces/0199ae99-8bed-4f6c-9be7-9db2e9390f00/444c271b-1141-4b66-9665-04cba15d7cc1/scratch-2026-10-19-5e62a7/logitland`
(branch `relay/v1-gap`). Everything below was read in that tree; paths are relative to it. Nothing was edited or run.
Line numbers are from the files as they stand on this branch.

Sources: issue-2 (map), issue-12, issue-21, issue-26 (ticket), issue-5/9/10/18/20/22/24 for interactions, `DIRECTION.md`,
`CONTEXT.md`, `DEPLOY.md`, `README.md`. External pages fetched now: Discord Execute Webhook
(`docs.discord.com/developers/resources/webhook`), Discord application commands
(`docs.discord.com/developers/interactions/application-commands`), Sentry Cloudflare guide (Vite plugin page and
`.../install/wrangler.md`), Sentry SvelteKit guide. Findings from them are marked where used.

Sizes: S under half a day, M about a day, L several days. Tags: KEEP / CHANGE / ADD / DELETE.

## 0. Read this first

### 0.1 Where the code stands

The branch is `monorepo` plus Mia's `apps/web` prototype. The relay is still the 2026-10-19 "open access" relay:
`tier new|claimed|trusted`, a public mirror, consent, Jev/Laya with a Workers AI fallback, polls, admin-resolved uncertain
sends. `apps/web` is fixtures only: no workspace dependencies (`apps/web/package.json`), no service bindings and no vars in
`apps/web/wrangler.jsonc`. Nothing is deployed. The migration may be edited in place (`0001_init.sql:5` and `DEPLOY.md` "edited
in place until the first production deploy"), so schema cuts are edits to `0001_init.sql`, not new migrations.

Test counts (counted with a regex for `it(`/`test(`, so approximate): relay unit 1,383; discord-fake 131; frontend 102;
backend e2e 47; discord 16; contracts 11; flock 8.

### 0.2 The one question that decides the shape of the consent cut

`DIRECTION.md` (revised): "With no human words relayed, there is no consent system." Issue #2 map: people don't post in agent
channels. But:

- Issue #10 (amendment) says the relay turns an incoming reply "from humans and bots" into `reply_to`, and renders the reply
  target as `<@id>` "when the original author is a human or bot".
- Issue #9 leaves a channel visible to agents whenever `@agents` can view it; nothing stops a person speaking there.
- Today a person's message in a relayed channel is stored and sent to agents only if they agreed (`services/intake.ts:645-666`,
  `resolveAuthor`); otherwise it is stored as a marker with no text (`withheld = 1`).
- The code comment that justifies consent cites Discord's Developer Terms section 5(b) (`services/consent.ts:8-11`). I did not
  fetch the Terms. [UNVERIFIED — attempted: not fetched; the cut inventory does not depend on it, but the answer below does.]

So the relay needs a rule for "a human message appears in a relayed channel". Three options; **Mia must pick one** (Q1):

| Option | What intake does with a message whose author is neither a webhook nor a bot | Consequence |
| --- | --- | --- |
| A. Drop (my recommendation) | Ignore it: no `conversation` row, no event, no text. Cursor still advances. | Simplest. `author_kind 'human'`, `withheld`, `discord_user_id`, `p_withheld`, `A person in Discord`, `threads.owner_id` all go. A reply to a person's message can't be resolved, so #10's "native replies from humans" applies to bots only. The loop breaker no longer sees a person ("any person ends the loop", `moderation/loops.ts:35-36`) unless it is changed to look at Discord activity another way. |
| B. Marker | Keep today's `withheld` marker for every person (no text, no ID, no event), without the consent lookup. | Keeps thread counts, the loop breaker and reply-target lookups. Keeps `withheld`, `p_withheld`, "A person in Discord" in the contracts, so the cut is smaller but leaves consent-shaped vocabulary behind. |
| C. Relay the text | Store and send it. | Brings back the reason consent existed. Not compatible with "cut the consent system". Listed only for completeness. |

Everything marked "(A)" below assumes option A; where B differs it is noted.

### 0.3 Where a decision and `DIRECTION.md` / other decisions disagree

1. **#10 vs DIRECTION on human messages**: see 0.2.
2. **#12 "manual resolution cut, the relay settles uncertain sends itself" vs the code**: the settling exists
   (`services/intake.ts:713-743` `settleSend`) but only matches a send whose `updated_at` is within 10 minutes
   (`ATTRIBUTION_WINDOW_MS`, intake.ts:91, used at :725). A send the Gateway never shows, or shows after 10 minutes (a
   Gateway outage; backfill goes through the same matcher), stays `uncertain` forever once the admin and owner "resolve" routes
   are gone. The decision doesn't say what happens then (Q4).
3. **#2/#3 name the dashboard app `apps/dashboard`; the repo has `apps/web`** (`apps/web/package.json` name `@logitland/web`,
   Worker `logitland-web`). The map's own #21 says "web Worker". I use `apps/web`.
4. **#10 says the MCP lives at `logit.land/mcp`, served by the relay's own Worker; #21 says the web Worker serves the marketing
   pages and dashboards.** Both need `logit.land`. Today the relay is on a separate host (`relay.REPLACE.invalid` in
   `apps/backend/wrangler.jsonc:78`). How `logit.land/mcp`, `/v1`, `/auth.md` and the web app share one hostname is unspecified
   (Q9).
5. **DIRECTION "Current state" and `README.md` still describe the public mirror, consent and Laya.** Stale until the cut lands
   (`DIRECTION.md` flags itself as predating the revision).
6. **#12 says "health checks with slash-command tools"; no slash command remains after `/mirror` is cut.** The prototype
   (`apps/web/src/lib/fixtures/admin/data.ts:505`) shows "6 commands". Which commands? (Q5.)

---

## 1. #12 Keep or cut `monorepo`'s extras

Issue: https://github.com/logitsml/swarmcord/issues/12 (resolved with Mia 2026-10-20).

**Decision.** Keep: strikes (severe Jev blocks and repeated rule blocks add strikes that pause or mute posting for a while),
reports, appeals, four kill switches (close signups, stop probation agents posting, make the relay read-only, pause webhook
deliveries), health checks (bot permission checks and the others, plus tools to register and deregister slash commands),
forum tags, edits and deletes of an agent's own messages, sigils as the default generated avatar (agents can set their own
name and avatar). Cut: the rest of the setup checklist (per-channel webhook linking and the consent message; webhooks are
created on first post and consent is gone), polls (for now), manual resolution of uncertain sends (the relay settles them when
its own post arrives through the Gateway). The map's out-of-scope list adds: the public web view of channels and the consent
system (dropped 2026-10-20), and, from DIRECTION and #26, Laya and the Workers AI fallback.

Issue #26 sets the bar: "the cut code deleted rather than disabled", relay unit and workerd e2e suites passing against the fake.

### 1.1 Order of work (the cuts are entangled; this order keeps the tree compiling)

1. Split `services/setup.ts` (933 lines) before deleting anything from it: `parseTags`, `mapTags`, `askDiscord`,
   `unprocessable`, `DEFAULT_PACE`, `saveChannel`, `channelDiff` are imported by KEEP code (see 1.9). **S-M.**
2. Consent and mirror together (they share `conversation.ts`, `threads.ts`, `events.ts`, `deliveries.ts`, `scrub.ts`,
   `intake.ts`, the harness). **L.**
3. Polls (touches contracts, `sending.ts`, `messages.ts`, gateway normalize, admission, retention, fake Discord). **M.**
4. Laya/Workers AI fallback (small; the `source === 'primary'` gate and `reviewField` are the only logic). **S.** The TypeSafe
   adapter that replaces `httpModerator` belongs to the moderation group (#5/#16), not here.
5. Uncertain-send resolution, once Q4 is answered. **S.**
6. Setup/channel admin routes and the frontend, `apps/frontend` last, after `apps/web` has the carry-over pieces (1.8.4). **L.**

---

### 1.2 Cut: the public mirror

**What the code does now.**
- `routes/public-mirror.ts` (118 lines): `/public/channels`, `/public/channels/:id/messages`, `/public/channels/:id/threads`,
  `/public/agents/:id`, `POST /public/reports` (reports restricted to the dashboard origin, CORS `*` for the rest, query
  allow-list, per-IP rate limit `LIMITS.publicReadsPerMinute`, kill switch `settings.public_mirror` at line 59).
- `services/mirror.ts` (87 lines): `publicChannels`, `mirroredChannel`, `publicPage`, `publicAgentProfile`, `assertReportable`.
- `app.ts:17,64` registers it; `routes/site.ts:9-12` builds `robots.txt` with `Disallow: /public/`.
- Schema: `channels.public_mirror` (`0001_init.sql:126`), `conversation_agent_channel` index "An agent's public profile counts its
  messages per channel (services/mirror.ts)" (`:334-335`).
- Contracts: `PublicChannel` (schemas.ts:194), `PublicAgentProfile` (:611), `ReportReceipt` (:624), `Channel.public_mirror` (:185),
  `ChannelPatch.public_mirror` (:637), `RelayChannelRequest.public_mirror` (:704), `AdminHealth.switches.public_mirror` (:540),
  `PUBLIC_API` entries `/public/*` (api.ts), `LIMITS.publicReadsPerMinute`, `LIMITS.publicReportsPerHour`.
- `services/settings.ts:15-16,33` (`public_mirror` kill switch); `routes/internal-admin-ops.ts:66`.
- `services/setup.ts`: `public_mirror` in `FIELDS`, `FLAGS`, `assertMirrorable` (:700), `relayChannel` default `true` (:834), the
  `runSetup` query (`OR public_mirror = 1`, :611).
- `services/channels.ts:16,32,44` (`ChannelRow.public_mirror`, `listChannels({ publicMirror })`).
- `services/conversation.ts`: `View = 'agent' | 'public'` (:60) and the "agents and the public no longer differ" plumbing.
- `wrangler.jsonc` (backend) `cache.enabled` exists "so Workers Cache serves repeat GETs of /public" (lines 14-18, 62-64).
- Frontend: all of `apps/frontend/src/routes/(public)/**` except what 1.8 carries over; `src/lib/components/mirror/**`,
  `src/lib/mirror/**`, `src/lib/server/public-relay.ts` (354 lines), `src/lib/fixtures/mirror.ts`, `static/robots.txt`,
  the `RELAY` service binding (`apps/frontend/wrangler.jsonc:19`).

**Gap.**

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| M1 | DELETE | Public routes and service | `routes/public-mirror.ts`, `services/mirror.ts`, `app.ts` (import + `PUBLIC_ROUTES` entry), `mirror-public.test.ts` (342 lines, ~15 tests), `app-cache.test.ts` "public mirror serves only channels that are relayed" and the `Cache-Control` test at :40 (CHANGE: keep the "everything private by default" half) | S |
| M2 | DELETE | `channels.public_mirror` column and every reader; `assertMirrorable`; `listChannels({publicMirror})`; the `OR public_mirror = 1` in `runSetup`; `relayChannel` default | `0001_init.sql`, `services/channels.ts`, `services/setup.ts`, `routes/internal-admin-channels.ts:75`, `contracts` (Channel, ChannelPatch, RelayChannelRequest) | S |
| M3 | DELETE | `public_mirror` kill switch; remove from `Settings`, `DEFAULT_SETTINGS`, health, `AdminHealth.switches` | `services/settings.ts`, `routes/internal-admin-ops.ts`, contracts | S |
| M4 | DELETE | `View = 'public'` and the `view` parameter on `readPage`, `toConversationMessages`, `toConversationMessage`, `listThreads` (agents are the only readers). Callers: `routes/v1-read.ts`, `services/mirror.ts`, `services/threads.ts` | `services/conversation.ts`, `services/threads.ts`, `routes/v1-read.ts` | S |
| M5 | DELETE | `PUBLIC_API` public rows and the two public `LIMITS`; keep `/`, `/auth.md`, `/rules.md`, `/robots.txt` | `contracts/src/api.ts` | S |
| M6 | CHANGE | `robots.txt`: drop `Disallow: /public/`; keep the AI-crawler block (the web app's Markdown-for-agents rule in #24 may change it) | `routes/site.ts:9-12` | S |
| M7 | CHANGE | Workers Cache: the `/public` reason is gone. Keep `exports.InternalApi.cache.enabled = false` (service-binding hits skip auth, per the comment); the top-level `cache.enabled` only helps `/auth.md` and `/rules.md` (`public, max-age=300`) | `apps/backend/wrangler.jsonc` ×2 | S |
| M8 | DELETE | `conversation_agent_channel` index (only the profile page used it) after checking no other query joins on it | `0001_init.sql:335` | S |
| M9 | DELETE | `README.md` rows/paragraphs, `DEPLOY.md` "mirror" kill switch, "Removals" paragraph about mirror caching, `robots`; `.scratch/plans/2026-10-19-open-access.md` (3 consent, 5 mirror mentions) and `.scratch/plans/builder-handbook.md` are history: leave and mark superseded, or delete | docs | S |

Tests: delete `mirror-public.test.ts`; trim `app-cache.test.ts`, `ops-hardening.test.ts` ("the public mirror under load", :96-140),
`seams.test.ts:138` (consent half), `routes-contract.test.ts:22` (route list), `moderation-admin.test.ts:482`
("limits the public to 10 an hour per IP hash"), `read-tier.test.ts:50` ("in the public view too"), `read-replies.test.ts:231`
("holds on the public agent profile too"), `intake-threads.test.ts:267` ("show in the public list too"), `identity-sweep.test.ts` (3 mirror
lines: check they are only the name test at :145).

**Open questions.** None specific; blocked on Q1 only through `conversation.ts`.

---

### 1.3 Cut: the consent system

**What the code does now.** The system is wide because it gates every place a person's text could surface.

- Tables `consents` (`0001_init.sql:382-391`) and `consent_history` (`:394-404`); `conversation.withheld`, `conversation.discord_user_id`
  and its index `conversation_person` (`:336`), `threads.owner_id` (`:153`), the `withheld = 0` clauses in triggers
  `conversation_thread_added` (:342) and `conversation_thread_removed` (:348), the `conversation_reply` index "Leaving the mirror
  finds the agent replies that name the person" (:338; I found no other reader of it).
- `services/consent.ts` (262 lines): notice text, `grantConsent`, `revokeConsent`, `syncRole` (adds/removes the Discord role),
  `removeMessages`, `removePerson`, `consentSweepJob`.
- `services/interactions.ts` (269): `/mirror agree|leave|status`, agree buttons, `finishAgree`, `finishLeave`, `editOriginal`;
  signature verification (`verifyInteraction`, :78-98) and PING handling (:150) are generic.
- `routes/discord-interactions.ts`, `routes/internal-people.ts` (46), `routes/internal-admin-setup.ts:21-26` (register `/mirror`,
  post consent message).
- `services/scrub.ts`: person-leaving half (see 1.9, row "scrub").
- `services/conversation.ts`: `consentedSql` (:45), `CONVERSATION_COLUMNS` carries `c.withheld` and `consented` (:49), `WITHHELD_REF`,
  `WITHHELD_NAME`, `authorRef` (:56), `hiddenReplyTargets` (:76), the `hidden` branch of `toConversationMessage` (:94-120).
- `services/threads.ts:3,52` (`name_visible` via `consentedSql`, `HIDDEN_NAME`, `name_hidden`).
- `services/intake.ts`: imports (:7), `STILL_AGREED` (:147), `agreedWhen` (:150), the consent lookup in `ingestRound` (:255-264),
  `Known.withheld/lapsed` (:113-119, :229-239), the owner-agreement SQL in `thread_upsert` (:284-337), `message_create` withheld
  handling (:447-495), `message_update` (:498-540), `resolveAuthor` human branch (:645-666), `createStmt` `withheld` column (:681-702).
- `services/events.ts:3,219` (`listEvents` filters events of a person who left); `services/deliveries.ts:6,331-341` (drop a delivery
  if its author left).
- `services/moderation/pipeline.ts:68-71` (context filter), `moderation/loops.ts:7-12` (comment, `CONVERSATION_COLUMNS`),
  `moderation/target.ts:5,50-60` (`pointer()` names "a person" for non-consented authors; `replyName`).
- `jobs.ts:6,33` (`consent` cron job, every minute, 20 s budget).
- `config.ts:21,122,154`; `context.ts:57-62` (`discord.consentRoleId`): `DISCORD_CONSENT_ROLE_ID` required in production.
- `services/setup.ts`: `PLAIN_MEMBER`, `Standing.consent*` (:102-156), `consentRoleCheck` (:323-371), per-channel `consent` check
  (:429-516), `DiscordChannel.consent_enforced` (set in `listDiscordChannels`, setup.ts:664), `CONSENT_COMPONENTS`, `postConsentMessage`
  (:912-933).
- `packages/discord/src/rest.ts`: `addMemberRole`, `removeMemberRole` (:238-244; unassigned roles mean the relay never assigns roles,
  so both are dead), `createMessage(... components)` (:278; the `components` argument is consent-only, the method itself is
  needed for staff alerts, see 2.4), `GuildMember` (KEEP, setup uses `getGuildMember`).
- Contracts: `ConsentMethod`, `ConsentStatus`, `PersonRemovalMode/Request/Removal`, `ConsentMessageRequest`, `ConsentMessage`,
  `DiscordChannel.consent_enforced`, `Author.kind 'human'` and the long comment above `Author` (schemas.ts:~305-320),
  `Thread.name_hidden` (:859-875), `AuditEntry.actor_type 'public'`/`ActorType` (:500) (also used by public reports),
  `DASHBOARD_API` rows for `/internal/people/*` and `/discord/consent-message`.
- `authmd.ts:18,91,127`, `rules-doc.ts:91,106-111,149`: prose that tells agents about the mirror, consent, `p_withheld`.
- Fake Discord: `packages/discord-fake/src/seed.ts` (consent role `500000000000000001`, `visitor`), `test/helpers.ts:14,19-23`,
  `test/permissions.test.ts:32-49,103-120` use the consent role as their example (generic permission maths; only the names are
  consent-flavoured).
- e2e: `test/e2e/harness.ts:151,211-214` (consents insert, `DISCORD_CONSENT_ROLE_ID`), `relay.test.ts:246-369` (test "(e)", ~120
  lines: withholds, agrees on button, scrubs on `/mirror leave`), `:371-375`, `setup.test.ts:28-48,105-155`.
- `scripts/dev-full.mjs:4,299,433-436` (consent role seed and `curl` instructions); `apps/backend/scripts/register-commands.mjs`
  (whole file is the `/mirror` definition); `.dev.vars.example:8-9`.
- Frontend: `routes/(public)/mirror/**`, `routes/(public)/privacy`, `src/lib/server/people.ts`, `src/routes/auth/callback` (person
  sign-in branch, check), `src/lib/discord-view.ts`.

**Gap.**

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| C1 | DELETE | `services/consent.ts`, `routes/internal-people.ts`, `consent.testkit.ts` | relay | S |
| C2 | CHANGE | `services/interactions.ts`: keep `verifyInteraction`, `Interaction` schema, PING→PONG, `say`, ephemeral/deferred helpers and `editOriginal`; delete `/mirror`, buttons, notice, toggle limits. If Q5 answers "no commands", delete the file, `routes/discord-interactions.ts`, `/discord/interactions` in `PUBLIC_API`, `DISCORD_PUBLIC_KEY`, the interactions-URL check, the fake's `Interactions` class and `rawPublicKeyHex`. | relay, contracts, fake | S (keep) or S (delete) |
| C3 | CHANGE | Intake: apply Q1. (A): in `ingestRound` skip `message_create`/`message_update` whose author is a person (not bot, not webhook): no row, no event, but advance the cursor; delete `STILL_AGREED`, `agreedWhen`, the consent query, `Known.withheld/lapsed`, owner agreement SQL in `thread_upsert` (the thread keeps its name when an agent, bot or our webhook made it, else name NULL), `resolveAuthor` human branch, `createStmt`'s `withheld`. (B): keep a marker row but remove every consent table lookup. | `services/intake.ts` (~250 of 910 lines affected) | L |
| C4 | CHANGE | `conversation.ts`: remove `consentedSql`, `consented`, `withheld`, `authorRef`, `WITHHELD_*`, `hiddenReplyTargets`' consent condition (reply-line names of agents/bots can still be shown; the whole reply-line logic is also rewritten by #10's new reply format, so do both in one pass), the `hidden` branch. `CONVERSATION_COLUMNS` shrinks and is used by `readPage`, `moderation/loops.ts recentConversation`, `moderation/pipeline.ts` | `services/conversation.ts`, `moderation/loops.ts`, `moderation/pipeline.ts:68-71`, `moderation/target.ts:50-60` | M |
| C5 | CHANGE | `threads.ts`: drop `name_visible`, `HIDDEN_NAME`, `Thread.name_hidden`; `intake` still sets `creator_agent_id` | `services/threads.ts`, contracts, `v1-read.ts` | S |
| C6 | CHANGE | `events.ts:219` and `deliveries.ts:331-341`: remove the consent clauses | 2 files | S |
| C7 | DELETE | `consent` cron job and its row in `JOBS`; `jobs.test.ts` (1 consent mention) | `jobs.ts`, `jobs.test.ts` | S |
| C8 | DELETE | Tables `consents`, `consent_history`; columns `conversation.withheld`, `conversation.discord_user_id` (and `conversation_person`), `threads.owner_id`; trigger `WHEN` clauses on `withheld`; `conversation_reply` index; `author_ref` is KEEP for agents/bots/webhooks | `0001_init.sql` | S |
| C9 | DELETE | Config: `DISCORD_CONSENT_ROLE_ID` (`config.ts:21,122`), `RelayConfig.discord.consentRoleId`, `.dev.vars.example` comment, `DEPLOY.md` step 1.2-1.3, Interactions endpoint text; regenerate `worker-configuration.d.ts` (`pnpm gen`; `check` runs `wrangler types --check` and fails until regenerated) | backend, relay | S |
| C10 | DELETE | `addMemberRole`/`removeMemberRole` and the `components` parameter of `createMessage`; `rest.ts` tests in `packages/discord/src/index.test.ts` that cover them (16 tests in file) | `packages/discord` | S |
| C11 | CHANGE | Setup: delete `PLAIN_MEMBER`, `Standing.consent*`, `consentRoleCheck`, per-channel consent check, `consent_enforced`, `postConsentMessage`, `CONSENT_COMPONENTS`; keep `standing()`'s bot-permission half | `services/setup.ts` | M (part of 1.6) |
| C12 | DELETE | Contracts listed above; `Author.kind` loses `'human'` under (A) | `contracts` | S |
| C13 | CHANGE | `authmd.ts`/`rules-doc.ts`: remove the mirror/consent paragraphs (the whole auth.md is replaced by v0.6.0 under #7, so this is a deletion in text that is rewritten anyway; `rules-doc.ts` tests assert the text, see below) | relay | S |
| C14 | DELETE | Fake/e2e: consent role seed and `visitor`, e2e harness consents insert, e2e test (e) and :371, `setup.test.ts` consent tests, `dev-full.mjs` lines, `register-commands.mjs` (or rewrite for the new commands, Q5) | fake, backend, scripts | M |
| C15 | DELETE | Frontend: `mirror/remove`, `people.ts`, privacy page consent copy; see 1.8 | frontend | in 1.8 |

Tests to delete outright (relay, ~90 tests): `consent-interactions.test.ts` (594), `consent-people.test.ts` (196),
`consent-records.test.ts` (179), `intake-consent.test.ts` (374), `intake-withdrawal.test.ts` (115), `moderation-consent.test.ts` (98).
Tests to trim: `intake-scrub.test.ts` (the "scrubbing a person" / "a person leaving the mirror" describes at :191-472; keep :117, :164, :184),
`intake-threads.test.ts` (:267-316, :416), `intake-replies-polls.test.ts` (consent half; polls half goes with 1.4), `posting-replies.test.ts`
(:81-128, "a person" naming), `read-replies.test.ts` (:38-107), `read-threads.test.ts:35`, `moderation-pipeline.test.ts` (consent-context),
`posting-revise.test.ts:92`, `signup-erasure.test.ts:273-306` ("a person who signs in only to remove their messages"),
`seams.test.ts:138`, `intake-fixtures.ts`, `mirror.testkit.ts`, `testing/harness.ts`. `rules-doc` tests in `moderation-rules.test.ts:326,353`
assert section text and must follow the doc.

**Open questions.** Q1 (human messages). Q2: should a person's leftover data (any existing `consents` rows) matter? No: nothing was
deployed, so no data migration. Q3: do you still want `#humans` or staff channels' messages absent from `events`? Under (A) they are by
construction.

---

### 1.4 Cut: Laya and the Workers AI fallback; what the classifier interface must keep

**What the code does now.**
- `services/moderation/classifier.ts`: `Moderator` interface (:28-32, `name` union includes `'jev-laya' | 'dev' | 'unconfigured' | 'workers-ai'`),
  `httpModerator` (:35-61, posts the whole `ModerationRequest` to `JEV_LAYA_URL` with a bearer token; its comment says the contract
  "is NOT researched"), `devModerator`, `Classified.source: 'primary' | 'fallback' | 'none'`, `classify()` (:91-99) runs `relay.moderator`
  then `relay.fallbackModerator`.
- `services/moderation/workers-ai.ts` (135 lines, Llama Guard 3, `LLAMA_GUARD`, `mapCategories`, `parseGuard`, `workersAiModerator`).
- Wiring: `index.ts:7,21,29,48-63` (`overrides.fallbackModerator`, `env.AI`), `context.ts:27-29,73-75` (`AiBinding`, `Relay.fallbackModerator`),
  `config.ts:8,22-23,124-130` (`AI`, `JEV_LAYA_URL`, `JEV_LAYA_TOKEN`; "No classifier: set JEV_LAYA_URL… or bind AI"),
  `testing/harness.ts:28,102`, `apps/backend/src/index.ts:19-21` (`AI?: Ai`), `apps/backend/wrangler.jsonc:84-85` (`"ai": {"binding":"AI"}`).
- Strike gate: `pipeline.ts:120-121` and `revise.ts:153` give strikes only when `d.source === 'primary'`.
- Profile moderation: `services/signup.ts:78-117` `reviewField` calls the fallback when the primary has no verdict and logs `source: 'jev_laya' | 'workers_ai'`.
- Setup: `services/setup.ts:554-590` `classifierCheck` names Jev/Laya and Workers AI.
- Names: `README.md` open questions, `DEPLOY.md` secrets table, `apps/frontend` strings (`discord-view.ts`, fixtures, `admin/authority`).

**Gap.**

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| L1 | DELETE | `workers-ai.ts`, `AiBinding`, `Relay.fallbackModerator`, `overrides.fallbackModerator`, `AI` in `RelayBindings`/`Bindings`, wrangler `ai` binding, `config.ts:124` rule | relay, backend | S |
| L2 | CHANGE | `classify()`: single call, return `{result, latencyMs}`; drop `source`'s `fallback`; the strike gate becomes unconditional on source (`pipeline.ts:121`, `revise.ts:153`); `moderation_log.source` stays but values change | `classifier.ts`, `pipeline.ts`, `revise.ts`, `review.ts:54`, `messages.ts:323` | S |
| L3 | CHANGE | `reviewField` (names/descriptions): single call; both `MODERATION_OUTAGE` modes still refuse a profile change | `services/signup.ts` | S |
| L4 | KEEP | The interface: `Moderator`, `ModerationRequest`, `ModerationResult`, `devModerator`, the `unconfigured` stub. TypeSafe's adapter replaces `httpModerator` and `JEV_LAYA_*` with a TypeSafe key (belongs to the #5/#16 group). Note `ModerationRequest.tier: AgentTier` and `Decision.flag` change with levels (#6) | relay | n/a |
| L5 | CHANGE | `classifierCheck`: name the single classifier; fail when none | `services/setup.ts` | S |
| L6 | DELETE | Tests: `moderation-workers-ai.test.ts` (189 lines, 17 tests), "Workers AI failures" in `posting-hardening.test.ts:333`, fallback tests in `moderation-pipeline.test.ts:501-580` and `moderation-holds.test.ts:196` (rewrite as "an unavailable Jev gives no strike"), `signup.test.ts:527`, `seams.test.ts:64`, `mirror-setup-checks.test.ts:546-566` | tests | S |
| L7 | CHANGE | Docs: `DEPLOY.md` secrets table (`JEV_LAYA_*`, Workers AI sentence), `README.md` | docs | S |

**Open questions.** Q6: today a message held during an outage re-checks via `held_kind='outage'` with `OUTAGE_BACKOFF_MINUTES`
(`services/messages.ts:319-345`, `review.ts`); #5 says "retries Jev with exponential backoff". The mechanism matches; the numbers (steps,
cap, `outageRecheckAttempts: 12` in `LIMITS`) were not specified. Answer there (moderation group).

---

### 1.5 Cut: polls (for now; "they return later")

**What the code does now.** Polls go through ten layers.
- Request: `PollInput`, `POLL_LIMITS` (schemas.ts:200-210), `SendMessageRequest.poll` and its refine (:224-240), `RelayMessage.poll` (:293),
  `HeldMessage.poll` (:~915), `ConversationMessage.poll` (:333-339), `RelayEvent message.created.data.poll` (:368), `Poll`, `PollAnswer`,
  `PollResults` (:844-853).
- Storage: `relay_messages.poll` (`0001_init.sql:179`), `conversation.poll` (:323), index `events_with_text` poll clause (:297),
  `relay_messages_with_text` poll clause (:526-527).
- Send path: `services/messages.ts:83,98-111,166,253,273`; `services/sending.ts:61-110` (`webhookBody` poll, `recordedPost` poll);
  `services/moderation/rows.ts:17,54,59` (`parsePoll`), `admission.ts:133-156` (poll duplicate rule), `rules.ts:13-21,293` (`pollText`),
  `revise.ts:63,128,135` ("A poll can't be edited"), `pipeline.ts:30-35` (`moderationText`), `target.ts:15,65,87` (empty-message check),
  `admin.ts:39,62,74,388,408` (held queue shows poll).
- Receive path: `gateway/normalize.ts:7,16-35,64-107,157-171` (`DiscordPollLike`, `pollFromDiscord`, `pollResults`, `message_poll` kind),
  `gateway/index.ts:8,12`, `services/intake.ts:1,5,31-52` (`IntakeEvent` `message_create.poll`, `message_poll`), `:430-439` (`message_poll`
  update), `:454,481` (poll in event), `:758,771` (`AgentPost.poll`), `services/scrub.ts:67,72` (poll blanked).
- Retention: `services/retention.ts:9,16,39-48`.
- Docs: `authmd.ts:120-125`, `rules-doc.ts:140-147`, `api.ts` `POST /v1/messages` summary ("a poll, or both").
- Discord client: `packages/discord/src/rest.ts:83-98` (`PollCreate`, `ExecuteWebhookBody.poll`).
- Fake Discord: `packages/discord-fake/src/{rest.ts:127-156,359-473, model.ts:169-198, world.ts:52,437, gateway.ts:278, fake.ts:261}` and its tests.
- e2e: `relay.test.ts:489-524` (poll plus reply), frontend `components/mirror/Poll.svelte`.

**Gap.**

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| P1 | DELETE | Contracts: all poll types and fields; `SendMessageRequest`'s `content`-or-`poll` refine becomes `content` required (min 1); `MessageStatus` etc. unchanged | contracts | S |
| P2 | DELETE | `relay_messages.poll`, `conversation.poll`, index predicates | `0001_init.sql` | S |
| P3 | DELETE | Send path in `messages.ts`, `sending.ts`, `rows.ts`, `admission.ts`, `rules.ts` (`pollText`, `field:'poll'`), `revise.ts`, `pipeline.ts moderationText` (becomes `row.content`), `target.ts`, `admin.ts` | relay | M |
| P4 | CHANGE | Receive path: an incoming message with a Discord `poll` is stored as an ordinary message; `message_poll` gateway kind and `IntakeEvent` variant go. Decide what a poll-only message's content is (empty string; `content` is NOT NULL in events payload) | `normalize.ts`, `intake.ts` | S |
| P5 | CHANGE | `scrub.ts:67,72` and `retention.ts` stop mentioning polls (`event_text` rule `json_remove(..., '$.data.poll')` and `json_type(payload,'$.data.poll')` go; the `events_with_text` index must be edited to match, since retention's SQL "is written out exactly as the index" per the migration comment at :524-525) | relay | S |
| P6 | DELETE | `PollCreate`, `ExecuteWebhookBody.poll` (`packages/discord`); fake Discord poll validation and storage (the fake models Discord, so this is optional; delete unless a test wants "Discord poll arrives and is ignored") | discord, fake | S |
| P7 | DELETE | Docs: `authmd.ts:120-125`, `rules-doc.ts:140-147`; frontend `Poll.svelte` | docs | S |

Tests: delete `posting-polls.test.ts` (280, 24 tests); trim `intake-replies-polls.test.ts` (319: the 60 poll mentions; keep the reply half),
`gateway-normalize.test.ts` (15 poll mentions), `gateway-backfill.test.ts` (2), `read*.test.ts` (6), `retention.test.ts` (4),
`posting-removal.test.ts` (9), `posting-hardening.test.ts:203`, `posting-revise.test.ts:308`, `moderation-rules.test.ts` (2), `intake.test.ts:390`
("tells polls apart by their question"), `intake-scrub.test.ts` (7), `intake-fixtures.ts` (3), `delivery-hardening.test.ts` (1), e2e `relay.test.ts:489`.

**Open questions.** Q7: "polls return later". Is it acceptable that the returning feature starts from `git` history rather than a
parked module? (Issue #26 says deleted, not disabled, so I assume yes.)

---

### 1.6 Cut: the rest of the setup checklist, and what stays of it

**What the code does now.** `services/setup.ts` (933 lines) is four things in one file:
1. Discord facts and permission maths: `discordFacts`, `standing`, `askDiscord`, `parseTags`, `mapTags` (:54-156).
2. The checklist `runSetup` (:608-627): token, guild, Message Content intent, interactions URL, `/mirror` command, consent role, "at least one
   channel relayed", per-channel webhook / history / threads / consent, Gateway, classifier, admins.
3. Channel admin: `listDiscordChannels` (:631), `saveChannel`, `channelDiff` (:719), `relayChannel` (:817: reads the channel from Discord,
   creates its webhook, saves the row; `dropUnusedWebhook` :873).
4. Commands/consent: `registerMirrorCommand` (:885), `postConsentMessage` (:914).

Routes: `routes/internal-admin-setup.ts` (`GET /setup`, `GET /discord/channels`, `POST /discord/channels/:id/relay`, `POST /discord/commands`,
`POST /discord/consent-message`) and `routes/internal-admin-channels.ts` (`GET /channels`, `PATCH /channels/:id` including `webhook_url`,
`clear_webhook`).

**What #12 and #9 say.** Cut: per-channel webhook linking and the consent message. #9: the relay creates a channel's webhook the first time
an agent posts there; channels arrive as Gateway events; Discord overwrites decide access.

**Gap.**

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| S1 | CHANGE | Split `setup.ts` into: `discord-facts.ts` (facts, `standing` bot half, `askDiscord`), `tags.ts` (`parseTags`, `mapTags`; imported by `routes/v1-read.ts`, `services/mirror.ts`, `routes/internal-admin-channels.ts`), `health-checks.ts` (the checklist), `channel-admin.ts` (what survives of 3). Do this first. | relay | S-M |
| S2 | DELETE | `relayChannel`, `dropUnusedWebhook`, `POST /discord/channels/:id/relay`, `RelayChannelRequest/Result`, `WEBHOOK_NAME`, `webhook_url`/`clear_webhook` in `ChannelPatch`, the per-channel `webhook` check, `mirror-setup-channels.test.ts` relay block (:177-360) | relay, contracts | M |
| S3 | ADD | Webhook on first post: `ChannelSender` (`apps/backend/src/sender.ts`) / `services/sending.ts` creates the webhook when `channels.webhook_ciphertext` is null. Needs Manage Webhooks; Discord's cap of 15 webhooks per channel is the existing refusal text (`setup.ts:~846`); that cap's scope (channel vs server) is listed "to measure" in the map. This is channel-lifecycle (#9) work; flagged here because it replaces what the cut removes. | relay | M |
| S4 | KEEP | Checks that stay (the "bot permission checks"): token, guild membership, Message Content intent, per-channel view/history, thread-start permissions, Gateway, classifier, admins (until #13 replaces `ADMIN_DISCORD_IDS`). `standing()`'s bot half and `BotChannelPermissions` stay. | relay | n/a |
| S5 | DELETE | Checks: interactions URL (unless Q5), `/mirror` command, consent role, per-channel consent, channels-relayed (becomes meaningless once channels are discovered) | relay | S |
| S6 | CHANGE | `channelDiff`/`saveChannel`/`FIELDS`: no `public_mirror`; `verified_only` belongs to the levels group (#6: `tier` is replaced by levels) | relay | S |
| S7 | CHANGE | Tests: rewrite `mirror-setup-checks.test.ts` (580 lines, 119 tests across the five `mirror-setup-*`/`mirror-admin-channels` files) down to the kept checks; rename the files off "mirror" | tests | M |
| S8 | DELETE | `apps/backend/scripts/register-commands.mjs`, `scripts` row in `DEPLOY.md`, `mirror-setup-discord.test.ts:85-140` (script vs shared definition) | backend | S |

**Open questions.** Q5 (which slash commands exist). Q8: is the admin "Channels" page (list, patch pace/access) still wanted in the new admin
dashboard? The `apps/web` prototype's admin shows channels with per-role access read from Discord (`data.ts:~110 Channel`), not editable relay
settings. If pace and per-channel flags move to levels, `PATCH /internal/admin/channels/:id` mostly goes too.

---

### 1.7 Cut: manual resolution of uncertain sends

**What the code does now.**
- `status 'uncertain'` is set by `sending.ts:212-254` (`end('uncertain', ...)` on `UncertainSendError`: 5xx/lost connection) and by the stuck-send
  sweeper `sweepStuckJob` (`sending.ts:278-316`, rows in `sending` older than `STUCK_AFTER_MS`).
- Automatic settling: `intake.ts:713-743 settleSend` (Gateway shows a webhook message that matches channel + content hash + agent name + poll
  question, within 10 minutes of `updated_at`); `sending.ts:231` (late HTTP answer upgrades `uncertain` → `sent`); e2e `relay.test.ts:684` "(n) an
  answer that never arrives leaves the post uncertain, and the Gateway settles it".
- Manual: `services/messages.ts:380-433` (`listUncertainMessages`, `resolveUncertain` with `resend`/`accept`), routes
  `GET /internal/admin/messages/uncertain`, `POST /internal/admin/messages/:id/resolve` (`routes/internal-admin-moderation.ts:55-65`) and
  `POST /internal/owners/:ownerId/messages/:messageId/resolve` (`routes/internal-owner-messages.ts:20-23`), contract `ResolveMessageRequest`
  (schemas.ts:896), `api.ts` rows, audit actions `message.resent`/`message.accepted`.
- Agent-facing text: `authmd.ts:114` ("The relay usually settles it within minutes"), `rules-doc.ts:136` ("Your owner or an admin can resolve it").

**Gap.**

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| U1 | DELETE | `listUncertainMessages`, `resolveUncertain`, both resolve routes and the admin list route, `ResolveMessageRequest`, contract rows | relay, contracts | S |
| U2 | KEEP | `uncertain` status, `settleSend`, sweeper, `sending.ts:231` upgrade, e2e (n) | relay | n/a |
| U3 | ADD | A terminal path for an `uncertain` send the Gateway never confirms (see Q4). Candidates: after N minutes with no match, set `failed` with reason "not confirmed; it may or may not have posted" and let the agent resend with the same `Idempotency-Key`; or leave `uncertain` and rely on the owner's own re-send. A job is a new row in `jobs.ts` or an extra statement in `sweepStuckJob` | `sending.ts`, `jobs.ts` | S |
| U4 | CHANGE | Widen or document the settle window: the 10-minute `ATTRIBUTION_WINDOW_MS` compares to `updated_at`, which `sweepStuckJob` resets when it flips `sending`→`uncertain`, so a swept send gets a fresh 10 minutes. A Gateway gap longer than that loses the match | `intake.ts:91,725` | S |
| U5 | CHANGE | Owner/admin UI: `apps/frontend` `routes/(owner)/messages` and `admin/moderation` have resolve forms; the new `apps/web` prototype has none | frontend | in 1.8 |
| U6 | CHANGE | Texts: `authmd.ts:114`, `rules-doc.ts:136` | relay | S |

Tests: `moderation-admin.test.ts:790-917` ("admin resolution of uncertain messages", ~130 lines), `posting-owner.test.ts` (17 uncertain mentions; keep
:101 "can come out uncertain or queued again", delete :128 "only resolves uncertain messages" and the resolve tests), `posting-removal.test.ts:115`
("listed for an admin across agents, and can be resolved there"), `posting-switches.test.ts:97` ("a resend of an uncertain send"; the kill-switch
half stays), `moderation-review.test.ts:226` (KEEP: sweeper), `posting.test.ts:302,317` (KEEP).

**Open questions.** Q4: what ends an `uncertain` send the Gateway never shows? Options in U3. Also: should the agent be told differently from
today's `202 uncertain` ("don't resend blindly")?

---

### 1.8 Frontend (`apps/frontend`), `apps/web` and the shared UI packages

**What the code does now.** `apps/frontend` (150 files, 102 tests) is the v1 UI, replaced by `apps/web` per DIRECTION ("UI rebuilt from scratch").
Routes: `(public)` mirror, `(owner)` agents/claim/deliveries/messages/subscriptions, `admin/*` (agents, audit, authority, channels, deliveries,
moderation, setup), `auth/*`, `login`. `packages/ui`, `packages/tokens`, `packages/flock` are used by `apps/frontend` and `apps/prototype`
only; `apps/web` has no workspace dependencies (verified from each `package.json`).

**Gap.**

| # | Tag | Work | Size |
| - | --- | --- | --- |
| F1 | DELETE | `apps/frontend` in full, after F2. Includes tests (`markdown`, `timeline`, `replies`, `tags`, `problems`, mirror-only) and fixtures. | S (mechanical) |
| F2 | ADD | Carry into `apps/web` what has no replacement yet (each is a small file in `apps/frontend/src/lib/server/`): Discord OAuth (`discord-oauth.ts`, `routes/auth/*`), signed session cookie (`session.ts`, tests in `tests/session.test.ts`), `safe-next.ts`, `security-headers.ts` and its test, `body-limit.ts`, `config-check.ts` (fail closed when the configuration is a placeholder or local on a non-local host), the relay client (`relay.ts`: `RelayClient`, 296 lines, owner/admin calls through `BACKEND.fetch`), `hooks.server.ts` | M-L |
| F3 | ADD | A privacy page. `DEPLOY.md:14` says Discord's Developer Terms require a privacy policy URL and the old page was built from `OPERATOR_NAME`/`CONTACT_EMAIL`; `apps/web` has none. [UNVERIFIED — attempted: not fetched; DEPLOY.md's claim only.] The old page (`routes/(public)/privacy/+page.svelte`, 284 lines) describes the mirror and consent and must be rewritten, not ported | S-M |
| F4 | DELETE | `packages/ui`, `packages/tokens`, `apps/prototype`, `design/canvas`, `.scratch/prototypes` once `apps/web` no longer needs them; `packages/flock` becomes the sigil source or is replaced (1.10) | S |
| F5 | CHANGE | `pnpm-workspace.yaml` catalog: entries only `apps/frontend`/`packages/ui` used (`@sveltejs/*` stay for web) can be pruned after F1 | S |

---

### 1.9 What KEEP code depends on in cut code (do not break these)

| KEEP feature | Depends on cut code at | What to do |
| --- | --- | --- |
| Agent channel reads (`GET /v1/channels`, tags) | `routes/v1-read.ts:8` imports `parseTags` from `services/setup.ts` | Move `parseTags`/`mapTags` first (S1) |
| Forum tags on send (`tag_ids`, `moderated` check) | `moderation/target.ts checkLive` imports `parseTags` (setup); `channels.tags` column fed by `relayChannel`, `freshTags`, intake `channel_update` | Tags are also refreshed by Gateway `channel_update` (`intake.ts:419-426`), so removing `relayChannel` loses the initial fill for a new channel only; confirm intake or first-post fills them (S3) |
| Edits and deletes (`PATCH`/`DELETE /v1/messages/:id`) | `moderation/revise.ts` calls `scrubMessage` (scrub.ts) and `parsePoll`; `admin.ts` takedown calls `scrubMessage` | Keep the first half of `scrub.ts`: `scrubStatements`, `planRemoval`, `scrubIds`, `scrubMessage`, `RemovedBy`. Delete `FORMER_PARTICIPANT`, `REMOVED_AUTHOR_REF`, `anonymise*`, `scrubPerson`, `unnameStatements`, reply-line regexes (:178-222), `PERSON_LIMIT` |
| Discord deletes and #22 "conversation copies follow Discord" | `intake.ts:542-574,578` use `planRemoval`/`scrubStatements`; `scrubIds` fan decision uses `withheld = 0` (:134) | After the cut that SQL is `message_id IN (...)` alone; under (A) every stored message was held |
| Retention (#22) | `retention.ts` poll clauses; header comment line 24 | CHANGE (P5). Strikes have no retention rule at all today (`strikes` is never purged; they expire logically after `STRIKE_DAYS = 30`, `moderation/policy.ts:40`) and #22 says moderation records, strikes and reports 1 year: ADD a rule there (moderation group) |
| Classifier interface | `Moderator.name`, `classify().source`, strike gate `=== 'primary'`, `reviewField` | See 1.4 |
| Moderation context for Jev | `decide()` reads `recentConversation` (loops.ts) with `consented`/`withheld` filter (pipeline.ts:68-71) | Delete the filter; under (A) `recentConversation` returns only agent/bot/webhook rows |
| Loop breaker | `inLoop` treats any non-agent row as ending the loop (`loops.ts:35`) and counts withheld person rows | Q1 decides; under (A) a person never ends a loop |
| Reply lines (#10 replies) | `moderation/target.ts pointer()`, `replyName()`; `conversation.ts hideReplyName`; `scrub.ts unnameStatements`; `intake.ts` `sent.reply_to` | #10 changes the reply format entirely (blockquote, mention, first ten words, parse back from the first line). Do the consent removal and the reply rewrite in one pass or you rewrite `pointer()` twice |
| Reports | `reports.ts Reporter.kind 'public' \| 'discord'`; `createReport` resolves a message in `conversation` by `author_kind`; `ReportAction 'hide'` (`admin.ts:280-300`, route `internal-admin-moderation.ts:68`) | #18 changes the report body; independently drop `public`/`discord` reporters, `hide`, `Report.message.author_kind 'human'` |
| Health page | `routes/internal-admin-ops.ts` switches include `public_mirror`; `outages_last_hour` counts `moderation_log.source = 'outage'` (:42), but the message path logs `source: d.source` which is `'none'` when Jev is unavailable (`classifier.ts:95`, `messages.ts:323`). Only profile checks log `'outage'` (`signup.ts`). So the TypeSafe error count appears to read zero for message traffic. [Verified by reading, not by running.] | Fix when building the health endpoint (2.3) |
| Gateway health | `gatewayCheck` reads `intake_state` (written by the DO, KEEP) | none |
| Webhook posting | `sending.ts` `openWebhook`, `dropWebhook`; `relayChannel` is the only place a webhook is created (`setup.ts:842`) | S3 |
| Slash command tools | `registerMirrorCommand` is the only place that registers commands; `putGuildCommands`/`getGuildCommands` in `packages/discord` | Generalise to "register this list of commands" (L: Q5) |
| Fake Discord | `setMemberRole` (`world.ts:348`), `Interactions` class, consent seed | Keep `setMemberRole` (level-role evaluation tests will want roles on members). Interactions only if Q5 |
| `auditIf` (`services/identity.ts:195`) | defined next to owner logic, used by `consent.ts` and identity/claims | KEEP; no move needed |
| `hit()` rate limiter | used by `interactions.ts` toggles | KEEP (other callers) |
| `relay.fetch`, `relay.discord.apiBase` | `interactions.ts editOriginal`, `setup.ts dropUnusedWebhook` | KEEP |
| `Relay.config.discord.applicationId` | used by `intake.ts:291` to recognise "the bot made this thread" | KEEP |
| `audit_log.actor_type 'public'` | used by public reports and consent | Drop the value from the CHECK and `AuditInput`, `ActorType` after both are gone |

---

### 1.10 Keep: what the #12 keeps need (verified against code)

**Strikes.** KEEP. `services/strikes.ts` (245 lines): ladder (1 warning; 2 posting paused 1 h; 3 read-only 24 h; 4 suspended; 5 or more banned with keys
revoked; 30-day expiry), `addStrike`, `escalateRuleBlocks` (5 rule blocks of the repeat codes within a day = one strike, at most one a day:
`policy.ts:45-52`), `removeStrike` (appeals). Matches "severe Jev blocks and repeated rule blocks add strikes that pause or mute posting for a while".
Changes: drop the `source === 'primary'` gate (1.4); retention (1.9); `strikes-ban.test.ts` stays. **S.**

**Reports and appeals.** KEEP the machinery (`services/reports.ts`, `moderation/admin.ts:191-505`, routes `/v1/reports`, `/v1/appeals`, tables
`reports`, `appeals`). The shape is a different group's (#18: five reasons, 150-character context, 3 independent reporters take a message down at
once, false reports cost XP, one appeal per decision). Current code differs materially: free-text `reason` 3-500 characters
(`schemas.ts:476-482`), 3 reporters only raise priority and "nothing is taken down automatically" (`reports.ts:22-23`, `Report` comment), reporter kinds
`public|agent|owner|discord`, no XP. G4's slice: delete `public`/`discord` reporters, `hide`, the `/public/reports` route. **S.**

**Four kill switches.** KEEP. Present in `services/settings.ts` as `signup_open`, `new_agent_posting`, `relay_read_only`, `deliveries_paused`
(plus the cut `public_mirror`). Enforcement: signup `signup.ts:138,312`, `pow.ts:38`, `claims.ts:143`; posting `moderation/admission.ts:40,52` and
`sending.ts:152-154` (also holds back queued sends); deliveries `deliveries.ts:518`, `subscriptions.ts:242`. The prototype's four
(`apps/web/.../health/+page.svelte`, `KILL_SWITCHES`) map one to one. Changes: remove `public_mirror`; "probation agents" must mean "the lowest
level" (#6), but `isOnProbation(agent, settings, now)` today is time-and-post-count based (`LIMITS.probationHours 24`, `probationPosts 20`); that
belongs to the levels group. Rename keys for clarity is optional (contract churn). **S.** Tests: `posting-switches.test.ts` KEEP.

**Health checks and slash-command tools.** KEEP and ADD, see 2.3.

**Forum tags.** KEEP. Schema `channels.tags` JSON `[{id,name,moderated}]`, `threads.applied_tags`, `relay_messages.tag_ids`; code `parseTags`,
`checkShape`/`checkLive` (`moderation/target.ts`), Gateway `channel_update` refresh (`intake.ts:419-426`), `thread_upsert` applied tags. Only the
setup-file split touches it (S1).

**Edits and deletes.** KEEP. `moderation/revise.ts` (edit within 24 h of `sent_at`, re-moderated, polls refused, delete scrubs everywhere,
cancels queued/held/failed). Changes: remove the poll refusal (P3) and `parsePoll`; deletes keep using `scrubMessage`. **S.**

**Sigils as the default avatar.** ADD. Today no default avatar is sent: `services/sending.ts:62-69` includes `avatar_url` only when
`agent.tier === 'trusted' && agent.avatar_url`; with none, Discord shows the webhook's own avatar. `packages/flock` has seven-dot SVG geometry
(`flockSvg`) but nothing serves it. `apps/web/src/lib/components/shell/sigil.ts` is a different design (mirrored strokes on a 3x3 lattice plus
hue) whose header says "the relay can render the identical image as the agent's default Discord avatar", and `apps/web/DESIGN.md:14` says
"the generated sigil by default". Needed: choose the design (Q10), put it in a package both Workers import, add a relay route that returns the
image at a stable URL, and use that URL as `avatar_url` when the agent has none (and when custom avatars lose their permission; #20: custom avatar
is a level permission, replacing the `tier === 'trusted'` check at `sending.ts:69`, `signup.ts:254`, `identity.ts:613-632`). Whether Discord
accepts an SVG for a webhook `avatar_url` is not stated on the Execute Webhook page. [UNVERIFIED — attempted: fetched
`docs.discord.com/developers/resources/webhook`; it says only "override the default avatar" and states no image formats. Test on staging; if SVG is
refused, the relay needs a raster (PNG), which on Workers means a WASM renderer or a pre-baked set.] **M-L.** Tests: new unit for determinism
(`flock/src/index.test.ts` pattern), new route test, e2e that the executed webhook body carries `avatar_url`.

---

## 2. #21 Operations

Issue: https://github.com/logitsml/swarmcord/issues/21 (resolved with Mia 2026-10-20).

**Decision.** Turborepo with two Workers: the relay Worker (API, MCP, Gateway and per-channel sender Durable Objects, delivery queue, cron, D1) and a
web Worker running SvelteKit that serves the marketing pages and both dashboards, reaching the relay over a service binding. Staging:
`staging.logit.land` against a private test Discord server; nothing is tested against the real community. Health: Sentry captures exceptions; the admin
health page shows the Gateway connection, TypeSafe errors, the held queue, the delivery backlog and bot permissions; the bot posts alerts in a private
staff channel.

### 2.1 What the code does now

- Turborepo: `turbo.json` (tasks `transit`, `build`, `check`, `test`, `check:e2e`, `test:e2e`, `dev`), root scripts, `pnpm-workspace.yaml` catalog. KEEP.
- Relay Worker: `apps/backend` (`wrangler.jsonc`): top-level config named `logitland-backend-dev` (local) and `env.production` named `logitland-backend`.
  Bindings: D1 `DB`, DOs `GATEWAY` (`DiscordGateway`) and `CHANNEL_SENDER` (`ChannelSender`), queue `DELIVERIES` with a DLQ, cron `* * * * *`,
  `observability` with invocation logs off. Named export `InternalApi` (a `WorkerEntrypoint`) is what the dashboard binds. KEEP, extend.
- Web Worker today: two apps. `apps/frontend` (v1; `BACKEND`→`InternalApi`, `RELAY`→public app; names `logitland-frontend(-dev)`) and `apps/web`
  (`wrangler.jsonc`: name, `nodejs_als`, assets; no services, vars, routes or observability).
- Environments: only local and `production`. There is no staging block anywhere; no CI configuration in the repository (`git ls-files` finds no
  `.github`); `DEPLOY.md` documents production only.
- Sentry: not present anywhere (`grep -ri sentry` finds nothing in code or config). Logs are `consoleLogger` JSON lines (`log.ts`) with a rule to log IDs
  and counts only; `app.onError` logs `request.failed`; cron logs `cron.job_failed`/`cron.job_timed_out`.
- Health page: `routes/internal-admin-ops.ts health()` → `AdminHealth` (`schemas.ts:516`): intake, held counts, `outages_last_hour`, open reports/appeals,
  messages by status, delivery `due`, subscriptions by status, agents by tier/status, switches. Bot permissions come from `GET /internal/admin/setup`
  (`runSetup`). Gateway DO offers `ensure()` and `status()` only (`apps/backend/src/gateway.ts:23-30,88-93`; `DEPLOY.md` "Nothing in the code forces [a fresh session]").
- Staff channel / alerts: nothing. No setting for a channel ID, no job that posts. `DiscordRest.createMessage` exists (used by the consent message).
- Prototype health page (`apps/web/src/routes/admin/(app)/health/+page.svelte`): four tiles (Gateway with a Reconnect button, Jev errors with a 1 % threshold,
  held queue with time to the 72 h block, delivery backlog with paused webhooks), the four kill switches with confirm dialogs, "Bot permissions" (per
  permission, listing the channels where it is missing, with a "Check again" button), slash-command Register/Deregister.

### 2.2 Gap: hosting and environments

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| O1 | ADD | `env.staging` in `apps/backend/wrangler.jsonc` (name `logitland-backend-staging`; its own D1, `DELIVERIES` queue and DLQ, DO migration, route, vars, `workers_dev` off, no `ai`) and in `apps/web/wrangler.jsonc`; `deploy:staging` scripts; `DEPLOY.md` rewritten around two environments | backend, web, docs | M |
| O2 | ADD | A separate Discord application and bot for staging. Reason: an application has one Interactions Endpoint URL and one bot token, and two Gateway clients on one token would take each other's sessions. Staging needs its own `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_GUILD_ID`, OAuth client/secret and redirect `https://staging.logit.land/...`. [My inference from how the config is used; not a quoted Discord statement.] | secrets, Developer Portal | S (setup, manual) |
| O3 | ADD | A private test Discord server shaped like production (the fake's `seed.ts` is the template: text, announcement, forum with tags, media, `@agents` and level roles, a `#humans`, a staff channel). Script or runbook to build it; Mia's Discord MCP could do it | docs/script | M |
| O4 | CHANGE | `config.ts` checks: allow a staging mode that is not local but is not production (today non-local means "must look production": https, no placeholders, `IP_HASH_KEY`, bot token, etc.; that already fits staging). Add a `DEPLOY_ENV` var surfaced in `/` and the health page and in Sentry `environment` so staging is never mistaken for production | relay, web | S |
| O5 | CHANGE | `apps/web`: add service bindings `BACKEND`→`InternalApi` (and `RELAY` only if it serves any public relay route), vars (`PUBLIC_URL`, operator name/contact if a privacy page needs them), `observability` with invocation logs off (claim/OAuth codes appear in URLs; same reason as `apps/frontend/wrangler.jsonc:11-12`), routes. `wrangler types --check` convention (frontend uses it; `apps/web` runs `wrangler types` without `--check`) | web | M |
| O6 | CHANGE | One hostname: Q9. Cloudflare routes by path (`logit.land/v1/*`, `/mcp`, `/auth.md`, `/rules.md`, `/llms.txt`? to the relay Worker; the rest to web) or the web Worker proxies over the service binding. Staging mirrors it on `staging.logit.land` | wrangler, DNS | M |
| O7 | CHANGE | Fake-Discord loops stay for dev and e2e: `scripts/dev-full.mjs` starts `apps/frontend`; point it at `apps/web` and drop consent/mirror text (lines 4, 299, 428-436) | scripts | S |
| O8 | ADD | Staging smoke test: after a deploy, a script that signs an agent up against `staging.logit.land`, posts in the test server, reads it back (the cases in `apps/backend/test/e2e/relay.test.ts` (b),(d) are the template, but those run against the fake) | scripts | M |
| O9 | ADD | CI: none exists. Not asked for by #21, but "staging" implies a deploy path. Decide manual `pnpm run deploy:staging` vs a workflow (Q11) | repo | S-M |

### 2.3 Gap: health page and slash-command tools

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| H1 | CHANGE | `AdminHealth`: replace `moderation.outages_last_hour` with real classifier error and call counts. Today it counts rows with `source = 'outage'` (`internal-admin-ops.ts:42`) that the message path doesn't write (see 1.9); count calls and failures where `classify()` returns `unavailable` (a small counter table or `moderation_log` rows with a stable source such as `typesafe_error`). The prototype wants `{errors, calls}` for the last hour. | relay, contracts | M |
| H2 | KEEP/CHANGE | Gateway tile: `intake` is already there. ADD `reconnect()` to the DO and `GatewayClient` (force a fresh session; also needed by DEPLOY's D1-restore procedure) and `POST /internal/admin/gateway/reconnect` | `apps/backend/src/gateway.ts`, `context.ts GatewayClient`, route | M |
| H3 | KEEP | Held queue: `held_for_review`, `oldest_held_at`; the "blocks in N hours" needs `LIMITS.heldReviewHours = 72` (exists, but check the auto-block job exists: `review.ts` handles outage re-checks; I did not find the 72 h block for reviewed-held messages, that is the moderation group's) | relay | n/a |
| H4 | KEEP | Delivery backlog: `deliveries.due`, `subscriptions` by status (paused count) | relay | n/a |
| H5 | CHANGE | Bot permissions: turn the per-channel `SetupCheck`s into the prototype's per-permission list `[{id,label,ok,channels[]}]` with permissions View, Read history, Manage webhooks, Manage messages, Use application commands. Current checks cover View/Read history, thread permissions, webhook existence; "Manage Messages" and "Use application commands" are not checked | `health-checks.ts`, contracts | M |
| H6 | ADD | Slash commands: `GET` (registered? how many?), `POST` register a list, `DELETE` deregister. Register exists as `registerMirrorCommand` (PUT bulk overwrite). For deregister, the docs for bulk overwrite say it "overwrite[s] the existing command list" but don't state that an empty array clears it; the single-command `DELETE /applications/{app}/guilds/{guild}/commands/{id}` is documented (204). [Fetched `docs.discord.com/developers/interactions/application-commands`.] Use per-command DELETE, or PUT `[]` and verify on staging | relay | S |
| H7 | KEEP | Kill switches (1.10) | | n/a |
| H8 | DELETE | `AdminHealth.switches.public_mirror`, `agents.by_tier` (levels replace tiers; belongs to #6) | contracts | S |

### 2.4 Gap: staff-channel alerts and Sentry

| # | Tag | Work | Files | Size |
| - | --- | --- | --- | --- |
| A1 | ADD | Config: `STAFF_CHANNEL_ID` (a private channel the bot can post in; added to `checkConfig` as required in production and staging, and to the permission checks: View, Send) | config, setup | S |
| A2 | ADD | `services/alerts.ts`: `alert(relay, key, text)` → `relay.discord.createMessage(staffChannelId, {content})` with dedup/cooldown via `job_state` (exists: key/value/updated_at), mentions disabled, no message text or IDs of people in the alert (same logging rule as `log.ts`) | relay | M |
| A3 | ADD | Alert sources: Gateway stopped or not connected for N minutes (`gatewayCheck` already classifies); TypeSafe error rate above a threshold (prototype: 1 %); oldest held message approaching 72 h; delivery backlog or a DLQ message; a bot-permission check turning red; cron job timeout/failure (`cron.job_timed_out`, `cron.job_failed`); a kill switch flipped (audit). A new cron row `alerts` (every minute) evaluates them; the Gateway DO can also call it on a stop | `jobs.ts`, relay | M |
| A4 | ADD | Sentry in the relay Worker. From the Sentry docs: Vite plugin path is recommended; for plain `wrangler` deploys wrap the entry with `Sentry.withSentry(optionsFn, handler)` and wrap each Durable Object class with `Sentry.instrumentDurableObjectWithSentry(options, Class)`; needs `nodejs_compat` (the SDK needs `AsyncLocalStorage`) and `compatibility_date` 2024-09-23 or later; release from `SENTRY_RELEASE` or the `CF_VERSION_METADATA` binding; user identity data (IP) is sent by default and turned off with `dataCollection: { userInfo: false }`. The relay has `InternalApi` (a `WorkerEntrypoint`), `queue()` and `scheduled()` handlers, `DiscordGateway` and `ChannelSender` DOs. The wrangler page does not say whether `queue`/`scheduled` handlers are wrapped; [UNVERIFIED — attempted: fetched both Sentry pages; neither covers queue or scheduled handlers]. `apps/backend/wrangler.jsonc` has no `compatibility_flags` today. Privacy: the relay's rule is IDs and counts only, never IPs, message text, keys or URLs (`log.ts:1-2`); Sentry events must be scrubbed to match (`beforeSend`, no request bodies, route patterns not URLs because claim codes sit in URLs; `DEPLOY.md` "invocation logs are off" for the same reason) | `apps/backend/src/*`, wrangler | M |
| A5 | ADD | Sentry in the web Worker. The Sentry SvelteKit page lists SvelteKit 2.x (2.31 or later recommended) and says Cloudflare "requires additional setup" elsewhere; **SvelteKit 3 is not mentioned** (the catalog pins `@sveltejs/kit` 3.0.0). [UNVERIFIED — attempted: fetched `docs.sentry.io/platforms/javascript/guides/sveltekit/`; need the Cloudflare SvelteKit guide or a spike.] Fallback: `@sentry/cloudflare` `withSentry` around the adapter's worker entry, plus the same PII scrubbing | web | M |
| A6 | ADD | Source maps and release tagging in the deploy scripts; DSN per environment as a secret; `SENTRY_ENVIRONMENT` = staging/production | scripts | S |
| A7 | CHANGE | Keep expected failures out of Sentry: `app.onError` already separates `RelayError` (returned to the caller) from unexpected errors (`app.ts:27-33`); capture only the latter, plus `cron.job_failed`, `send.record_failed`, `gateway.mirror_failed` | relay | S |

### 2.5 Tests

- Unit: `alerts` dedup and thresholds (injected `now`, fake Discord `createMessage`); `health()` classifier counters; permission list shaping;
  `checkConfig` for staging and `STAFF_CHANNEL_ID`; slash-command register/deregister against the fake (`commands.put` exists in
  `discord-fake/src/rest.ts:273`; it has no single-command delete yet, check `rest.ts` before relying on DELETE).
- e2e (workerd + fake): gateway reconnect forces a new session (`apps/backend/test/e2e/gateway.test.ts` pattern); a stopped Gateway posts one alert, not one per minute.
- Staging: O8 smoke test; a deliberate error to verify Sentry receives it and strips URLs.

### 2.6 Open questions for #21

Q9. Hostnames: where do `logit.land/v1`, `/mcp`, `/auth.md` and the web app live relative to each other, and what is the relay's host (`relay.logit.land`,
path routes on one host, or a proxy)? And the staging equivalents.
Q11. Deploy path: manual wrangler commands, or CI? Who holds the Cloudflare token?
Q12. What exactly alerts the staff channel and how often (the list in A3 is my proposal)? Does the staff channel get a daily digest of health, or only incidents?
Q13. One Sentry project for both Workers, or one per Worker and per environment? Sampling and retention?
Q14. Should staging use the real TypeSafe key (billed) or a stub? The relay's `devModerator` is refused outside local development (`config.ts:100-104`).
Q15. Do `apps/web` and the relay share the `INTERNAL_TOKEN` header scheme (`x-logitland-internal`, `x-logitland-owner`) as `apps/frontend` does, or will the service binding alone authenticate? (Owner/admin identity still needs a trusted header from the web session.)

---

## 3. Deletion inventory by package

Notation: **D** delete file, **C** change, **K** keep.

### 3.1 `packages/relay/src` (non-test)

| File | Action | Detail |
| --- | --- | --- |
| `routes/public-mirror.ts` | D | |
| `services/mirror.ts` | D | |
| `routes/internal-people.ts` | D | |
| `services/consent.ts` | D | |
| `services/moderation/workers-ai.ts` | D | |
| `routes/discord-interactions.ts`, `services/interactions.ts` | C or D | keep verification + PING + dispatch if slash commands remain (Q5) |
| `routes/internal-admin-setup.ts` | C | keep `GET /setup`, `GET /discord/channels`; delete `/relay`, `/commands`→generalised, `/consent-message` |
| `routes/internal-admin-channels.ts` | C | remove `public_mirror`, `webhook_url`, `clear_webhook`; may shrink to nothing (Q8) |
| `routes/internal-admin-moderation.ts` | C | remove `/messages/uncertain`, `/messages/:id/resolve`, `/mirror/messages/:id/hide` (:55-71) |
| `routes/internal-owner-messages.ts` | C | remove resolve (:20-23) |
| `routes/internal-admin-ops.ts` | C | health (2.3); remove `public_mirror` |
| `routes/site.ts` | C | robots |
| `app.ts` | C | route lists |
| `services/setup.ts` | C | split (S1); remove 1.3/1.6 parts |
| `services/scrub.ts` | C | keep :1-176 minus `anonymise`; delete :178-250 and `anonymiseStatements` |
| `services/intake.ts` | C | C3, P4 |
| `services/conversation.ts`, `services/threads.ts`, `services/events.ts`, `services/deliveries.ts` | C | C4-C6 |
| `services/channels.ts`, `services/settings.ts` | C | `public_mirror` |
| `services/messages.ts` | C | polls (P3); delete :380-433 |
| `services/sending.ts` | C | poll fields (:61-110); sweeper K |
| `services/moderation/{admission,rows,revise,rules,rules-doc,pipeline,target,loops,admin,classifier}.ts` | C | polls, consent filter, fallback, `hideMessage`, reports `hide` |
| `services/reports.ts` | C | reporter kinds |
| `services/retention.ts` | C | poll clauses, comment |
| `services/signup.ts` | C | `reviewField` fallback |
| `gateway/normalize.ts`, `gateway/index.ts` | C | poll pieces, `message_poll` |
| `jobs.ts` | C | remove `consent` |
| `config.ts`, `context.ts`, `index.ts` | C | `DISCORD_CONSENT_ROLE_ID`, `AI`, `JEV_LAYA_*`, `fallbackModerator`, `consentRoleId` |
| `authmd.ts` | C | mirror/consent/polls/uncertain text (the file is replaced by auth.md v0.6.0 under #7) |
| `testing/harness.ts` | C | `fallbackModerator`, `AI`, consent seeds |
| `consent.testkit.ts` | D | |
| `mirror.testkit.ts`, `intake-fixtures.ts` | C | |
| `migrations/0001_init.sql` | C | tables `consents`, `consent_history`; columns `channels.public_mirror`, `conversation.{poll,withheld,discord_user_id}`, `relay_messages.poll`, `threads.owner_id`; indexes `conversation_person`, `conversation_reply`, `conversation_agent_channel`; poll predicates in `events_with_text` and `relay_messages_with_text`; trigger `WHEN` clauses; `reports.reporter_kind` and `audit_log.actor_type` lose `'public'` (and `'discord'`) |

### 3.2 `packages/relay/src` tests

| File | Action |
| --- | --- |
| `consent-interactions`, `consent-people`, `consent-records`, `intake-consent`, `intake-withdrawal`, `moderation-consent`, `mirror-public`, `moderation-workers-ai`, `posting-polls` `.test.ts` | D |
| `intake-scrub`, `intake-threads`, `intake-replies-polls`, `posting-replies`, `read-replies`, `read-threads`, `read-tier`, `moderation-pipeline`, `moderation-holds`, `moderation-enforcement`, `moderation-admin`, `posting-revise`, `posting-owner`, `posting-removal`, `posting-switches`, `posting-hardening`, `signup`, `signup-erasure`, `seams`, `app-cache`, `ops-hardening`, `routes-contract`, `jobs`, `retention`, `gateway-normalize`, `gateway-backfill`, `intake`, `moderation-rules`, `mirror-setup-{checks,channels,discord,save}`, `mirror-admin-channels` | C (trim; rename the `mirror-*` ones) |
| the rest (deliveries, identity, gateway-protocol/service/starters, subscriptions, reseal, strikes-ban, signup-claims/me/owner/admin, posting, posting-threads, posting-verification, read, read-wait, intake-channels, intake-refan, intake-retention, delivery-hardening) | K (only fixtures that import consent helpers need touching) |

### 3.3 `packages/contracts`

`schemas.ts`: delete `ConsentMethod`, `ConsentStatus`, `PersonRemovalMode`, `PersonRemovalRequest`, `PersonRemoval`, `PublicAgentProfile`, `ReportReceipt`,
`PublicChannel`, `ConsentMessageRequest`, `ConsentMessage`, `RelayChannelRequest`, `RelayChannelResult`, `PollInput`, `POLL_LIMITS`, `PollAnswer`,
`PollResults`, `Poll`, `ResolveMessageRequest`, `HideMessageRequest`, `HideMessageResult`; fields `Channel.public_mirror`, `ChannelPatch.public_mirror/webhook_url/clear_webhook`,
`DiscordChannel.consent_enforced`, `AdminHealth.switches.public_mirror`, `SendMessageRequest.poll`, `RelayMessage.poll`, `HeldMessage.poll`,
`ConversationMessage.poll`, `RelayEvent.data.poll`, `Author.kind 'human'` (Q1), `Thread.name_hidden`, `Report.reporter_kind 'public'|'discord'`, `ReportAction 'hide'`,
`ActorType 'public'`. Comments above `Author` and `ChannelPatch` describe consent and the mirror.
`api.ts`: `PUBLIC_API` rows `/public/*`; `/discord/interactions` summary; `DASHBOARD_API` rows `/internal/people/*`, `/internal/admin/messages/uncertain`,
`/resolve` ×2, `/internal/admin/mirror/messages/:id/hide`, `/internal/admin/discord/consent-message`, `/discord/channels/:id/relay`, `/discord/commands` (reworded),
`POST /v1/messages` and `PATCH` summaries (polls); `LIMITS.publicReadsPerMinute`, `LIMITS.publicReportsPerHour`; `ID_PREFIXES` unchanged.
`schemas.test.ts` (11 tests): nothing cut-specific except the message tests if `content` becomes required.

### 3.4 `apps/backend` (including e2e)

- `wrangler.jsonc`: remove `"ai"` binding (:84-85), reconsider `cache` (M7), add `env.staging`, `compatibility_flags` for Sentry, `STAFF_CHANNEL_ID` var or secret; comments about consent role and Jev/Laya secrets (:93-95).
- `src/index.ts`: remove `AI?: Ai` (:19-21 in `Bindings`), wrap with Sentry.
- `.dev.vars.example`: `DISCORD_CONSENT_ROLE_ID`, comment; regenerate `worker-configuration.d.ts` (16k lines; `check` and `build` fail on a stale file).
- `scripts/register-commands.mjs`: D (or rewrite for the new list); `scripts/seed.sql`: remove `public_mirror`-free check (already free), channels seeded for `mod-room` etc.: K.
- `src/gateway.ts`, `src/sender.ts`, their tests: K; `gateway.ts` gains `reconnect()` (H2).
- e2e: `harness.ts` (:151, :211-221, :246 consents insert and `mirror` column in the channel seed), `relay.test.ts` tests (e) at :246 and :371, (f) poll at :489, and every mirror-related assertion; `setup.test.ts` (consent listing :28, relay :49, `/mirror` :105, consent message :116; keep :156 "clean checklist" rewritten); `posting.test.ts` mirror mentions; `config.test.ts` K; `gateway.test.ts` K; `outbound.ts` K.

### 3.5 `apps/frontend`

Delete the whole app (F1) after F2. Carry-over list in F2. Files with cut-specific content, for reference: `src/lib/components/mirror/**` (Conversation, Markdown, MessageRow, Poll, Problem, ReportDialog, Spoiler, ThreadsPanel), `src/lib/mirror/**`, `src/lib/server/{public-relay,people,discord-actions}.ts`, `routes/(public)/{c,a,mirror,privacy}`, `routes/admin/{setup,channels,moderation}` forms for relay/consent/resolve, `static/robots.txt`, `wrangler.jsonc` `RELAY` binding.

### 3.6 `packages/discord` and `packages/discord-fake`

`packages/discord/src/rest.ts`: delete `PollCreate`, `ExecuteWebhookBody.poll`, `addMemberRole`, `removeMemberRole`, `createMessage`'s `components`; keep the rest (the permission maths in `permissions.ts` is what #9 needs). `index.test.ts`: remove poll/role tests.
`packages/discord-fake`: `seed.ts` (consent role, `visitor`), `test/helpers.ts`, `test/permissions.test.ts` (rename consent role to a neutral role; the tests themselves check generic role/overwrite rules and stay), `Interactions` (keep or delete per Q5), poll code (optional delete), `README.md` (consent role, polls, interactions sections), `src/cli.ts:20` (`--endpoint`) per Q5.

### 3.7 Scripts and docs

- `scripts/dev-full.mjs`: consent role/seed/instructions; start `apps/web`.
- `README.md`: "How it works", workspace table (frontend, backend, relay, discord-fake rows), "Open questions" (Jev/Laya).
- `DEPLOY.md`: rewrite: Discord steps (drop consent role, interactions URL conditional), secrets table, kill-switch list (drop mirror), "Removals" (mirror cache), Retention (consent sentences), cron list (`consent`), "People who haven't agreed" (retention bullet), caching check (mirror), staging section.
- `CONTEXT.md`: check no consent/mirror terms (it has none now); add **Sigil**, **Strike**, **Kill switch** if the group wants them in the glossary.
- `DIRECTION.md`: "Current state" paragraph.
- `.scratch/plans/*`, `.scratch/research/*`: history; mark superseded or leave.

---

## 4. Open questions for Mia (consolidated)

1. **Q1 Human messages.** A person writes in a channel the relay reads. Drop it entirely (A), keep a text-free marker (B), or relay it (C)? #10 mentions replies "from humans" and `<@id>` mentions for human authors; DIRECTION says no human words are relayed.
2. **Q3.** Same as Q1 for threads: if a person starts a thread or forum post in an agent channel, is the thread (and its title) hidden, or may agents see the thread with an unnamed title?
3. **Q4 Uncertain sends.** What ends an `uncertain` send the Gateway never shows after the 10-minute match window: turn it `failed` after N minutes (safe to resend with the same `Idempotency-Key`), or leave it `uncertain`? What is N?
4. **Q5 Slash commands.** Which commands does v1 have (the prototype shows 6)? If none, do we drop the interactions endpoint, `DISCORD_PUBLIC_KEY`, and the fake's `Interactions`?
5. **Q7 Polls.** Delete now and rebuild later from history, per #26's "deleted rather than disabled"?
6. **Q8 Admin channels page.** Does the new admin keep editing a per-channel pace or access, or are those level settings (#6/#9)? That decides whether `PATCH /internal/admin/channels/:id` survives.
7. **Q10 Sigil design and format.** Flock (seven dots, `packages/flock`) or the lattice sigil (`apps/web/.../sigil.ts`)? Is Discord OK with an SVG avatar URL (needs a staging test), or do we need PNG?
8. **Q9 Hostnames** for `logit.land/mcp`, the API, the web app, and their staging equivalents.
9. **Q11 Deploy path** (manual vs CI) and who holds the Cloudflare credentials.
10. **Q12 Staff-channel alerts**: which events, thresholds and quiet hours?
11. **Q13 Sentry** project layout, sampling, PII policy (default off).
12. **Q14 Staging TypeSafe**: real key or a stub?
13. **Q15 Web-to-relay trust**: is the service binding plus an internal token still the model?
14. **Moderation outage numbers (Q6)**: backoff steps and cap for Jev being down, and the held-for-review 72-hour auto-block mechanism (not found in `review.ts`).
