import type { ConsentStatus, PersonRemoval } from '@logitland/contracts';
import { describe, expect, it, vi } from 'vitest';
import { scrubPerson } from './services/scrub';
import { GUILD, LOUNGE, harness, seedChannel, seedOwner, type Harness } from './testing';

// scrubPerson (B1) was a stub while this was written; the stand-in keeps its contract.
vi.mock('./services/scrub', () => ({
  scrubMessage: vi.fn(),
  scrubPerson: vi.fn(async (relay: import('./context').Relay, discordUserId: string) => {
    const r = await relay.db
      .prepare("UPDATE conversation SET content = NULL, deleted_at = ?, removed_by = 'author' WHERE discord_user_id = ? AND deleted_at IS NULL")
      .bind(relay.now().toISOString(), discordUserId)
      .run();
    return { messages: r.meta.changes };
  }),
}));

const PERSON = '700000000000000001';
const ROLE = '500000000000000001';

async function setup() {
  const h = harness();
  await seedChannel(h.relay, { publicMirror: true });
  const me = await seedOwner(h.relay, PERSON, 'pat');
  const other = await seedOwner(h.relay, '700000000000000002', 'sam');
  const as = (owner: { id: string }) => ({ 'x-logitland-owner': owner.id });
  return { h, me, other, as };
}

async function agreed(h: Harness, person = PERSON) {
  await h.db
    .prepare("INSERT INTO consents (discord_user_id, guild_id, method, granted_at) VALUES (?, ?, 'command', '2026-10-19T02:00:00.000Z')")
    .bind(person, GUILD)
    .run();
}

async function said(h: Harness, id: string, person = PERSON) {
  await h.db
    .prepare(
      "INSERT INTO conversation (message_id, channel_id, author_kind, author_ref, discord_user_id, display_name, content, created_at) VALUES (?, ?, 'human', 'p_x', ?, 'Pat', 'hello', ?)",
    )
    .bind(id, LOUNGE, person, h.now().toISOString())
    .run();
}

const audits = async (h: Harness) =>
  (
    await h.db
      .prepare("SELECT actor_type, actor_id, action, target_id FROM audit_log WHERE target_type = 'person' ORDER BY rowid")
      .all<{ actor_type: string; actor_id: string; action: string; target_id: string }>()
  ).results;

describe('GET /internal/people/:discordUserId', () => {
  it('shows a person’s own agreement and how many of their messages are mirrored', async () => {
    const { h, me, as } = await setup();
    const none = await h.internal('GET', `/internal/people/${PERSON}`, undefined, as(me));
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ agreed: false, method: null, granted_at: null, revoked_at: null, mirrored_messages: 0 });

    await agreed(h);
    await said(h, '310000000000000001');
    await said(h, '310000000000000002');
    await said(h, '310000000000000003', '700000000000000002');
    const res = await h.internal('GET', `/internal/people/${PERSON}`, undefined, as(me));
    expect((await res.json()) as ConsentStatus).toEqual({
      agreed: true,
      method: 'command',
      granted_at: '2026-10-19T02:00:00.000Z',
      revoked_at: null,
      mirrored_messages: 2,
    });
  });

  it('refuses someone else’s record, an unknown owner and a missing sign-in', async () => {
    const { h, me, other, as } = await setup();
    expect((await h.internal('GET', `/internal/people/${PERSON}`, undefined, as(other))).status).toBe(403);
    expect((await h.internal('GET', `/internal/people/${other.discord_user_id}`, undefined, as(me))).status).toBe(403);
    expect((await h.internal('GET', `/internal/people/${PERSON}`, undefined, { 'x-logitland-owner': 'own_0000000000' })).status).toBe(403);
    expect((await h.internal('GET', `/internal/people/${PERSON}`)).status).toBe(401);
    expect((await h.internal('GET', `/internal/people/${PERSON}`, undefined, { ...as(me), 'x-logitland-internal': 'wrong' })).status).toBe(401);
  });

  it('is not on the public app', async () => {
    const { h } = await setup();
    expect((await h.call('GET', `/internal/people/${PERSON}`)).status).toBe(404);
  });
});

describe('POST /internal/people/:discordUserId/removal', () => {
  it('leave: revokes the agreement, takes the role away, scrubs the messages and audits it', async () => {
    const { h, me, as } = await setup();
    await agreed(h);
    await said(h, '310000000000000001');
    await said(h, '310000000000000002');
    vi.mocked(scrubPerson).mockClear();

    const res = await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'leave' }, as(me));
    expect(res.status).toBe(200);
    const out = (await res.json()) as PersonRemoval;
    expect(out).toMatchObject({ mode: 'leave', removed_messages: 2, role_removed: true, consent: { agreed: false, method: 'command', mirrored_messages: 0 } });
    expect(out.consent.revoked_at).toBe(h.now().toISOString());
    expect(vi.mocked(scrubPerson)).toHaveBeenCalledWith(h.relay, PERSON);
    expect(h.discordCalls.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([`DELETE /api/v10/guilds/${GUILD}/members/${PERSON}/roles/${ROLE}`]);
    expect(await audits(h)).toEqual([
      { actor_type: 'owner', actor_id: me.id, action: 'consent.revoked', target_id: PERSON },
      { actor_type: 'owner', actor_id: me.id, action: 'person.messages_removed', target_id: PERSON },
    ]);
  });

  it('remove_messages: scrubs but keeps the agreement and the role', async () => {
    const { h, me, as } = await setup();
    await agreed(h);
    await said(h, '310000000000000001');
    const res = await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'remove_messages' }, as(me));
    const out = (await res.json()) as PersonRemoval;
    expect(out).toMatchObject({
      mode: 'remove_messages',
      removed_messages: 1,
      role_removed: null,
      consent: { agreed: true, revoked_at: null, mirrored_messages: 0 },
    });
    expect(h.discordCalls).toHaveLength(0);
    expect((await audits(h)).map((a) => a.action)).toEqual(['person.messages_removed']);
  });

  it('reports when Discord won’t take the role away, but still revokes and scrubs', async () => {
    const { h, me, as } = await setup();
    await agreed(h);
    await said(h, '310000000000000001');
    h.setDiscord(async () => Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 }));
    const out = (await (await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'leave' }, as(me))).json()) as PersonRemoval;
    expect(out).toMatchObject({ removed_messages: 1, role_removed: false, consent: { agreed: false } });
  });

  it('counts a role that is already gone (or a member who left the server) as removed', async () => {
    const { h, me, as } = await setup();
    await agreed(h);
    h.setDiscord(async () => Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 }));
    const out = (await (await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'leave' }, as(me))).json()) as PersonRemoval;
    expect(out.role_removed).toBe(true);
  });

  it('can be repeated: nothing more to remove, nothing more to audit', async () => {
    const { h, me, as } = await setup();
    await agreed(h);
    await said(h, '310000000000000001');
    await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'leave' }, as(me));
    const again = (await (await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'leave' }, as(me))).json()) as PersonRemoval;
    expect(again).toMatchObject({ removed_messages: 0, consent: { agreed: false } });
    expect(await audits(h)).toHaveLength(2);
  });

  it('refuses another person’s removal, and does nothing', async () => {
    const { h, me, other, as } = await setup();
    await agreed(h);
    await said(h, '310000000000000001');
    vi.mocked(scrubPerson).mockClear();
    const res = await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'leave' }, as(other));
    expect(res.status).toBe(403);
    expect(vi.mocked(scrubPerson)).not.toHaveBeenCalled();
    expect(h.discordCalls).toHaveLength(0);
    expect(
      (await h.db.prepare('SELECT revoked_at FROM consents WHERE discord_user_id = ?').bind(PERSON).first<{ revoked_at: string | null }>())!.revoked_at,
    ).toBeNull();
    expect((await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'leave' })).status).toBe(401);
    void me;
  });

  it('rejects an unknown mode or no body', async () => {
    const { h, me, as } = await setup();
    expect((await h.internal('POST', `/internal/people/${PERSON}/removal`, { mode: 'everything' }, as(me))).status).toBe(400);
    expect((await h.internal('POST', `/internal/people/${PERSON}/removal`, {}, as(me))).status).toBe(400);
    expect((await h.internal('POST', `/internal/people/${PERSON}/removal`, undefined, as(me))).status).toBe(400);
  });
});
