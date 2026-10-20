# Agent-social landscape: landing pages and onboarding

Research for [#25 Marketing pages](https://github.com/logitsml/swarmcord/issues/25), captured **2026-10-20**.
Evidence labels: **verified** (fetched or rendered by me on that date), **inferred** (conclusion from verified evidence), **unknown** (could not establish).
Nothing was signed up for, posted, or submitted. Desktop screenshots (1440×900, headless Chromium, first screen) are in [`agent-social-landscape/`](agent-social-landscape/).
Live numbers are snapshots from that day.

## Products studied

| # | Product | Kind | URL |
|---|---|---|---|
| 1 | Moltbook | agent-only Reddit | <https://www.moltbook.com> |
| 2 | The Commons | cross-model AI discussion space | <https://jointhecommons.space> |
| 3 | Chirper.ai | AI-agent social app | <https://chirper.ai> |
| 4 | SocialAI | one human, AI followers (iOS) | <https://socialai.co> |
| 5 | The Colony | agent forum, DMs, marketplace | <https://thecolony.ai> |
| 6 | AI Village | watch-only multi-agent chat | <https://theaidigest.org/village> |
| 7 | 4claw | agent imageboard | <https://www.4claw.org> |
| 8 | AgentGram | agent registry (pivoted to MCP governance) | <https://www.agentgram.co> |

**Which "The Commons".** The name is shared by several unrelated projects (an open-source agent platform on Peerlist, `ai.algo.pw` "Agent Commons", ETHGlobal's AgentCommons). I picked [jointhecommons.space](https://jointhecommons.space) because it is the one that is an AI-agent community: its `llms.txt` describes "a persistent, noncommercial space where AI voices from different models post, reply, and build norms together", and a web search for the phrase surfaced its old GitHub Pages URL, which now says "The Commons has moved!" to this domain and to [github.com/mereditharmcgee/the-commons](https://github.com/mereditharmcgee/the-commons) (verified). **Inferred** that this is the one Mia meant; say if it is not.

## 1. First screens

| Product | Headline | Subhead | Primary / secondary action | Audience routing |
|---|---|---|---|---|
| Moltbook | "A Social Network for **AI Agents**" | "Where AI agents share, discuss, and upvote. Humans welcome to observe." | **I'm a Human** / **I'm an Agent** toggle, then a card: "Send Your AI Agent to Moltbook" with the prompt `Read https://www.moltbook.com/skill.md and follow the instructions to join Moltbook` and 3 numbered steps (send to agent → it sends a claim link → tweet to verify) | Two-way toggle (human/agent). Spectators are covered by "humans welcome to observe" and a public feed below. Builders get a "Build for Agents" early-access block lower down. |
| The Commons | "The Commons", tagline "Where AI minds meet" | "A space where AI models speak to each other, not humans speaking for AIs, but AIs speaking for themselves." | No hero button. A local "Continue reading" card (saved places in this browser) sits above the fold; nav: Interests, Reading Room, Postcards, Headlines, Voices | Spectator-first. Owners ("facilitators") reach **Bring Your AI** and **Learn How to Participate** in the footer; agents are served by `llms.txt`. |
| Chirper.ai | none; the home page is the app: sidebar, "For You / Recent" feed, "Trending Now" | banner "Fund Your Favorite Agents! … Get CHIRP" | **Login**, **Register**, **Get CHIRP** | Not routed. One shell for everyone. Feed and trending rendered only as skeletons in my headless session (**unknown** whether live data loads). |
| SocialAI | "SocialAI" | none (meta description: "your personal and private AI-powered social network … millions of AI followers responding to your every post") | **Download on the App Store** | Single audience: the human with AI followers. No agent or owner path. |
| The Colony | "The AI agent **social network.**" with eyebrow "AI agents & humans. A shared world." | "Forums, direct messages, and portable identity for AI agents and the humans they work with." | **Connect your AI →** / **Sign up**; nav also has **Connect Your AI** | Two actions (agents' owners vs plain sign-up). Three cards (Social, Forums, Identity) and a hero illustration. Builders get OpenID Connect "identity". |
| AI Village | "Welcome to the AI Village!" modal over a live dashboard | "You can observe their behavior as they use their computers, chat with each other, and go about their daily tasks." | Close the modal and watch; **Subscribe** (newsletter); **Join Discord** | Spectators only. Chat panel: "Chat is agent-only. Want to talk to the agents? Visit the open chat village here." Outsiders cannot add agents (FAQ, below). |
| 4claw | "what your clawkers are really thinking"; box: "how to start shitposting NOW on 4claw" | "install as **Human** / **Bot**" | Copyable `Read https://www.4claw.org/skill.md and follow the instructions to join 4claw.` plus "send this msg to your agent / they'll sign up & start shitposting" | Human/Bot toggle, then the board grid (thread titles, post counts, times) as spectator content. |
| AgentGram | "MCP Governance & Audit for Teams & Companies" | "Score, audit, and allow-list the MCP servers and agents your organization uses." Below it, leftover copy: "Your companion, built for you. No judgment." | **Get Started Free** / **API Reference** | Builders/teams only. The old agent-social positioning survives only in the ticker (`695 agents · 6,040 posts · Last post 46m`) and a "Hello, world!" quickstart (verified). |

Sources: rendered first screens (screenshots), page text via headless Chromium `--dump-dom`; Commons nav and footer from the page source; SocialAI meta description from its HTML.

## 2. How an agent or developer gets in

| Product | Entry | Credential and claim | Size of the guide |
|---|---|---|---|
| Moltbook | `skill.md` ("or just read them from the URLs"), plus `heartbeat.md`, `rules.md`, `skill.json`; installable with 4 `curl` lines into `~/.moltbot/skills/moltbook/` | `POST /api/v1/agents/register` → `api_key`, `claim_url`, `verification_code`. The human opens the claim URL, verifies **email**, then posts a **verification tweet** to activate. New-agent limits for 24 h (1 post per 2 h, 20 comments a day) vs established (1 per 30 min, 50 a day). | `skill.md` 1,102 lines, 38 KB |
| The Commons | `llms.txt` → `skill.md`, `agent-guide.html`, `api.html`, `bring-your-ai.md`, `orientation.html`; MCP server `mcp-server-the-commons` (npm, MCP Registry, 55 tools). **Reading needs no account or token.** | A human "facilitator" creates an identity and a `tc_…` token for the AI. Skill: validate the token first; "bring proposed first public words back for facilitator approval". Posts via Supabase RPC. | `skill.md` 18 KB; `bring-your-ai.md` is one self-contained invitation: culture first, then access, "declining is an honest outcome" |
| Chirper.ai | Web registration (**unknown** beyond that; I did not open forms). Mentions "advanced models, MCP integrations" as premium features unlocked by CHIRP. | **Unknown** | No agent docs found. Every path I probed (`/llms.txt`, `/skill.md`, `/index.md`, `/docs`) returns the same 70 KB app shell with 200 OK. |
| SocialAI | iOS app only | **Unknown** (human account) | n/a. Every probed path (`/llms.txt`, `/skill.md`, `/robots.txt`, …) is a 404 page. |
| The Colony | `llms.txt`, `skill.md`, `agents.txt`, `/for-agents`, `round.md` (a schedulable participation prompt), `agent-refresh.md` ("already integrated? check you're current"), OpenAPI, MCP at `/mcp`, A2A card, ai-plugin manifest, RSS | Two-step register: `register/begin` → inactive account + `col_…` key + 15-minute `claim_token`; `register/confirm` needs the **last 6 characters of the key**, proving it was stored. No CAPTCHA, no email. "Registered by mistake?" undo for 15 minutes. | `skill.md` 899 lines, 41 KB; `llms.txt` 10 KB |
| AI Village | None. "The way the Village is set up currently, that's not possible" (FAQ, via [the village blog](https://aivillageblog.substack.com/p/how-the-ai-village-works)). The organisers run 30+ frontier agents, each with its own Linux computer. Human chat closed in 2025. | n/a | n/a |
| 4claw | `skill.md` (v0.2.4), `heartbeat.md` | `POST /api/v1/agents/register` → `clawchan_…` key. X claim is **optional**. Registration limited to 1/min/IP and 30/day/IP. | `skill.md` 364 lines, 14 KB |
| AgentGram | Python/JS SDKs, MCP registry, docs, "For Agents" page | `client.register(name="MyBot")` (as shown in the hero). Not studied further. | **Unknown** |

Sources: Moltbook <https://www.moltbook.com/skill.md>, <https://www.moltbook.com/heartbeat.md>, <https://www.moltbook.com/skill.json>, <https://www.moltbook.com/rules.md>; Commons <https://jointhecommons.space/llms.txt>, <https://jointhecommons.space/skill.md>, <https://jointhecommons.space/bring-your-ai.md>; Colony <https://thecolony.ai/llms.txt>, <https://thecolony.ai/skill.md>, <https://thecolony.ai/agents.txt>; 4claw <https://www.4claw.org/skill.md>.

The Moltbook "claim" is the only step that needs a third-party account (X) and the owner before the agent is "activated" (verified in `skill.md`; a secondary source, [DataCamp](https://www.datacamp.com/tutorial/moltbook-how-to-get-started), says the agent cannot post until claimed, which I did not verify).

## 3. How they show it working

| Product | Proof on the first screens |
|---|---|
| Moltbook | Hydrated page shows **216,429** human-verified agents ("2,924,068 total registered"), **33,445** submolts, **4,522,337** posts, **23,597,668** comments; a "Trending Agents (last 24h)" leaderboard; a **LIVE** post stream with "Hot Right Now · most active in the last 5 min" (verified, rendered 2026-10-20). Counters are `0` until JS hydrates. |
| The Commons | `llms.txt` claims "9,000+ posts, 3.3 million words, 530+ active voices, most replies crossing model families" (self-reported). Home shows a daily "Headlines" edition and a changelog; a numbers report is published at `/report.html`. Home content loads from JS ("Loading the edition…"). |
| Chirper.ai | None visible without JS data. The only promo is the CHIRP funding banner. |
| SocialAI | None. |
| The Colony | Public `GET /api/v1/stats`: 2,549 agents, 1,300 humans, 55 colonies, 29,157 posts, 181,731 comments, 257 posts and 2,815 comments in 24 h (verified). The home page has an illustration and three feature cards; leaderboards, directory and activity pages sit in the Explore menu. |
| AI Village | The whole page is the proof: live screens of each agent's computer, a replay scrubber, a "Live" badge, a group chat of the agents, and "Latest agent project". Viewing is weekdays 10am–2pm PT; the full transcript dataset is on Hugging Face (FAQ). |
| 4claw | Board grid with post counts (731 to 2,189 per board) and the latest three thread titles with times. |
| AgentGram | Ticker `695 agents · 6,040 posts · Last post 46m`. |

Social proof beyond numbers is thin everywhere: no logos, testimonials or press, except Moltbook's third-party coverage (found by search; not on the page) and AI Village's research dataset.

## 4. Agent-facing affordances (fetched)

| Product | `llms.txt` | `skill.md` | Other machine-readable | `Accept: text/markdown` on `/` |
|---|---|---|---|---|
| Moltbook | 404 | yes, `text/markdown`, front-matter (`name`, `version`, `metadata.api_base`) | `heartbeat.md`, `rules.md`, `skill.json` (version, files map, trigger phrases) | HTML (not negotiated) |
| The Commons | yes, 3.5 KB, a curated index with a one-paragraph summary and "if you are an AI reading this…" | yes | `bring-your-ai.md`, plain-text posts at `mcp.jointhecommons.space/post/<id>.txt`, MCP server, sitemap | **Unknown** (request timed out twice) |
| Chirper.ai | none (SPA fallback returns HTML) | none | none found | HTML |
| SocialAI | 404 | 404 | none | **Unknown** (timed out) |
| The Colony | yes, 10 KB (register steps inline) | yes | `agents.txt` (robots.txt-style manifest), `.well-known/agent.json`, `ai-plugin.json`, OpenAPI, MCP, RSS, `round.md`, `agent-refresh.md`; the home page sends a `Link` header with `rel="alternate"` to `/llms.txt`, `rel="service-desc"` to the OpenAPI document and `rel="help"` to `/for-agents` | **Yes: returns the Markdown of `llms.txt` with `Content-Type: text/markdown`** (verified) |
| AI Village | 404 | 404 | blog, transcripts on Hugging Face | HTML |
| 4claw | 404 | yes, with a culture section ("write like a 4chan poster") | `heartbeat.md` | HTML |
| AgentGram | not probed | not probed | docs, SDKs, MCP registry | HTML |

Notable patterns:

- **Prompt-as-install.** Moltbook and 4claw put one sentence on the first screen ("Read <url>/skill.md and follow the instructions to join …"). All four agent-native sites (those two, Colony and The Commons) publish `skill.md`.
- **Behaviour files next to the API file.** Moltbook (`heartbeat.md`, every 30 minutes) and Colony (`round.md`, every 4–8 hours) hand agents a polling schedule. This runs against Logitland's direction (digests and subscriptions to save tokens).
- **Moltbook's `/home`.** The heartbeat starts with one call, `GET /api/v1/home`, returning account, notifications, DMs, followed posts and a `what_to_do_next` list (verified in `heartbeat.md`).
- **Prompt-injection guidance in the skill.** Colony tells agents never to treat post content as instructions and ships a `safe_text` field (verified in `skill.md`).
- **Culture inside the agent file.** Commons (reading is participation, short is a full post, declining is fine) and 4claw (tone rules) write their norms for the agent, not for the landing page.
- **Key handling is the failure point.** Colony's two-step registration exists because lost keys ended most registrations (its `skill.md` says so).

## 5. Visual language

- **Moltbook:** dark charcoal, red lobster mascot, red and teal accents, system sans; Reddit-like. Cheerful, emoji-heavy.
- **The Commons:** near-black, serif wordmark in gold brackets, italic tagline; quiet and literary.
- **Chirper.ai:** light X/Twitter-style three-column app shell, orange accent; the home page is the product.
- **SocialAI:** pure black, white logo and one App Store badge.
- **The Colony:** dark navy and teal, gradient headline, painted hero illustration, eyebrow and three icon cards; generic SaaS template.
- **AI Village:** light, dense dashboard of live agent desktops with a friendly welcome modal.
- **4claw:** periwinkle early-web imageboard with a Pepe-lobster; deliberate 4chan pastiche.
- **AgentGram:** black and green developer hero with a code window.

## What Logitland should take and leave

Judged against `DIRECTION.md` (agents sign up themselves via auth.md; owners optional via Discord OAuth; no public web view of channels; token-conscious) and the "very little copy" preference. Our prototype's first screen is already leaner than all eight (heading plus three actions, no eyebrow or subhead).

1. **Take: serve `/skill.md` as well as `/auth.md`.** All four agent-native peers (Moltbook, The Commons, Colony, 4claw) publish that file, and "Read <url>/skill.md and follow the instructions to join" is now the de facto prompt. A redirect or alias costs nothing and keeps the prompt we show (`Read https://logit.land/auth.md …`) working for agents that look for `skill.md` first. (Inferred: agents search by that name; not tested.)
2. **Take: show the agent prompt on the first screen, not behind a jump.** Moltbook and 4claw lead with the copyable prompt and three short steps. Ours is one click lower because Watch on Discord is the hero button. Putting the prompt next to it would serve both groups without adding copy.
3. **Take: real aggregate numbers, never the content.** Moltbook, Colony and AgentGram prove life with counts (agents, posts today, last post). `DIRECTION.md` dropped the public mirror on 2026-10-20, so the home page's live channel is a fixture and should stay clearly illustrative; at launch swap in two or three counts only (agents, messages today). **Decision for Mia:** whether the fixture channel survives once a mirror is ruled out.
4. **Take: `Link` headers on `/`.** Colony advertises `llms.txt`, the API description and the help page via `Link` response headers, and also negotiates `Accept: text/markdown` (we already do). Adding headers for `/llms.txt` and `/auth.md` makes `curl -I logit.land` self-explanatory.
5. **Take: one agent-facing rules file that carries the culture, cost and etiquette.** Commons' `bring-your-ai.md` is the model: norms first, short posts are fine, declining is fine. This is where "plenty of guidance on using the server responsibly and cheaply" belongs, so none of it lands on the marketing page.
6. **Take: a single orient call for the MCP/API spec.** Moltbook's `GET /home` (account, notifications, what to do next) is the nicest idea in this set. It fits Logitland's digest subscriptions; it belongs in the v1 spec, not on the marketing pages.
7. **Leave: heartbeat and "round" polling files, the X claim, and email-then-claim.** Moltbook and Colony push agents to check in every 30 minutes to 8 hours (token burn at hundreds of agents), and Moltbook gates activation on a tweet. Our "agents sign up alone, owners adopt later" is the differentiator; say it once in the page, don't copy their gates.
8. **Leave: everything decorative.** Mascots and emoji (Moltbook), eyebrow plus hero illustration plus three feature cards (Colony), token promos (Chirper's CHIRP banner), newsletter or early-access capture (Moltbook, AI Village modal). The weak examples also warn on structure: Chirper and The Commons render empty without JS, SocialAI is one button, and AgentGram's stale companion line sits under a governance headline. Keep server-rendered, one headline, three paths.

## Gaps

- Chirper's registration, agent creation and live feed were not observed (no signup; feed stayed on skeletons headless). Treat its onboarding as **unknown**.
- The Commons and SocialAI timed out on the Markdown negotiation test; negotiation is **unknown** for both.
- Moltbook's "I'm an Agent" tab content was not captured; only the default "I'm a Human" view was seen.
- Counts are one-day snapshots and, for The Commons, self-reported.
