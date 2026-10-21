import { describe, expect, it } from 'vitest';
import { agree } from './consent.testkit';
import { syncPeopleRolesJob } from './services/people-roles';
import { updateSettings } from './services/settings';
import { harness, seedAgent, seedOwner } from './testing';

// The parents and consent roles in Discord follow the relay: who owns an agent, and who agreed through /consent.

const PARENTS = '130000000000000001';
const CONSENT = '130000000000000002';
const OTHER = '130000000000000003';
const PARENT = '200000000000000010';
const PERSON = '200000000000000011';
const LEFT = '200000000000000012';

async function setup() {
  const h = harness();
  /** Member-role calls, as `PUT user role` or `DELETE user role`. Someone in LEFT has left the server. */
  const calls: string[] = [];
  h.setDiscord((req) => {
    const [, user, role] = new URL(req.url).pathname.match(/\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/) ?? [];
    if (!user) return new Response(null, { status: 404 });
    calls.push(`${req.method} ${user} ${role}`);
    if (user === LEFT) return Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 });
    return new Response(null, { status: 204 });
  });
  const owner = await seedOwner(h.relay, PARENT);
  const agent = await seedAgent(h.relay, { ownerId: owner.id });
  await agree(h, PERSON);
  const sync = async () => {
    calls.length = 0;
    await syncPeopleRolesJob(h.relay);
    return [...calls].sort();
  };
  return { h, owner, agent, sync };
}

describe('people’s roles', () => {
  it('gives nothing until admins pick the roles, then each role to who it is for, once', async () => {
    const { h, sync } = await setup();
    expect(await sync()).toEqual([]);
    await updateSettings(h.relay, 'own_admin', { parents_role_id: PARENTS, consent_role_id: CONSENT });
    expect(await sync()).toEqual([`PUT ${PARENT} ${PARENTS}`, `PUT ${PERSON} ${CONSENT}`]);
    expect(await sync()).toEqual([]);
  });

  it('takes a role back when it stops applying, and moves people when admins pick another role', async () => {
    const { h, agent, sync } = await setup();
    await updateSettings(h.relay, 'own_admin', { parents_role_id: PARENTS, consent_role_id: CONSENT });
    await sync();
    await h.db.prepare('UPDATE agents SET owner_id = NULL WHERE id = ?').bind(agent.id).run();
    await h.db.prepare('UPDATE consents SET revoked_at = ? WHERE discord_user_id = ?').bind(h.now().toISOString(), PERSON).run();
    await agree(h, PARENT);
    await updateSettings(h.relay, 'own_admin', { consent_role_id: OTHER });
    expect(await sync()).toEqual([`DELETE ${PARENT} ${PARENTS}`, `DELETE ${PERSON} ${CONSENT}`, `PUT ${PARENT} ${OTHER}`]);
  });

  it('tries again only after a while for someone who isn’t in the server', async () => {
    const { h, sync } = await setup();
    await agree(h, LEFT);
    await updateSettings(h.relay, 'own_admin', { consent_role_id: CONSENT });
    expect(await sync()).toContain(`PUT ${LEFT} ${CONSENT}`);
    expect(await sync()).toEqual([]);
    h.advance(7 * 3_600_000);
    expect(await sync()).toEqual([`PUT ${LEFT} ${CONSENT}`]);
  });
});
