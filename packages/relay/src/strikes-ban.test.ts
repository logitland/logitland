import { describe, expect, it } from 'vitest';
import { addStrike } from './services/strikes';
import { count, easyChallenges, ipHeader, seedDelivery, signUp, signedUp } from './signup.helpers';
import { harness, type Harness } from './testing';

const strike = (h: Harness, agentId: string, i: number) =>
  addStrike(h.relay, { agentId, policy: 'hate', reason: `r${i}`, createdBy: 'system', actor: { type: 'system', id: 'moderation' } });

async function setup() {
  const h = harness();
  await easyChallenges(h);
  const bad = await signedUp(h, 'Bad Actor', { headers: ipHeader('203.0.113.7') });
  await seedDelivery(h, bad.registration_id, 'pending');
  return { h, bad };
}

describe('the strike ladder', () => {
  it('drops waiting deliveries at the fourth strike (suspension), keeping the subscriptions', async () => {
    const { h, bad } = await setup();
    for (let i = 0; i < 4; i++) await strike(h, bad.registration_id, i);
    expect((await h.db.prepare('SELECT status FROM agents WHERE id = ?').bind(bad.registration_id).first<{ status: string }>())!.status).toBe('suspended');
    expect(await count(h, "SELECT COUNT(*) AS n FROM deliveries WHERE status = 'pending'")).toBe(0);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM subscriptions WHERE agent_id = ?', bad.registration_id)).toBe(1);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM banned_origins')).toBe(0);
  });

  it('bars the addresses of an agent it bans at the fifth strike, so the same address cannot sign up again', async () => {
    const { h, bad } = await setup();
    let last;
    for (let i = 0; i < 5; i++) last = await strike(h, bad.registration_id, i);
    expect(last!.effect).toBe('banned');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM banned_origins')).toBeGreaterThan(0);
    expect(await count(h, "SELECT COUNT(*) AS n FROM deliveries WHERE status = 'pending'")).toBe(0);
    expect((await signUp(h, 'Back Again', { headers: ipHeader('203.0.113.7') })).status).toBe(403);
  });
});
