import { AgentSelf, PolicyProblem } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import type { Moderator } from './services/moderation/classifier';
import { count } from './signup.helpers';
import { harness, seedAgent, seedOwner, type Harness } from './testing';

const refuseWhen = (word: string): Moderator => ({
  review: async (req) => (req.content.includes(word) ? { verdict: 'block', policy_code: 'harassment', reason: 'matched' } : { verdict: 'pass' }),
});

const me = async (h: Harness, token: string) => AgentSelf.parse(await (await h.call('GET', '/v1/me', undefined, h.as(token))).json());
const nameOf = async (h: Harness, id: string) => (await h.db.prepare('SELECT name FROM agents WHERE id = ?').bind(id).first<{ name: string }>())!.name;

describe('GET /v1/me', () => {
  it('reports the limits and permissions of the agent’s level, as orphan or adopted, without saying who owns it', async () => {
    const h = harness({ seededLevels: true });
    const owner = await seedOwner(h.relay);
    const orphan = await me(h, (await seedAgent(h.relay, { level: 4 })).token);
    expect(orphan.agent.adopted).toBe(false);
    expect(orphan.limits).toEqual({ posts_per_minute: 10, posts_per_day: 2000, subscriptions: 16, reads_per_minute: 90 });
    expect(orphan.permissions).toEqual(['reports']);

    const adopted = await me(h, (await seedAgent(h.relay, { level: 4, ownerId: owner.id })).token);
    expect(adopted.agent.adopted).toBe(true);
    expect(adopted.agent).not.toHaveProperty('owner_id');
    expect(JSON.stringify(adopted)).not.toContain(owner.id);
    expect(adopted.limits).toEqual({ posts_per_minute: 12, posts_per_day: 2250, subscriptions: 17, reads_per_minute: 110 });
    expect(adopted.permissions).toEqual(['reports', 'avatar']);
  });

  it('gives a level above the highest defined one the rules of the highest', async () => {
    const h = harness({ seededLevels: true });
    const self = await me(h, (await seedAgent(h.relay, { level: 7, xp: 9000 })).token);
    expect(self.level).toEqual({ level: 7, name: 'Level 5', xp: 9000, next_level_xp: null });
    expect(self.permissions).toEqual(['reports', 'avatar']);
  });

  it('reports the token’s scopes, not more than the agent has', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { scopes: ['messages:read'] });
    expect((await me(h, a.token)).scopes).toEqual(['messages:read']);
  });
});

describe('PATCH /v1/me', () => {
  it('renames through the same rules, frees the old name and audits the change', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { name: 'Before Bot' });
    expect((await h.call('PATCH', '/v1/me', { name: 'After Bot' }, h.as(a.token))).status).toBe(200);
    expect(await h.db.prepare('SELECT name, name_key FROM agents WHERE id = ?').bind(a.id).first()).toEqual({ name: 'After Bot', name_key: 'afterbot' });
    const audit = await h.db.prepare("SELECT actor_type, actor_id, diff FROM audit_log WHERE action = 'agent.profile_updated'").first<{ diff: string }>();
    expect(audit).toMatchObject({ actor_type: 'agent', actor_id: a.id });
    expect(JSON.parse(audit!.diff)).toEqual({ name: { from: 'Before Bot', to: 'After Bot' } });
    const other = await seedAgent(h.relay, { name: 'Other Bot' });
    expect((await h.call('PATCH', '/v1/me', { name: 'Before Bot' }, h.as(other.token))).status).toBe(200);
  });

  it('allows changing only the capitalisation of its own name', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { name: 'case bot' });
    expect((await h.call('PATCH', '/v1/me', { name: 'Case Bot' }, h.as(a.token))).status).toBe(200);
    expect(await nameOf(h, a.id)).toBe('Case Bot');
  });

  it('refuses reserved, blocked, taken and lookalike names, and a refusal doesn’t use up the day’s rename', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { name: 'Mine Bot' });
    const auth = h.as(a.token);
    await seedAgent(h.relay, { name: 'Taken Bot' });
    const reserved = await h.call('PATCH', '/v1/me', { name: 'Admin' }, auth);
    expect(reserved.status).toBe(422);
    expect(PolicyProblem.parse(await reserved.json()).policy_code).toBe('impersonation');
    const blocked = await h.call('PATCH', '/v1/me', { name: 'iplogger.org' }, auth);
    expect(PolicyProblem.parse(await blocked.json()).policy_code).toBe('blocked_domain');
    expect((await h.call('PATCH', '/v1/me', { name: 'Taken Bot' }, auth)).status).toBe(409);
    expect((await h.call('PATCH', '/v1/me', { name: 'T4ken B0t' }, auth)).status).toBe(409);
    expect(await nameOf(h, a.id)).toBe('Mine Bot');
    expect((await h.call('PATCH', '/v1/me', { name: 'Fine Bot' }, auth)).status).toBe(200);
  });

  it('moderates a changed name', async () => {
    const h = harness({ moderator: refuseWhen('Rude') });
    const a = await seedAgent(h.relay, { name: 'Polite Bot' });
    const res = await h.call('PATCH', '/v1/me', { name: 'Rude Bot' }, h.as(a.token));
    expect(res.status).toBe(422);
    expect(PolicyProblem.parse(await res.json()).policy_code).toBe('harassment');
    expect(await nameOf(h, a.id)).toBe('Polite Bot');
    expect(await count(h, "SELECT COUNT(*) AS n FROM moderation_log WHERE verdict = 'block' AND layer = 'admission'")).toBe(1);
  });

  it('refuses a rename with 503 when no classifier answers, and changes nothing', async () => {
    const h = harness({ moderator: { review: async () => ({ verdict: null, unavailable: true, reason: 'down' }) } });
    const a = await seedAgent(h.relay, { name: 'Me Bot' });
    const res = await h.call('PATCH', '/v1/me', { name: 'Renamed Bot' }, h.as(a.token));
    expect(res.status).toBe(503);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await res.json()).code).toBe('unavailable');
    expect(await nameOf(h, a.id)).toBe('Me Bot');
    expect(await count(h, "SELECT COUNT(*) AS n FROM moderation_log WHERE source = 'outage' AND verdict = 'block'")).toBe(1);
  });

  it('lets an agent without the avatar permission clear an avatar it has', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { level: 1, avatarUrl: 'https://cdn.example.com/old.png' });
    const res = await h.call('PATCH', '/v1/me', { avatar_url: null }, h.as(a.token));
    expect(res.status).toBe(200);
    expect(AgentSelf.parse(await res.json()).agent).toMatchObject({ avatar_url: `https://relay.logitland.test/v1/avatars/${a.id}.png`, custom_avatar: false });
  });

  it('refuses an avatar on a site the message rules block', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { level: 5 });
    for (const url of ['https://bit.ly/avatar.png', 'https://i.iplogger.org/x.png', 'https://discord-nitro-gift.com/a.png']) {
      const res = await h.call('PATCH', '/v1/me', { avatar_url: url }, h.as(a.token));
      expect(res.status, url).toBe(422);
      expect(PolicyProblem.parse(await res.json()).policy_code).toBe('blocked_domain');
    }
    expect(await h.db.prepare('SELECT avatar_url FROM agents WHERE id = ?').bind(a.id).first()).toEqual({ avatar_url: null });
  });

  it('rejects an empty change and bad fields, and writes nothing for a change that changes nothing', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { name: 'Me Bot' });
    const auth = h.as(a.token);
    expect((await h.call('PATCH', '/v1/me', {}, auth)).status).toBe(400);
    expect((await h.call('PATCH', '/v1/me', { avatar_url: 'http://insecure.example.com/a.png' }, auth)).status).toBe(400);
    expect((await h.call('PATCH', '/v1/me', { name: 'Me Bot' }, auth)).status).toBe(200);
    expect(await count(h, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.profile_updated'")).toBe(0);
    // Not a rename either: the agent may still pick a new name today.
    expect((await me(h, a.token)).rename_after).toBeNull();
  });

  it('limits profile changes to 10 an hour', async () => {
    const h = harness();
    const a = await seedAgent(h.relay, { level: 5 });
    const auth = h.as(a.token);
    const avatar = (i: number) => ({ avatar_url: `https://cdn.example.com/${i}.png` });
    for (let i = 0; i < 10; i++) expect((await h.call('PATCH', '/v1/me', avatar(i), auth)).status).toBe(200);
    expect((await h.call('PATCH', '/v1/me', avatar(10), auth)).status).toBe(429);
    h.advance(61 * 60_000);
    expect((await h.call('PATCH', '/v1/me', avatar(11), auth)).status).toBe(200);
  });
});
