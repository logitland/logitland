import { AgentSelf, LIMITS, ReconnectCode, TokenResponse } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { asOwner, count, ipHeader, tokenCall } from './signup.helpers';
import { harness, seedAgent, seedOwner, type Harness } from './testing';

// Reconnecting (#182): a parent makes a one-time code, and the agent's new session, holding no credentials, trades it for
// its identity at /oauth2/token.

const RECONNECT = 'urn:logitland:grant-type:reconnect';

const makeCode = (h: Harness, ownerId: string, agentId: string) =>
  h.internal('POST', `/internal/owners/${ownerId}/agents/${agentId}/reconnect-codes`, undefined, asOwner(ownerId));

async function codeFor(h: Harness, ownerId: string, agentId: string) {
  const res = await makeCode(h, ownerId, agentId);
  expect(res.status).toBe(201);
  return ReconnectCode.parse(await res.json()).code;
}

const trade = (h: Harness, code: string, agentId: string) => tokenCall(h, { grant_type: RECONNECT, code, registration_id: agentId });

async function setup() {
  const h = harness();
  const owner = await seedOwner(h.relay);
  const agent = await seedAgent(h.relay, { ownerId: owner.id, level: 3, xp: 2500 });
  return { h, owner, agent };
}

describe('reconnect codes', () => {
  it('give a new session a working identity for the same agent, with its level and XP', async () => {
    const { h, owner, agent } = await setup();
    const res = await trade(h, await codeFor(h, owner.id, agent.id), agent.id);
    expect(res.status).toBe(200);
    const tokens = TokenResponse.parse(await res.json());

    const me = AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(tokens.access_token))).json());
    expect(me.agent.id).toBe(agent.id);
    expect(me.level).toMatchObject({ level: 3, xp: 2500 });
    const renewed = await tokenCall(h, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: tokens.identity_assertion });
    expect(renewed.status).toBe(200);
    expect(
      await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE target_id = ? AND action IN ('agent.reconnect_code', 'agent.reconnected')", agent.id),
    ).toBe(2);
  });

  it('are made only by the agent’s parent, for an agent that can sign in', async () => {
    const { h, owner, agent } = await setup();
    const other = await seedOwner(h.relay, '200000000000000002', 'grace');
    const orphan = await seedAgent(h.relay);
    const off = await seedAgent(h.relay, { ownerId: owner.id, status: 'off' });
    expect((await makeCode(h, other.id, agent.id)).status).toBe(404);
    expect((await makeCode(h, owner.id, orphan.id)).status).toBe(404);
    expect((await makeCode(h, owner.id, off.id)).status).toBe(409);
  });

  it.each([
    { refused: 'a second use', after: async (h: Harness, code: string, id: string) => void (await trade(h, code, id)) },
    { refused: 'an expired code', after: async (h: Harness) => h.advance(LIMITS.claimCodeSeconds * 1000 + 1) },
    {
      refused: 'a code replaced by a newer one',
      after: async (h: Harness, _code: string, id: string, ownerId: string) => void (await codeFor(h, ownerId, id)),
    },
    {
      refused: 'a revoked agent',
      after: async (h: Harness, _code: string, id: string, ownerId: string) =>
        expect((await h.internal('DELETE', `/internal/owners/${ownerId}/agents/${id}`, undefined, asOwner(ownerId))).status).toBe(204),
    },
  ])('refuse $refused', async ({ after }) => {
    const { h, owner, agent } = await setup();
    const code = await codeFor(h, owner.id, agent.id);
    await after(h, code, agent.id, owner.id);
    const res = await trade(h, code, agent.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('refuse a code made for another agent', async () => {
    const { h, owner, agent } = await setup();
    const sibling = await seedAgent(h.relay, { ownerId: owner.id });
    const res = await trade(h, await codeFor(h, owner.id, agent.id), sibling.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('lock out a network after too many wrong codes, even with the right one', async () => {
    const { h, owner, agent } = await setup();
    const code = await codeFor(h, owner.id, agent.id);
    for (let i = 0; i < LIMITS.claimAttemptsPerHour; i++) expect((await trade(h, 'AAAA-AAAA', agent.id)).status).toBe(400);
    const locked = await trade(h, code, agent.id);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBeTruthy();
    const elsewhere = await h.call('POST', '/oauth2/token', { grant_type: RECONNECT, code, registration_id: agent.id }, ipHeader('198.51.100.9'));
    expect(elsewhere.status).toBe(200);
  });
});
