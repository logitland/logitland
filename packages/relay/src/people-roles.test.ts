import { AdoptionToken } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { grantConsent, revokeConsent } from './services/consent';
import { updateSettings } from './services/settings';
import { asOwner } from './signup.helpers';
import { GUILD, harness, seedAgent, seedOwner } from './testing';

// The parents and consent roles in Discord change with what they stand for: adopting and losing the last agent, agreeing and
// withdrawing through /consent.

const PARENTS = '130000000000000001';
const CONSENT = '130000000000000002';
const OWNER = '200000000000000001';
const PERSON = '200000000000000011';
const actor = { type: 'public', id: PERSON } as const;

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
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, actor });
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, actor });
    await revokeConsent(h.relay, PERSON, actor);
    expect(calls).toEqual([`PUT ${PERSON} ${CONSENT}`, `DELETE ${PERSON} ${CONSENT}`]);
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
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, actor });
    expect(calls).toEqual([]);
    await updateSettings(h.relay, 'own_admin', { consent_role_id: CONSENT });
    h.setDiscord(() => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }));
    expect(await revokeConsent(h.relay, PERSON, actor)).toBe(true);
  });
});
