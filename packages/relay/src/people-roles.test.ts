import { AdoptionToken } from '@logitland/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AGREE_BUTTON, answerFromGateway } from './services/interactions';
import { updateSettings } from './services/settings';
import { asOwner } from './signup.helpers';
import { GUILD, harness, seedAgent, seedOwner } from './testing';

// The parents and consent roles in Discord change with what they stand for: adopting and losing the last agent, agreeing and
// withdrawing through /consent.

const PARENTS = '130000000000000001';
const CONSENT = '130000000000000002';
const OWNER = '200000000000000001';
const PERSON = '200000000000000011';
const base = { id: '800000000000000001', application_id: '400000000000000001', token: 'interaction-token', guild_id: GUILD, member: { user: { id: PERSON } } };
const command = (sub: string) => ({ ...base, type: 2, data: { name: 'consent', options: [{ name: sub, type: 1 }] } });
const press = (customId: string) => ({ ...base, type: 3, data: { custom_id: customId } });

async function setup() {
  const h = harness();
  /** Member-role calls, as `PUT user role` or `DELETE user role`. */
  const calls: string[] = [];
  h.setDiscord((req) => {
    const [, user, role] = new URL(req.url).pathname.match(/\/members\/(\d+)\/roles\/(\d+)$/) ?? [];
    if (user) calls.push(`${req.method} ${user} ${role}`);
    return new Response(null, { status: 204 });
  });
  await updateSettings(h.relay, 'own_admin', { parents_role_id: PARENTS, consent_role_id: CONSENT });
  const owner = await seedOwner(h.relay, OWNER);
  const owned = (method: string, path: string) => h.internal(method, `/internal/owners/${owner.id}${path}`, undefined, asOwner(owner.id));
  /** Adopts a fresh orphan through an adoption token, as an agent would. */
  const adopt = async () => {
    const agent = await seedAgent(h.relay);
    const { token } = AdoptionToken.parse(await (await owned('POST', '/adoption-tokens')).json());
    expect((await h.call('POST', '/v1/me/adopt', { token }, h.as(agent.token))).status).toBe(200);
    return agent;
  };
  return { h, calls, owned, adopt };
}

describe('people’s roles', () => {
  it('gives the consent role on agreeing and takes it on withdrawing', async () => {
    const { h, calls } = await setup();
    await answerFromGateway(h.relay, press(AGREE_BUTTON));
    await answerFromGateway(h.relay, press(AGREE_BUTTON));
    await answerFromGateway(h.relay, command('withdraw'));
    expect(calls).toEqual([`PUT ${PERSON} ${CONSENT}`, `DELETE ${PERSON} ${CONSENT}`]);
  });

  it('answers the interaction before a slow role call finishes', async () => {
    const { h } = await setup();
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const order: string[] = [];
    h.setDiscord(async (req) => {
      if (/\/roles\//.test(req.url)) {
        await slow;
        order.push('role');
        return new Response(null, { status: 204 });
      }
      order.push('callback');
      return new Response(null, { status: 204 });
    });
    const answering = answerFromGateway(h.relay, press(AGREE_BUTTON));
    await vi.waitFor(() => expect(order).toEqual(['callback']));
    release();
    await answering;
    expect(order).toEqual(['callback', 'role']);
  });

  it('gives the parents role on adopting, and takes it only with the last agent', async () => {
    const { calls, owned, adopt } = await setup();
    const first = await adopt();
    const second = await adopt();
    expect(calls).toEqual([`PUT ${OWNER} ${PARENTS}`, `PUT ${OWNER} ${PARENTS}`]);
    calls.length = 0;
    expect((await owned('DELETE', `/agents/${first.id}`)).status).toBe(204);
    expect(calls).toEqual([`PUT ${OWNER} ${PARENTS}`]);
    calls.length = 0;
    expect((await owned('DELETE', `/agents/${second.id}`)).status).toBe(204);
    expect(calls).toEqual([`DELETE ${OWNER} ${PARENTS}`]);
  });

  it('changes nothing in Discord until admins pick the roles, and a failed call doesn’t undo the change', async () => {
    const { h, calls } = await setup();
    await updateSettings(h.relay, 'own_admin', { consent_role_id: null });
    await answerFromGateway(h.relay, press(AGREE_BUTTON));
    expect(calls).toEqual([]);
    await updateSettings(h.relay, 'own_admin', { consent_role_id: CONSENT });
    h.setDiscord(() => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }));
    await answerFromGateway(h.relay, command('withdraw'));
    const row = await h.db.prepare('SELECT revoked_at FROM consents WHERE discord_user_id = ?').bind(PERSON).first<{ revoked_at: string | null }>();
    expect(row?.revoked_at).not.toBeNull();
  });
});
