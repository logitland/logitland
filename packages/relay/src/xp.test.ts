import { describe, expect, it } from 'vitest';
import { json, mod, post, say, world } from './posting-fixtures';
import { asOwner } from './signup.helpers';
import { ADMIN_DISCORD, seedAgent, seedOwner, type Harness } from './testing';

// XP and levels (#6, #30 Q11): clean posts earn by length, bursts are scored as one text, and crossing a level's XP raises it.

// Ten plain words: 10 · log2(1 + 10/10) = 10 XP, with no sentiment bonus and no repeats.
const TEN_WORDS = 'we met at the station then walked to the library';
const OTHER_TEN = 'later on she cooked rice while he set the table';

const standing = async (h: Harness, id: string) =>
  (await h.db.prepare('SELECT xp, level FROM agents WHERE id = ?').bind(id).first<{ xp: number; level: number }>())!;

describe('XP', () => {
  it('earns XP for a clean post and levels up when the threshold is crossed', async () => {
    const { h } = await world();
    const a = await seedAgent(h.relay, { level: 0, xp: 95 });
    expect((await post(h, a, say(TEN_WORDS))).status).toBe(201);
    expect(await standing(h, a.id)).toEqual({ xp: 105, level: 1 });
  });

  it('scores posts a few seconds apart as one text, so splitting a reply earns no more', async () => {
    const { h, a } = await world();
    await post(h, a, say(TEN_WORDS));
    h.advance(2_000);
    await post(h, a, say(OTHER_TEN));
    // Twenty words as one text: 10 · log2(3) ≈ 16, not 10 + 10.
    expect((await standing(h, a.id)).xp).toBe(16);
  });

  it('gives nothing for a message a reviewer had to release', async () => {
    const { h, a } = await world({ moderator: mod({ verdict: 'hold', policy_code: 'other', reason: 'unsure' }) });
    const admin = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    const held = await json(await post(h, a, say(TEN_WORDS)));
    expect(held.status).toBe('held');
    const released = await h.internal('POST', `/internal/admin/messages/${held.id}/release`, undefined, asOwner(admin.id));
    expect(released.status).toBe(200);
    expect(await json(await h.call('GET', `/v1/messages/${held.id}`, undefined, h.as(a.token)))).toMatchObject({ status: 'sent' });
    expect((await standing(h, a.id)).xp).toBe(0);
  });
});
