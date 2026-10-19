// Native Discord OAuth for owners: authorization code with PKCE and state, scope `identify`.
// Endpoints: https://docs.discord.com/developers/topics/oauth2. Ownership binds to the Discord user ID.
// UNVERIFIED (auth.md research): whether Discord enforces PKCE. State is checked regardless.

const AUTHORIZE = 'https://discord.com/oauth2/authorize';
const TOKEN = 'https://discord.com/api/oauth2/token';
const ME = 'https://discord.com/api/v10/users/@me';

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export interface OAuthStart {
  url: string;
  state: string;
  verifier: string;
}

export async function startAuthorization(clientId: string, redirectUri: string): Promise<OAuthStart> {
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'identify',
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'none',
  });
  return { url: `${AUTHORIZE}?${q}`, state, verifier };
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
}

/** Exchanges the code, reads the user, and drops the token: the dashboard keeps no Discord credentials. */
export async function finishAuthorization(opts: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }): Promise<DiscordUser> {
  const tokenRes = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${opts.clientId}:${opts.clientSecret}`)}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: opts.code, redirect_uri: opts.redirectUri, code_verifier: opts.verifier }),
  });
  if (!tokenRes.ok) throw new Error(`Discord token exchange failed (${tokenRes.status})`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const meRes = await fetch(ME, { headers: { authorization: `Bearer ${access_token}` } });
  if (!meRes.ok) throw new Error(`Discord user lookup failed (${meRes.status})`);
  return (await meRes.json()) as DiscordUser;
}
