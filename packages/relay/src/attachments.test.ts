import { Permission } from '@logitland/discord';
import { describe, expect, it } from 'vitest';
import { HUMAN, all, at, edit, human, msg, push, remove, subscribe, world } from './intake-fixtures';
import { handleScheduled } from './jobs';
import { readFeed, readableChannels, DIGEST_MAX, type SubscriptionRow } from './services/feed';
import { GUILD, LOUNGE, seedAgent, seedChannel, testImage, type Harness } from './testing';

// Files on messages (#179): listed in message events with the relay's address, and served from the relay's copy.

const CDN = 'cdn.discordapp.com';
const GATED = '110000000000000010';
const PRIVATE = '120000000000000001';
const START = Date.parse('2026-10-19T03:00:00Z');

/** Discord's signed address for a file, expiring `ttlHours` after the harness starts. */
const signed = (id: string, filename: string, ttlHours = 24) =>
  `https://${CDN}/attachments/${LOUNGE}/${id}/${filename}?ex=${Math.floor(START / 1000 + ttlHours * 3600).toString(16)}&is=0&hm=sig`;

const file = (n: number, over: Record<string, unknown> = {}) => ({
  id: String(500000000000000000n + BigInt(n)),
  filename: 'cat.png',
  content_type: 'image/png',
  size: 1234,
  width: 128,
  height: 128,
  url: signed(String(500000000000000000n + BigInt(n)), 'cat.png'),
  ...over,
});

/** A world whose CDN serves a different PNG at every path, and counts the requests. */
async function setup() {
  const w = await world();
  const cdn: string[] = [];
  w.h.receivers[CDN] = (req) => {
    const url = new URL(req.url);
    cdn.push(url.pathname + url.search);
    return new Response(testImage('png', 128, 128, url.pathname), { headers: { 'content-type': 'image/png' } });
  };
  return { ...w, cdn };
}

const fetchFile = (h: Harness, id: string, token?: string) => h.call('GET', `/v1/attachments/${id}`, undefined, token ? h.as(token) : {});

async function events(h: Harness, subscriptionId: string) {
  const sub = (await h.db
    .prepare('SELECT s.*, a.level, a.owner_id FROM subscriptions s JOIN agents a ON a.id = s.agent_id WHERE s.id = ?')
    .bind(subscriptionId)
    .first<SubscriptionRow & { level: number; owner_id: string | null }>())!;
  return (await readFeed(h.relay, sub, null, DIGEST_MAX, await readableChannels(h.relay, sub))).events;
}

describe('files on messages', () => {
  it('are listed in message events with the relay’s address, and served to a reader from the relay’s copy', async () => {
    const { h, agent, cdn } = await setup();
    const sub = await subscribe(h, agent.id);
    const cat = file(1);
    await push(h, human(1, { attachments: [cat] }));

    const [created] = await events(h, sub);
    expect(created!.data).toMatchObject({
      attachments: [
        {
          id: cat.id,
          filename: 'cat.png',
          content_type: 'image/png',
          size: 1234,
          width: 128,
          height: 128,
          url: `https://relay.logitland.test/v1/attachments/${cat.id}`,
        },
      ],
    });
    expect(JSON.stringify(created)).not.toContain(CDN);

    const first = await fetchFile(h, cat.id, agent.token);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(testImage('png', 128, 128, `/attachments/${LOUNGE}/${cat.id}/cat.png`));
    const again = await fetchFile(h, cat.id, agent.token);
    expect(again.status).toBe(200);
    expect(new Uint8Array(await again.arrayBuffer())).toEqual(testImage('png', 128, 128, `/attachments/${LOUNGE}/${cat.id}/cat.png`));
    expect(cdn).toHaveLength(1);
  });

  it('are not found for an agent that can’t read the message: a channel above its level, or a private conversation it isn’t in', async () => {
    const { h, agent } = await setup();
    const role = '100000000000000022';
    await h.db
      .prepare('INSERT INTO guild_roles (id, guild_id, name, permissions, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(role, GUILD, 'level 3', '0', h.now().toISOString())
      .run();
    await h.db.prepare('UPDATE levels SET role_id = ? WHERE level = 3').bind(role).run();
    await seedChannel(h.relay, {
      id: GATED,
      name: 'gated',
      overwrites: [
        { id: GUILD, type: 0, deny: String(Permission.VIEW_CHANNEL), allow: '0' },
        { id: role, type: 0, deny: '0', allow: String(Permission.VIEW_CHANNEL | Permission.READ_MESSAGE_HISTORY) },
      ],
    });
    await h.db
      .prepare('INSERT INTO threads (id, parent_id, name, created_at, private, updated_at) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(PRIVATE, LOUNGE, 'private', h.now().toISOString(), h.now().toISOString())
      .run();
    const gated = file(1);
    const secret = file(2);
    await push(
      h,
      human(1, { channel_id: GATED, reply_to: null, attachments: [gated] }),
      human(2, { thread_id: PRIVATE, reply_to: null, attachments: [secret] }),
    );
    const senior = await seedAgent(h.relay, { name: 'Senior', level: 3 });

    expect((await fetchFile(h, gated.id, agent.token)).status).toBe(404);
    expect((await fetchFile(h, gated.id)).status).toBe(404);
    expect((await fetchFile(h, gated.id, senior.token)).status).toBe(200);
    expect((await fetchFile(h, secret.id, agent.token)).status).toBe(404);
    expect((await fetchFile(h, secret.id)).status).toBe(404);
  });

  it('are refused over 10 MB, without fetching them', async () => {
    const { h, agent, cdn } = await setup();
    const big = file(1, { size: 10 * 1024 * 1024 + 1 });
    await push(h, human(1, { attachments: [big] }));
    const res = await fetchFile(h, big.id, agent.token);
    expect(res.status).toBe(413);
    expect(cdn).toEqual([]);
  });

  it('are served as downloads, never for display, unless they are images or plain text', async () => {
    const { h, agent } = await setup();
    const svg = file(1, { filename: 'logo.svg', content_type: 'image/svg+xml' });
    const html = file(2, { filename: 'page.html', content_type: 'text/html; charset=utf-8' });
    const png = file(3);
    await push(h, human(1, { attachments: [svg, html, png] }));
    for (const f of [svg, html]) {
      const res = await fetchFile(h, f.id, agent.token);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${f.filename}"; filename*=UTF-8''${f.filename}`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
    expect((await fetchFile(h, png.id, agent.token)).headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('are fetched from a fresh address once Discord’s signed one has expired', async () => {
    const { h, agent, cdn } = await setup();
    const cat = file(1, { url: signed(file(1).id, 'cat.png', 1) });
    const fresh = signed(cat.id, 'cat.png', 48).replace('hm=sig', 'hm=fresh');
    const asked: unknown[] = [];
    h.setDiscord(async (req) => {
      asked.push(await req.json());
      return Response.json({ refreshed_urls: [{ original: cat.url, refreshed: fresh }] });
    });
    await push(h, human(1, { attachments: [cat] }));
    h.advance(2 * 3600_000);

    expect((await fetchFile(h, cat.id, agent.token)).status).toBe(200);
    expect(asked).toEqual([{ attachment_urls: [cat.url] }]);
    expect(cdn).toEqual([fresh.slice(`https://${CDN}`.length)]);
  });

  it('are deleted when their message is, and when an edit drops them', async () => {
    const { h, agent } = await setup();
    const [a, b, c] = [file(1), file(2), file(3)];
    await push(h, human(1, { attachments: [a] }), human(2, { attachments: [b, c] }));
    for (const f of [a, b, c]) expect((await fetchFile(h, f.id, agent.token)).status).toBe(200);
    expect([...h.attachments.keys()].sort()).toEqual([a.id, b.id, c.id]);

    await push(h, remove(1), edit(2, 'kept one', 5, { attachments: [c] }));
    expect((await fetchFile(h, a.id, agent.token)).status).toBe(404);
    expect((await fetchFile(h, b.id, agent.token)).status).toBe(404);
    expect((await fetchFile(h, c.id, agent.token)).status).toBe(200);

    await handleScheduled(h.relay, new Date('2026-10-19T03:01:00Z'));
    expect([...h.attachments.keys()]).toEqual([c.id]);
    expect(await all(h, 'SELECT id FROM attachments')).toEqual([{ id: c.id }]);
    expect(JSON.stringify(await all(h, "SELECT payload FROM events WHERE message_id = ? AND type = 'message.created'", msg(1)))).not.toContain('cat.png');
  });

  it('stay as they were when intake turns an edit away because its author had withdrawn', async () => {
    const { h, agent } = await setup();
    const [kept, added] = [file(1), file(2)];
    await push(h, human(1, { attachments: [kept] }));
    await h.db.prepare('UPDATE consents SET revoked_at = ? WHERE discord_user_id = ?').bind(at(1), HUMAN).run();

    await push(h, edit(1, 'written after withdrawing', 2, { attachments: [added] }));
    expect((await fetchFile(h, added.id)).status).toBe(404);
    expect((await fetchFile(h, kept.id, agent.token)).status).toBe(200);
  });

  it('stay as a newer edit left them when an older edit commits after it', async () => {
    const { h, agent } = await setup();
    const [a, b] = [file(1), file(2)];
    await push(h, human(1, { attachments: [a] }));
    // The newer edit (minute 3, a for b) commits while the older one (minute 2, keeping a) waits to write.
    const batch = h.db.batch.bind(h.db);
    let raced = false;
    h.db.batch = async (stmts) => {
      if (!raced && stmts.some((s) => (s as { sql?: string }).sql?.startsWith('UPDATE conversation SET content'))) {
        raced = true;
        await push(h, edit(1, 'newer', 3, { attachments: [b] }));
      }
      return batch(stmts);
    };
    await push(h, edit(1, 'older', 2, { attachments: [a] }));

    expect((await fetchFile(h, b.id, agent.token)).status).toBe(200);
    expect((await fetchFile(h, a.id, agent.token)).status).toBe(404);
  });

  it('are deleted after 30 days, with the events that list them', async () => {
    const { h, agent } = await setup();
    const cat = file(1);
    await push(h, human(1, { attachments: [cat] }));
    expect((await fetchFile(h, cat.id, agent.token)).status).toBe(200);

    h.advance(31 * 86_400_000);
    await handleScheduled(h.relay, h.now());
    expect((await fetchFile(h, cat.id, agent.token)).status).toBe(404);
    expect(h.attachments.size).toBe(0);
  });
});
