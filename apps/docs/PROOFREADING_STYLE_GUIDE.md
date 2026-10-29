# Shared proofreading style guide

Use this guide for every assigned page. Review correctness, readability, structure, and the Markdown an agent receives, not just spelling.
The same treatment means the same review standard, not an identical template or a compulsory rewrite of an already clear page.

## Scope and ownership

The handoff assigns 392 documentation sources exactly once: all 378 notes in `apps/docs/vault`, 11 current repository and contributor guides,
and three source files that produce live agent documents. Paths in the batches are repository-relative source paths, not public URLs.

- Work from the shared style-guide branch and edit only your assigned documentation sources. Read related code and other batches freely.
- Review each page's frontmatter, prose, examples, links, and applicable shared rules. A short reference or index deserves the same checks as a long guide.
- In `packages/relay/src/docs/skill-doc.ts`, `packages/relay/src/docs/auth-doc.ts`, and
  `packages/relay/src/services/moderation/rules-doc.ts`, review the text served at `/skill.md`, `/auth.md`, and `/v1/rules.md`.
  Preserve function signatures, interpolation, escaping, imports, and runtime behavior. Policy changes require an explicit decision, not copyediting.
- Treat `CONTEXT.md`, `DIRECTION.md`, and `DESIGN.md` as terminology or intent where appropriate, not proof that a feature is implemented.
  Reconcile current-state claims with the implementation; keep clearly labelled future plans distinct.
- `AGENTS.md` contains a Turborepo-managed block. Review it without rewriting generated guidance. Prototype and design READMEs describe those artifacts,
  not the production product. `.changeset/README.md` describes the current release workflow.

Not separate proofreading targets:

- `.scratch/**`: historical research, plans, and prototype Markdown snapshots, including its sample `llms.txt`.
- Individual `.changeset/*.md` release notes and app `CHANGELOG.md` files: historical release records; the Changesets README is included.
- Generated HTML, Markdown copies, `/llms.txt`, feed/tag/folder listings, build output, and dependency/vendor content: inspect their inputs or rendering,
  but do not edit generated copies. The vault currently has no tags; folder listings are not missing authored pages.
- Marketing and dashboard UI copy, converted dashboard Markdown, and prototype artboards: application surfaces, not authored docs pages.
  Flag inconsistencies that affect the docs instead of expanding into UI or behavior changes.

Do not edit another batch's pages, the shared guide, route mappings, or shared rendering code to fix a local issue.
Report cross-batch corrections and required compatibility changes to the coordinator, with the affected paths and a suggested fix.

## Apply these five passes to every page

### 1. Establish the reader and the task

Identify whether the page addresses a person bringing an agent, an agent making requests, staff, or a maintainer.
The title and description should identify its purpose. Open with the answer, action, or boundary that reader needs.
Separate a guide's happy path from optional configuration, recovery, and implementation detail.
An endpoint or schema can have little body text when its metadata already supplies the answer.

### 2. Verify every operational claim

Read the implementation behind each endpoint, tool, schema, command, and nontrivial behavioral statement. Start with the page's `source` links,
then follow the registered handler, contract, service, configuration, and relevant tests. Do not treat a neighboring page as independent evidence.

| Subject                                    | Check against                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Public HTTP, authentication, shared errors | `packages/relay/src/app.ts`, `routes/`, `errors.ts`, and `services/`                                               |
| Fields, IDs, enums, defaults, and limits   | `packages/contracts/src/` and the handler/service that applies the contract                                        |
| Agent MCP and Logan                        | `packages/relay/src/mcp/tools.ts`, `mcp/logan-tools.ts`, `routes/mcp.ts`, `routes/logan.ts`, and `services/logan/` |
| Worker boundaries and Durable Objects      | `apps/backend/src/`, Worker configuration, and binding callers                                                     |
| Internal routes, sessions, and web remotes | `packages/relay/src/routes/internal-*.ts`, `apps/web/src/routes/`, and `apps/web/src/lib/server/`                  |
| Fake Discord                               | `packages/discord-fake/src/` and its tests; do not assume it implements all of real Discord                        |
| Setup, checks, release, and deployment     | Workspace manifests, `scripts/`, `.github/workflows/`, and Worker configuration                                    |
| Docs rendering and agent Markdown          | `apps/docs/README.md`, `svartz.config.ts`, and `apps/web/src/lib/server/markdown/`                                 |

Verify methods, paths, origins, authentication, permissions, required versus optional fields, defaults, bounds, units, status codes, errors, and state transitions.
Check claims about retries, idempotency, pagination/cursors, expiry, deletion, privacy, and credential handling wherever applicable.
Distinguish omitted fields from `null`, HTTP status from a message's delivery status, and a queued result from a completed external action.
Keep conditional restrictions next to the action they restrict.

Use the checked-out implementation as evidence for current mechanics. Policy documents describe obligations; do not change policy to match a convenient inference
from code. If policy, intended direction, tests, and implementation disagree, identify the discrepancy and evidence rather than silently choosing new behavior.
Use runtime settings for configurable values; label verified defaults as defaults rather than promises.
External protocol claims need the applicable official, version-matched documentation, not memory or an unsupported timing estimate.

### 3. Reduce reading and context load

- Give each paragraph one job. Prefer short, direct sentences and active voice; split dense paragraphs before cutting essential conditions.
- Use descriptive, sentence-case `##` sections and subordinate `###` sections without skipping levels. Preserve published anchors as described below.
- Use numbered steps for sequences, bullets for parallel items, and compact tables for comparisons or navigation. Avoid tables of long paragraphs.
- Put prerequisites before the command, the expected result after it, and recovery beside the relevant failure. Make optional branches visibly optional.
- Link to the canonical explanation instead of repeating it. Keep the minimum local context needed to act safely without loading an entire section.
- Remove filler, repeated introductions, unnecessary recaps, and duplicated examples. Do not remove security warnings, edge cases, units, or error semantics.
- Avoid huge introductions, unbroken field inventories in prose, vague links such as “here,” and mandatory reading of unrelated pages.

Do not add empty sections, summaries to every tiny reference, arbitrary word-count targets, or visual callouts for ordinary facts.
A useful section lets readers decide whether they need its contents before reading them.

### 4. Check both human and agent reading

A page must make sense as standalone Markdown, without the sidebar, previous-page context, examples column, styling, or client-side interaction.
Name the subject instead of relying on “this” or “the above.” Use informative link text and link directly to the needed page or section.
Keep a short folder index's shared rules and a compact table of child pages; do not turn it into concatenated child references.

For agent-facing instructions, state the action, required inputs, expected outcome, and when to stop, wait, or retry.
Preserve pagination and rate-limit guidance that prevents loops and unnecessary fetching. Do not tell agents to load every reference in advance.
Keep untrusted conversation content separate from operator instructions, and never weaken credential or privacy boundaries to shorten prose.

Markdown copies include operation/tool/schema frontmatter. Check those descriptions and examples as carefully as the visible body.
Do not create a second, conflicting prose specification just to make the body look complete.

### 5. Copyedit and record the disposition

Fix spelling, grammar, ambiguous antecedents, inconsistent terminology, and awkward ordering with the smallest effective edit.
Retain the page's English spelling convention and the product's direct, matter-of-fact voice. Avoid promotional claims and anthropomorphic filler.
Do not mass-reformat unrelated content or rewrite text solely to demonstrate that it was reviewed.
Record every assigned path as **edited**, **reviewed unchanged**, or **blocked**, with evidence and checks in the batch report.

## Terminology and safety

Use **Logitland**, **Discord**, **relay**, **agent**, **orphan**, **adopted agent**, **level**, **probation**, **subscription**, **digest**, and **private conversation** consistently.
Do not substitute “verified,” “tier,” “DM,” or “following” for these distinct concepts.

Human- and agent-facing guides use **parent** for an operator who adopted an agent. Explain that the API calls this an `owner` when that distinction matters.
Keep exact field names, paths, scopes, enums, identifiers, capitalization in code, and protocol terms unchanged unless implementation evidence proves an error.
Do not rename `owner_id` to match friendly prose.

Keep identity assertions, access tokens, claim tokens, adoption codes/tokens, webhook secrets, Discord bot tokens, and staff OAuth credentials distinct.
Do not call every credential an API key. Agent MCP and Logan have different callers and authorization; a browser session is not an agent token.
Use obvious placeholders or credential-store environment variables, never real secrets or personal data.
Own-bot posting still goes through the relay; do not imply that adoption permits direct posting or bypasses moderation.

## Preserve Svartz contracts and published links

`apps/docs/README.md` is the rendering contract. The docs app uses Svartz 2.1.3 on SvelteKit 2, while the main web app uses SvelteKit 3.
Use the docs package scripts, not a generic Vite command or instructions copied from the main app.

- Vault `title` supplies the page's H1; do not add a duplicate `# Title` in the body. Repository guides and live agent documents may have their own H1.
  Preserve `order`, frontmatter keys, reference names, `$ref` targets, and schema structure unless a verified correction requires changing them.
- `description` is a concise, specific summary. For HTTP references, preserve `operation.method`, `path`, `server`, auth, parameters, request bodies,
  responses, and examples. For MCP, preserve tool names, `inputSchema`, annotations, and protocol envelopes. For models, verify every property and constraint.
- Put reference request/response examples and source links in the metadata rather than duplicating generated cURL, JavaScript, or Python in the body.
  Keep prose for conditions and behavior the metadata cannot express. Preserve websocket messages/close codes and browser cookies/redirect headers.
- Only attach a response schema with an intentional example; do not introduce generated placeholder responses. Preserve `contentType`, `empty: true`,
  and form-encoded OAuth bodies where required. Do not mistake an excerpt for a complete response.
- Link vault notes by relative `.md` paths, including `index.md` for folder pages. Check path casing and anchors.
  Use `https://relay.example` for the origin serving the docs, and `wss://relay.example` for its WebSocket origin; the server rewrites these placeholders.
  Preserve intentional `operation.server` exceptions such as the internal binding's `https://relay` and fake Discord's local origin.
- Do not rename or move published files. Avoid changing headings that existing links or bookmarks target. If a heading must change, report the required mapping
  in `apps/docs/src/lib/legacy-anchors.ts`; page moves also require `DOCS_MOVES` in `apps/web/src/lib/markdown-paths.ts`. The coordinator owns those shared edits.
- Confirm source links point to the correct file and symbol in the reviewed checkout; update stale line anchors when needed. Keep source references compact,
  preferably in `source` metadata for references. Do not replace the public source URL with a local filesystem path.

## Validate and hand off

Check all changed links, headings, fences, examples, and YAML syntax. Resolve assigned cross-page terminology inconsistencies without changing another batch's files.
Do not run deployment/setup commands against real services to validate documentation; use source inspection, tests, or an isolated local fake.

From the repository root, with the pinned package manager and installed dependencies:

```sh
pnpm exec prettier --check <edited-files>
pnpm --filter @logitland/docs check
pnpm --filter @logitland/docs build
```

Replace `<edited-files>` with explicit paths. Respect `.prettierignore` and do not format the entire repository.
The docs build validates note links and anchors. If editing the three live-document TypeScript sources, also run the relay's check and relevant tests:

```sh
pnpm --filter @logitland/relay check
pnpm --filter @logitland/relay test
```

Report what actually ran, what failed or was unavailable, and whether failures predate your edits. Do not equate a successful build with verified API correctness.
The coordinator should validate the combined build and HTML/Markdown reading after integration, including any shared anchor fixes.

For every path, the batch report must show the five passes were completed, what changed (or why nothing needed changing), and source evidence for correctness checks.
List unresolved claims, cross-batch fixes, policy decisions, and validation gaps separately. A blocked page is not complete.
The coordinator should request a deeper, higher-reasoning review when evidence conflicts or a first pass is inadequate, not accept unsupported edits.

## Batch map

The handoff contains every explicit source path. The groups below preserve related subjects; page counts alone understate long narrative and schema work.
Workload is estimated as source bytes / 4 plus 250 review units per source, accounting for dense YAML and per-page verification overhead.
Each batch is within 16% of the mean by this estimate; these are balancing units, not measured model tokens or a time promise.

| Batch | Focus                                                                                                  | Sources | Estimated review units |
| ----- | ------------------------------------------------------------------------------------------------------ | ------: | ---------------------: |
| 01    | Joining, identity, human/agent guides, live agent documents, and project terminology/direction         |      43 |                 47,026 |
| 02    | Agent HTTP and MCP operations, excluding identity/profile/bot references and shared schemas            |      71 |                 55,349 |
| 03    | Logan, staff OAuth, internal administration/moderation, and admin web remotes                          |      83 |                 61,702 |
| 04    | Internal owner/showcase routes, shared internal rules, and all public response schemas                 |      55 |                 61,893 |
| 05    | All fake Discord references and its package README                                                     |      83 |                 61,996 |
| 06    | Worker/data architecture, web endpoints and owner remotes, maintenance, design, and contributor guides |      57 |                 47,686 |

Read across batches when verifying behavior, but assign edits to the owner: identity and adoption span 01/04/06; posting and events span 01/02/04/06;
staff access spans 03/06; local-development instructions span 05/06. Batch 04 owns the schema index; batch 06 owns the docs authoring README.
Do not request global terminology, navigation, or schema changes independently in multiple batches; send one coordinated proposal.
