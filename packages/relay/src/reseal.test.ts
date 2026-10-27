import { describe, expect, it } from 'vitest';
import { SecretBox } from './crypto';
import { resealJob } from './services/reseal';
import { LOUNGE, harness, seedAgent, seedChannel, type Harness } from './testing';

/** Keys the old way a rotation leaves them: the new box opens what the old key sealed. */
function rotate(h: Harness, to: string) {
  const oldId = h.relay.secrets.currentId;
  const oldKeys = (h.relay.secrets as unknown as { keys: Map<string, unknown> }).keys;
  const rotated = new SecretBox({ id: to, key: SecretBox.generateKey() });
  const keys = (rotated as unknown as { keys: Map<string, unknown> }).keys;
  for (const [id, key] of oldKeys) keys.set(id, key);
  (h.relay as { secrets: SecretBox }).secrets = rotated;
  return { oldId, rotated };
}

const webhook = (h: Harness, id: string) => h.db.prepare('SELECT webhook_ciphertext AS v FROM channels WHERE id = ?').bind(id).first<{ v: string }>();

describe('re-sealing after a key rotation', () => {
  it('moves values sealed with an old key onto the current one and leaves current values alone', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE });
    const before = (await webhook(h, LOUNGE))!.v;
    expect(await resealJob(h.relay)).toBe(0);

    const { rotated } = rotate(h, 'k2');
    expect(await resealJob(h.relay)).toBe(1);
    const after = (await webhook(h, LOUNGE))!.v;
    expect(after).not.toBe(before);
    expect(after.startsWith('v2.k2.')).toBe(true);
    expect(await rotated.open(after, `channels.webhook:${LOUNGE}`)).toContain('/api/webhooks/');
    expect(await resealJob(h.relay)).toBe(0);
  });

  it('re-seals an agent’s bot token too', async () => {
    const h = harness();
    const { id } = await seedAgent(h.relay);
    const at = h.now().toISOString();
    await h.db
      .prepare(
        "INSERT INTO agent_bots (agent_id, bot_user_id, application_id, username, token_ciphertext, status, checked_at, created_at, updated_at) VALUES (?, '500000000000000001', '500000000000000002', 'bot', ?, 'waiting', ?, ?, ?)",
      )
      .bind(id, await h.relay.secrets.seal('a-bot-token', `agent_bots.token:${id}`), at, at, at)
      .run();
    const { rotated } = rotate(h, 'k2');
    expect(await resealJob(h.relay)).toBe(1);
    const { v } = (await h.db.prepare('SELECT token_ciphertext AS v FROM agent_bots WHERE agent_id = ?').bind(id).first<{ v: string }>())!;
    expect(await rotated.open(v, `agent_bots.token:${id}`)).toBe('a-bot-token');
    expect(v.startsWith('v2.k2.')).toBe(true);
  });

  it('logs and skips a value it can no longer open', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE });
    (h.relay as { secrets: SecretBox }).secrets = new SecretBox({ id: 'k9', key: SecretBox.generateKey() });
    expect(await resealJob(h.relay)).toBe(0);
    expect(h.log.lines.some((l) => l.event === 'reseal.failed' && l.fields.table === 'channels')).toBe(true);
  });

  it('tells a key ID from another that differs only where LIKE would see a wildcard', async () => {
    const h = harness({ env: { RELAY_SECRET_KEY_ID: 'k1x' } });
    await seedChannel(h.relay, { id: LOUNGE });
    const { rotated } = rotate(h, 'k1_');
    // LIKE 'v2.k1_.%' would read the old value as current and leave it sealed with the old key.
    expect(await resealJob(h.relay)).toBe(1);
    expect((await webhook(h, LOUNGE))!.v.startsWith('v2.k1_.')).toBe(true);
    expect(await rotated.open((await webhook(h, LOUNGE))!.v, `channels.webhook:${LOUNGE}`)).toContain('/api/webhooks/');
  });

  it('is not held up by values it cannot open, however many come first', async () => {
    const h = harness();
    const stranger = new SecretBox({ id: 'zz', key: SecretBox.generateKey() });
    // 150 channels with lower IDs sealed with a key nobody listed, then one that can be moved.
    for (let i = 0; i < 150; i++) {
      const id = `11000000000010${String(i).padStart(4, '0')}`;
      await seedChannel(h.relay, { id, name: `c${i}`, webhookUrl: null });
      await h.db
        .prepare('UPDATE channels SET webhook_ciphertext = ? WHERE id = ?')
        .bind(await stranger.seal('https://discord.com/api/webhooks/1/x', `channels.webhook:${id}`), id)
        .run();
    }
    await seedChannel(h.relay, { id: '119999999999999999', name: 'good' });
    rotate(h, 'k2');
    expect(await resealJob(h.relay)).toBe(1);
    expect(h.log.lines.filter((l) => l.event === 'reseal.failed')).toHaveLength(150);
    expect(h.log.lines.some((l) => l.event === 'reseal.walked' && l.fields.table === 'channels' && l.fields.unreadable === 150)).toBe(true);
  });

  it('walks a column once for a key and then does not scan it again, until the key changes', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE });
    rotate(h, 'k2');
    expect(await resealJob(h.relay)).toBe(1);

    const sql: string[] = [];
    const real = h.relay.db;
    h.relay.db = { batch: (s) => real.batch(s), prepare: (text) => (sql.push(text), real.prepare(text)) };
    expect(await resealJob(h.relay)).toBe(0);
    h.relay.db = real;
    expect(sql.filter((q) => q.includes('FROM channels') || q.includes('FROM subscriptions') || q.includes('FROM agent_origins'))).toEqual([]);

    // A new rotation starts a new walk.
    rotate(h, 'k3');
    expect(await resealJob(h.relay)).toBe(1);
    expect((await webhook(h, LOUNGE))!.v.startsWith('v2.k3.')).toBe(true);
  });

  it('repeats a walk that met unreadable values once a day, in case the missing key was put back', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE });
    (h.relay as { secrets: SecretBox }).secrets = new SecretBox({ id: 'k9', key: SecretBox.generateKey() });
    await resealJob(h.relay);
    const walked = () => h.log.lines.filter((l) => l.event === 'reseal.walked' && l.fields.table === 'channels').length;
    expect(walked()).toBe(1);
    h.advance(3_600_000);
    await resealJob(h.relay);
    expect(walked()).toBe(1);
    h.advance(24 * 3_600_000);
    await resealJob(h.relay);
    expect(walked()).toBe(2);
  });

  it('re-seals raw IPs in id order across pages, whatever their text order', async () => {
    const h = harness();
    const agent = await seedAgent(h.relay);
    const at = h.relay.now().toISOString();
    for (let i = 0; i < 105; i++)
      await h.db
        .prepare("INSERT INTO agent_origins (agent_id, kind, ip_hmac, net_hmac, ip_sealed, ip_purge_after, seen_at) VALUES (?, 'use', 'a', 'b', ?, ?, ?)")
        .bind(agent.id, await h.relay.secrets.seal(`203.0.113.${i}`, `agent_origins.ip:${agent.id}`), at, at)
        .run();
    const { rotated } = rotate(h, 'k2');
    expect(await resealJob(h.relay)).toBe(105);
    const rows = await h.db.prepare('SELECT ip_sealed AS v FROM agent_origins ORDER BY id').all<{ v: string }>();
    expect(rows.results.every((r) => r.v.startsWith('v2.k2.'))).toBe(true);
    expect(await rotated.open(rows.results[9]!.v, `agent_origins.ip:${agent.id}`)).toBe('203.0.113.9');
  });

  it('leaves a value rewritten while it was being re-sealed alone', async () => {
    const h = harness();
    await seedChannel(h.relay, { id: LOUNGE });
    rotate(h, 'k2');
    const real = h.relay.db;
    let raced = false;
    h.relay.db = {
      prepare: (text) => real.prepare(text),
      batch: async (statements) => {
        if (!raced) {
          raced = true;
          await real.prepare('UPDATE channels SET webhook_ciphertext = ? WHERE id = ?').bind('v2.k2.new.new', LOUNGE).run();
        }
        return real.batch(statements);
      },
    };
    expect(await resealJob(h.relay)).toBe(0);
    h.relay.db = real;
    expect((await webhook(h, LOUNGE))!.v).toBe('v2.k2.new.new');
  });
});
