# Gap analysis G2: moderation, Jev, reports and appeals, channel lifecycle, webhooks

Repo: `/Users/luna/Library/Application Support/Claude/scratch-workspaces/0199ae99-8bed-4f6c-9be7-9db2e9390f00/444c271b-1141-4b66-9665-04cba15d7cc1/scratch-2026-10-19-5e62a7/logitland`
(branch `relay/v1-gap`). All paths below are relative to it. Nothing was edited, run, or started.

Decisions covered: [#5](https://github.com/logitsml/swarmcord/issues/5), [#4](https://github.com/logitsml/swarmcord/issues/4) and [#16](https://github.com/logitsml/swarmcord/issues/16), [#18](https://github.com/logitsml/swarmcord/issues/18), [#9](https://github.com/logitsml/swarmcord/issues/9), [#8](https://github.com/logitsml/swarmcord/issues/8). Context from the map [#2](https://github.com/logitsml/swarmcord/issues/2), ticket [#26](https://github.com/logitsml/swarmcord/issues/26), [#6](https://github.com/logitsml/swarmcord/issues/6), [#12](https://github.com/logitsml/swarmcord/issues/12), `DIRECTION.md`.

Size key: S under half a day, M about a day, L several days. Tags: KEEP, CHANGE, ADD, DELETE.

## 0. What I fetched (2026-10-20) and cross-cutting findings

Fetched now, and relied on:

- TypeSafe docs (`https://docs.typesafe.ai/`): `api/system-one.md` (OpenAPI for `POST /v1/systemone`), `api/errors.md`, `models.md`, `confidence.md`, `primitives/choice.md`, `model-jaggedness/jev-1.13.md`, `cookbooks/llm_guardrails.md`, `cookbooks/consistency_choice_cookbook.md`.
- Discord docs, read from `discord/discord-api-docs` at commit `fd75e22e8c32` (the repo's current head, 2026-10-19): `developers/change-log.mdx`, `resources/webhook.mdx`, `resources/channel.mdx`, `topics/permissions.mdx`, `topics/rate-limits.mdx`.
- The research notes cited in #4, #8 and #16 (`.scratch/research/jev.md` on `research/jev-measured`, `discord-webhooks.md` on `research/discord-webhooks`), via `gh api`. I used them as pointers and re-checked the load-bearing facts against the sources above.
- Not fetched: TypeSafe's developer console (`console.typesafe.ai/rate-limits`, needs a login) and the auth.md spec (not my group).

Where decisions and `DIRECTION.md` disagree, or where decisions disagree with each other:

1. **#4's contract is for the Cloudflare route, #5's follow-up replaces it.** #4 and #16 describe `typesafe/jev` on Workers AI (32k context, `env.AI.run`, response wrapped as `result.result.answers`). #5's follow-up and #26 move to `POST https://api.typesafe.ai/v1/systemone`. On the direct API the answer is top-level (`answers.<name>.choice`, `.confidence`, `.probabilities`), the context limits are 64k per request and 32k per question (262k with a long-context header), and rate limits are per TypeSafe organisation, not Workers AI's 20 or 300 a minute. The #16 measurement of "77 calls in 31 s with no 429" was taken through Cloudflare's AI Gateway, so it says nothing about TypeSafe's own limits (section 2).
2. **#5 blocks `spam` and `personal data` on a Jev win, while its own deterministic checks only hold them.** Same category, two outcomes. Needs a ruling (section 1, open question 4).
3. **#9 says visibility is "when `@agents` can view it", and also that level roles add trust-specific access.** Mia's own fixtures (`apps/web/src/lib/fixtures/admin/data.ts:216-218`) have `lab` visible only to `r_l3` and `governance` to `r_l2`/`r_l4`, with no `@agents` grant. The evaluation rule ("as if a member held `@agents` plus the level roles") makes visibility per agent; the sentence about `@agents` is the base case. I assume per agent (section 4).
4. **#18 makes only reporting a level permission.** The task wording groups "reports and appeals" as a permission; the issue gives appeals no permission, and the fixture's `PERMISSION_LABELS` has only `reports` and `avatar` (`data.ts:13-16`). I treat appeals as open to every agent.
5. **#9 and #12 say the webhook is created on the first post.** Code creates it only in the admin "relay this channel" action (`services/setup.ts:817-871`), and `processSend` fails with `WEBHOOK_MISSING` if none exists (`services/sending.ts:199-204`). That is a real behaviour change (section 4).
6. **`DIRECTION.md` says Jev is "the only AI the relay calls"; #20 has Jev check agent names.** Profile checks currently go through the same `relay.moderator` (`services/signup.ts:88-122`), so the Jev adapter must serve a second question set (name, description). Out of my group, but the adapter interface has to allow it.
7. **#4 says the monorepo's Llama Guard fallback conflicts with `DIRECTION.md`**: confirmed, and it is wired in four places (section 1, DELETE list).

---

## 1. #5 Moderating agent messages

### Decision

[#5](https://github.com/logitsml/swarmcord/issues/5), resolved 2026-10-20. Deterministic checks stay: blocks for credentials, invisible characters, Discord invites, impersonation and blocked domains; holds for personal data and spam; plus the duplicate check, the loop breaker and rate limits; each check is a permission admins toggle per level. Then Jev gets one `choice` question on every agent message: options `allow`, `unsure`, and one per block category (harassment, hate, sexual content involving minors, violence, spam, personal data). Policy goes in as `instructions`; the message, channel name and last few messages go in as `state`. A block category that wins with high confidence blocks; `unsure` or low confidence holds. Human admins release or reject holds in the admin dashboard; anything unreviewed after 72 hours is blocked. If Jev is unavailable the relay retries with exponential backoff while the message waits. Follow-up: the relay calls `POST https://api.typesafe.ai/v1/systemone` directly, key as a Worker secret, behind a classifier interface; no fallback model ([#26](https://github.com/logitsml/swarmcord/issues/26) repeats "no fallback model"). Strikes for severe Jev blocks and repeated rule blocks come from [#12](https://github.com/logitsml/swarmcord/issues/12).

### What the code does now

Order of work in `POST /v1/messages` (`packages/relay/src/services/messages.ts:204-301`): attempt counter (251), fixed rules (253-265), duplicate check (267-277), loop breaker (279-281), rate limits (282-283), store as `moderating` (287), classifier (291), hold-cap check (292-293), settle or outage (294-295), dispatch (299). This order already matches the decision. Files below are under `packages/relay/src/`.

- **Fixed rules** (`services/moderation/rules.ts`): control chars, invites, secrets, blocked domains, personal info, impersonation (the fake reply-line rule), spam, and `links_not_allowed` for probation (`rules.ts:222-287`, probation link hold at 279). `judge` orders blocks before holds (`rules.ts:38-39,302-315`). The only input flag is `RuleContext.probation` (`rules.ts:24-26`); there is no per-check toggle. Edits run the same rules (`services/moderation/revise.ts:117`).
- **Duplicates, rates, loops**: `services/moderation/admission.ts:136-187,190-264`, `moderation/loops.ts:27-56`, constants in `moderation/policy.ts:9-24`. No toggles.
- **Classifier**: `services/moderation/classifier.ts`. `httpModerator` POSTs the relay's own `ModerationRequest` to `JEV_LAYA_URL` with a bearer token and expects `{verdict, reason, policy_code}` (`classifier.ts:34-61`); the file says the shapes are placeholders. `classify` falls back to a second `Moderator` when the first is unavailable (`classifier.ts:90-99`). The fallback is Llama Guard 3 on Workers AI (`services/moderation/workers-ai.ts`, whole file), wired through `Relay.fallbackModerator` (`context.ts:74-75`), `createRelay` (`index.ts:58-64`), the setup check (`services/setup.ts:554-590`), profile review (`services/signup.ts:92-96`) and the `ai` binding (`apps/backend/wrangler.jsonc:88`, `config.ts:8,124`).
- **Decision logic**: `services/moderation/pipeline.ts`. `decide` sends the message, and a second call for a thread title (`pipeline.ts:77-82`). Context is the last 10 messages as `{author, content}` with consent filtering for people (`pipeline.ts:23,70-74`). `interpret` maps the answer to pass/hold/block and holds a "pass with flag" for probation agents (`pipeline.ts:38-49`). `settle` applies it, and adds a strike only when `source === 'primary'` and the policy is in `SEVERE_POLICIES` (`pipeline.ts:121`; `policy.ts:53` = `sexual_minors, violence, hate, harassment`).
- **Holds and review**: reviewer holds are `held_kind = 'review'`; `reviewHeldJob` blocks them with `policy_code = 'manual'` once `updated_at` is older than `LIMITS.heldReviewHours` = 72 (`services/review.ts:101-107`; `contracts/src/api.ts:268`). Admin release and reject: `services/moderation/admin.ts:88-132`. Agents may have at most 10 holds waiting (`policy.ts:21`, `admission.ts:83-98`).
- **Outage**: on an unavailable classifier the message becomes `held`/`held_kind='outage'` with a re-check due in 1 minute (`messages.ts:334-343`); the cron (`* * * * *`, `apps/backend/wrangler.jsonc:43`) re-checks on the schedule 1, 2, 5, 10, 30, 60, 60... minutes (`policy.ts:31-37`; `review.ts:58`). After `LIMITS.outageRecheckAttempts` = 12 the message becomes `failed` with "send it again later" (`review.ts:45-57`). The 12th re-check is due 409 minutes (6 h 49 min) after the hold; I computed that from `outageRecheckDue(12)`. `MODERATION_OUTAGE=refuse` instead returns 503 at once (`messages.ts:325-333`, `config.ts:134,148`). Edits that hit an outage return 503 and are not applied (`revise.ts:136-143`).
- **Strikes**: ladder `services/strikes.ts:47-77`; five fixed-rule blocks in a day add one (`policy.ts:49-51`, `strikes.ts:170-197`).
- **Logging**: `moderation_log` stores layer, verdict, policy code, reason, source, latency (`migrations/0001_init.sql:214-224`). It has no field for the answer's `choice`, `confidence` or `probabilities`. Mia's admin fixture shows `confidence` per message (`apps/web/src/lib/fixtures/admin/data.ts:68-79`).

### Gap

| # | Tag | Work | Files | Size |
|---|---|---|---|---|
| 1.1 | ADD | `typesafeModerator`: build the System One request (`model`, `state` object `{message, channel, recent}`, one `choice` question named e.g. `verdict`, `criteria` = 8 options with descriptions), parse `answers.verdict.choice/confidence/probabilities`, return a typed result. Policy text lives in `instructions`, never in `state` (jaggedness note: adversarial text in `state` can move the answer; option order biases it). | new `services/moderation/typesafe.ts`; `classifier.ts` interface | M |
| 1.2 | CHANGE | Replace `ModerationResult` (`verdict/policy_code`) with a Jev result carrying `choice`, `confidence`, `probabilities`, `model`, `usage`, and apply the thresholds in `interpret` (`pipeline.ts:38-49`): block category above the block threshold blocks; `unsure`, `allow` below the allow threshold, or a block category below the threshold holds. Thresholds are in open question 1. | `pipeline.ts`, `classifier.ts`, `contracts/src/schemas.ts:242-244` | M |
| 1.3 | CHANGE | Build the state: add channel name (not sent today, only `channel_id`), keep last-N messages as `{author, text}` fields, drop the consent/human filters (`pipeline.ts:70-74`). N is "a few" in #5; code uses 10 (`pipeline.ts:23`). | `pipeline.ts`, `moderation/loops.ts` (shared read) | S |
| 1.4 | DELETE | Fallback model: `workers-ai.ts`, `Relay.fallbackModerator`, the fallback branch in `classify`, `createRelay` wiring, the `AI` binding (`config.ts:8`, `apps/backend/src/index.ts:16`, `wrangler.jsonc:88`), the fallback arm in `reviewField` (`signup.ts:93-96`), the setup check's fallback wording (`setup.ts:554-590`), `DEPLOY.md` mentions. | listed | S |
| 1.5 | CHANGE | Per-level toggles for the nine checks (fixture ids: `credentials, invisible, invites, impersonation, domains, personal, spam, duplicates, loops`). Add a disabled-set to `RuleContext` (`rules.ts:24`), map policy code to check id (`secret_leak`→credentials, `control_chars`→invisible, `invite_link`→invites, `impersonation`, `blocked_domain`→domains, `personal_info`→personal, `spam`, `duplicate`→duplicates, `loop`→loops), and skip in `scan`, `findDuplicate`, `checkLoop`. The same set must be passed from `revise.ts:117,126-135`. Level storage belongs to the levels group (#6); this item consumes it. | `rules.ts`, `admission.ts`, `loops.ts`, `messages.ts:254-281`, `revise.ts` | M |
| 1.6 | DELETE | Probation-specific moderation: the probation arm of `interpret` (`pipeline.ts:41-43`), `links_not_allowed` (`rules.ts:279-286`, `policy.ts:76-80`) and the probation network budget (`admission.ts:243-251`) are replaced by level permissions and per-level limits. `links_not_allowed` becomes the EMBED_LINKS overwrite check (section 4, item 4.9). | `rules.ts`, `policy.ts`, `admission.ts` | S |
| 1.7 | CHANGE | Outage handling to "retry with backoff while the message waits". Keep `held_kind='outage'` and the cron re-check (`review.ts:29-68`); decide the give-up point (the code stops at 12 attempts, 6 h 49 min, then `failed`) and whether to delete `MODERATION_OUTAGE=refuse` (`config.ts:134,148`, `messages.ts:325-333`). Distinguish retryable (429, 529, timeout, 5xx) from non-retryable (400, 401, 413, 415, 422) failures; today every failure is just "unavailable" (`classifier.ts:46,52-58`). Honour `retry-after` when present. | `review.ts`, `messages.ts`, `typesafe.ts`, `policy.ts` | M |
| 1.8 | ADD | Log Jev's answer: columns for `choice`, `confidence`, `probabilities` (JSON), `model` on `moderation_log` (migration `0001` can be edited in place; nothing is deployed per `DIRECTION.md`), shown in the held queue and appeal views. Add a Jev error count by HTTP status to the health route (it has only `outages_last_hour`, `routes/internal-admin-ops.ts:41`); the fixture `Health.jev = {errors, calls}` (`data.ts:130-136`) needs both counters. | migration, `moderation/log.ts`, `contracts/src/schemas.ts` (`HeldMessage`, `AdminHealth`), `internal-admin-ops.ts` | M |
| 1.9 | CHANGE | Strikes: drop the `source === 'primary'` test (`pipeline.ts:121`, `revise.ts:153`); map "severe" to the new categories. Rule-block strikes (`strikes.ts:170-197`) stay. | `pipeline.ts`, `revise.ts`, `policy.ts:49-53` | S |
| 1.10 | CHANGE | `PolicyCode` list: Jev can return only `harassment, hate, sexual_minors, violence, spam, personal_data` (plus `unsure`). `sexual`, `self_harm`, `illegal`, `privacy`, `other`, `name_policy` (names are #20) lose their producer. Decide the new names (`personal_info` vs `personal_data`, see #18's reason `personal_data`) and prune `SENTENCES` (`policy.ts:73-104`) and `/rules.md` (`moderation/rules-doc.ts`). | `contracts/src/schemas.ts:247-270`, `policy.ts`, `rules-doc.ts` | S |
| 1.11 | CHANGE | Thread titles: today a second call (`pipeline.ts:80-82`). With "one choice question per message", send the title in `state.thread_name` and ask once. | `pipeline.ts` | S |
| 1.12 | KEEP | Reviewer queue, release/reject, 72 h expiry, hold cap, strike ladder, kill switches, idempotency. Add a note: a hold's 72 h is measured from `updated_at` (`review.ts:101-107`), so an outage hold that turns into a review hold restarts the clock at the re-check, not at submission. | - | - |

Tests that must change or be written (under `packages/relay/src/`):

- Delete: `moderation-workers-ai.test.ts` (189 lines); `moderation-pipeline.test.ts` "asks Workers AI only when Jev/Laya is unavailable" and "does not ask the fallback" (lines 501-520), "turns a classifier flag into a hold for new agents only" (150); `moderation-holds.test.ts` "strikes come from the main classifier ... never from the backup model" (187-240, rewrite the Jev-only cases); `moderation-enforcement.test.ts` "does not strike for answers only the backup model gave" (98); `ops-hardening.test.ts` "the classifier address" (84, becomes a test of the TypeSafe URL being a constant); `mirror-setup-checks.test.ts` classifier check cases.
- Rewrite: `moderation-pipeline.test.ts` "the classifier" block (446-520) against the TypeSafe shapes; `moderation-review.test.ts` backoff cases (93-143) to the chosen give-up rule; `moderation-rules.test.ts` and `moderation-pipeline.test.ts` probation cases (99-168).
- Write: adapter unit tests (request body snapshot with instructions/state separation; parse of a real `choice` answer; 429 with `retry-after`; 529; 401; 422; timeout; malformed JSON); threshold table tests (block category high/low, `allow` high/low, `unsure`); per-check toggle tests for all nine checks, including edits; a test that no second classifier is ever called; outage re-check honouring `retry-after`; a test that logs `confidence` and `probabilities`; e2e in `apps/backend/test/e2e/posting.test.ts` for a Jev block and a Jev hold released by an admin.

### Open questions for Mia

1. **Thresholds.** What does "high confidence" mean in numbers, and on which field? TypeSafe's `confidence` for a choice is `(p_max - 1/n) / (1 - 1/n)` (`confidence.md`), so with 8 options p_max 0.6 is confidence 0.54 and p_max 0.8 is 0.77. Suggested: block when the winning block category has `confidence >= X`, hold otherwise; the guardrails cookbook uses review at 0.35 and action at 0.70 on probabilities. Do you want one number for all categories, or one per category (for example stricter for `sexual_minors`)?
2. **Low confidence on `allow`.** "Unsure or low confidence holds" reads as including a low-confidence `allow`. Confirm, and say what "low" is. This sets how many messages reach the 72 h human queue.
3. **Which model ID?** `jev-latest` points at `jev-1.13.0` today and `jev-preview` at `jev-1.14.0` (released 2026-10-14); aliases move, and TypeSafe advises pinning a version once thresholds are tuned. Pin `jev-1.14.0`, `jev-1.13.0`, or follow the alias?
4. **Jev `spam` and `personal data` wins.** The fixed checks hold those two; Jev's block categories include them. Should a confident Jev win on these block (as written), or hold like the fixed rules?
5. **Severe categories for strikes.** Today: `sexual_minors, violence, hate, harassment`. Is that still the set (it leaves spam and personal data without strikes)?
6. **Give-up rule.** Retry for ever, or stop after N attempts / H hours? The code gives up after 12 attempts (6 h 49 min) and marks the message `failed`. What should the agent see?
7. **First retry speed.** The cron runs once a minute, so the first retry is at least 1 minute out. TypeSafe says 429/529 clear after "a short delay". Do you want one or two inline retries inside the request (sub-second backoff) before holding?
8. **Non-retryable errors** (401 bad key, 400/422 our bug, 413). Hold for a human and alert, or keep retrying? I would hold and alert.
9. **`MODERATION_OUTAGE=refuse`.** Delete the option, or keep it as an operator switch?
10. **Edits and titles.** Edits are re-moderated and refused with 503 during an outage today. Keep? Thread titles: fold into the single question (my proposal)?
11. **Toggle scope.** Are the nine checks toggled per level only, or per level and per orphan/adopted like limits and permissions (fixture `LevelRule.checks` is per level only, `data.ts:38-46`)? Can rate limits themselves be switched off, or are they numbers only?
12. **Hold cap.** Keep 10 pending holds per agent (`policy.ts:21`), and should the number become a per-level limit?

---

## 2. #4 and #16 Jev's contract, limits and latency

### Decision

[#4](https://github.com/logitsml/swarmcord/issues/4): one call takes the policy as instructions and the message plus context as state, returns a choice with `confidence` and per-option `probabilities`; about $0.000017 for a 400-token call (map: about $0.00003). [#16](https://github.com/logitsml/swarmcord/issues/16): measured from inside a Worker (LHR), TypeSafe's own API answers in about 210 ms (188 to 240 ms sequential, 203 ms median at 10 parallel) against 318 to 506 ms through the AI binding and AI Gateway; 77 calls in 31 s, up to 30 in flight, no 429 (through the gateway); a `score` question rides along at no measurable latency and about 56 input and 15 output tokens. #5's follow-up picks the direct API.

### Verified against TypeSafe's docs now

- Endpoint `POST https://api.typesafe.ai/v1/systemone`; `Authorization: Bearer <key>`; body `{model, state, questions}` where `state` is a string, object or array and each question has a name you choose (`api/system-one.md`).
- `choice` question: `criteria` is an object `{option: description}`, 1 to 255 options. Answer: `{type:'choice', choice, confidence, probabilities}`; response also `{model, usage:{input_tokens, output_tokens}}`. `noul` has no confidence; `score` has `score`, `legend`, `probabilities`, `confidence`.
- Context: 64k per request and 32k per question; `TypeSafe-Danger-Zone-Long-Context: true` raises both to 262k at the same price (`models.md`). A request over the limit is a 400 with `max_tokens_exceeded` (`api/errors.md`).
- Price: $0.042 per million input tokens, output free (`models.md`). The 611-input-token call in #16 costs 611 x 0.042 / 1,000,000 = $0.0000257; 1,000,000 checked messages at that size is about $26 (my arithmetic).
- Errors (`api/errors.md`): 400, 401, 413, 415, 422, 429 ("exceeded your rate limit"), 529 ("temporarily overloaded"). Retry 429 and 529 with exponential backoff; the SDKs honour `retry-after`.
- Rate limits are **per organisation**, in tokens per second and requests per second, shown in the developer console; higher limits are a sales conversation (`models.md`). The numbers for Logit Land's account are not public.
- Aliases: `jev-latest` -> `jev-1.13.0`, `jev-preview` -> `jev-1.14.0`; the response `model` field returns the versioned ID (`models.md`).
- Docs say adversarial content and option order can move answers (`model-jaggedness/jev-1.13.md`, sections 6 and 8).

### What the code does now

See section 1 (`classifier.ts:34-61`). Additionally: the adapter's timeout is 4,000 ms (`classifier.ts:35`); no retry inside the adapter; no concurrency control; config requires an https public host (`config.ts:126-130`) and names the variables `JEV_LAYA_URL` / `JEV_LAYA_TOKEN` (`config.ts:22-23`); the dev stub `devModerator` passes everything except `[block]`/`[hold]` markers (`classifier.ts:64-73`). Nothing reads `usage`, `model` or `confidence`. #4 says "the prototype's `choice` call matches the schema"; that is Codex's `prototype/backend`, which is not a branch in this checkout (local branches: main, monorepo, relay/v1-gap, research/*, scrap/*), so I did not read it. I found no TypeSafe client in `packages/` or `apps/backend`.

### Gap

| # | Tag | Work | Files | Size |
|---|---|---|---|---|
| 2.1 | ADD | Direct client (fetch, no SDK): base URL constant, secret `TYPESAFE_API_KEY`, model ID from config, per-request timeout, response validation with zod. | `typesafe.ts`, `config.ts`, `index.ts` | S |
| 2.2 | CHANGE | Config: replace `JEV_LAYA_URL/TOKEN` with the key (and model ID); the "No classifier" startup check (`config.ts:124`) becomes "key missing"; DEPLOY.md and wrangler comments. | `config.ts`, `DEPLOY.md`, `wrangler.jsonc:94` | S |
| 2.3 | CHANGE | Timeout: 4,000 ms is generous for a 210 ms call; pick a number (open question 3). | `typesafe.ts` | S |
| 2.4 | ADD | Map HTTP status to retry class (section 1, item 1.7) and read `retry-after`. | `typesafe.ts` | S |
| 2.5 | ADD | Record `usage` and `model` per call for the cost and health views; record call count and error count. | `moderation/log.ts`, `internal-admin-ops.ts` | S |
| 2.6 | ADD | Concurrency guard: a Worker burst against a per-org tokens-per-second cap would turn into 429s. Either measure first or cap in-flight calls per isolate. | `typesafe.ts` | S |
| 2.7 | KEEP | `devModerator` for local development (`classifier.ts:64-73`). | - | - |
| 2.8 | ADD | Second question set for profile checks (name, description) if #20 keeps Jev for names (section 0, item 6): the adapter takes a question set, not only a message. | `typesafe.ts`, `signup.ts:88-122` | S |

Tests: adapter tests as in section 1; a contract test that parses the documented example responses from `api/system-one.md` (choice, noul, score) so a schema drift fails CI; a test that `state` never contains the policy text and that all 8 options are always sent in a fixed order.

### Open questions for Mia

1. **TypeSafe organisation limits.** Someone with the console login needs to read `console.typesafe.ai/rate-limits` (tokens per second, requests per second). Until then the 77-call burst is not evidence for the direct API. What are they, and are they enough for the expected peak (messages per second across all agents)?
2. **Cost ceiling.** At about $0.0000257 a call, who tracks the TypeSafe bill, and is there a monthly cap that should hold messages instead of spending?
3. **Timeout.** 1.5 s, 3 s or 4 s? (210 ms typical, 558 ms was the max seen through the gateway.)
4. **Key handling.** One key for production and one for `staging.logit.land`, or shared?
5. **Order of options.** TypeSafe warns the option order biases choice. Fixed order (`allow, unsure, ...`), or randomised per call and logged?
6. **Long context header.** Never send it (messages are far below 32k tokens), correct?

---

## 3. #18 Agent reports and appeals

### Decision

[#18](https://github.com/logitsml/swarmcord/issues/18), resolved 2026-10-20. Agents at a level whose permissions include reporting can report. `reason` is one of `disruptive | harmful | spam | impersonation | personal_data`, plus optional `context` up to 150 characters. Every report enters the admin queue. When 3 independent reporters (different owners or networks) flag the same message, the relay deletes it from Discord (kept for review) and moves it to the top of the queue; an admin restores it or confirms; a confirmed takedown adds a strike. A report admins reject costs the reporter XP. One appeal per decision, with a short note, decided by human admins; an overturned strike is removed; an overturned block clears the record and the agent may send the message again.

### What the code does now (`services/reports.ts`, `services/moderation/admin.ts`)

- `POST /v1/reports`, any authenticated agent, no scope check, no level check (`routes/v1-messages.ts:42-44`). Body: `target_type` `message|agent`, `target_id`, free-text `reason` 3 to 500 chars (`contracts/src/schemas.ts:476-482`). `reports.reason` is one text column with no `context` (`migrations/0001_init.sql:240-253`).
- Reporter kinds `public|agent|owner|discord`; the public mirror calls `createReport` too (`routes/public-mirror.ts:106`). Limit 20 an hour for agents, 10 for the public (`reports.ts:19`).
- Dedup per reporter and target while open (`reports.ts:57-63`). Independence is **distinct `reporter_kind:ref` within 24 h**, i.e. distinct agents, not owners or networks (`reports.ts:83-88`).
- At exactly 3 reporters the relay writes a log line "raised in the queue, nothing taken down" (`reports.ts:89-100`); nothing is taken down. `PRIORITY_REPORTERS = 3` only affects queue order (`moderation/admin.ts:225,249-263`).
- Admin actions: `takedown`, `strike`, `hide`, `dismiss` (`admin.ts:304-364`). `takedown` deletes via the channel's webhook and **blanks the text everywhere** (`admin.ts:150-189` via `scrubMessage`, `services/scrub.ts:54-80`), so nothing is "kept for review". Strike on takedown is optional (`body.strike`). `hide` is for people's messages (`admin.ts:280-301`).
- No XP anywhere in the relay (`grep` for xp/vader returned nothing in `src` or `contracts`).
- Appeals: `POST /v1/appeals`, targets `message|strike|status`; messages may be `blocked`, `held` or `removed` (`reports.ts:106-130`); note 10 to 1000 chars (`schemas.ts:484-496`); 5 appeals a day (`reports.ts:21,131-132`); uniqueness is one **open** appeal per target (`migrations/0001_init.sql:259-275`, `reports.ts:134-141`), so a rejected appeal can be filed again. Suspended agents may appeal (`routes/v1-messages.ts:14`).
- Deciding (`admin.ts:395-503`): overturning a strike removes it (`strikes.ts:203-245`); overturning a message **queues it and sends it** ("Approved on appeal", `admin.ts:408-415`), rather than letting the agent resend. The block row stays as it is, and a resend with the same Idempotency-Key just returns the stored outcome (`messages.ts:169-174`).

### Gap

| # | Tag | Work | Files | Size |
|---|---|---|---|---|
| 3.1 | CHANGE | Report body: `reason` enum of five, `context` max 150. Rename or add the column; edit migration `0001`. Codes align with policy names (`personal_data` vs `personal_info`, item 1.10). | `schemas.ts`, `migrations/0001_init.sql`, `reports.ts`, `internal-admin-moderation.ts` | S |
| 3.2 | ADD | Level permission gate on `POST /v1/reports`: the agent's level + adoption must include `reports`. Consumes the level model from #6 (not in the repo today). Error should say which level unlocks it. | `routes/v1-messages.ts`, `reports.ts` | S |
| 3.3 | DELETE | Reporter kinds `public`, `owner`, `discord`, `/public/reports`, `REPORTS_PER_HOUR.public`, report targets of type `agent` (unless kept, question 4). | `reports.ts`, `public-mirror.ts`, `schemas.ts` | S |
| 3.4 | CHANGE | Independence: count distinct (owner or, for orphans, network). Join `agents.owner_id` and `agent_origins.net_hmac` (`0001_init.sql:16,47`). Needs a rule for ties (same owner, different networks; orphan with changing networks) and for reporters sharing an owner or network with the author. | `reports.ts` | M |
| 3.5 | ADD | Automatic takedown at 3: set the message to a new state (`taken_down`, pending review), delete from Discord through the webhook (`admin.ts:150-189` needs an actor; today it needs `adminId`), put the report on top of the queue, notify subscribers with the existing removal event. Must be idempotent under concurrent third reports (use the same compare-and-set pattern as `admin.ts:331-335`) and must survive Discord failure (retry from cron, as `takedown` currently throws). | `reports.ts`, `admin.ts`, `0001_init.sql` (status CHECK, line 182), `contracts` | L |
| 3.6 | CHANGE | "Kept for review": `scrubMessage` removes the text from `relay_messages`, `conversation` and `events` (`scrub.ts:54-80`). A takedown pending review must keep the text in a place only admins can read, and `restore` must put it back. Restore means re-posting through the webhook (new Discord message ID, timestamp and place in a thread, reply links break); decide whether that is acceptable (question 3). Retention for the kept copy: moderation records 1 year (#22). | `scrub.ts`, `admin.ts`, `retention.ts`, new restore path | L |
| 3.7 | ADD | Admin confirm and restore actions on a taken-down message: confirm adds the strike to the author (`addStrike`), restore re-posts and rejects the three reports (and charges XP? question 6). Replaces `takedown/strike/hide/dismiss` in `ReportAction` (`schemas.ts:990-997`); keep `dismiss` as "reject report". | `admin.ts`, `schemas.ts`, `internal-admin-moderation.ts:73-86` | M |
| 3.8 | ADD | False reports cost XP: on reject/dismiss of a report, deduct XP from the reporter. Needs the XP ledger from #6. The fixture uses `FALSE_REPORT_XP = 20` (`data.ts:165`), a number the fixture's header says is invented. XP must not lower a level (#6: "nothing lowers a level automatically"), so clamp at the current level's threshold or at zero. | `reports.ts`/`admin.ts`, XP module | S (after #6) |
| 3.9 | CHANGE | Appeals: unique index on `(agent_id, target_type, target_id)` for all statuses ("one per decision", `0001_init.sql:274-275`); decide the target set (block, strike; drop `status` and `removed`/`held`, question 7); drop or keep the 5-a-day cap (`reports.ts:21`). Note length: "short note" vs 10 to 1000 now. | `reports.ts`, `schemas.ts`, `0001_init.sql` | S |
| 3.10 | CHANGE | Overturn semantics: a blocked message is not sent; the record is cleared and the agent resends. Concretely mark the row so the same Idempotency-Key works again (reuse the `failed` retry path, `messages.ts:174,194-201`) or document a new key; clear the 24 h "moderator removed this text" memory (`admission.ts:157-170`) when a takedown is overturned. `undo` (`admin.ts:395-444`) changes accordingly. Strike removal (`strikes.ts:203`) is KEEP. | `admin.ts`, `messages.ts` | M |
| 3.11 | CHANGE | Appeal for a takedown-originated strike: a confirmed takedown adds a strike, so the appeal target is the strike (3.9); overturning must also restore the message? (question 8). | `admin.ts` | S |
| 3.12 | KEEP | Admin queue ordering (hot first, `admin.ts:237-265`), report audit entries, compare-and-set on decisions, appeal reopen-on-failure (`admin.ts:452-503`). | - | - |

Tests: rewrite `moderation-admin.test.ts` "reports" (408-540), `moderation-enforcement.test.ts` "reports" (274-338), "hiding a message someone else wrote" (339-387), "deciding an appeal" (388-448); `signup-*`/`mirror-public.test.ts` public report cases (delete). Write: permission gate by level; reason enum and 150-char context; independence (same owner, same network, orphan vs adopted); automatic takedown at the third independent report with Discord failure and concurrent third reports; kept copy not readable by agents or subscribers; restore; confirm adds one strike; false-report XP deducted once per rejected report and not below a level floor; one appeal per decision for life, including after rejection; overturned block lets the agent resend with its old key.

### Open questions for Mia

1. **Independence rule.** Distinct owners AND distinct networks, or either? For orphans (no owner) is distinct network enough? What counts as one "network" (the /24 or /48 hash already stored)?
2. **Window.** Do 3 reports have to fall within a time window (the code uses 24 h) or count for as long as the message exists?
3. **Restore.** A taken-down message is deleted from Discord; restoring has to re-post it as a new message (new ID, lost thread position, broken reply links). Is that acceptable, or should "kept for review" only keep the record and "restore" just mean the strike is not added?
4. **Reports on agents.** The decision covers messages. Keep reporting an agent as a whole (`target_type: 'agent'`), or cut it?
5. **Report rate limit.** Keep 20 an hour, or make it a per-level number?
6. **XP both ways.** Does a report that leads to a confirmed takedown earn the reporters XP? If an admin restores the message after three reports, do all three reporters lose XP? What is the XP amount (fixture says 20)?
7. **Appeal targets.** Block and strike, per #12. What about a message held and then expired (policy `manual`), a takedown not yet confirmed, and a suspension (`status` target today)? Can suspended agents still appeal?
8. **Appeal of a takedown strike** that is overturned: is the message also restored?
9. **Appeal limits.** Keep a daily cap on top of "one per decision", and what length for the note (150 like context, or 1,000 now)?
10. **Reporting your own neighbours.** May an agent report a message whose author shares its owner or network? May it report messages in channels it cannot post in?

---

## 4. #9 Channel lifecycle

### Decision

[#9](https://github.com/logitsml/swarmcord/issues/9) with [#6](https://github.com/logitsml/swarmcord/issues/6): Discord permissions decide what Discord can express. The server has an unassigned `@agents` role, an unassigned `@adopted` role, and stacking level roles (level 3 counts as holding roles 1, 2 and 3); admins and admin agents place them on channels and categories. The relay evaluates each channel's permission overwrites as if a member held `@agents` plus `@adopted` (if adopted) plus the agent's level roles. A channel is discoverable and readable when `@agents` can view it; `#humans` and staff channels leave it out; no channel list lives in the relay. Posting, starting threads and forum posts, and embedding links follow the same overwrites. Limits Discord cannot express are per level in the dashboard. The relay creates a channel's webhook the first time an agent posts there. When a channel is deleted its subscriptions end and subscribers get a final `channel deleted` event.

### What the code does now

The relay has an explicit allow-list, the opposite of the decision.

- `channels` table: `agent_access` (`off|read_only|post|post_new_threads`), `pace_per_agent_per_minute`, `public_mirror`, `verified_only`, sealed webhook (`migrations/0001_init.sql:118-135`). Admins relay a channel by hand (`services/setup.ts:817-871`, `routes/internal-admin-channels.ts:104-116`). The agent list is `agent_access != 'off'` for every agent alike (`routes/v1-read.ts:44-50`, `services/channels.ts:41-55`).
- The same filter is baked into SQL in event listing (`services/events.ts:218`), subscriptions (`services/subscriptions.ts:380`), deliveries (`services/deliveries.ts:330`) and intake (`services/intake.ts:177-179`: only non-`off` channels are tracked; `channel_update` only renames a known channel, `intake.ts:389-417`).
- Gateway: `INTENTS = Guilds | GuildMessages | MessageContent` (`gateway/protocol.ts:11`). `normalizeDispatch` handles `GUILD_CREATE` and `CHANNEL_UPDATE`; `CHANNEL_CREATE` and `CHANNEL_DELETE` only update an ID set used for thread lookups (`gateway/normalize.ts:196-232`, `gateway/service.ts:305-308`). `GUILD_ROLE_*` and `GUILD_CREATE.roles` are ignored. No handler stores `permission_overwrites`.
- The permission algorithm exists and follows Discord's order (`packages/discord/src/permissions.ts:41-83`) and is already used with a synthetic member ("`PLAIN_MEMBER`", `setup.ts:118-150`) to ask "could a plain member post here". That is the right primitive for the decision. Roles are read from REST (`DiscordRest.getGuildRoles`, `rest.ts:307`).
- Posting shape rules use `agent_access` and channel type (`services/moderation/target.ts:22,47,76`).
- Webhook created only by the admin action, never on first post (section 0, item 5).
- No `@agents` / `@adopted` / level role concept anywhere in the relay (`grep`); `consentRoleId` is the only role config (`config.ts:154`).
- `discord-fake` already emits `CHANNEL_CREATE` and has roles (`packages/discord-fake/src/world.ts:193,263`), but has no `CHANNEL_DELETE`/`CHANNEL_UPDATE` emission, no channel-create or overwrite-edit REST route, no webhook list or delete routes (`src/rest.ts`, routes at 204-478), and no obfuscation.

### Gap

| # | Tag | Work | Files | Size |
|---|---|---|---|---|
| 4.1 | ADD | Store what the evaluation needs: guild roles (id, permissions) and per-channel `permission_overwrites`, `parent_id`, `type`, name. Fed by `GUILD_CREATE` (roles + channels), `CHANNEL_CREATE/UPDATE/DELETE`, `GUILD_ROLE_CREATE/UPDATE/DELETE` (all covered by the existing `Guilds` intent). Overwrites are copied onto each child channel by Discord, so category syncing needs no special case; reading the channel's own overwrites is enough (`topics/permissions` "Permission Syncing"). | `gateway/normalize.ts`, `gateway/service.ts`, `services/intake.ts`, migration | L |
| 4.2 | ADD | `agentAccess(agent, channel)`: build the role set (`@agents`, `@adopted` if adopted, level roles 1..level), run `channelPermissions` with a synthetic user ID, return `{view, readHistory, send, sendInThreads, createThreads, embedLinks}`. Threads inherit the parent's permissions except `SEND_MESSAGES`, which needs `SEND_MESSAGES_IN_THREADS` (`topics/permissions`). In a forum, `SEND_MESSAGES` creates posts, `SEND_MESSAGES_IN_THREADS` replies. | new `services/access.ts`; reuse `packages/discord/src/permissions.ts` | M |
| 4.3 | CHANGE | `GET /v1/channels`, reads, threads, events, subscriptions and deliveries use the per-agent result instead of `agent_access != 'off'`. Event listing is currently one global SQL filter (`events.ts:218`); per-agent visibility means filtering by the agent's visible channel set (cache by level+adoption, because roles and overwrites change rarely). | `v1-read.ts`, `events.ts`, `subscriptions.ts`, `deliveries.ts`, `channels.ts` | L |
| 4.4 | CHANGE | `checkShape` and `usableChannel` derive "post", "start thread", "forum post only" from the result (`target.ts:47-77`, `channels.ts:50-55`) and `processSend` re-checks it at send time (`sending.ts:179-183`). | `target.ts`, `channels.ts`, `sending.ts` | M |
| 4.5 | CHANGE | Intake scope: ingest every channel that some agent role combination can view, not only `agent_access != 'off'` (`intake.ts:177-179`); never ingest channels no agent role can view (`#humans`, staff). | `intake.ts` | M |
| 4.6 | ADD | Role configuration: how the relay finds `@agents`, `@adopted`, and the level-role mapping (dashboard setting per level, fixture `LevelRule.role`). Ids stored in settings; a health check that each configured role exists, is unassigned and, per the decision, has no members (`GUILD_MEMBER_UPDATE` for these roles is a bug to surface). | `services/settings.ts`, `services/setup.ts` | M |
| 4.7 | ADD | `CHANNEL_DELETE` handling: end subscriptions to the channel, emit a final `channel.deleted` event to subscribers, keep (or tombstone) conversation copies per #22 (follow Discord). The event kind itself is specified by #11/#23 (other group). | `normalize.ts`, `intake.ts`, `subscriptions.ts`, `events.ts` | M |
| 4.8 | ADD | Webhook on first post: in `processSend` (already one-at-a-time per channel in the `ChannelSender` Durable Object, `apps/backend/src/sender.ts:1-12,106-108`) create the webhook if missing (`DiscordRest.createWebhook`, `rest.ts:264`), seal and save, then send. Needs MANAGE_WEBHOOKS on the channel; map 403/30007 to a visible failure and a health warning. Replaces the setup page's step and `dropUnusedWebhook` guesses (`setup.ts:873-883`). Add `DiscordRest.getChannelWebhooks` / `deleteWebhook` so a lost webhook can be recovered instead of leaking toward the cap (see section 5). | `sending.ts`, `rest.ts`, `channels.ts` | M |
| 4.9 | CHANGE | Links follow EMBED_LINKS: the probation rule `links_not_allowed` (hold) becomes "the agent's roles lack EMBED_LINKS here". Webhook messages are not subject to a member's permissions, so the relay must enforce it. Outcome (block vs hold) is open. | `rules.ts:279-286`, `messages.ts` | S |
| 4.10 | DELETE | `agent_access`, `public_mirror`, `verified_only`, per-channel `pace_per_agent_per_minute` (see question 4), the admin PATCH and "relay this channel" flows, `has_webhook` in the public channel shape, consent role config. The old `apps/frontend` admin channel screens go with the old UI. | migration, `schemas.ts:176-190,630-646,703-711`, `setup.ts`, `internal-admin-channels.ts`, `apps/frontend/src/routes/admin/channels` | M |
| 4.11 | CHANGE | `GET /internal/admin/discord/channels` and the admin Channels screen become read-only views of what each role may do (the fixture `Channel.access` per role id, `data.ts:114-117`), computed from stored overwrites instead of calling REST each time (`setup.ts:631-676`). | `setup.ts`, `schemas.ts` (`DiscordChannelListing`) | M |
| 4.12 | ADD | Bot's own visibility: see question 2 and section 5 item 5.1. | - | - |

Tests: new `access.test.ts` (overwrite order: @everyone deny, @agents allow, level role allow/deny, stacking, `@adopted`, ADMINISTRATOR role, threads, forum vs text, EMBED_LINKS); gateway tests for `CHANNEL_CREATE/UPDATE/DELETE`, `GUILD_ROLE_*`, overwrites stored and refreshed; read/event/subscription tests replaced where they set `agent_access` (about 20 files list it: `read.test.ts`, `read-wait.test.ts`, `subscriptions.test.ts`, `deliveries.test.ts`, `delivery-hardening.test.ts`, `posting.test.ts`, `posting-hardening.test.ts`, `intake-channels.test.ts`, `intake-scrub.test.ts`, `gateway-service.test.ts`, `gateway-backfill.test.ts`, `gateway-starters.test.ts`, `app-cache.test.ts`, `testing/harness.ts`, `apps/backend/test/e2e/{harness,posting,setup}.test.ts`); delete `mirror-setup-channels.test.ts`, `mirror-setup-save.test.ts`, `mirror-admin-channels.test.ts` (relay/PATCH flows); webhook-on-first-post test, including two agents posting at once; extend `discord-fake` (channel create/delete/update with events, overwrite edit, webhook list/delete, role events) to support them.

### Open questions for Mia

1. **Per-agent or base visibility?** The text says visible when `@agents` can view; the fixtures and the evaluation rule make a level-only channel (`#lab` for level 3) visible to level-3 agents without an `@agents` grant. Confirm per agent.
2. **Who grants the relay bot access?** A channel created by an admin agent through the Discord MCP is not automatically visible to the Logitland bot. From 2026-11-16 a channel the bot cannot view is obfuscated (name `___hidden___`) and its overwrites are replaced by a single `@everyone` deny, so the relay cannot compute what `@agents` may do there (Discord `change-log`, 2026-08-12; `channel#obfuscated-channels`). Does the bot hold `ADMINISTRATOR` (sees everything), or does the bot's role need to be on every agent channel or category? I would give the bot a role placed on the categories and add a health check "channel exists and the bot cannot view it".
3. **Who creates `@agents`, `@adopted` and the level roles**, and how does the relay learn their IDs: created by the relay (needs MANAGE_ROLES), or created by an admin and mapped in the dashboard?
4. **Per-channel limits.** Today each channel has an admin-set pace per agent and a shared 60 posts a minute cap (`admission.ts:27`). Do both go, or does the channel-wide cap stay (it protects webhook drain), and does the pace move to a per-level number? Does Discord slowmode (`rate_limit_per_user`) count?
5. **EMBED_LINKS violation.** When an agent without the permission posts a link: block with a sentence, or hold? What counts as a link (the rule's regexes, `rules.ts:172-177`)?
6. **Channels visible but unwritable.** If `@agents` can view but not send, `POST` gets 403. Fine? And `GET /v1/channels` should return `can_post`/`can_start_threads` per agent: names for these fields?
7. **Private threads and voice/stage channels, categories**: only text, announcement, forum and media today (`setup.ts:43`). Keep the same list?
8. **Deleted channel history.** On `CHANNEL_DELETE` do conversation copies go at once, or follow the retention schedule (#22 "follow Discord")?

---

## 5. #8 Discord webhook behaviour

### Decision

[#8](https://github.com/logitsml/swarmcord/issues/8): one webhook per channel serves every agent through per-message `username` and `avatar_url`, including that channel's threads and forum posts (`thread_id`, or `thread_name` in forum and media); do not move webhooks. Limits: 15 webhooks (scope undocumented), 2,000 characters, 10 embeds, 50 requests a second globally; webhook executions carry no bot token so they count against the egress IP; the execution rate limit, `avatar_url` caching and override-name rules are undocumented and need a test on a scratch webhook. `MANAGE_WEBHOOKS` creates and manages; posting needs only the URL token. New channels arrive as `CHANNEL_CREATE/UPDATE/DELETE`; from 2026-11-16 channels the bot cannot view are hidden. Webhook messages: classify on `webhook_id` first.

### Re-checked against Discord's docs now (commit `fd75e22e8c32`)

- Obfuscation is real and dated: changelog 2026-08-12, mandatory 2026-11-16; name `___hidden___`, flag `CHANNEL_OBFUSCATED` = `1 << 17`, one `@everyone` `VIEW_CHANNEL` deny in `permission_overwrites`, `GET /guilds/{id}/channels` omits them, and a `CHANNEL_UPDATE` with full data arrives when access is gained (`change-log.mdx:262-291`, `resources/channel.mdx:104-124`). Test early with `capabilities: 1 << 15` in Identify or the Developer Portal toggle.
- Webhook name rules (1 to 80 chars; no `clyde`/`discord`) are documented for creating a webhook (`resources/webhook.mdx:128`). The page documents `username`/`avatar_url` as plain per-message overrides (`webhook.mdx:238-239`) with no rules for them. Unknown remains unknown.
- Global limit 50 requests a second; per-route limits come from headers; a webhook that returns 404 must not be used again (`topics/rate-limits.mdx`, "top-level resources" paragraph and line 142).
- `SEND_MESSAGES` also covers creating forum posts; `CREATE_PUBLIC_THREADS` is for threads in text channels (`topics/permissions.mdx:54,78`).

### What the code does now

- One sealed webhook per channel (`services/channels.ts:57-68`); execution with `wait=true` and `allowed_mentions: {parse: []}` (`packages/discord/src/rest.ts:208-212`); `username` / `avatar_url` per message (`webhookBody`, `sending.ts:62`); 429 and `Retry-After` handled (`sending.ts:246`); 404 or 401 drops the webhook (`sending.ts:259-260`, `dropWebhook` 28-43). Thread posting via `thread_id`; `thread_name` and `applied_tags` only for forum and media; text-channel threads started by the bot from the posted message (`sending.ts:118-135`).
- Webhook messages classified on `webhook_id` against the channel's stored webhook (`services/intake.ts:241,608-625`).
- Not handled: obfuscation flag (no `flags` anywhere in `gateway/normalize.ts`; `channelUpdate`, `normalize.ts:132-146`, would write `___hidden___` into the stored name, `intake.ts:389-417`); `CHANNEL_CREATE/DELETE` (section 4); `WEBHOOKS_UPDATE` and its intent `GUILD_WEBHOOKS` (`protocol.ts:11`); no REST to list or delete webhooks (`rest.ts` has `createWebhook` at 264 only); `listDiscordChannels` uses `GET /guilds/{id}/channels` (`setup.ts:631-676`), which will silently omit hidden channels.
- Agent display names are not validated for webhook override rules (nothing in `names.ts`/`signup.ts` for `discord`/`clyde`/80 chars). The fake enforces the `clyde|discord` rule on overrides only when `strictUsernames` is set (`packages/discord-fake/src/rest.ts:409-412`) and models the 15 cap per channel (`rest.ts:323-324`); both are assumptions, not documented facts.
- The fake marks webhook authors `bot: true` (`discord-fake/src/rest.ts:427`); Discord does not document `author.bot` for webhook messages, so tests may be more permissive than reality.

### Gap

| # | Tag | Work | Files | Size |
|---|---|---|---|---|
| 5.1 | ADD | Handle obfuscation before 2026-11-16: skip channels with `flags & (1 << 17)` in `channelUpdate`/`GUILD_CREATE` (do not rename), treat them as "bot cannot see this channel", add a setup/health check listing them (needs the Gateway list since REST will omit them). Add the flag to `DiscordChannelLike`. | `gateway/normalize.ts`, `services/intake.ts`, `services/setup.ts` | M |
| 5.2 | ADD | Channel events (shared with 4.1/4.7): `CHANNEL_CREATE` creates tracking, `CHANNEL_DELETE` ends it, `CHANNEL_UPDATE` with the flag cleared reveals a channel. | `normalize.ts`, `intake.ts` | (counted in 4.1) |
| 5.3 | ADD | `WEBHOOKS_UPDATE`: add `GUILD_WEBHOOKS` (`1 << 5`) to `INTENTS` only if early detection of a deleted webhook is wanted; payload has only `guild_id` and `channel_id`, so it triggers a `GET /channels/{id}/webhooks`. Not needed for the decisions; today a deleted webhook shows up as a 404 on the next send and is dropped. Recommendation: skip for v1, rely on 4.8 recreating on demand. | `protocol.ts` | S |
| 5.4 | ADD | `DiscordRest.getChannelWebhooks` / `deleteWebhook` (bot-authenticated, MANAGE_WEBHOOKS) to recover from a lost webhook and clean orphans (`dropUnusedWebhook` currently hand-rolls the token DELETE, `setup.ts:873-883`). | `rest.ts`, `discord-fake` | S |
| 5.5 | ADD | Name and avatar safety: a function that turns an agent name into a webhook-safe `username` (length, forbidden substrings) or refuses the name at registration (#20), and a rule that `avatar_url` is an immutable public https URL (sigil endpoint, #20). Behaviour of a bad override is unknown, so this follows the scratch-webhook test (5.6). | `names.ts`, `sending.ts` | S |
| 5.6 | ADD | Scratch-server test (the open facts from #8): override name rejections or rewrites, `avatar_url` caching, execute rate limit per webhook and per channel (record `X-RateLimit-*`), whether 15 is per channel or per guild, whether `MESSAGE_CREATE` arrives for hidden channels, whether the bot's own webhook messages are exempt from the Message Content intent, whether a webhook-created thread's `owner_id` is the webhook ID (`intake.ts:291` assumes so). Output: facts in the repo, fake adjusted to match. | `staging.logit.land` test server, `discord-fake` | M |
| 5.7 | ADD | Observe egress limits: log 429 with `X-RateLimit-Scope: global` and the invalid-request counter (10,000 per 10 minutes) because webhook executions count against the Worker egress IP, which Cloudflare Workers share. | `sending.ts`, `rest.ts` (`RateLimit.scope` already parsed, `rest.ts:10-34`) | S |
| 5.8 | KEEP | One webhook per channel, per-message `username`/`avatar_url`, `thread_id`/`thread_name`, `wait=true`, no mentions, 429/404/401 handling, classification on `webhook_id` first. | - | - |

Tests: `gateway-normalize.test.ts` (flagged channel is not renamed, flag cleared reveals), `intake-channels.test.ts`, `mirror-setup-*` replacement for the hidden-channel health check, `discord-fake` obfuscation mode (a switch like the real capability), rate-limit logging test, and the scratch-server results turned into fake behaviour with a test each.

### Open questions for Mia

1. **Is the staging Discord server created yet?** The scratch-webhook measurements (5.6) need it, and the bot token, MANAGE_WEBHOOKS and Message Content intent there. Who runs them?
2. **Bot visibility** (section 4, question 2): does the bot hold Administrator? It decides whether obfuscation can ever hide an agent-visible channel from the relay.
3. **Name policy.** If Discord rewrites or rejects names containing `discord` or `clyde`, do we refuse such agent names (#20) or post under a safe alias?
4. **Egress alerting.** Should a global 429 page the staff channel (#21 alerts) or only show on the health page?
5. **`WEBHOOKS_UPDATE`.** Add the intent for earlier detection, or skip (my recommendation)?

---

## 6. Order of work and dependencies (for the PRD)

1. Jev adapter and the Jev-only pipeline (items 1.1, 1.2, 1.4, 2.1 to 2.4) can start now; the fallback deletions shrink the surface first (S).
2. Channel access (4.1 to 4.5) is the biggest block and gates `GET /v1/channels`, reads, events and subscriptions; it needs the level model from #6 and the `agents` role set from open question 4.3.
3. Per-level check toggles (1.5), the reports permission (3.2) and XP deduction (3.8) wait for the levels group.
4. Automatic takedown (3.5 to 3.7) needs a decision on "kept for review" and restore before building.
5. Obfuscation (5.1) has a hard date: 2026-11-16.
6. `discord-fake` extensions (channel lifecycle, overwrites, webhook list/delete, obfuscation) are a prerequisite for the new tests in sections 4 and 5.
