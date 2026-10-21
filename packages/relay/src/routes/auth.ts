import { ALL_SCOPES, ClaimRequest, RegistrationRequest } from '@logitland/contracts';
import { OAuthError, parse } from '../errors';
import { issueChallenge } from '../services/pow';
import { register as registerAgent } from '../services/signup';
import { CLAIM_GRANT, JWT_BEARER, agentByClaimToken, authenticateToken, exchangeAssertion, pollClaim, revokeAccessToken, startClaim } from '../services/tokens';
import { bearer, body, type AppContext, type RegisterRoutes } from './shared';

// auth.md v0.6.0 (#7): discovery, registration, adoption from the agent's side, and the token endpoint. Errors here answer in
// RFC 6749's shape (app.ts). Contracts and paths: packages/contracts/src/api.ts (AUTH_API).

/** auth.md's version this relay follows. */
const AUTH_MD_VERSION = '0.6.0';

/** /oauth2/token and /oauth2/revoke take form fields (RFC 6749); JSON is accepted too. */
async function fields(c: AppContext): Promise<Record<string, string>> {
  const raw = (c.req.header('content-type') ?? '').includes('application/json') ? await body(c) : await c.req.parseBody();
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v;
  return out;
}

const required = (f: Record<string, string>, name: string): string => {
  const v = f[name];
  if (!v) throw new OAuthError(400, 'invalid_request', `Send ${name}.`);
  return v;
};

export const register: RegisterRoutes = (app, relay) => {
  const url = relay.config.publicUrl;
  const docs = { 'cache-control': 'public, max-age=300' };

  app.get('/.well-known/oauth-protected-resource', (c) =>
    c.json(
      {
        resource: url,
        authorization_servers: [url],
        scopes_supported: ALL_SCOPES,
        bearer_methods_supported: ['header'],
        resource_documentation: `${url}/skill.md`,
      },
      200,
      docs,
    ),
  );

  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json(
      {
        issuer: url,
        token_endpoint: `${url}/oauth2/token`,
        revocation_endpoint: `${url}/oauth2/revoke`,
        grant_types_supported: [JWT_BEARER, CLAIM_GRANT],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ALL_SCOPES,
        agent_auth: {
          version: AUTH_MD_VERSION,
          skill: `${url}/auth.md`,
          identity_endpoint: `${url}/agent/identity`,
          claim_endpoint: `${url}/agent/identity/claim`,
          challenge_endpoint: `${url}/agent/identity/challenge`,
          identity_types_supported: ['anonymous'],
        },
      },
      200,
      docs,
    ),
  );

  app.get('/agent/identity/challenge', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await issueChallenge(relay, c.get('client')));
  });

  app.post('/agent/identity', async (c) => {
    const request = parse(RegistrationRequest, await body(c));
    c.header('cache-control', 'no-store');
    return c.json(await registerAgent(relay, request, c.get('client')));
  });

  // The claim token, or (a Logitland extension) the agent's access token, so a lost claim token doesn't rule out adoption.
  app.post('/agent/identity/claim', async (c) => {
    const token = bearer(c);
    c.header('cache-control', 'no-store');
    if (token) return c.json(await startClaim(relay, (await authenticateToken(relay, token, c.get('client'))).agent));
    const { claim_token } = parse(ClaimRequest, await body(c));
    if (!claim_token) throw new OAuthError(400, 'invalid_request', 'Send claim_token, or your access token as a Bearer token.');
    return c.json(await startClaim(relay, await agentByClaimToken(relay, claim_token)));
  });

  app.post('/oauth2/token', async (c) => {
    const f = await fields(c);
    c.header('cache-control', 'no-store');
    switch (required(f, 'grant_type')) {
      case JWT_BEARER:
        return c.json(await exchangeAssertion(relay, required(f, 'assertion'), c.get('client')));
      case CLAIM_GRANT:
        return c.json(await pollClaim(relay, required(f, 'claim_token')));
      default:
        throw new OAuthError(400, 'unsupported_grant_type', `Use ${JWT_BEARER} or ${CLAIM_GRANT}.`);
    }
  });

  app.post('/oauth2/revoke', async (c) => {
    await revokeAccessToken(relay, required(await fields(c), 'token'));
    return c.body(null, 200);
  });
};
