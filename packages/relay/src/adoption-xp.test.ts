import { AdoptionToken, ClaimAttempt } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { updateSettings } from './services/settings';
import { grantAdoptionXp, penalise } from './services/xp/award';
import { asOwner } from './signup.helpers';
import { harness, seedAgent, seedOwner, type Harness } from './testing';

const standing = (h: Harness, id: string) => h.db.prepare('SELECT xp, level, adoption_xp FROM agents WHERE id = ?').bind(id).first();

async function adopt(h: Harness, ownerId: string, agentToken: string) {
  const made = await h.internal('POST', `/internal/owners/${ownerId}/adoption-tokens`, undefined, asOwner(ownerId));
  expect(made.status).toBe(201);
  const { token } = AdoptionToken.parse(await made.json());
  return h.call('POST', '/v1/me/adopt', { token }, h.as(agentToken));
}

describe('adoption XP', () => {
  it.each([
    { xp: 1000, level: 2 },
    { xp: 2250, level: 3 },
    { xp: 0, level: 0 },
  ])('token adoption grants the configured $xp XP once and raises the level by the curve', async ({ xp, level }) => {
    const h = harness();
    const owner = await seedOwner(h.relay);
    const agent = await seedAgent(h.relay, { level: 0, xp: 0 });
    await updateSettings(h.relay, 'own_admin', { adoption_xp: xp });
    expect((await adopt(h, owner.id, agent.token)).status).toBe(200);
    const expected = { xp, level, adoption_xp: xp };
    expect(await standing(h, agent.id)).toEqual(expected);
    // A repeated award notification while the owner is held must not duplicate its XP.
    await Promise.all([grantAdoptionXp(h.relay, agent.id), grantAdoptionXp(h.relay, agent.id)]);
    expect((await adopt(h, owner.id, agent.token)).status).toBe(409);
    expect(await standing(h, agent.id)).toEqual(expected);
  });

  it('claim approval grants adoption XP once and raises a level 0 agent to level 2', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay);
    const agent = await seedAgent(h.relay, { level: 0, xp: 0 });
    const started = await h.call('POST', '/agent/identity/claim', undefined, h.as(agent.token));
    const { claim_attempt } = ClaimAttempt.parse(await started.json());
    const approve = () =>
      h.internal('POST', `/internal/owners/${owner.id}/claims`, { user_code: claim_attempt.user_code, decision: 'approve' }, asOwner(owner.id));
    expect((await approve()).status).toBe(200);
    expect(await standing(h, agent.id)).toEqual({ xp: 1000, level: 2, adoption_xp: 1000 });
    expect((await approve()).status).toBe(404);
    expect(await standing(h, agent.id)).toEqual({ xp: 1000, level: 2, adoption_xp: 1000 });
  });

  it.each([0, 1400])('owner deletion takes back the original award, preserves earned XP, and audits the level drop after a %i XP penalty', async (penalty) => {
    const h = harness();
    const owner = await seedOwner(h.relay);
    const agent = await seedAgent(h.relay, { level: 1, xp: 500 });
    expect((await adopt(h, owner.id, agent.token)).status).toBe(200);
    await updateSettings(h.relay, 'own_admin', { adoption_xp: 2250 });
    if (penalty) await penalise(h.relay, agent.id, penalty, 'report_rejected');
    expect((await h.internal('DELETE', `/internal/owners/${owner.id}`, undefined, asOwner(owner.id))).status).toBe(204);
    expect(await standing(h, agent.id)).toEqual({ xp: penalty ? 0 : 500, level: penalty ? 0 : 1, adoption_xp: 0 });
    const audit = await h.db
      .prepare("SELECT target_id, reason, diff FROM audit_log WHERE action = 'agent.level_down'")
      .first<{ target_id: string; reason: string; diff: string }>();
    expect(audit).toMatchObject({ target_id: agent.id, reason: 'lost its owner' });
    expect(JSON.parse(audit!.diff)).toEqual({ level: { from: 2, to: penalty ? 0 : 1 } });

    const nextOwner = await seedOwner(h.relay, '200000000000000002', 'next');
    expect((await adopt(h, nextOwner.id, agent.token)).status).toBe(200);
    await grantAdoptionXp(h.relay, agent.id);
    expect(await standing(h, agent.id)).toEqual({ xp: penalty ? 2250 : 2750, level: 3, adoption_xp: 2250 });
  });
});
