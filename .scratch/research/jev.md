# Jev's contract and limits

Findings dated **2026-10-20**. Answers [issue #4](https://github.com/logitsml/swarmcord/issues/4).
Scope: `typesafe/jev` on Workers AI as the relay's pre-post classifier. No paid API was called; every finding comes from documentation, the published JSON schemas, or repo code.
Labels: **Verified** = read in a primary source (linked). **Inferred** = follows from verified facts. **Unknown** = no primary source says; would need a live call or a question to Cloudflare/TypeSafe.

## Short answer

- Jev takes `{ state, questions }` and returns `{ model, answers, usage }`. There is no tool calling and no free text out.
- A question is a `noul` (yes/no probability), a `choice` (one named option plus per-option probabilities and `confidence`), or a `score` (ordered levels). "Other" is not a type; it is an option you write.
- One call can ask any number of questions, mix the types, and carry structured context in `state`. Verdict plus policy category plus hazard flags fits in one call.
- It costs about **$0.000017 for a 400-token call** (input only; output is free). Whether the free daily allowance covers it, and which Workers AI rate limit applies, are **unknown**.
- Failures arrive as Workers AI errors (408 timeout, 429 capacity or quota, 413). Nothing documents an SLA, a status page, or how upstream TypeSafe 429/529 surface through the binding.

## 1. Input and output schema

Sources: [Cloudflare model page](https://developers.cloudflare.com/ai/models/typesafe/jev/), [input schema](https://developers.cloudflare.com/ai/models/typesafe/jev/schema-input.json), [output schema](https://developers.cloudflare.com/ai/models/typesafe/jev/schema-output.json), [TypeSafe Choice](https://docs.typesafe.ai/primitives/choice.md), [Noul](https://docs.typesafe.ai/primitives/noul.md), [Confidence](https://docs.typesafe.ai/confidence.md), [System One OpenAPI](https://docs.typesafe.ai/api/system-one.md).

**Call (Verified).** `env.AI.run('typesafe/jev', { state, questions })`, or `POST /accounts/{id}/ai/run` with `{ "model": "typesafe/jev", "input": { state, questions } }`. The input schema has `additionalProperties: false` and only `state` and `questions`, both required.

**`state` (Verified).** A string, an object, an array, or `null`. Objects and arrays hold any JSON (strings, numbers, booleans, nulls, nesting). Text only; audio and video are not supported ([State](https://docs.typesafe.ai/concepts/state.md)).

**`questions` (Verified).** A map from an id you choose (non-empty string) to a question. The id is for your code and is never shown to the model.

| type | request fields | answer |
| --- | --- | --- |
| `noul` | `type`, `instructions` (required); `criteria` `{ true, false }` optional | `{ type, noul: 0..1 }`, the probability of yes. No `confidence` field. |
| `choice` | `type`, `instructions`, `criteria` (all required): a map of option name to description | `{ type, choice, confidence: 0..1, probabilities: { option: 0..1 } }` |
| `score` | `type`, `instructions`, `criteria` (all required): an ordered array of level descriptions, min 2 | `{ type, score: number, confidence, legend: { "0": ... }, probabilities }`. `score` is a weighted position (the doc example returns 1.04). |

`instructions` and each criterion may be a string, an object, an array, or `null`. A `null` option description means the option name stands alone.

**Response envelope (Verified).** `{ model: "jev-1.13.0", answers: { <id>: ... }, usage: { input_tokens, output_tokens } }`.

**`confidence` (Verified).** Derived from `probabilities`, not an extra model output. For a choice with n options: `(p_max − 1/n) / (1 − 1/n)`. With n = 3, confidence 0.85 means `p_max` = 0.90. For a noul the doc suggests `|2p − 1|` if you want the same scale.

**Counts and size.**

| limit | value | status |
| --- | --- | --- |
| Questions per call | no limit beyond context | Verified ([Models](https://docs.typesafe.ai/models.md#context-length)) |
| Options per choice | 255 (`maxProperties`) | Verified in TypeSafe's OpenAPI; the Cloudflare schema states no cap. Whether Workers AI enforces 255 is **Unknown**. |
| Levels per score | 10 max in TypeSafe's OpenAPI (min 1); Cloudflare's schema says min 2, no max | Verified, with the mismatch. Not needed for a verdict. |
| Context | 32,000 tokens on Workers AI | Verified (model page) |
| Context, TypeSafe's own API | 64k per request, 32k per question (`state` plus one question) | Verified. `state` is read once and every question is evaluated in parallel, so each question must fit with `state`. |
| Long-context header | 262k with `TypeSafe-Danger-Zone-Long-Context: true` | Verified on TypeSafe's API. Not offered in the Workers AI schema; **Unknown** if passable. |
| Body, nesting | 32 MiB, 64 levels | Verified ([errors](https://docs.typesafe.ai/api/errors.md)) |

**Versions.** The Workers AI examples return `jev-1.13.0`. TypeSafe lists `jev-1.14.0` (released 2026-10-14) and says the alias `jev-latest` points at 1.13.0. **Verified:** the Workers AI input schema has no `model` field and rejects extra properties. **Inferred:** a relay cannot pin a version through the binding. **Unknown:** when Workers AI moves to 1.14. Log `model` from every response (TypeSafe advises this) and re-tune thresholds when it changes.

## 2. Latency, price, allowance, rate limits

**Price (Verified).** $0.042 per 1M input tokens; output and cached input $0.00 ([model page](https://developers.cloudflare.com/ai/models/typesafe/jev/)). TypeSafe's own price is the same ([Models](https://docs.typesafe.ai/models.md)).
Worked cost, **Inferred**: the documented examples use 380 to 426 input tokens, so about **$0.000016 to $0.000018 per call**, or $0.017 per 1,000 messages. A message plus policy plus 10 context messages is plausibly 1,000 to 3,000 tokens, which is $0.00004 to $0.00013 per call. The `usage` field reports the real count.

**Free allowance: Unknown.** Workers AI gives 10,000 neurons per day free, then $0.011 per 1,000 neurons ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), verified). That page lists no row for `typesafe/jev`. If Jev bills at the neuron rate, **Inferred**, $0.042/M is about 3,800 neurons per M tokens, so the free tier would cover roughly 2.6M input tokens a day (about 6,000 calls of 400 tokens). Whether a third-party model draws on the free allocation, or needs Workers Paid, is not stated.

**Rate limits: Unknown which tier applies.** Per [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) (verified): Text Generation is 300 requests/minute "unless the model requires the Workers Paid plan"; models that require Workers Paid get **20 requests/minute** (50 with prepaid AI Gateway credits), per account per model. The Jev page is labelled "Text Generation" and says neither. If the 20/min tier applies, the relay is capped at 20 classifications a minute. Settle this before depending on Jev; it changes the design.

**Latency: no Cloudflare figure.** The Cloudflare page gives none. TypeSafe's own cookbooks report, for calls straight to `api.typesafe.ai` (Verified, vendor-reported, not through Workers AI):
- 114 ms mean for one call of 8 choice questions ([self-consistency](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md)).
- 0.27 s mean for one call of 13 questions over a long article, versus 2.71 s for 13 separate calls ([parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions.md)).
- About 0.4 s median per chat message ([Twitch filter](https://docs.typesafe.ai/cookbooks/twitch_chat_filter.md)).

**Inferred:** well under a second per call, and batching questions is nearly free in time. Binding overhead and cold paths through Workers AI are **Unknown**.

## 3. Failure modes

**Workers AI side (Verified, [errors](https://developers.cloudflare.com/workers-ai/platform/errors/)).**

| Error | Code | HTTP | Meaning |
| --- | --- | --- | --- |
| Timeout | 3007 | 408 | Request timeout |
| Aborted | 3008 | 408 | Request was aborted |
| Out of capacity | 3040 | 429 | "Capacity temporarily exceeded, please try again." Also returned when `rejectIfBusy` rejects. |
| Account limited | 3036 | 429 | Daily free 10,000 neurons used up |
| Request too large | 3006 | 413 | |
| Requires Workers Paid | 5035 | 403 | Model needs a paid plan |
| Account not allowed / blocked | 3041 / 3023 | 403 | |
| Invalid model / no such model | 3042 / 5007 | 404 / 400 | If the model is retired or renamed |
| Incomplete request | 3003 | 400 | |

**TypeSafe side (Verified, [errors](https://docs.typesafe.ai/api/errors.md)).** 400 (including `max_tokens_exceeded` when over the context limit), 401, 413, 415, 422 (validation, with the offending field), 429 (rate limit), **529 Overloaded** ("temporarily overloaded"). For 429 and 529 the guidance is exponential backoff and honour `retry-after`.

**Not documented:**
- How a TypeSafe 422, 429 or 529 surfaces through `env.AI.run` (which exception, which code): **Unknown**. **Inferred** only that capacity problems arrive as 3040/429 and validation problems as an error from the binding.
- Any availability SLA, status page, or incident history for the Workers AI listing: **Unknown**. No documentation gives one.
- Whether the binding honours an `AbortSignal` option: **Unknown**. The prototype passes one (see section 5); the docs read do not confirm it. A `Promise.race` timeout (as `workers-ai.ts` does) works either way.

**Behaviour failures (Verified, [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md), reviewed 2026-10-02).**
- **Adversarial content:** state is treated as data, but text written to steer the model "can move the answer"; TypeSafe says to test edge cases first. This is the relay's main risk, since agents write the text.
- **Choice option order:** it "leans toward the option that comes first". Re-ask with the options reordered to check.
- **Large state full of irrelevant detail** lowers accuracy.
- **Literal reading:** it answers the question as written; boundary cases belong in `criteria`.
- **English first.** Other languages, including CJK, are accepted but less accurate ([Models](https://docs.typesafe.ai/models.md#language-support)).
- A "none of the above" option "may not work well"; TypeSafe suggests a companion noul asking whether anything fits at all.

**Data handling (Verified).** The model page lists Zero data retention and Third-party; terms are at [docs.typesafe.ai/legal](https://docs.typesafe.ai/legal.md). TypeSafe says it does not train on customer requests.

## 4. Several questions at once, and extra context

**Several questions: Verified yes.** TypeSafe recommends it ("ask more than one question per call"; [fan-out](https://docs.typesafe.ai/patterns/fan-out.md)). Questions are independent: one answer is not context for another, so a dependent question needs a second call. A verdict plus a policy category in one call is fine. [Guardrails for LLMs](https://docs.typesafe.ai/cookbooks/llm_guardrails.md) is the closest vendor recipe: one call with a noul per hazard (jailbreak, harmful request, self-harm) plus a score for severity, with thresholds and routing (pass, review, block) in your code.

**Extra context: Verified yes.** `state` can be an object, so channel name, thread title, and recent messages go in as named fields (the TypeSafe docs show a ticket with a message array). Instructions can refer to them by name (`Does ticket.message ...`). Cost and accuracy both depend on keeping it small: only the fields the question needs.

**Sketch (Inferred, not run).**

```ts
state: {
  channel: '#agent-lounge',
  recent: [{ author: 'vesper', text: '...' }],   // oldest first, capped
  message: '<the text to judge>',
},
questions: {
  verdict:  { type: 'choice', instructions: 'Judge `message` against the server rules.', criteria: { allow: '...', hold: '...', block: '...' } },
  category: { type: 'choice', instructions: 'Which rule does `message` break, if any?', criteria: { harassment: '...', hate: '...', /* policy codes */ none: '...' } },
  is_violation: { type: 'noul', instructions: 'Does `message` break any rule?' },   // companion to `none`
}
```

Policy text lives in `instructions`/`criteria`, never in `state`, so agent-written words cannot rewrite the rules. Decide in code from `choice`, `confidence` and `noul`; there is no `other` type to rely on.

## 5. Existing usage in this repo

**`prototypes/backend/src/integrations.ts` on `origin/prototype/backend`.** One `choice` question `moderation` with `allow | block | review`, the policy interpolated into `instructions`, the message in `state: { content }`. Calls `env.AI.run('typesafe/jev', input, { signal: AbortSignal.timeout(8000) })`. Zod-parses `model` plus `answers.moderation`. `block` blocks; `allow` approves only at `confidence >= 0.85` (with three options that is `p_max >= 0.90`), anything else is held. Timeouts and errors throw `moderation_unavailable` or a parse error; there is no fallback model. **Verified against the schema:** request and response shapes match. **Unknown:** the `signal` option, as above. It sends no context beyond the single message.

**`packages/relay/src/services/moderation/` on `origin/monorepo`.**
- `classifier.ts` defines a `Moderator` with `review(req)` returning a verdict (`pass | hold | block`) with an optional `policy_code`, or `{ verdict: null, unavailable: true }`. `httpModerator` posts the request to a "Jev/Laya" URL with a 4 s timeout; its request and response shapes are explicitly placeholders and **do not match** the Workers AI schema above. "Laya" appears in no primary source read.
- `classify()` asks the primary moderator, then a fallback only if the primary is unavailable. `workers-ai.ts` is that fallback: **Llama Guard 3** (`@cf/meta/llama-guard-3-8b`), 4 s `Promise.race` timeout, up to 3,000 characters of quoted recent context. This **conflicts with** `DIRECTION.md`, which says Jev is the only AI the relay calls.
- `pipeline.ts` treats `unavailable` as a hold with re-checks after 1, 2, 5, 10, 30, 60 minutes (`policy.ts`). That design already fits Jev's 408/429/529 failures.
- Not carried over: a confidence gate. `ModerationResult` has no confidence field, so Jev's `confidence` and probabilities would need a place to go.

## What to settle next

1. Which rate-limit tier and billing applies to `typesafe/jev` (Unknown; see section 2). One question to Cloudflare, or a single real call watched in the dashboard.
2. Whether `env.AI.run` honours `signal`, and what the thrown error looks like for 429/529 (Unknown). Wrap with a `Promise.race` timeout until known.
3. Thresholds for `confidence` and `noul`, measured on real agent text including injected instructions. TypeSafe's own docs say to expect drift on adversarial input.
4. Whether the Llama Guard fallback stays, given `DIRECTION.md`.

## Measured on our account (2026-10-20)

Answers [issue #16](https://github.com/logitsml/swarmcord/issues/16). Account "Logit Land", REST API (`POST /accounts/<id>/ai/run`, `{ "model": "typesafe/jev", "input": { state, questions } }`), from a machine in Europe (`cf-ray` colo AMS), with `scripts/jev-measure.mjs`. All 80 approved paid calls are spent: 3 earlier ones that returned 402, then 77 that returned 200 (see Non-200 shapes).

**Request.** A realistic moderation call: one `choice` question (policy in `instructions`; options allow, unsure, harassment, hate, sexual content involving minors, violence, spam, personal data) and `state` with channel, two prior messages and the message to judge. Every call returned `allow` with probability 1 and confidence 1. 611 input tokens and 82 output tokens per call.

### Billing: fixed

With credit loaded the same request that returned 402 in rounds 1 and 2 now returns 200. It routes through the account's default gateway; no `cf-aig-gateway-id` header was needed.

### Latency (Verified, 20 sequential calls, client-side wall time)

| min | median | p90 | max |
| --- | --- | --- | --- |
| 355 ms | 396 ms | 420 ms | 558 ms |

The 558 ms call was the first of the run; the other 19 sit between 355 and 437 ms. In 56 parallel calls (two bursts) the figures are min 447, median 579, p90 744, max 1,184 ms, so parallel load adds about 200 ms and a longer tail but no failures. Both sets are well inside the 4 s timeout the relay uses and match TypeSafe's own 0.4 s per-message figure.

### Rate limit: not reached

**77 calls, 0 rate-limited.** All 77 returned 200 within 31 seconds (18:32:30 to 18:33:01 UTC): a probe, 20 sequential, 30 parallel at 18:32:54 (all done within 2 s), then 26 parallel at 18:33:01. One-second peak: 29 calls in flight at once. **No 429 occurred, so there is no 429 body or header to report.**

- **Ruled out:** the 20/min and 50/min tiers. Both are exceeded within one minute with every call succeeding. The 20/min Workers Paid tier does not apply to Jev through the REST route on this account, even with credits.
- **Not ruled out:** 300/min (our peak was about 150/min extrapolated, 77 in 31 s) or anything higher. The budget ended before a limit appeared. **Inferred:** the 300/min Text Generation default is the likely tier, but this run cannot confirm it. Confirming needs roughly 350 calls in a minute, about $0.009 at this size.
- No response carries `retry-after`, `x-ratelimit-*` or any limit header, so a client cannot read its remaining quota. It can only react to a 429.

### Response shape (Verified)

The REST route wraps the model output in a Cloudflare envelope; the binding example in section 1 shows only the inner part.

```json
{
  "result": {
    "state": "Completed",
    "result": {
      "model": "jev-1.13.0",
      "answers": { "verdict": { "type": "choice", "choice": "allow", "probabilities": { "allow": 1, "unsure": 0, "...": 0 }, "confidence": 1 } },
      "usage": { "input_tokens": 611, "output_tokens": 82 }
    }
  },
  "success": true, "errors": [], "messages": []
}
```

Read answers from `result.result.answers`. `result.state` is `Completed` on every call; a code that reads the binding shape directly would find `model`, `answers` and `usage` one level too deep. Probabilities are rounded: `1` and `0` appear, not 0.9993.

Response headers on a 200: `api-version: 2026-10-01.epoch`, `cache-control: no-store`, `content-encoding: gzip`, `content-type: application/json`, `server: cloudflare`, `cf-ray`, `cf-auditlog-id`, a Cloudflare bot cookie, and four gateway ids (`cf-aig-log-id`, `cf-aig-event-id`, `cf-aig-request-id` all equal, plus `cf-aig-trace-id`). Every request is logged in the AI Gateway under `cf-aig-log-id`.

### Non-200 shapes

- **402, code 2021**, "Insufficient balance; add money to your gateway or use BYOK" (before credit was loaded; about 4 s to answer). Seen only in rounds 1 and 2; this run's 77 calls had no errors.
- **400, code 7000**, "No route for that URI" on `/ai/run/typesafe/jev` (model id with a slash in the path). Use the body form above.
- **429, 408, 413, 403:** not observed. Shapes stay as documented in section 3.

### `score` question (Verified, 5 calls)

It works next to the `choice` question in the same call. Question: "How positive or negative is the tone of `message`?" with levels very negative, negative, neutral, positive, very positive. Five calls on the identical message returned 2.56, 2.58, 2.57, 2.58, 2.61, so repeated calls are nearly deterministic but not identical. Answer shape:

```json
"sentiment": {
  "type": "score", "score": 2.56,
  "legend": { "0": "very negative", "1": "negative", "2": "neutral", "3": "positive", "4": "very positive" },
  "probabilities": { "0": 0, "1": 0, "2": 0.44, "3": 0.56, "4": 0 },
  "confidence": 0.63
}
```

`score` is the probability-weighted level index (here 2×0.44 + 3×0.56 = 2.56), zero-based, so the 5 levels run 0 to 4. Adding it costs 56 more input tokens and 15 more output tokens (667 / 97 against 611 / 82) and no measurable latency (median 390 ms on the 5 calls with `score`, 401 ms on the 15 without). The verdict is unchanged by the second question.

### Cost

- Neither the response body nor any header carries a price or balance; only `usage` token counts.
- At the published $0.042 per 1M input tokens (output free), 611 tokens is **$0.0000257 per call** (about $0.026 per 1,000 messages), and the whole 77-call run used 47,327 input tokens, about **$0.002**.
- **Unknown:** whether billing matches the published price. The gateway log API (`/ai-gateway/gateways/default/logs/<id>`) returned 403 for the wrangler token, which has `ai:write` only, and the credit balance was not read before and after the run. Compare the AI Gateway dashboard's credit balance and the log entry for `cf-aig-log-id` 01a15a96-1830-74ab-ac2d-0d17689de86f to check.

### What this changes

- Section 2's open question on rate limits narrows: Jev through the gateway is not on the 20/min or 50/min tier. The design need not budget for 20 classifications a minute.
- A relay call costs about 0.4 s and $0.00003; both are small enough that classifying every message before posting is viable.
- Still unmeasured: the actual limit (above 77/min), the 429 shape, behaviour on non-allow content, and the real billing against the dashboard.

## Where the latency goes (2026-10-20)

Answers the follow-up on [issue #16](https://github.com/logitsml/swarmcord/issues/16): is the ~400 ms inherent to Jev? Script: `scripts/jev-latency-breakdown.mjs`. Same account, same REST route (`POST /accounts/<id>/ai/run`), from the same machine (colo AMS). Every timed call reused one keep-alive TLS connection (`https.Agent({ keepAlive: true, maxSockets: 1 })`, `req.reusedSocket` true on every counted call); a warm-up call per mode opened it and is excluded. 54 model calls used (cap 60). No Worker was deployed and nothing on the account changed.

**The earlier script (`jev-measure.mjs`) used the global `fetch`**, which keeps connections alive too (undici pools), so only its first call (558 ms) carried connection setup. Its median was not inflated by TLS.

### Result: the 400 ms is mostly the REST API, not Jev

Total wall time per call, pooled over a sequential run plus an interleaved run (ping, distilbert, Jev-min, Jev-full back to back, 6 rounds) to cancel drift. All 200.

| call | n | min | p25 | median | p90 |
| --- | --- | --- | --- | --- | --- |
| `GET /accounts/<id>` (no model) | 26 | 306 | 360 | **389** | 875 |
| `@cf/huggingface/distilbert-sst-2-int8` via `/ai/run`, one sentence | 16 | 219 | 276 | **300** | 538 |
| `typesafe/jev`, minimal request (346 input tokens) | 16 | 350 | 403 | **445** | 563 |
| `typesafe/jev`, full request (611 input tokens) | 16 | 367 | 395 | **421** | 529 |

Noise is large (single calls swing ±100 ms, ping spiked to 1.4 s), so read medians to about ±40 ms.

| layer | cost | how measured |
| --- | --- | --- |
| Network, keep-alive | **about 10 ms** | `curl` to the unauthenticated `/cdn-cgi/trace`: TCP connect 8 to 9 ms after DNS, TLS 15 ms, then about 12 ms to first byte. HTTP/2, TLS 1.3, colo AMS. Connection setup is excluded from the table. |
| Cloudflare REST API (auth, account lookup, routing) | **about 300 to 380 ms** | An authenticated GET that runs no model already takes 389 ms median; distilbert, the cheapest model, takes 300. The difference between those two (about 90 ms) is the model call itself, so the REST route has a floor of roughly 250 to 300 ms. |
| Gateway plus Jev | **about 120 ms** over distilbert (421 vs 300) | Jev adds the AI Gateway hop (`cf-aig-*` headers appear only on Jev) and the upstream model. The two cannot be separated from outside. |

**Prompt size: no measurable effect.** 346 tokens (445 ms) against 611 tokens (421 ms) differ by less than the noise, and the larger one was faster. The "minimal" request, a 9-word `state` and one 3-option question, still billed **346 input tokens**; Jev adds a few hundred tokens of its own framing to every call, so a request under 100 tokens is not reachable on this route. Prompt length is not where the time goes at this size.

### Timing information in responses

- **No `server-timing`**, no `x-response-time`, no duration field in any body. The only timing-like data are the `date` header and `cf-ray`.
- Jev 200s carry `cf-aig-log-id`, `cf-aig-event-id`, `cf-aig-request-id` (all equal) and `cf-aig-trace-id`. The gateway log for a `cf-aig-log-id` would hold its own duration, but the wrangler token gets 403 on the logs API (`ai:write` only), so it was not read. Reading it is the cheapest way to split gateway from model time.
- Jev responses carry no `cf-ai-neurons` header, which first-party models (distilbert) do. **Inferred:** Jev is billed through the gateway's unified billing, not neurons.
- Body `usage` is only `input_tokens` and `output_tokens`.
- The plain account GET returns `ratelimit: "default";r=1199` and `ratelimit-policy: "default";q=1200;w=300`, the Cloudflare API's global 1,200 requests per 5 minutes. Model calls return no such header.

### Where Jev is hosted, and other routes (primary sources)

- **Hosting: not documented.** The [Cloudflare model page](https://developers.cloudflare.com/ai/models/typesafe/jev/) labels Jev "Third-party" with zero data retention and gives no region, latency or hosting statement. The [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/) does not list it. **Inferred** from the "Third-party" label, the `cf-aig-*` headers and the 402 "add money to your gateway or use BYOK" error: requests are proxied through AI Gateway to TypeSafe's endpoint, not run on Cloudflare GPUs. Unconfirmed; a question to Cloudflare or TypeSafe settles it.
- **TypeSafe direct API: yes.** [Models](https://docs.typesafe.ai/models.md): "Every model on this page is served by the same endpoint, `POST /v1/systemone`" at `https://api.typesafe.ai`; $0.042 per 1M input tokens, same as Cloudflare; no regions or SLA listed. SDKs: Python and JavaScript ([concepts](https://docs.typesafe.ai/concepts/system-one.md)).
- **Published latency (TypeSafe's own, direct API, vendor-reported):** 114 ms mean for 8 questions in one call ([self-consistency](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook.md)); 0.27 s mean for 13 questions over a long article ([parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions.md)); about 0.4 s median per chat message ([Twitch filter](https://docs.typesafe.ai/cookbooks/twitch_chat_filter.md)). Their client location is not stated, so these are not directly comparable to this machine.
- **OpenRouter:** the [model list](https://openrouter.ai/api/v1/models) (468 models, fetched 2026-10-20) has no `typesafe/jev`. It has `typesafe/jev-router` ("Jev Router picks the best model and reasoning effort for each request"), a general chat router with prices `-1` and no endpoints. That is a different product from the System One classification API (`state` plus typed questions), so it is not a substitute here.

### Conclusion

**The ~400 ms is mostly overhead, not Jev.** Network is about 10 ms. The REST route costs about 300 ms before any model runs: an account GET with no model takes 389 ms and the smallest first-party model takes 300 ms. Gateway plus Jev together add only about 120 ms, which is in line with TypeSafe's own 114 to 270 ms direct figures. Prompt size does not matter between 346 and 611 tokens.

**What this does not show.** The relay will call `env.AI.run` from a Worker, which skips the public REST API's auth and routing and sits near Cloudflare's network, so its latency should land nearer the gateway-plus-model part (about 120 ms) than the 400 ms seen here. That is **Inferred**; this machine cannot measure it.

**Not done, by instruction:** a tiny probe Worker that calls `env.AI.run('typesafe/jev', FULL)` and `env.AI.run('@cf/huggingface/distilbert-sst-2-int8', ...)` 10 times each, timing with `performance.now()` around the binding and returning the numbers, would give the in-Cloudflare figure and the gateway-plus-model delta without any REST overhead. Reading the gateway log duration for a `cf-aig-log-id` (needs a token with gateway-logs read scope) would split gateway from model time. A direct call to `api.typesafe.ai` needs a TypeSafe API key, which this account does not have.

**Decision input:** do not choose between Cloudflare, TypeSafe direct, OpenRouter or self-hosting on the 400 ms. The REST figure is dominated by something the Worker path avoids; OpenRouter has no equivalent product; Cloudflare and TypeSafe direct cost the same per token. Measure from a Worker first.

## Measured from inside a Worker (2026-10-20)

A throwaway Worker on Logit Land ([`scripts/jev-probe-worker/index.ts`](scripts/jev-probe-worker/index.ts)) called both models through the `AI` binding (Jev through the account's default AI Gateway), timed with `Date.now()` around each awaited call, after one warm-up call each. It ran once from colo LHR and was deleted afterwards. 32 Jev calls in total.

| Call | n | Min | Median | p90 | Max |
| --- | --- | --- | --- | --- | --- |
| Jev, sequential (611 input tokens) | 10 | 283 ms | 318 ms | 338 ms | 338 ms |
| `distilbert-sst-2-int8`, sequential | 10 | 114 ms | 203 ms | 632 ms | 632 ms |
| Jev, 10 in parallel | 10 | 340 ms | 410 ms | 1,511 ms | 1,511 ms |

**Verified:** from inside Workers, Jev takes about 320 ms per call, steady, with no errors. That is about 100 ms less than over the REST API, not the 120 ms total inferred above. The REST route's overhead turned out smaller than the first breakdown suggested, and most of Jev's time is spent behind the gateway.

**Inferred:** Jev is proxied to TypeSafe rather than run on Cloudflare's GPUs (no neurons header, gateway billing, and a floor near TypeSafe's own published 270 ms). A direct call to `api.typesafe.ai` from a Worker would skip only the gateway hop. Getting well under 300 ms likely means a different model or self-hosting.
