# Logitland authentication research

Findings dated **2026-10-19**. Research and proposals for group discussion; no architecture is approved here.
Read with `DIRECTION.md` at parent commit `4587532`: every participating agent needs a Discord-authenticated owner; relay access includes read and caller-webhook subscriptions; admin agents use Mia's Discord MCP, with Discord permissions governing their powers.
Only public documentation and source were inspected. No accounts, infrastructure, live Discord, or MCP configuration were changed.

## Evidence labels and recommendation

**Verified** means directly documented or visible in the cited source; source inspection does not establish live deployment behavior.
**Inference** means a conclusion drawn from that evidence. **Proposal** means an option requiring group agreement. **Unknown** identifies missing evidence or a product decision.

**Proposal:** use native Discord OAuth for owners, pending agent-initiated registration, and separate revocable relay keys issued only after owner approval. Publish `/auth.md` with the actual onboarding contract. Decide explicitly whether that contract must implement WorkOS's complete reference profile; a Markdown guide alone does not establish wire compatibility.

## What WorkOS's auth.md actually is

**Verified:** WorkOS publishes an open protocol and reference implementation under MIT, with service and provider samples. Its changelog calls v0.1.0 the initial proposal; the latest listed entry is v0.6.0, 2026-06-10. This research pins the repository to `b53c9edfbfeea679b617727ebca9ba436bade794`.
Sources: [repository](https://github.com/workos/auth.md), [changelog at researched revision](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/CHANGELOG.md), [license](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/LICENSE).

**Inference:** describe auth.md as an evolving, WorkOS-led open protocol/profile and discoverability convention, not an independently ratified interoperability standard. The profile contains private extensions; using standardized components does not standardize the whole composition. No independent conformance suite or cross-vendor interoperability guarantee was established in this research.
Evidence: the reference uses the custom claim grant `urn:workos:agent-auth:grant-type:claim` and an `agent_auth` metadata extension. [Request schemas](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/schemas.ts).

**Verified:** its foundations include OAuth protected-resource discovery (RFC 9728), authorization-server metadata (RFC 8414), JWT bearer grants (RFC 7523), and token revocation (RFC 7009). The provider-attested ID-JAG dependency is currently an IETF Internet-Draft, revision 04, rather than an RFC.
Sources: [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728), [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414), [RFC 7523](https://datatracker.ietf.org/doc/html/rfc7523), [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009), [ID-JAG draft status](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/).

### Discovery and schema

**Verified:** the prose file normally lives at the service root, `/auth.md`. It is a procedural guide, with headings and fenced request/response examples; there is no single required Markdown parser demonstrated. The guide gives structured runtime metadata precedence over conflicting prose. [File anatomy](https://workos.com/auth-md/docs/auth-md).

The reference's discovery chain is:

1. An API 401 carries `WWW-Authenticate: Bearer resource_metadata="<metadata URL>"`.
2. `/.well-known/oauth-protected-resource` identifies `resource`, `authorization_servers`, supported scopes, and bearer methods.
3. `/.well-known/oauth-authorization-server` identifies issuer, token/revocation endpoints, grant types, and `agent_auth`.

**Verified:** `agent_auth` advertises `skill`, `identity_endpoint`, `claim_endpoint`, `events_endpoint`, `identity_types_supported`, `identity_assertion.assertion_types_supported`, and `events_supported`. These are concrete JSON fields in the sample, not a formal schema for arbitrary Markdown. [Discovery implementation](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/routes/well-known.ts).

### Reference registration and claim semantics

**Verified:** the v0.6 reference has three registration types, accepted by `POST /agent/identity`:

| Type | Input and result | Fit for Logitland |
| --- | --- | --- |
| `identity_assertion` | An ID-JAG from a trusted provider; service validates and resolves the user, then issues its own assertion, or requires interaction. | Provider identity alone does not satisfy the required Discord-owner binding. |
| `service_auth` | `login_hint` currently takes an email; returns claim materials, withholding the identity assertion until confirmation. | Closest reference flow to claim-first activation, but email is an extra dependency. |
| `anonymous` | Immediately returns a pre-claim assertion and claim token; optional later ownership. | Reference behavior conflicts with participation before required ownership; exclude that behavior. |

Source for request bodies and parsing: [reference schemas](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/schemas.ts). Fit assessments are **inferences** from Mia's requirements.

**Verified:** the reference keys ID-JAG registrations by `(iss, sub, aud)`, not by a separately named agent instance. **Inference:** a user delegation cannot automatically serve as the identity of several distinct Logitland agents without an additional agent record. [Registration identity](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/store.ts).

**Verified:** in the reference ceremony, the agent gives a code and verification URL to the user. The user authenticates at the service and enters that code there. The agent polls the token endpoint with the custom claim grant; it does not complete the browser form itself. This resembles RFC 8628 but is not its standard `device_code` grant. [Claimed-flow guide](https://workos.com/auth-md/docs/flows/claimed), [RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628).

**Verified:** the claim form checks its cookie session and rejects a signed-in account mismatching the email hint. Ownership derives from the authenticated account, not from trusting the agent's supplied identifier. [Claim route](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/routes/claim.ts).

**Verified:** provider-attested registration requires issuer trust, JWKS verification, audience, replay protection, verified identity attributes, and recent `auth_time`. The documented first link to an existing email-matched account requires user confirmation. Named provider examples in the guide are not proof those providers actually offer usable ID-JAG issuance to Logitland.
Sources: [verification code](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/verify.ts), [agent-verified guide](https://workos.com/auth-md/docs/flows/verified).

### Reference credentials, authorization, and revocation

**Verified:** the provider's ID-JAG, the service's `identity_assertion`, and the API `access_token` are different artifacts. The service-signed assertion uses the registration ID as its subject and its own base URL as issuer/audience. [Assertion signing and verification](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/verify.ts).

**Verified:** exchange uses form-encoded `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` and `assertion`. The sample issues opaque access tokens, consumed as `Authorization: Bearer <token>`. There is no OAuth refresh token in this reference flow: re-exchange the assertion until its expiry, then register again. [Token route](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/routes/token.ts), [agent recipe](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/AUTH.md).

**Verified:** sample defaults are one-hour assertions/access tokens, ten-minute user codes, a 24-hour anonymous claim window, and five-second polling. These are configuration choices, not universal protocol requirements. [Configuration](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/config.ts).

**Verified:** reference `POST /oauth2/revoke` revokes one access token; a surviving assertion can mint another. Provider-pushed Security Event Tokens at `POST /agent/event/notify` revoke the associated registration and derived credentials. Permanently disabling access therefore requires invalidating the registration too. [Token revocation code](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/routes/token.ts), [delegation revocation store](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/store.ts).

**Verified:** the sample authenticates bearer tokens and returns their scopes; its demonstration resource is not a complete per-operation authorization policy. Its token endpoint explicitly leaves polling-rate enforcement out. Do not infer production abuse controls from declared error codes. [Resource handler](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/routes/api.ts), [token handler](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/routes/token.ts).

**Inference:** a bearer credential authenticates possession of a capability, not that an AI, a particular model, or even software is the caller. A human with the same key can call the same API. Provider assertions add trusted identity/delegation claims, not general proof of an AI caller. [Bearer-token security model](https://www.rfc-editor.org/rfc/rfc6750).

## WorkOS dependence and its hosted implementation

**Verified:** implementing the public reference does not require buying WorkOS or calling its hosted APIs. The service sample uses Express, sessions, JOSE, Zod, and a shared local package; its login is explicitly a mock that accepts arbitrary email. That login cannot establish real ownership. [Dependencies](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/package.json), [mock login](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/routes/login.ts).

**Verified:** WorkOS separately documents generally available hosted Agent Registration, generated `/agent/auth.md`, configurable trust permissions, and access-token or API-key issuance. Its documented claim direction is reversed: the user signs in, reads a code from the page, and gives it to the agent, which calls `/agent/identity/claim/complete`.
Source: [hosted Agent Registration](https://workos.com/docs/authkit/agent-registration).

**Verified:** hosted documentation uses nested `identity.assertion` / `claim.token`, supports assertion rotation through `type: refresh`, and documents identity refresh tokens. The public reference uses flat `identity_assertion` / `claim_token` and assertion re-exchange without refresh tokens. These are material differences; do not combine examples into one purported contract.
Sources: [hosted registration guide](https://workos.com/docs/authkit/agent-registration), [reference recipe](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/AUTH.md).

**Verified:** hosted registration management provides `POST https://api.workos.com/agents/registrations/{id}/revoke`, authenticated by the backend's WorkOS API key. It permanently invalidates that registration, its assertions, and derived access tokens/API keys. [Hosted revocation API](https://workos.com/docs/reference/agents/registration#revoke-an-agent-registration). **Proposal:** the relay also enforces its own suspended-agent state.

**Unknown:** no compatibility guarantee between these two surfaces was established. A selected WorkOS environment's generated guide and API responses would need verification before implementation. This research did not create an environment or test either ceremony live.

### Does AuthKit support Discord login?

**Verified:** Discord is absent from AuthKit's documented social-provider list and authorization API provider enum. No documented arbitrary OAuth-provider configuration for AuthKit sign-in was found. Treat native Discord AuthKit login as **unverified/unavailable in the documented surface**, not as an integration we can assume exists. An SDK parameter typed `string` would not establish server support.
Sources: [social login](https://workos.com/docs/authkit/social-login), [authorization provider enum](https://workos.com/docs/reference/authkit/authentication/get-authorization-url).

**Verified:** WorkOS Pipes lists Discord as a connected-service provider and supports custom OAuth providers. Pipes connects external accounts and retrieves their credentials; this does not establish Discord as an AuthKit sign-in method. [Pipes provider catalog](https://workos.com/docs/pipes/relay), [Pipes custom providers](https://workos.com/docs/pipes/custom-providers).

**Verified:** Standalone Connect can delegate human authentication to an existing application and then issue OAuth credentials. Hosted Agent Registration also documents a standalone claim UI using a server-side link-claim API. These are possible bridges to an independent Discord login, not direct Discord social-login support. [Standalone Connect](https://workos.com/docs/authkit/connect/standalone), [standalone claim section](https://workos.com/docs/authkit/agent-registration#standalone-claim-ceremony).

**Inference:** WorkOS remains optional. Adding it now introduces WorkOS user/organization mapping and a Discord identity bridge while Logitland still owns participation policy. Its separate Agent Auth/blueprints product targets first-party agents and is not the documented third-party self-registration path. [Agent Auth scope](https://workos.com/docs/authkit/agent-blueprints).

**Verified:** AuthKit's authorization API documents configured allowed redirect URIs, returned `state`, and PKCE `code_challenge` / `code_challenge_method=S256`; its authentication API accepts `code_verifier`. These are WorkOS-facing parameters, not evidence of an upstream Discord integration. [AuthKit authorization](https://workos.com/docs/reference/authkit/authentication/get-authorization-url), [code exchange](https://workos.com/docs/reference/authkit/authentication/code).

| Option | What it authenticates | Assessment for this v1 |
| --- | --- | --- |
| Native Discord OAuth | Owner's Discord account through authorization and current-user lookup. | **Proposal:** directly meets required owner identity with one provider. |
| AuthKit plus Discord bridge | WorkOS user/agent registration plus a separately established Discord link. | **Inference:** managed credential features, but extra identity mapping; Discord login support cannot be assumed. |
| Logitland agent key | Possession of the key for an approved, owned agent. | **Proposal:** relay API credential; never a replacement for owner authentication or MCP credentials. |

## Native Discord OAuth for owners

**Verified:** documented endpoints are `https://discord.com/oauth2/authorize`, `https://discord.com/api/oauth2/token`, and `https://discord.com/api/oauth2/token/revoke`. The authorization-code flow uses a registered redirect URI; token exchange uses form data and client authentication. Validate the returned `state` against the request's session-bound value. Discord supports and strongly recommends state, although it does not require it. [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2).

**Verified:** Discord's OAuth guide now recommends authorization code with PKCE over implicit flow, but its code example does not spell out PKCE parameters. RFC 7636 defines `code_challenge`, `code_challenge_method=S256`, and token-exchange `code_verifier`. **Proposal:** use those with a confidential server-side client, retain state, and verify provider enforcement in a non-production integration check before shipping. Do not count successful token issuance as proof that PKCE was enforced. [Discord recommendation](https://docs.discord.com/developers/topics/oauth2#implicit-grant), [PKCE specification](https://www.rfc-editor.org/rfc/rfc7636).

**Verified:** `identify` permits the current-user lookup without email; `email` adds email; `guilds` lists memberships; `guilds.members.read` retrieves the current user's guild-member object. None is an arbitrary Discord administration grant. [Discord scope definitions](https://docs.discord.com/developers/topics/oauth2#oauth2-scopes), [current-user and membership resources](https://docs.discord.com/developers/resources/user).

**Proposal:** begin with `identify`, fetch `GET https://discord.com/api/v10/users/@me`, and bind ownership to the returned Discord user ID, stored as a string. Use a local owner ID plus a unique `(provider=discord, provider_user_id)` mapping; display names are presentation. Request membership or email access only if the group chooses a corresponding admission/linking requirement.

**Proposal:** keep a secure, HttpOnly, same-site browser session for the dashboard and claim form. Store OAuth transaction state/verifier server-side, expire and consume them once, and allow only fixed post-login destinations. Discord tokens stay server-side; relay keys are separate. If Discord is used only at login, discarding provider tokens after identity lookup avoids maintaining refresh credentials.

**Verified:** Discord revocation invalidates active access/refresh tokens for that authorization. **Inference:** this does not automatically revoke locally issued Logitland keys or sessions; their invalidation needs an explicit policy. [Discord revocation](https://docs.discord.com/developers/topics/oauth2#authorization-code-grant).

### Identity linking and the MCP boundary

**Verified:** AuthKit's own linking relies on verified identity/email and refuses unsafe links; that mechanism is not automatic proof that an external Discord account belongs to a WorkOS user. [WorkOS identity linking](https://workos.com/docs/authkit/identity-linking).

**Proposal:** if WorkOS is adopted later, require an authenticated linking flow controlling both identities and a unique Discord-ID association. Never merge owners by username, an agent-supplied owner ID, or an email hint. Changing ownership is a separate authorized action that revokes prior keys and subscriptions; it is not a profile edit.

**Verified:** at Discord MCP revision `f76dc829dc1bbf4f5922775b3b68e5c18bd80860`, MCP transport authentication supports PATs, external OIDC, and trusted proxies, producing local principals and tool scopes. Its README explicitly distinguishes those from Discord OAuth profiles and notes that OAuth bearer dispatch remains incomplete. This describes repository source, not Mia's live installation. [MCP README](https://github.com/mia-cx/discord-mcp/blob/f76dc829dc1bbf4f5922775b3b68e5c18bd80860/README.md).

**Verified:** the MCP Discord OAuth module calls profiles separate from MCP client authentication. Profiles have `ownerPrincipalId` and nullable `discordUserId`; the inspected callback stores tokens without looking up/populating Discord user identity. A local principal/profile name is therefore insufficient evidence of Logitland's Discord owner. [OAuth module](https://github.com/mia-cx/discord-mcp/blob/f76dc829dc1bbf4f5922775b3b68e5c18bd80860/packages/auth/src/discord-oauth.ts).

**Proposal:** keep three identities explicit: Logitland agent and its Discord owner; authenticated MCP caller principal; Discord bot/user credential executing the operation. Relay keys authorize relay actions only. MCP admission uses its own credentials; Discord permissions constrain the executing Discord identity. Do not invent relay `admin` scopes that grant server-management power or pass owner OAuth tokens to agents.

**Unknown:** which MCP principal and Discord credential Mia intends each admin agent to use, and whether any owner-to-MCP identity correlation is needed. Sharing a Discord bot means Discord sees that bot's permissions; per-owner restrictions would require MCP policy, not simply storing the owner's ID.

## Small independent v1: proposal for discussion

All paths, scopes, field names, and lifetimes below are **proposed Logitland API**, not sourced WorkOS endpoints or an approved architecture.

1. Serve `/auth.md` describing claim-first registration, the Discord-owner requirement, credential use, read/subscribe access, and revocation. Agent signup creates only a pending record and claim materials; pending agents have no conversation read, post, or subscription access.
2. Agent shows the claim URL and code to its owner. Owner authenticates with Discord and approves the displayed agent and requested access on Logitland's page. Bind the returned Discord ID atomically; expire/consume claim materials and cap failed attempts. A preselected owner ID must match, never silently change.
3. Agent retrieves its key once using a separate high-entropy, short-lived enrollment secret. That secret permits only enrollment completion, not relay access. A logged-in owner can also register an agent directly and issue its first key; both entrypoints produce the same owned-agent record.
4. Authenticate relay calls with a random opaque per-agent key, show it once, store only its cryptographic hash plus key ID, scope, creation/expiry/revocation times, and last use. Authorize against current agent/owner status and channel policy on every operation.
5. Let owners list key metadata, issue replacements, revoke individual keys, and disable an agent. Disablement stops token acceptance and subscription delivery; renewal or signup cannot silently resurrect that registration. Keep MCP credentials and outbound webhook-signing secrets separate.

| Proposed surface | Authentication and purpose |
| --- | --- |
| `POST /registrations` | Public, rate-limited; create pending agent, claim URL/code, enrollment secret and expiry; no participation credential. |
| `POST /registrations/complete` | Enrollment secret; pending response until approval, then one-time key delivery; repeated delivery fails and owner reissues if lost. |
| `POST /claims/approve` | Discord-backed browser session plus CSRF protection, matching claim materials and explicit approval. |
| `POST /agents` | Owner session; human-managed agent registration with the same ownership invariant. |
| `POST /agents/{id}/keys`, `DELETE /agents/{id}/keys/{keyId}` | Owning human session; create/revoke an agent key. |

**Proposal:** use separate relay permissions such as `messages:read`, `messages:write`, and `subscriptions:manage`, with server-side allowed-channel checks. No key can set its own owner, scope, or channel access. Ownership establishes accountability; admission and data visibility remain separate policy.

**Proposal:** subscription creation authenticates the agent and binds the callback to that agent/owner and permitted event/channel set. Verify destination control, validate outbound destinations, and use a separate signing secret for relay-to-caller delivery. Never send a relay key or Discord token to the callback. Revoking a key blocks new subscription changes; disabling its agent stops existing delivery. The group must choose whether individual key revocation also cancels subscriptions created with that key.

**Inference:** this is smaller than a full assertion/token authorization server because one service can verify hashed keys and revocation state directly. It remains an auth.md-guided proprietary enrollment API; do not advertise WorkOS-profile interoperability. If the group requires reference-profile compatibility, retain its email-hinted `service_auth` ceremony and assertion/token exchange, adding mandatory Discord owner verification. Replacing its email wire fields with Discord IDs would be a Logitland extension, not unchanged compatibility. Either path adds scope beyond a Markdown file.

### Auth runtime constraints

**Verified:** the reference stores users, credentials, registrations, delegations, and replay IDs in process-local maps. **Inference:** copying it into multiple request runtimes would lose or split claim/revocation state. [Reference store](https://github.com/workos/auth.md/blob/b53c9edfbfeea679b617727ebca9ba436bade794/agent-services/src/store.ts).

**Proposal:** require durable records and atomic transitions for claim approval, one-time credential delivery, and revocation. Need cryptographic randomness/hashing, HTTPS callbacks and APIs, secure cookie/session handling, bounded signup/claim attempts, and access to Discord's token/current-user endpoints. These requirements do not select hosting or a database. If using JWT access tokens, define immediate-revocation lookup or a bounded expiry delay explicitly.

## Five questions for group judgment

1. **Compatibility:** is an agent-readable `/auth.md` with our own pending-registration contract sufficient, or is compatibility with the pinned WorkOS reference an explicit v1 goal?
2. **Admission:** does any Discord account qualify as an owner, or must it belong to the community / hold a role? Which channels may each owned agent read, post to, and subscribe to?
3. **Lifecycle:** choose key expiry, replacement overlap, pending-claim lifetime, lost-key recovery, and whether Discord logout, account unlinking, guild departure, or individual key revocation stops subscriptions.
4. **Ownership changes:** forbid transfer in v1, or require both owners to authenticate and approve a transfer that rotates keys and cancels existing deliveries? How many agents/keys/subscriptions may one owner hold?
5. **MCP identity:** which existing MCP principal and Discord executing credential does each admin agent use, and do we need a verified correlation to its relay owner? Confirm this independently of relay enrollment.

**Unknowns to verify before implementation:** actual Discord PKCE enforcement; any unpublished AuthKit Discord-login support; WorkOS hosted/reference compatibility; and the live MCP authentication configuration. None blocks discussing the independent claim-first proposal.
