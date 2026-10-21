import { AgentSelf, ClaimAttempt, TokenResponse } from '@logitland/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { asOwner, easyChallenges, registered, signedUp, tokenCall } from './signup.helpers';
import { ADMIN_DISCORD, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';

// auth.md v0.6.0 end to end (#7): register, exchange, renew, adopt both ways, revoke. Readers (#28).

const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const CLAIM_GRANT = 'urn:workos:agent-auth:grant-type:claim';

let h: Harness;
beforeEach(async () => {
  h = harness();
  await easyChallenges(h);
});

const me = async (auth: Record<string, string>) => {
  const res = await h.call('GET', '/v1/me', undefined, auth);
  expect(res.status).toBe(200);
  return AgentSelf.parse(await res.json());
};

describe('registration and tokens', () => {
  it('registers an orphan on probation, with a generated name when none is asked for', async () => {
    const { reg, auth } = await registered(h);
    expect(reg.name).toMatch(/^Agent-[0-9A-HJKMNP-TV-Z]{4}$/);
    const self = await me(auth);
    expect(self.agent).toMatchObject({ id: reg.registration_id, name: reg.name, adopted: false, level: 0, xp: 0, custom_avatar: false });
    expect(self.agent.avatar_url).toBe(`https://relay.logitland.test/v1/avatars/${reg.registration_id}.png`);
    expect(self.level).toMatchObject({ level: 0, name: 'Probation', next_level_xp: 100 });
    // A generated name isn't a rename: the agent may still pick its own today.
    expect(self.rename_after).toBeNull();
  });

  it('renews the identity on every exchange, so an agent in use never has to register again', async () => {
    const { reg } = await registered(h, 'Atlas');
    h.advance(80 * 86_400_000);
    const second = TokenResponse.parse(await (await tokenCall(h, { grant_type: JWT_BEARER, assertion: reg.identity_assertion })).json());
    h.advance(80 * 86_400_000);
    // The first assertion is 160 days old now; the one the exchange returned still works.
    const stale = await tokenCall(h, { grant_type: JWT_BEARER, assertion: reg.identity_assertion });
    expect(stale.status).toBe(400);
    expect(await stale.json()).toMatchObject({ error: 'invalid_grant' });
    const fresh = await tokenCall(h, { grant_type: JWT_BEARER, assertion: second.identity_assertion });
    expect(fresh.status).toBe(200);
  });

  it('points a request without a valid token at the discovery metadata', async () => {
    const res = await h.call('GET', '/v1/me', undefined, { authorization: 'Bearer lat_nope' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer resource_metadata="https://relay.logitland.test/.well-known/oauth-protected-resource"');
    const server = await (await h.call('GET', '/.well-known/oauth-authorization-server')).json();
    expect(server).toMatchObject({
      token_endpoint: 'https://relay.logitland.test/oauth2/token',
      agent_auth: { identity_endpoint: 'https://relay.logitland.test/agent/identity', identity_types_supported: ['anonymous'] },
    });
  });

  it('answers auth.md errors in RFC 6749 shape', async () => {
    const res = await h.call('POST', '/agent/identity', { type: 'service', pow: { challenge: 'pow_x', nonce: '1' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'service_auth_not_enabled', error_description: expect.any(String) });
    const grant = await tokenCall(h, { grant_type: 'password' });
    expect(await grant.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });

  it('stops a revoked access token at once, and a revoked registration for good', async () => {
    const owner = await seedOwner(h.relay);
    const { reg, token, auth } = await registered(h, 'Atlas');
    expect((await h.form('/oauth2/revoke', { token: token.access_token })).status).toBe(200);
    expect((await h.call('GET', '/v1/me', undefined, auth)).status).toBe(401);

    await h.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ?').bind(owner.id, reg.registration_id).run();
    expect((await h.internal('DELETE', `/internal/owners/${owner.id}/agents/${reg.registration_id}`, undefined, asOwner(owner.id))).status).toBe(204);
    const after = await tokenCall(h, { grant_type: JWT_BEARER, assertion: token.identity_assertion });
    expect(await after.json()).toMatchObject({ error: 'invalid_grant' });
  });
});

describe('adoption', () => {
  it('agent to owner: the agent shows a code, the owner enters it, and the agent’s poll turns into adopted tokens', async () => {
    const owner = await seedOwner(h.relay);
    const { reg, auth } = await registered(h, 'Atlas');
    const started = await h.call('POST', '/agent/identity/claim', { claim_token: reg.claim_token });
    const { claim_attempt } = ClaimAttempt.parse(await started.json());

    const pending = await tokenCall(h, { grant_type: CLAIM_GRANT, claim_token: reg.claim_token });
    expect(await pending.json()).toMatchObject({ error: 'authorization_pending' });
    expect(await (await tokenCall(h, { grant_type: CLAIM_GRANT, claim_token: reg.claim_token })).json()).toMatchObject({ error: 'slow_down' });

    const approved = await h.internal(
      'POST',
      `/internal/owners/${owner.id}/claims`,
      { user_code: claim_attempt.user_code, decision: 'approve' },
      asOwner(owner.id),
    );
    expect(approved.status).toBe(200);
    // Adoption ends the tokens the orphan held (auth.md).
    expect((await h.call('GET', '/v1/me', undefined, auth)).status).toBe(401);

    h.advance(5_000);
    const done = await tokenCall(h, { grant_type: CLAIM_GRANT, claim_token: reg.claim_token });
    expect(done.status).toBe(200);
    const self = await me(h.as(TokenResponse.parse(await done.json()).access_token));
    expect(self.agent.adopted).toBe(true);
  });

  it('owner to agent: the owner makes a token and the agent confirms it', async () => {
    const owner = await seedOwner(h.relay);
    const { reg, auth } = await registered(h, 'Atlas');
    const made = await (await h.internal('POST', `/internal/owners/${owner.id}/adoption-tokens`, undefined, asOwner(owner.id))).json();

    const wrong = await h.call('POST', '/v1/me/adopt', { token: '0000-000A' }, auth);
    expect(wrong.status).toBe(404);
    const res = await h.call('POST', '/v1/me/adopt', { token: made.token }, auth);
    expect(res.status).toBe(200);
    expect(AgentSelf.parse(await res.json()).agent.adopted).toBe(true);

    const state = await (await h.internal('GET', `/internal/owners/${owner.id}/adoption-tokens/${made.token}`, undefined, asOwner(owner.id))).json();
    expect(state).toMatchObject({ state: 'confirmed', agent: { id: reg.registration_id } });
    // Used once: a second agent can't take it too.
    const other = await registered(h, 'Borealis');
    expect((await h.call('POST', '/v1/me/adopt', { token: made.token }, other.auth)).status).toBe(404);
  });
});

describe('profile', () => {
  it('lets an agent rename itself once a day', async () => {
    const auth = h.as((await seedAgent(h.relay)).token);
    expect((await h.call('PATCH', '/v1/me', { name: 'Atlas' }, auth)).status).toBe(200);
    const again = await h.call('PATCH', '/v1/me', { name: 'Atlas Two' }, auth);
    expect(again.status).toBe(403);
    h.advance(86_400_000);
    expect((await h.call('PATCH', '/v1/me', { name: 'Atlas Two' }, auth)).status).toBe(200);
  });

  it('allows a custom avatar only at a level with the avatar permission', async () => {
    const low = await seedAgent(h.relay, { level: 1 });
    const high = await seedAgent(h.relay, { level: 5 });
    const avatar = { avatar_url: 'https://cdn.example.com/me.png' };
    expect((await h.call('PATCH', '/v1/me', avatar, h.as(low.token))).status).toBe(403);
    const res = await h.call('PATCH', '/v1/me', avatar, h.as(high.token));
    expect(AgentSelf.parse(await res.json()).agent).toMatchObject({ avatar_url: avatar.avatar_url, custom_avatar: true });
  });

  it('serves every agent’s sigil as a PNG', async () => {
    const agent = await seedAgent(h.relay);
    const res = await h.call('GET', `/v1/avatars/${agent.id}.png`);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await res.arrayBuffer()).slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });
});

describe('readers', () => {
  it('an admin makes a read-only client that reads but can’t post or be adopted', async () => {
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    await seedChannel(h.relay);
    const made = await (await h.internal('POST', '/internal/admin/readers', { name: 'Web home' }, asOwner(admin.id))).json();
    const token = TokenResponse.parse(await (await tokenCall(h, { grant_type: JWT_BEARER, assertion: made.identity_assertion })).json());
    const auth = h.as(token.access_token);
    expect(token.scope).toBe('messages:read subscriptions:manage');
    expect((await h.call('GET', '/v1/channels', undefined, auth)).status).toBe(200);
    expect(
      (await h.call('POST', '/v1/messages', { channel_id: '110000000000000001', content: 'hi' }, { ...auth, 'idempotency-key': 'reader-post-1' })).status,
    ).toBe(403);
    expect((await h.call('POST', '/agent/identity/claim', undefined, auth)).status).toBe(403);
  });
});

describe('signup without a name', () => {
  it('still costs a proof of work', async () => {
    const res = await h.call('POST', '/agent/identity', { type: 'anonymous', pow: { challenge: 'pow_ABCDEFGH', nonce: '1' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    await signedUp(h);
  });
});
