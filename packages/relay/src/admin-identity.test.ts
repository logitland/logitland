import { AdminStanding } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { GUILD, application, harness, seedOwner } from './testing';

// Human admins (#13): the bot's Developer team are full admins; server roles that full admins map grant narrower powers.

const TEAM_MEMBER = '200000000000000011';
const INVITED = '200000000000000012';
const MODERATOR = '200000000000000013';
const STRANGER = '200000000000000014';
const MODS_ROLE = '500000000000000020';

/** Discord with a team (TEAM_MEMBER accepted, INVITED not yet) and server members holding these roles. Nothing is cached yet. */
async function scripted(members: Record<string, string[]> = {}) {
  const h = harness();
  await h.db.prepare('DELETE FROM discord_lookups').run();
  await h.db
    .prepare("INSERT INTO guild_roles (id, guild_id, name, permissions, position, updated_at) VALUES (?, ?, 'mods', '0', 3, ?)")
    .bind(MODS_ROLE, GUILD, h.now().toISOString())
    .run();
  const team = application([TEAM_MEMBER, INVITED]);
  team.team.members[1]!.membership_state = 1;
  h.setDiscord((req) => {
    const path = new URL(req.url).pathname;
    if (path.endsWith('/applications/@me')) return Response.json(team);
    const member = /\/guilds\/\d+\/members\/(\d+)$/.exec(path)?.[1];
    if (member && members[member]) return Response.json({ user: { id: member, username: 'someone' }, roles: members[member] });
    return Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 });
  });
  const person = async (discordUserId: string) => {
    const owner = await seedOwner(h.relay, discordUserId, `p${discordUserId.slice(-2)}`);
    const as = { 'x-logitland-owner': owner.id };
    return {
      standing: async () => AdminStanding.parse(await (await h.internal('GET', `/internal/owners/${owner.id}/admin`, undefined, as)).json()),
      call: (method: string, path: string, body?: unknown) => h.internal(method, path, body, as),
    };
  };
  return { h, person };
}

type Person = Awaited<ReturnType<Awaited<ReturnType<typeof scripted>>['person']>>;
const mapRole = (as: Person, permissions: string[]) => as.call('PUT', `/internal/admin/roles/${MODS_ROLE}`, { permissions });

describe('human admins', () => {
  it('makes the accepted members of the bot’s Developer team full admins', async () => {
    const { person } = await scripted();
    const lead = await person(TEAM_MEMBER);
    expect(await lead.standing()).toEqual({ full: true, permissions: ['moderate', 'agents', 'levels', 'operate', 'logan'] });
    expect((await lead.call('GET', '/internal/admin/roles')).status).toBe(200);
    expect(await (await person(INVITED)).standing()).toEqual({ full: false, permissions: [] });
  });

  it('lets a mapped server role grant one permission and refuses the others', async () => {
    const { h, person } = await scripted({ [MODERATOR]: [MODS_ROLE] });
    const lead = await person(TEAM_MEMBER);
    const mod = await person(MODERATOR);
    expect((await mapRole(lead, ['moderate'])).status).toBe(200);

    expect(await mod.standing()).toEqual({ full: false, permissions: ['moderate'] });
    expect((await mod.call('GET', '/internal/admin/moderation/queue')).status).toBe(200);
    expect((await mod.call('GET', '/internal/admin/health')).status).toBe(403);
    expect((await mod.call('PUT', '/internal/admin/levels/3', {})).status).toBe(403);
    // Only full admins change who holds what.
    expect((await mapRole(mod, ['moderate', 'operate'])).status).toBe(403);

    const { results } = await h.db.prepare("SELECT target_id FROM audit_log WHERE action = 'admin_role.updated'").all();
    expect(results).toEqual([{ target_id: MODS_ROLE }]);
  });

  it('lists the Developer team with names to full admins, and the server’s roles to every admin', async () => {
    const { h, person } = await scripted({ [MODERATOR]: [MODS_ROLE] });
    const lead = await person(TEAM_MEMBER);
    const res = await lead.call('GET', '/internal/admin/team');
    expect(res.status).toBe(200);
    const owner = await h.db.prepare('SELECT id FROM owners WHERE discord_user_id = ?').bind(TEAM_MEMBER).first<{ id: string }>();
    // The invited member hasn't accepted, so isn't on the team.
    expect(((await res.json()) as { members: unknown[] }).members).toEqual([
      { discord_user_id: TEAM_MEMBER, username: 'dev-0011', name: 'dev-0011', owner_id: owner!.id },
    ]);

    await mapRole(lead, ['moderate']);
    const mod = await person(MODERATOR);
    expect((await mod.call('GET', '/internal/admin/team')).status).toBe(403);
    expect((await mod.call('GET', '/internal/admin/roles')).status).toBe(200);
  });

  it('refuses someone with no admin standing', async () => {
    const { person } = await scripted();
    const stranger = await person(STRANGER);
    expect(await stranger.standing()).toEqual({ full: false, permissions: [] });
    const res = await stranger.call('GET', '/internal/admin/agents');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ detail: 'This person isn’t a relay admin' });
  });

  it('keeps the last answer while Discord is down, and asks to try again when it has none', async () => {
    const { h, person } = await scripted();
    const lead = await person(TEAM_MEMBER);
    expect((await lead.call('GET', '/internal/admin/agents')).status).toBe(200);
    h.setDiscord(() => Response.json({ message: 'Service Unavailable' }, { status: 503 }));
    h.advance(3_600_000);
    expect((await lead.call('GET', '/internal/admin/agents')).status).toBe(200);
    await h.db.prepare('DELETE FROM discord_lookups').run();
    const res = await lead.call('GET', '/internal/admin/agents');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});
