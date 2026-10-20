import { describe, expect, it, vi } from 'vitest';
import { getSettings, updateSettings } from './services/settings';
import { processSend, sweepStuckJob } from './services/sending';
import { release } from './services/moderation/admin';
import { reviewHeldJob } from './services/review';
import { STUCK_AFTER_MS } from './services/moderation/policy';
import { down, json, mod, post, row, say, world } from './posting-fixtures';
import { ADMIN_DISCORD, seedAgent, seedOwner } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

/** A world where the channel's sender only remembers what it was handed, so a message stays `queued` until the test sends it. */
async function queued(opts: Parameters<typeof world>[0] = {}) {
  const handed: string[] = [];
  const w = await world({ sender: { enqueue: async (_c, id) => void handed.push(id) }, ...opts });
  const admin = await seedOwner(w.h.relay, ADMIN_DISCORD, 'admin');
  const send = async (who: { key: string } = w.a, text = 'waiting its turn') => {
    const res = await post(w.h, who, say(text));
    expect(res.status).toBe(202);
    return (await json(res)).id as string;
  };
  return { ...w, handed, admin, send };
}

const posted = (h: { discordCalls: Request[] }) => h.discordCalls.filter((c) => c.method === 'POST').length;

describe('kill switches reach messages that were already accepted', () => {
  it('keeps a queued message queued while the relay is read-only, says why, and sends it once posting is back', async () => {
    const { h, admin, send } = await queued();
    const id = await send();
    await updateSettings(h.relay, admin.id, { relay_read_only: true });

    expect(await processSend(h.relay, id)).toEqual({});
    expect(posted(h)).toBe(0);
    expect(await row(h, id)).toMatchObject({ status: 'queued', discord_message_id: null });
    expect((await row(h, id))!.status_reason).toMatch(/read-only/);
    expect(h.log.lines.some((l) => l.event === 'send.held_back' && l.fields.why === 'read_only')).toBe(true);

    await updateSettings(h.relay, admin.id, { relay_read_only: false });
    expect(await processSend(h.relay, id)).toEqual({});
    expect(await row(h, id)).toMatchObject({ status: 'sent', status_reason: null });
    expect(posted(h)).toBe(1);
  });

  it('holds back the messages of a paused agent only, until the pause ends', async () => {
    const { h, a, send } = await queued();
    const other = await seedAgent(h.relay, { tier: 'trusted' });
    const mine = await send(a, 'from the paused one');
    const theirs = await send(other, 'from another agent');
    await h.db
      .prepare('UPDATE agents SET posting_paused_until = ? WHERE id = ?')
      .bind(new Date(h.now().getTime() + 3_600_000).toISOString(), a.id)
      .run();

    await processSend(h.relay, mine);
    await processSend(h.relay, theirs);
    expect((await row(h, mine))!.status).toBe('queued');
    expect((await row(h, mine))!.status_reason).toMatch(/paused/);
    expect((await row(h, theirs))!.status).toBe('sent');

    h.advance(3_600_001);
    await processSend(h.relay, mine);
    expect((await row(h, mine))!.status).toBe('sent');
  });

  it('holds back an agent on probation, claimed or not, when posting is off for them, but not a trusted one', async () => {
    const { h, a, admin, send } = await queued();
    const trusted = await seedAgent(h.relay, { tier: 'trusted' });
    const first = await send(a, 'claimed but still on probation');
    const second = await send(trusted, 'trusted');
    await updateSettings(h.relay, admin.id, { new_agent_posting: false });

    await processSend(h.relay, first);
    await processSend(h.relay, second);
    expect((await row(h, first))!.status).toBe('queued');
    expect((await row(h, first))!.status_reason).toMatch(/probation/);
    expect((await row(h, second))!.status).toBe('sent');
  });

  it('is offered again by the stuck-message sweep, spaced out by the time the row was last touched', async () => {
    const { h, admin, send, handed } = await queued();
    const id = await send();
    await updateSettings(h.relay, admin.id, { relay_read_only: true });
    await processSend(h.relay, id);
    handed.length = 0;

    h.advance(STUCK_AFTER_MS - 1000);
    await sweepStuckJob(h.relay);
    expect(handed).toEqual([]);

    h.advance(2000);
    await sweepStuckJob(h.relay);
    expect(handed).toEqual([id]);
  });

  it('applies to an admin release and a recheck after an outage', async () => {
    const down1 = mod(down);
    const { h, admin, a, handed } = await queued({ moderator: down1 });
    // An outage hold, re-checked by the job once the classifier is back.
    const outage = (await json(await post(h, a, say('held by an outage')))).id as string;
    expect((await row(h, outage))!.status).toBe('held');
    // A review hold, released by an admin.
    const review = (await json(await post(h, a, say('write to me@example.com about it')))).id as string;
    await updateSettings(h.relay, admin.id, { relay_read_only: true });
    handed.length = 0;
    h.relay.moderator = mod({ verdict: 'pass' });
    // With a sender these hand the message over; the sender's processSend then holds it back. Run that step here.
    h.advance(70_000);
    await reviewHeldJob(h.relay);
    await release(h.relay, admin.id, review);
    expect(handed.sort()).toEqual([outage, review].sort());
    for (const id of handed) await processSend(h.relay, id);
    for (const id of [outage, review]) expect(await row(h, id), id).toMatchObject({ status: 'queued', discord_message_id: null });
    expect(posted(h)).toBe(0);
  });
});

describe('processSend reads first and claims last', () => {
  it('leaves a never-sent message queued when a read fails before Discord is called', async () => {
    const { h, send } = await queued();
    const id = await send();
    const real = h.relay.db;
    let failures = 1;
    h.relay.db = {
      prepare: (sql) => {
        if (failures > 0 && sql.includes('FROM agents WHERE id')) {
          failures--;
          throw new Error('D1 hiccup');
        }
        return real.prepare(sql);
      },
      batch: (s) => real.batch(s),
    };
    await expect(processSend(h.relay, id)).rejects.toThrow('D1 hiccup');
    expect(await row(h, id)).toMatchObject({ status: 'queued' });
    expect(posted(h)).toBe(0);

    expect(await processSend(h.relay, id)).toEqual({});
    expect(await row(h, id)).toMatchObject({ status: 'sent' });
    expect(posted(h)).toBe(1);
  });

  it('fails a message whose agent was switched off, from the queue', async () => {
    const { h, a, send } = await queued();
    const id = await send();
    await h.db.prepare("UPDATE agents SET status = 'suspended' WHERE id = ?").bind(a.id).run();
    await processSend(h.relay, id);
    expect(await row(h, id)).toMatchObject({ status: 'failed' });
    expect((await row(h, id))!.status_reason).toMatch(/switched off or suspended/);
    expect(posted(h)).toBe(0);
  });
});

describe('settings are read key by key', () => {
  it('lets one bad stored value fall back alone and leaves the kill switches as stored', async () => {
    const { h } = await queued();
    const put = (key: string, value: string) =>
      h.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').bind(key, value, h.now().toISOString()).run();
    await put('relay_read_only', 'true');
    await put('pow_difficulty', '"hard"');
    await put('probation_posts', '999999');
    await put('unknown_key', 'true');
    const s = await getSettings(h.relay);
    expect(s.relay_read_only).toBe(true);
    expect(s.pow_difficulty).toBe(20);
    expect(s.probation_posts).toBe(20);
    expect(s).not.toHaveProperty('unknown_key');
  });

  it('has a deliveries_paused switch, off by default, that an admin can flip and that is audited', async () => {
    const { h, admin } = await queued();
    expect((await getSettings(h.relay)).deliveries_paused).toBe(false);
    const res = await h.internal('PATCH', '/internal/admin/settings', { deliveries_paused: true }, { 'x-logitland-owner': admin.id });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ deliveries_paused: true, relay_read_only: false });
    expect((await getSettings(h.relay)).deliveries_paused).toBe(true);
    const audit = await h.db.prepare("SELECT diff FROM audit_log WHERE action = 'settings.updated'").first<{ diff: string }>();
    expect(JSON.parse(audit!.diff)).toEqual({ deliveries_paused: { from: false, to: true } });
  });
});
