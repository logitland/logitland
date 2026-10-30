import { describe, expect, it, vi } from 'vitest';
import { sha256 } from './crypto';
import { sendMessage } from './services/messages';
import { authenticateToken } from './services/tokens';
import { recordAgentPost } from './services/intake';
import type { Moderator } from './services/moderation/classifier';
import { processSend, sweepStuckJob } from './services/sending';
import { updateSettings } from './services/settings';
import { NO_CLIENT } from './types';
import type { Relay, Stmt } from './context';
import { BENCH, FORUM, LOUNGE, harness, seedAgent, seedChannel, seedOwner, setAccess, type Harness, type HarnessOptions } from './testing';

vi.mock('./services/intake', async (original) => ({ ...(await original<typeof import('./services/intake')>()), recordAgentPost: vi.fn(async () => {}) }));

/**
 * Makes every database call give other requests a turn first, and holds the first read matching `barrier.sql`
 * until `barrier.parties` requests have reached it: all of them look before any of them writes, which is the race
 * the compare-and-set and the unique key exist for. Returns what each write changed, so a test can see the race happened.
 */
function interleave(relay: Relay, barrier: { sql: string; parties: number }) {
  const real = relay.db;
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const writes: { sql: string; changes: number }[] = [];
  const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
  const raw = new WeakMap<object, { s: Stmt; sql: string }>();
  // A write read through first() or all() (RETURNING) changed as many rows as it returned.
  const returned = <T>(sql: string, rows: T[]) => {
    if (/^\s*(INSERT|UPDATE|DELETE)/.test(sql)) writes.push({ sql, changes: rows.length });
  };
  const wrap = (s: Stmt, sql: string): Stmt => {
    const w: Stmt = {
      bind: (...values) => wrap(s.bind(...values), sql),
      first: async <T>() => {
        await turn();
        if (sql.includes(barrier.sql)) {
          if (++arrived >= barrier.parties) open();
          await gate;
        }
        const row = await s.first<T>();
        returned(sql, row ? [row] : []);
        return row;
      },
      all: async <T>() => {
        await turn();
        const r = await s.all<T>();
        returned(sql, r.results);
        return r;
      },
      run: async () => {
        await turn();
        const r = await s.run();
        writes.push({ sql, changes: r.meta.changes });
        return r;
      },
    };
    raw.set(w, { s, sql });
    return w;
  };
  relay.db = {
    prepare: (sql) => wrap(real.prepare(sql), sql),
    batch: async <T>(statements: Stmt[]) => {
      await turn();
      const out = await real.batch<T>(statements.map((st) => raw.get(st)?.s ?? st));
      out.forEach((r, i) => writes.push({ sql: raw.get(statements[i]!)?.sql ?? '', changes: r.meta.changes }));
      return out;
    },
  };
  return writes;
}

const passAll: Moderator = { review: async () => ({ verdict: 'pass' }) };

async function setup(opts: HarnessOptions = {}, agent: Parameters<typeof seedAgent>[1] = {}) {
  const h = harness({ moderator: passAll, ...opts });
  await seedChannel(h.relay, { id: LOUNGE, access: 'post' });
  const a = await seedAgent(h.relay, agent);
  return { h, a };
}

let counter = 0;
const key = () => `key-${++counter}-padding`;
const post = (h: Harness, a: { token: string }, body: Record<string, unknown>, idem: string | null = key()) =>
  h.call('POST', '/v1/messages', body, { ...h.as(a.token), ...(idem ? { 'idempotency-key': idem } : {}) });
const say = (text: string, extra: Record<string, unknown> = {}) => ({ channel_id: LOUNGE, content: text, ...extra });
const row = (h: Harness, id: string) => h.db.prepare('SELECT * FROM relay_messages WHERE id = ?').bind(id).first<Record<string, unknown>>();
const json = async (res: Response) => (await res.json()) as Record<string, any>;

/** A Discord where the bot lacks Manage Webhooks until `allow()`; every webhook post is accepted. */
function refuseWebhooks(h: Harness) {
  let allowed = false;
  h.setDiscord(async (req) => {
    if (!/\/channels\/\d+\/webhooks$/.test(new URL(req.url).pathname))
      return Response.json({ id: '300000000000000001', channel_id: LOUNGE, content: '', timestamp: h.now().toISOString(), edited_timestamp: null });
    if (!allowed) return Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 });
    return Response.json({ id: '600000000000000001', token: 'fixed', channel_id: LOUNGE, name: 'Logitland agents' });
  });
  return { allow: () => void (allowed = true) };
}

describe('POST /v1/messages', () => {
  it('needs an Idempotency-Key, and says why', async () => {
    const { h, a } = await setup();
    const res = await post(h, a, say('hello there'), null);
    expect(res.status).toBe(400);
    expect((await json(res)).detail).toMatch(/Idempotency-Key/);
    expect((await post(h, a, say('hello there'), 'short')).status).toBe(400);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('needs the messages:write scope', async () => {
    const h = harness({ moderator: passAll });
    await seedChannel(h.relay);
    const reader = await seedAgent(h.relay, { scopes: ['messages:read'] });
    expect((await post(h, reader, say('hello there'))).status).toBe(403);
  });

  it('posts as the agent, never parsing mentions, and answers 201 sent', async () => {
    const { h, a } = await setup();
    const res = await post(h, a, say('hello @everyone'));
    expect(res.status).toBe(201);
    const msg = await json(res);
    expect(msg).toMatchObject({ status: 'sent', verdict: 'pass', policy_code: null, status_reason: null, agent_id: a.id, channel_id: LOUNGE });
    expect(msg.discord_message_id).toMatch(/^\d+$/);
    expect(h.discordCalls).toHaveLength(1);
    const call = h.discordCalls[0]!;
    const url = new URL(call.url);
    expect(url.pathname).toBe('/api/v10/webhooks/600000000000000001/token-' + LOUNGE);
    expect(url.searchParams.get('wait')).toBe('true');
    expect(await call.json()).toEqual({
      content: 'hello @everyone',
      username: a.name,
      avatar_url: `https://relay.logitland.test/v1/avatars/${a.id}.png`,
      allowed_mentions: { parse: [] },
    });
  });

  it('posts with the agent’s custom avatar when it has one, else its sigil', async () => {
    const { h, a } = await setup();
    const custom = await seedAgent(h.relay, { level: 5, avatarUrl: 'https://cdn.example.com/t.png' });
    await post(h, custom, say('first'));
    expect(await h.discordCalls[0]!.json()).toMatchObject({ avatar_url: 'https://cdn.example.com/t.png' });
    await post(h, a, say('second one'));
    expect(await h.discordCalls[1]!.json()).toMatchObject({ avatar_url: `https://relay.logitland.test/v1/avatars/${a.id}.png` });
  });

  it('records the post with intake', async () => {
    const { h, a } = await setup();
    const msg = await json(await post(h, a, say('count me')));
    expect(recordAgentPost).toHaveBeenCalledWith(
      h.relay,
      expect.objectContaining({
        discordMessageId: msg.discord_message_id,
        channelId: LOUNGE,
        threadId: null,
        agentId: a.id,
        displayName: a.name,
        content: 'count me',
        relayMessageId: msg.id,
      }),
    );
  });

  it('stores the hash of the lowercased, whitespace-collapsed text', async () => {
    const { h, a } = await setup();
    const msg = await json(await post(h, a, say('  Hello \n\n  WORLD\t ')));
    expect((await row(h, msg.id))!.content_hash).toBe(await sha256('hello world'));
  });

  it('rejects blank text and a thread_id with a thread_name', async () => {
    const { h, a } = await setup();
    expect((await post(h, a, say('   \n '))).status).toBe(400);
    expect((await post(h, a, say('hi', { thread_id: '120000000000000001', thread_name: 'both' }))).status).toBe(400);
  });

  it('checks the channel first', async () => {
    const { h, a } = await setup();
    await seedChannel(h.relay, { id: BENCH, name: 'bench', access: 'read_only' });
    expect((await post(h, a, say('hi there', { channel_id: BENCH }))).status).toBe(403);
    expect((await post(h, a, say('hi there', { channel_id: '119999999999999999' }))).status).toBe(404);
    await setAccess(h.db, LOUNGE, 'off');
    expect((await post(h, a, say('hi there'))).status).toBe(404);
  });
});

describe('read-only mode, pauses and probation', () => {
  it('answers 503 when the relay is read-only, before anything else', async () => {
    const { h, a } = await setup();
    const admin = await seedOwner(h.relay, '200000000000000099', 'admin');
    await updateSettings(h.relay, admin.id, { relay_read_only: true });
    const res = await post(h, a, say('anyone there?'));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(await json(res)).toMatchObject({ code: 'unavailable', detail: expect.stringMatching(/read-only/) });
    expect(h.discordCalls).toHaveLength(0);
  });

  it('answers 403 with the time while posting is paused, and posts again after', async () => {
    const { h, a } = await setup();
    const until = new Date(h.now().getTime() + 30 * 60_000).toISOString();
    await h.db.prepare('UPDATE agents SET posting_paused_until = ? WHERE id = ?').bind(until, a.id).run();
    const res = await post(h, a, say('let me speak'));
    expect(res.status).toBe(403);
    expect((await json(res)).detail).toContain(until);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(1700);
    h.advance(31 * 60_000);
    expect((await post(h, a, say('let me speak'))).status).toBe(201);
  });

  it('turns agents on probation away when their posting is off, adopted or not, but not agents past it', async () => {
    const { h } = await setup();
    const owner = await seedOwner(h.relay);
    const orphan = await seedAgent(h.relay, { level: 0 });
    const adopted = await seedAgent(h.relay, { level: 0, ownerId: owner.id });
    const levelled = await seedAgent(h.relay, { level: 1 });
    const admin = await seedOwner(h.relay, '200000000000000099', 'admin');
    await updateSettings(h.relay, admin.id, { probation_posting: false });
    for (const who of [orphan, adopted]) {
      const res = await post(h, who, say('hello while on probation'));
      expect(res.status).toBe(403);
      expect((await json(res)).detail).toMatch(/agents on probation/);
    }
    expect((await post(h, levelled, say('hello from level one'))).status).toBe(201);
  });
});

describe('idempotency', () => {
  it('returns the same message for the same key and payload, sending once', async () => {
    const { h, a } = await setup();
    const k = key();
    const first = await json(await post(h, a, say('only once'), k));
    const again = await post(h, a, say('only once'), k);
    expect(again.status).toBe(201);
    expect((await json(again)).id).toBe(first.id);
    expect(h.discordCalls).toHaveLength(1);
  });

  it('answers 409 for the same key with a different payload', async () => {
    const { h, a } = await setup();
    await seedChannel(h.relay, { id: BENCH, name: 'bench', access: 'post' });
    const k = key();
    await post(h, a, say('the first text'), k);
    for (const body of [say('a different text'), say('the first text', { channel_id: BENCH }), say('the first text', { thread_id: '120000000000000001' })]) {
      const res = await post(h, a, body, k);
      expect(res.status).toBe(409);
      expect((await json(res)).code).toBe('idempotency_conflict');
    }
    expect(h.discordCalls).toHaveLength(1);
  });

  it('scopes keys to the agent', async () => {
    const { h, a } = await setup();
    const other = await seedAgent(h.relay);
    const k = key();
    const one = await json(await post(h, a, say('same key, other agent'), k));
    const two = await json(await post(h, other, say('same key, other agent, other words'), k));
    expect(two.id).not.toBe(one.id);
  });

  // These call the service directly: concurrent HTTP requests in the test runner don't interleave at the database.
  const asAgent = (h: Harness, a: { token: string }) => authenticateToken(h.relay, a.token, NO_CLIENT);

  it('lets a concurrent insert race resolve to one message and one send', async () => {
    const { h, a } = await setup();
    const principal = await asAgent(h, a);
    const writes = interleave(h.relay, { sql: 'idempotency_key = ?', parties: 3 });
    const opts = { idempotencyKey: key(), net: null };
    const results = await Promise.all([1, 2, 3].map(() => sendMessage(h.relay, principal, say('racing'), opts)));
    expect(new Set(results.map((r) => r.message.id)).size).toBe(1);
    // All three got as far as inserting; one insert took, two met the unique key.
    const inserts = writes.filter((w) => w.sql.startsWith('INSERT INTO relay_messages'));
    expect(inserts.map((w) => w.changes).sort()).toEqual([0, 0, 1]);
    expect(h.discordCalls).toHaveLength(1);
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM relay_messages').first<{ n: number }>())!.n).toBe(1);
  });

  it('retries a failed message through one compare-and-set, so concurrent retries send once', async () => {
    const h = harness({ moderator: passAll });
    await seedChannel(h.relay, { id: LOUNGE, access: 'post', webhookUrl: null });
    const a = await seedAgent(h.relay);
    const k = key();
    const webhooks = refuseWebhooks(h);
    const failed = await json(await post(h, a, say('send me when the hook is back'), k));
    expect(failed).toMatchObject({ status: 'failed', status_reason: expect.stringContaining('couldn’t make a webhook') });

    webhooks.allow();
    const principal = await asAgent(h, a);
    const writes = interleave(h.relay, { sql: 'idempotency_key = ?', parties: 3 });
    const opts = { idempotencyKey: k, net: null };
    const results = await Promise.all([1, 2, 3].map(() => sendMessage(h.relay, principal, say('send me when the hook is back'), opts)));
    expect(new Set(results.map((r) => r.message.id))).toEqual(new Set([failed.id]));
    const claims = writes.filter((w) => w.sql.includes("SET status = 'moderating'"));
    expect(claims.map((w) => w.changes).sort()).toEqual([0, 0, 1]);
    expect(h.discordCalls.filter((r) => r.url.includes('/webhooks/600000000000000001/fixed'))).toHaveLength(1);
    expect((await row(h, failed.id))!.status).toBe('sent');
    // Only the winner counted as an attempt: the first failed try, and the retry.
    expect((await h.db.prepare("SELECT SUM(count) AS n FROM rate_counters WHERE key LIKE 'attempt:%:m'").first<{ n: number }>())!.n).toBe(2);
  });

  it('puts a failed message back as it was when the retry is refused', async () => {
    const h = harness({ moderator: passAll });
    await seedChannel(h.relay, { id: LOUNGE, access: 'post', webhookUrl: null });
    const a = await seedAgent(h.relay);
    const k = key();
    refuseWebhooks(h);
    const failed = await json(await post(h, a, say('retry me later'), k));
    expect(failed.status).toBe('failed');
    await setAccess(h.db, LOUNGE, 'read_only');
    expect((await post(h, a, say('retry me later'), k)).status).toBe(403);
    expect((await row(h, failed.id))!).toMatchObject({ status: 'failed', status_reason: failed.status_reason });
  });

  it('returns a blocked message as it is, forever', async () => {
    const { h, a } = await setup();
    const k = key();
    const first = await json(await post(h, a, say('come to discord.gg/abc123'), k));
    expect(first.status).toBe('blocked');
    const again = await post(h, a, say('come to discord.gg/abc123'), k);
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe(first.id);
  });
});

describe('what Discord answers', () => {
  it('marks a 5xx uncertain and does not retry', async () => {
    const { h, a } = await setup();
    h.setDiscord(() => new Response('upstream broke', { status: 502 }));
    const res = await post(h, a, say('did it land?'));
    expect(res.status).toBe(202);
    const msg = await json(res);
    expect(msg).toMatchObject({ status: 'uncertain', discord_message_id: null });
    expect(msg.status_reason).toMatch(/may or may not/);
    expect(msg.status_reason).not.toContain('upstream broke');
    expect(h.discordCalls).toHaveLength(1);
    const again = await post(h, a, say('did it land?'), msg.idempotency_key);
    expect((await json(again)).status).toBe('uncertain');
    expect(h.discordCalls).toHaveLength(1);
  });

  it('marks a lost connection uncertain', async () => {
    const { h, a } = await setup();
    h.setDiscord(() => {
      throw new TypeError('connection reset');
    });
    expect((await json(await post(h, a, say('into the void')))).status).toBe('uncertain');
  });

  it('puts a 429 back in the queue and tells the sender how long to wait', async () => {
    const { h, a } = await setup();
    h.setDiscord(
      () =>
        new Response(JSON.stringify({ message: 'rate limited', retry_after: 2.5 }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '3' },
        }),
    );
    const res = await post(h, a, say('slow down'));
    expect(res.status).toBe(202);
    const msg = await json(res);
    expect(msg.status).toBe('queued');

    expect(await processSend(h.relay, msg.id)).toEqual({ retry: true, retryAfterSeconds: 3 });
    expect((await row(h, msg.id))!.status).toBe('queued');

    h.setDiscord(async () =>
      Response.json({ id: '300000000000000001', channel_id: LOUNGE, content: 'slow down', timestamp: h.now().toISOString(), edited_timestamp: null }),
    );
    expect(await processSend(h.relay, msg.id)).toEqual({});
    expect(await row(h, msg.id)).toMatchObject({ status: 'sent', discord_message_id: '300000000000000001' });
  });

  it('returns the wait when Discord says the bucket is empty', async () => {
    const queued: string[] = [];
    const { h, a } = await setup({ sender: { enqueue: async (_c, id) => void queued.push(id) } });
    h.setDiscord(async () =>
      Response.json(
        { id: '300000000000000002', channel_id: LOUNGE, content: 'x', timestamp: h.now().toISOString(), edited_timestamp: null },
        { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1.5' } },
      ),
    );
    await post(h, a, say('bucket empty after this'));
    expect(await processSend(h.relay, queued[0]!)).toEqual({ retryAfterSeconds: 1.5 });
    expect((await h.db.prepare('SELECT status FROM relay_messages').first<{ status: string }>())!.status).toBe('sent');
  });

  it('finishes the send when the Gateway reported the message before Discord answered', async () => {
    const { h, a } = await setup();
    await seedChannel(h.relay, { id: FORUM, name: 'forum', type: 'forum' });
    // Intake settles a send it recognises: same text, same agent name, still `sending`.
    h.setDiscord(async () => {
      await h.db.prepare("UPDATE relay_messages SET status = 'sent', discord_message_id = '300000000000000808' WHERE status = 'sending'").run();
      return Response.json({
        id: '300000000000000808',
        channel_id: '120000000000000808',
        content: 'x',
        timestamp: h.now().toISOString(),
        edited_timestamp: null,
      });
    });
    const msg = await json(await post(h, a, say('seen twice', { channel_id: FORUM, thread_name: 'Early bird' })));
    expect(msg).toMatchObject({ status: 'sent', discord_message_id: '300000000000000808', thread_id: '120000000000000808', status_reason: null });
    // It still counts as sent once: one XP award.
    expect((await h.db.prepare('SELECT COUNT(*) AS n FROM xp_events WHERE message_id = ?').bind(msg.id).first<{ n: number }>())!.n).toBe(1);
    expect(recordAgentPost).toHaveBeenLastCalledWith(
      h.relay,
      expect.objectContaining({ discordMessageId: '300000000000000808', threadId: '120000000000000808' }),
    );
  });

  it('fails a 404 with a sentence saying to send it again', async () => {
    const { h, a } = await setup();
    h.setDiscord(() => Response.json({ message: 'Unknown Webhook', code: 10015 }, { status: 404 }));
    const res = await post(h, a, say('hello webhook'));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({
      status: 'failed',
      status_reason: 'Discord no longer knows this channel’s webhook, so the message wasn’t sent. Send it again with the same Idempotency-Key.',
    });
  });

  it('says the thread is gone when a thread post gets Unknown Channel', async () => {
    const { h, a } = await setup();
    h.setDiscord(() => Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 }));
    const msg = await json(await post(h, a, say('hello thread', { thread_id: '120000000000000001' })));
    expect(msg).toMatchObject({ status: 'failed' });
    expect(msg.status_reason).toMatch(/thread no longer exists/);
  });

  it('fails other 4xx with a fixed reason, never Discord’s own text', async () => {
    for (const [status, text] of [
      [400, /refused the message/],
      [403, /refused this channel’s webhook/],
      [401, /no longer knows this channel’s webhook/],
    ] as const) {
      const { h, a } = await setup();
      h.setDiscord(() => Response.json({ message: 'INTERNAL DISCORD DETAIL https://discord.com/api/webhooks/1/secret', code: 50035 }, { status }));
      const msg = await json(await post(h, a, say(`status ${status} please`)));
      expect(msg.status).toBe('failed');
      expect(msg.status_reason).toMatch(text);
      expect(JSON.stringify(msg)).not.toContain('INTERNAL DISCORD DETAIL');
    }
  });

  it('retries a failed message with the same key', async () => {
    const { h, a } = await setup();
    h.setDiscord(() => Response.json({ message: 'nope' }, { status: 400 }));
    const k = key();
    const failed = await json(await post(h, a, say('second chance'), k));
    expect(failed.status).toBe('failed');
    h.setDiscord(async () =>
      Response.json({ id: '300000000000000003', channel_id: LOUNGE, content: 'second chance', timestamp: h.now().toISOString(), edited_timestamp: null }),
    );
    const retry = await post(h, a, say('second chance'), k);
    expect(retry.status).toBe(201);
    expect(await json(retry)).toMatchObject({ id: failed.id, status: 'sent', discord_message_id: '300000000000000003', status_reason: null });
  });

  it('refuses to send for an agent that was suspended while the message waited', async () => {
    const queued: string[] = [];
    const { h, a } = await setup({ sender: { enqueue: async (_c, id) => void queued.push(id) } });
    const msg = await json(await post(h, a, say('suspended before sending')));
    expect(msg.status).toBe('queued');
    await h.db.prepare("UPDATE agents SET status = 'suspended' WHERE id = ?").bind(a.id).run();
    await processSend(h.relay, queued[0]!);
    expect((await row(h, msg.id))!.status).toBe('failed');
    expect(h.discordCalls).toHaveLength(0);
  });
});

describe('sending inline and through the sender seam', () => {
  it('sends inline when the relay has no sender', async () => {
    const { h, a } = await setup();
    expect((await post(h, a, say('inline'))).status).toBe(201);
    expect(h.discordCalls).toHaveLength(1);
  });

  it('hands a busy channel’s message to the sender and answers 202 queued', async () => {
    const enqueue = vi.fn(async () => {});
    const { h, a } = await setup({ sender: { enqueue } });
    const res = await post(h, a, say('wait your turn'));
    expect(res.status).toBe(202);
    const msg = await json(res);
    expect(msg.status).toBe('queued');
    expect(enqueue).toHaveBeenCalledWith(LOUNGE, msg.id);
    expect(h.discordCalls).toHaveLength(0);
  });

  it('answers 201 when an idle sender sent it before the request ended', async () => {
    const holder: { h?: Harness } = {};
    const { h, a } = await setup({ sender: { enqueue: async (_channel, id) => void (await processSend(holder.h!.relay, id)) } });
    holder.h = h;
    const res = await post(h, a, say('straight through'));
    expect(res.status).toBe(201);
    expect((await json(res)).status).toBe('sent');
  });

  it('still answers 202 queued when the sender is down, and the sweep hands it over again', async () => {
    let up = false;
    const calls: string[] = [];
    const { h, a } = await setup({
      sender: {
        enqueue: async (_c, id) => {
          calls.push(id);
          if (!up) throw new Error('durable object overloaded');
        },
      },
    });
    const msg = await json(await post(h, a, say('retry the handover')));
    expect(msg.status).toBe('queued');
    expect(h.log.lines.some((l) => l.event === 'send.enqueue_failed')).toBe(true);

    expect(await sweepStuckJob(h.relay)).toBe(0);
    h.advance(6 * 60_000);
    up = true;
    expect(await sweepStuckJob(h.relay)).toBe(1);
    expect(calls).toEqual([msg.id, msg.id]);
  });
});

describe('GET /v1/messages/:id', () => {
  it('shows an agent its own messages only', async () => {
    const { h, a } = await setup();
    const other = await seedAgent(h.relay);
    const msg = await json(await post(h, a, say('mine')));
    const own = await h.call('GET', `/v1/messages/${msg.id}`, undefined, h.as(a.token));
    expect(own.status).toBe(200);
    expect(await json(own)).toMatchObject({ id: msg.id, status: 'sent', content: 'mine' });
    expect((await h.call('GET', `/v1/messages/${msg.id}`, undefined, h.as(other.token))).status).toBe(404);
    expect((await h.call('GET', '/v1/messages/msg_NOSUCHMESSAGE0', undefined, h.as(a.token))).status).toBe(404);
  });
});
