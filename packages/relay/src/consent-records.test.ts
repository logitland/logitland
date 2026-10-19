import { describe, expect, it } from 'vitest';
import { CONSENT_NOTICE_VERSION, consentNotice, grantConsent, revokeConsent, syncRole } from './services/consent';
import { GUILD, harness, seedOwner } from './testing';

// The consents row says which notice a person saw and when; consent_history keeps every grant and revocation.
// Both are written in the same batch as the audit entry, and a repeat or a lost race writes none of them.

const PERSON = '700000000000000001';
const ROLE = '500000000000000001';
const actor = { type: 'public' as const, id: PERSON };

const rows = async (h: ReturnType<typeof harness>) => ({
  consent: await h.db.prepare('SELECT * FROM consents').all<Record<string, unknown>>(),
  history: await h.db
    .prepare('SELECT discord_user_id, guild_id, action, method, notice_version, interaction_id, at FROM consent_history ORDER BY id')
    .all<Record<string, unknown>>(),
  audit: await h.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'consent.%' ORDER BY rowid").all<{ action: string }>(),
});

describe('granting consent', () => {
  it('stores the notice version and the interaction, appends the history and audits it, in one batch', async () => {
    const h = harness();
    const batches: number[] = [];
    const batch = h.db.batch.bind(h.db);
    h.db.batch = async (stmts) => {
      batches.push(stmts.length);
      return batch(stmts);
    };
    const r = await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'button', actor, interactionId: '800000000000000009' });
    expect(r).toEqual({ changed: true });
    expect(batches).toEqual([3]);
    const now = h.now().toISOString();
    const { consent, history, audit } = await rows(h);
    expect(consent.results).toEqual([
      {
        discord_user_id: PERSON,
        guild_id: GUILD,
        method: 'button',
        notice_version: CONSENT_NOTICE_VERSION,
        interaction_id: '800000000000000009',
        granted_at: now,
        revoked_at: null,
      },
    ]);
    expect(history.results).toEqual([
      {
        discord_user_id: PERSON,
        guild_id: GUILD,
        action: 'granted',
        method: 'button',
        notice_version: CONSENT_NOTICE_VERSION,
        interaction_id: '800000000000000009',
        at: now,
      },
    ]);
    expect(audit.results.map((a) => a.action)).toEqual(['consent.granted']);
    // Granting does not touch Discord: the caller gives the role once the record is safe.
    expect(h.discordCalls).toHaveLength(0);
  });

  it('writes nothing for an agreement already in force, and reports it', async () => {
    const h = harness();
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'command', actor });
    h.advance(60_000);
    expect(await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'button', actor })).toEqual({ changed: false });
    const { consent, history, audit } = await rows(h);
    expect(consent.results[0]).toMatchObject({ method: 'command', granted_at: '2026-10-19T03:00:00.000Z' });
    expect(history.results).toHaveLength(1);
    expect(audit.results).toHaveLength(1);
  });

  it('writes one record when two clicks arrive together', async () => {
    const h = harness();
    const results = await Promise.all([
      grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'button', actor }),
      grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'command', actor }),
    ]);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    const { history, audit } = await rows(h);
    expect(history.results).toHaveLength(1);
    expect(audit.results).toHaveLength(1);
  });

  it('starts over after a revocation: a new time, the current notice, and every step kept', async () => {
    const h = harness();
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'command', actor, interactionId: '800000000000000001' });
    h.advance(60_000);
    expect(await revokeConsent(h.relay, PERSON, actor, { interactionId: '800000000000000002' })).toBe(true);
    h.advance(60_000);
    expect(await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'button', actor, interactionId: '800000000000000003' })).toEqual({
      changed: true,
    });
    const { consent, history, audit } = await rows(h);
    expect(consent.results).toHaveLength(1);
    expect(consent.results[0]).toMatchObject({
      method: 'button',
      granted_at: '2026-10-19T03:02:00.000Z',
      revoked_at: null,
      interaction_id: '800000000000000003',
    });
    expect(history.results.map((r) => [r.action, r.method, r.interaction_id, r.at])).toEqual([
      ['granted', 'command', '800000000000000001', '2026-10-19T03:00:00.000Z'],
      ['revoked', 'command', '800000000000000002', '2026-10-19T03:01:00.000Z'],
      ['granted', 'button', '800000000000000003', '2026-10-19T03:02:00.000Z'],
    ]);
    expect(audit.results.map((a) => a.action)).toEqual(['consent.granted', 'consent.revoked', 'consent.granted']);
  });
});

describe('revoking consent', () => {
  it('appends the history with how the person left, under the notice they had agreed to', async () => {
    const h = harness();
    const owner = await seedOwner(h.relay, PERSON, 'pat');
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'command', actor });
    expect(await revokeConsent(h.relay, PERSON, { type: 'owner', id: owner.id })).toBe(true);
    const { history } = await rows(h);
    expect(history.results[1]).toEqual({
      discord_user_id: PERSON,
      guild_id: GUILD,
      action: 'revoked',
      method: 'dashboard',
      notice_version: CONSENT_NOTICE_VERSION,
      interaction_id: null,
      at: h.now().toISOString(),
    });
  });

  it('writes nothing when there is no agreement in force', async () => {
    const h = harness();
    expect(await revokeConsent(h.relay, PERSON, actor)).toBe(false);
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'command', actor });
    await revokeConsent(h.relay, PERSON, actor);
    expect(await revokeConsent(h.relay, PERSON, actor)).toBe(false);
    const { history, audit } = await rows(h);
    expect(history.results.map((r) => r.action)).toEqual(['granted', 'revoked']);
    expect(audit.results.map((a) => a.action)).toEqual(['consent.granted', 'consent.revoked']);
  });

  it('is not undone by retention: the history is not touched by the audit purge', async () => {
    const h = harness();
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'command', actor });
    h.advance(400 * 86_400_000);
    const { retentionJob } = await import('./services/retention');
    await retentionJob(h.relay);
    expect((await rows(h)).history.results).toHaveLength(1);
  });
});

describe('the chat role', () => {
  it('follows the agreement as it stands: granted while agreed, taken away once revoked', async () => {
    const h = harness();
    await grantConsent(h.relay, { discordUserId: PERSON, guildId: GUILD, method: 'command', actor });
    expect(await syncRole(h.relay, GUILD, PERSON)).toBe(true);
    await revokeConsent(h.relay, PERSON, actor);
    expect(await syncRole(h.relay, GUILD, PERSON)).toBe(true);
    expect(h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      `PUT /api/v10/guilds/${GUILD}/members/${PERSON}/roles/${ROLE}`,
      `DELETE /api/v10/guilds/${GUILD}/members/${PERSON}/roles/${ROLE}`,
    ]);
  });

  it('is left alone when there is no guild or role to manage, and reports Discord’s refusal', async () => {
    const h = harness();
    expect(await syncRole(h.relay, null, PERSON)).toBe(true);
    expect(h.discordCalls).toHaveLength(0);
    h.setDiscord(async () => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }));
    expect(await syncRole(h.relay, GUILD, PERSON)).toBe(false);
  });
});

describe('the notice', () => {
  it('is versioned, fits in a Discord message, and names the mirror site', () => {
    expect(CONSENT_NOTICE_VERSION).toBe('2026-10-19');
    const notice = consentNotice('https://logitland.test');
    expect(notice.length).toBeLessThan(2000);
    expect(notice).toContain('https://logitland.test/privacy');
    expect(notice).toContain('https://logitland.test/mirror');
  });
});
