import { newId, type LoganAuthorization, type LoganConsent, type LoganDecision, type LoganRedirect, type Owner } from '@logitland/contracts';
import { iso, type Relay } from '../../context';
import { randomToken, sha256 } from '../../crypto';
import { OAuthError, forbidden, invalid, unauthorized } from '../../errors';
import type { ClientInfo } from '../../types';
import { adminStanding } from '../admins';
import { getOwner, keepOwner } from '../identity';
import { enforce } from '../limits';
import { clientHashes } from '../origins';

// OAuth 2.1 for the Logan admin MCP (MCP authorization, spec 2025-11-25): dynamic client registration for public clients,
// the authorization code grant with PKCE (S256 only), refresh tokens that rotate, and revocation. The authorization endpoint
// is the dashboard's /oauth/authorize, where the person signs in with Discord and consents; the dashboard hands the decision
// here over the internal API. Codes and tokens are kept as hashes. Tokens only say who the person is: what they may do is
// checked again on every MCP call (access.ts).

export const ACCESS_SECONDS = 3600;
const REFRESH_SECONDS = 30 * 86_400;
const CODE_SECONDS = 300;
const REGISTRATIONS_PER_HOUR = 20;
/** RFC 8252: a native app's loopback redirect may use any port, picked when it runs. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Schemes a redirect may never use: plain http off this machine, and ones that run or read things in the browser. */
const REFUSED_SCHEMES = new Set(['http:', 'javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:']);
export const SCOPE = 'logan';

/** The admin MCP's own addresses. Its issuer is apart from auth.md's, which only issues agents' tokens. */
export const loganUrls = (relay: Relay) => {
  const url = relay.config.publicUrl;
  return {
    resource: `${url}/mcp/admin`,
    resourceMetadata: `${url}/.well-known/oauth-protected-resource/mcp/admin`,
    issuer: `${url}/oauth2/admin`,
    authorize: `${relay.config.dashboardUrl}/oauth/authorize`,
  };
};

interface ClientRow {
  id: string;
  name: string;
  redirect_uris: string;
}

const isLoopback = (u: URL) => u.protocol === 'http:' && LOOPBACK.has(u.hostname);

function redirectProblem(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return 'Each redirect URI must be a URL.';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Each redirect URI must be a URL.';
  }
  if (u.hash) return 'Redirect URIs can’t have a fragment.';
  if (REFUSED_SCHEMES.has(u.protocol) && !isLoopback(u)) return 'Redirect URIs must use https, or http on localhost.';
  return null;
}

/** Whether `asked` is one of the client's registered redirect URIs; a loopback one matches on any port. */
function registered(client: ClientRow, asked: string): boolean {
  let a: URL;
  try {
    a = new URL(asked);
  } catch {
    return false;
  }
  return (JSON.parse(client.redirect_uris) as string[]).some((r) => {
    if (r === asked) return true;
    const u = new URL(r);
    return isLoopback(u) && isLoopback(a) && u.hostname === a.hostname && u.pathname === a.pathname && u.search === a.search;
  });
}

/** RFC 7591: registers a public MCP client. Answers its client_id and what it registered. */
export async function registerClient(relay: Relay, raw: unknown, from: ClientInfo) {
  const { net } = await clientHashes(relay, from);
  await enforce(
    relay,
    [{ key: `logan-dcr:${net ?? 'unknown'}:h`, limit: REGISTRATIONS_PER_HOUR, windowSeconds: 3600 }],
    'Too many client registrations. Try again later.',
  );
  const meta = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10) throw new OAuthError(400, 'invalid_redirect_uri', 'Send redirect_uris: one to ten URLs.');
  for (const u of uris) {
    const problem = redirectProblem(u);
    if (problem) throw new OAuthError(400, 'invalid_redirect_uri', problem);
  }
  if (meta.token_endpoint_auth_method !== undefined && meta.token_endpoint_auth_method !== 'none')
    throw new OAuthError(400, 'invalid_client_metadata', 'Only public clients are supported: token_endpoint_auth_method none, with PKCE.');
  const grants = meta.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grants) || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token'))
    throw new OAuthError(400, 'invalid_client_metadata', 'grant_types may only be authorization_code and refresh_token.');
  const name = typeof meta.client_name === 'string' && meta.client_name.trim() ? meta.client_name.trim().slice(0, 100) : 'An MCP client';
  const id = newId('logan_client');
  const now = relay.now();
  await relay.db
    .prepare('INSERT INTO logan_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, name, JSON.stringify(uris), iso(now))
    .run();
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: uris as string[],
    grant_types: grants as string[],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/** Checks an authorization request as the dashboard received it; answers the client it names. Errors are shown, not redirected. */
async function checkRequest(relay: Relay, req: LoganAuthorization): Promise<ClientRow> {
  const client = await relay.db.prepare('SELECT id, name, redirect_uris FROM logan_clients WHERE id = ?').bind(req.client_id).first<ClientRow>();
  if (!client) throw invalid('That MCP client isn’t registered. Add the server to your MCP client again.');
  if (!registered(client, req.redirect_uri)) throw invalid('That redirect address isn’t one the MCP client registered.');
  if (req.response_type !== 'code') throw invalid('Only the authorization code flow is supported (response_type=code).');
  if (req.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(req.code_challenge))
    throw invalid('Send a PKCE code_challenge with code_challenge_method S256.');
  if (req.resource !== undefined && req.resource.replace(/\/$/, '') !== loganUrls(relay).resource) throw invalid('That resource isn’t the Logan admin MCP.');
  return client;
}

const holdsLogan = async (relay: Relay, ownerId: string) =>
  (await adminStanding(relay, (await getOwner(relay, ownerId)).discord_user_id)).permissions.includes('logan');

/** The consent screen: which client asks, and whether this person may let it act for them. */
export async function consent(relay: Relay, ownerId: string, req: LoganAuthorization): Promise<LoganConsent> {
  const client = await checkRequest(relay, req);
  return { client_name: client.name, allowed: await holdsLogan(relay, ownerId) };
}

/** The person's answer. Allowing issues a code bound to them, the client, the redirect and the PKCE challenge. */
export async function authorize(relay: Relay, ownerId: string, d: LoganDecision): Promise<LoganRedirect> {
  const client = await checkRequest(relay, d);
  const to = new URL(d.redirect_uri);
  if (d.state !== undefined) to.searchParams.set('state', d.state);
  to.searchParams.set('iss', loganUrls(relay).issuer);
  if (d.decision === 'deny') {
    to.searchParams.set('error', 'access_denied');
    return { redirect_to: to.toString() };
  }
  if (!(await holdsLogan(relay, ownerId))) throw forbidden('Acting through Logan needs the logan admin power.');
  const code = randomToken('llc_');
  const now = relay.now();
  await relay.db
    .prepare('INSERT INTO logan_codes (hash, grant_id, client_id, owner_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256(code), newId('logan_grant'), client.id, ownerId, d.redirect_uri, d.code_challenge, iso(new Date(now.getTime() + CODE_SECONDS * 1000)))
    .run();
  to.searchParams.set('code', code);
  return { redirect_to: to.toString() };
}

/** base64url(SHA-256(verifier)), as PKCE's S256 compares. */
async function challengeOf(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const invalidGrant = (why: string) => new OAuthError(400, 'invalid_grant', why);

async function endGrant(relay: Relay, grantId: string): Promise<void> {
  await relay.db.prepare('UPDATE logan_tokens SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL').bind(iso(relay.now()), grantId).run();
}

async function issue(relay: Relay, grant: { grant_id: string; client_id: string; owner_id: string }) {
  const access = randomToken('lla_');
  const refresh = randomToken('llr_');
  const now = relay.now();
  const insert = async (token: string, kind: 'access' | 'refresh', seconds: number) =>
    relay.db
      .prepare('INSERT INTO logan_tokens (hash, kind, grant_id, client_id, owner_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256(token), kind, grant.grant_id, grant.client_id, grant.owner_id, iso(now), iso(new Date(now.getTime() + seconds * 1000)));
  await relay.db.batch([await insert(access, 'access', ACCESS_SECONDS), await insert(refresh, 'refresh', REFRESH_SECONDS)]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPE };
}

const need = (f: Record<string, string>, name: string): string => {
  const v = f[name];
  if (!v) throw new OAuthError(400, 'invalid_request', `Send ${name}.`);
  return v;
};

/** The token endpoint: an authorization code with its PKCE verifier, or a refresh token, for a new pair. */
export async function exchange(relay: Relay, f: Record<string, string>) {
  const now = iso(relay.now());
  switch (need(f, 'grant_type')) {
    case 'authorization_code': {
      const row = await relay.db
        .prepare('SELECT * FROM logan_codes WHERE hash = ?')
        .bind(await sha256(need(f, 'code')))
        .first<{
          hash: string;
          grant_id: string;
          client_id: string;
          owner_id: string;
          redirect_uri: string;
          code_challenge: string;
          expires_at: string;
          used_at: string | null;
        }>();
      if (!row) throw invalidGrant('That code isn’t valid.');
      if (row.used_at) {
        // A code used twice was probably stolen: whatever the first use got stops working.
        await endGrant(relay, row.grant_id);
        throw invalidGrant('That code was already used.');
      }
      if (row.expires_at <= now) throw invalidGrant('That code expired. Sign in again.');
      if (row.client_id !== need(f, 'client_id') || row.redirect_uri !== need(f, 'redirect_uri'))
        throw invalidGrant('That code was issued to another client or redirect URI.');
      if ((await challengeOf(need(f, 'code_verifier'))) !== row.code_challenge) throw invalidGrant('The code_verifier doesn’t match the code_challenge.');
      const used = await relay.db.prepare('UPDATE logan_codes SET used_at = ? WHERE hash = ? AND used_at IS NULL').bind(now, row.hash).run();
      if (!used.meta.changes) throw invalidGrant('That code was already used.');
      return issue(relay, row);
    }
    case 'refresh_token': {
      const hash = await sha256(need(f, 'refresh_token'));
      const row = await relay.db
        .prepare("SELECT grant_id, client_id, owner_id, expires_at, revoked_at FROM logan_tokens WHERE hash = ? AND kind = 'refresh'")
        .bind(hash)
        .first<{ grant_id: string; client_id: string; owner_id: string; expires_at: string; revoked_at: string | null }>();
      if (!row) throw invalidGrant('That refresh token isn’t valid.');
      if (row.revoked_at) {
        // A replaced refresh token coming back means two parties hold it: end the grant for both.
        await endGrant(relay, row.grant_id);
        throw invalidGrant('That refresh token was already used or revoked. Sign in again.');
      }
      if (row.expires_at <= now) throw invalidGrant('That refresh token expired. Sign in again.');
      if (row.client_id !== need(f, 'client_id')) throw invalidGrant('That refresh token was issued to another client.');
      const replaced = await relay.db.prepare('UPDATE logan_tokens SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL').bind(now, hash).run();
      if (!replaced.meta.changes) throw invalidGrant('That refresh token was already used.');
      return issue(relay, row);
    }
    default:
      throw new OAuthError(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  }
}

/** RFC 7009. A refresh token ends its whole grant; an access token only itself. Unknown tokens are fine. */
export async function revoke(relay: Relay, token: string): Promise<void> {
  const row = await relay.db
    .prepare('SELECT kind, grant_id FROM logan_tokens WHERE hash = ?')
    .bind(await sha256(token))
    .first<{ kind: string; grant_id: string }>();
  if (!row) return;
  if (row.kind === 'refresh') return endGrant(relay, row.grant_id);
  await relay.db
    .prepare('UPDATE logan_tokens SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL')
    .bind(iso(relay.now()), await sha256(token))
    .run();
}

/** The person an access token was issued to. Their owner row comes with it, kept for the call (`keepOwner`). */
export async function authenticate(relay: Relay, token: string): Promise<string> {
  const row = token.startsWith('lla_')
    ? await relay.db
        .prepare(
          "SELECT o.*, t.expires_at AS token_expires_at, t.revoked_at AS token_revoked_at FROM logan_tokens t JOIN owners o ON o.id = t.owner_id WHERE t.hash = ? AND t.kind = 'access'",
        )
        .bind(await sha256(token))
        .first<Owner & { token_expires_at: string; token_revoked_at: string | null }>()
    : null;
  if (!row || row.token_revoked_at || row.token_expires_at <= iso(relay.now())) throw unauthorized('That access token isn’t valid or has expired.');
  const { token_expires_at: _expires, token_revoked_at: _revoked, ...owner } = row;
  keepOwner(owner);
  return owner.id;
}

/** Cron: forgets codes, tokens and confirmation requests that expired a day ago. The audit log keeps what ran. */
export async function pruneLoganJob(relay: Relay): Promise<number> {
  const cutoff = iso(new Date(relay.now().getTime() - 86_400_000));
  const results = await relay.db.batch(
    ['logan_codes', 'logan_tokens', 'logan_requests'].map((table) => relay.db.prepare(`DELETE FROM ${table} WHERE expires_at < ?`).bind(cutoff)),
  );
  return results.reduce((n, r) => n + r.meta.changes, 0);
}
