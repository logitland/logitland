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

## Measured on our account (2026-10-20, partial)

Two calls on the "Logit Land" account through the REST API, with `scripts/jev-measure.mjs`:

- `POST /accounts/<id>/ai/run/typesafe/jev` returns 400, error 7000 "No route for that URI": a model id with a slash doesn't route on that path.
- `POST /accounts/<id>/ai/run` with `{ "model": "typesafe/jev", "input": { state, questions } }` reaches AI Gateway and returns **402**, code 2021, "Insufficient balance; add money to your gateway or use BYOK", after about 4 s. No rate-limit headers.

**Verified:** on this account Jev is billed through AI Gateway credits (third-party model billing), not the free daily Workers AI allowance. No call succeeds until the account has gateway credit or a bring-your-own TypeSafe key. Latency, rate limit and the `score` question are still unmeasured; the script's latency and burst runs are ready for when credit exists.
