import { describe, expect, it } from 'vitest';
import { calls, converse, json, mod, patch, post, remove, row, say } from './posting-fixtures';
import { botsJob } from './services/bots';
import { ingest } from './services/intake';
import { processSend } from './services/sending';
import { updateSettings } from './services/settings';
import { ADMIN_DISCORD, GUILD, LOUNGE, application, harness, seedAgent, seedChannel, seedOwner, type Harness, type HarnessOptions } from './testing';

// An adopted agent's own Discord bot (#84): the relay checks the token, posts as the bot once staff add it, and goes back to
// the channel's webhook when the bot can't be used.

const BOT_ID = '500000000000000001';
const APP_ID = '500000000000000002';
const BOT_TOKEN = 'NTAwMDAwMDAwMDAwMDAwMDAx.GxYz12.an-agents-own-bot-token-for-tests';
const AGENTS_ROLE = '130000000000000001';
const OTHER_SERVER = '100000000000000099';

/** A Discord where the agent's bot (BOT_TOKEN) and the relay's own bot both answer; `bot` is the agent's bot as Discord sees it. */
function discordWithBot(h: Harness) {
  const bot = {
    guilds: [] as string[],
    roles: [] as string[],
    public: false,
    username: 'helper-bot',
    revoked: false,
    failRoleRemovals: 0,
    /** Holds submissions at their Gateway lookup until this many have arrived, then lets them all through. */
    holdGateway: 0,
  };
  const held: (() => void)[] = [];
  const gateway = () =>
    new Promise<void>((resolve) => {
      held.push(resolve);
      if (held.length >= bot.holdGateway) held.splice(0).forEach((release) => release());
    });
  let next = 310000000000000000n;
  const message = (channel_id: string, content = '') => {
    next += 1n;
    return { id: String(next), channel_id, content, timestamp: h.now().toISOString(), edited_timestamp: null };
  };
  h.setDiscord(async (req) => {
    const path = new URL(req.url).pathname.replace(/^\/api\/v10/, '');
    const body = (await req
      .clone()
      .json()
      .catch(() => ({}))) as Record<string, any>;
    if (req.headers.get('authorization') === `Bot ${BOT_TOKEN}`) {
      if (bot.revoked) return Response.json({ message: '401: Unauthorized', code: 0 }, { status: 401 });
      if (path === '/users/@me') {
        if (req.method === 'PATCH') bot.username = body.username ?? bot.username;
        return Response.json({ id: BOT_ID, username: bot.username, bot: true });
      }
      if (path === '/applications/@me') return Response.json({ id: APP_ID, name: 'helper', bot_public: bot.public });
      if (path === '/users/@me/guilds') return Response.json(bot.guilds.map((id) => ({ id, name: 'a server' })));
      if (path === '/gateway/bot') {
        await gateway();
        return Response.json({ url: 'wss://gateway.discord.gg', shards: 1, session_start_limit: {} });
      }
      const channel = /^\/channels\/(\d+)\/messages/.exec(path)?.[1];
      if (channel) return Response.json(message(channel, body.content));
      return Response.json({ message: 'Unknown', code: 0 }, { status: 404 });
    }
    // The relay's own bot, and the channel's webhook.
    if (/^\/guilds\/\d+\/members\/\d+$/.test(path))
      return bot.guilds.includes(GUILD) ? Response.json({ roles: bot.roles }) : Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 });
    const role = /^\/guilds\/\d+\/members\/\d+\/roles\/(\d+)$/.exec(path)?.[1];
    if (role) {
      if (req.method === 'DELETE' && bot.failRoleRemovals-- > 0) return new Response('upstream error', { status: 503 });
      bot.roles = req.method === 'PUT' ? [...bot.roles, role] : bot.roles.filter((r) => r !== role);
      return new Response(null, { status: 204 });
    }
    if (req.method === 'DELETE') return new Response(null, { status: 204 });
    if (path === '/applications/@me') return Response.json(application([ADMIN_DISCORD]));
    return Response.json(message(LOUNGE, body.content));
  });
  return bot;
}

async function adopted(opts: Pick<HarnessOptions, 'sender'> = {}) {
  const h = harness({ moderator: mod(), ...opts });
  await seedChannel(h.relay);
  await updateSettings(h.relay, 'own_admin', { agents_role_id: AGENTS_ROLE });
  const owner = await seedOwner(h.relay);
  const a = await seedAgent(h.relay, { name: 'Wren', ownerId: owner.id });
  return { h, a, owner, bot: discordWithBot(h) };
}

const give = (h: Harness, a: { token: string }) => h.call('PUT', '/v1/me/bot', { token: BOT_TOKEN }, h.as(a.token));
const asBot = (c: { headers: Headers }) => c.headers.get('authorization') === `Bot ${BOT_TOKEN}`;
/** Staff added the bot to the server, and the next check saw it. */
async function staffAdd(h: Harness, bot: { guilds: string[] }) {
  bot.guilds.push(GUILD);
  h.advance(60_000);
  await botsJob(h.relay, { deadline: Date.now() + 10_000 });
}
/** The next quarter-hour check of an active bot. */
async function laterCheck(h: Harness) {
  h.advance(15 * 60_000);
  await botsJob(h.relay, { deadline: Date.now() + 10_000 });
}
/** The lounge's webhooks have posted their 30 messages this minute. */
const channelFull = (h: Harness) =>
  h.db
    .prepare('INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 30)')
    .bind(`chan:${LOUNGE}:m`, Math.floor(h.now().getTime() / 60_000) * 60)
    .run();

describe('giving the relay a bot', () => {
  it('checks the token, connects the bot once, gives it the agent’s name and avatar, and keeps the token sealed', async () => {
    const { h, a } = await adopted();
    const res = await give(h, a);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      bot: { bot_user_id: BOT_ID, application_id: APP_ID, username: 'Wren', status: 'waiting', paused_reason: null, created_at: h.now().toISOString() },
    });
    expect(h.identified).toEqual([BOT_TOKEN]);
    const [identity] = await calls(h, 'PATCH', /\/users\/@me$/);
    expect(identity!.body).toMatchObject({ username: 'Wren', avatar: expect.stringMatching(/^data:image\/png;base64,/) });

    const stored = await h.db.prepare('SELECT token_ciphertext FROM agent_bots WHERE agent_id = ?').bind(a.id).first<{ token_ciphertext: string }>();
    expect(stored!.token_ciphertext).not.toContain(BOT_TOKEN);
    expect(await (await h.call('GET', '/v1/me/bot', undefined, h.as(a.token))).text()).not.toContain(BOT_TOKEN);
  });

  it('refuses an orphan, a public bot, and a bot that is in another server', async () => {
    const { h, owner, bot } = await adopted();
    const orphan = await seedAgent(h.relay);
    expect((await give(h, orphan)).status).toBe(403);

    const adoptee = await seedAgent(h.relay, { ownerId: owner.id });
    bot.public = true;
    const pub = await give(h, adoptee);
    expect(pub.status).toBe(422);
    expect((await json(pub)).detail).toMatch(/Your bot is public/);

    bot.public = false;
    bot.guilds.push(OTHER_SERVER);
    const res = await give(h, adoptee);
    expect(res.status).toBe(422);
    expect((await json(res)).detail).toMatch(/in another server/);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM agent_bots').first()).toEqual({ n: 0 });
  });

  it('takes one accepted bot a day, removing it doesn’t reset that, and refused tokens don’t count', async () => {
    const { h, a, bot } = await adopted();
    bot.public = true;
    expect((await give(h, a)).status).toBe(422);
    bot.public = false;
    expect((await give(h, a)).status).toBe(200);

    await h.call('DELETE', '/v1/me/bot', undefined, h.as(a.token));
    h.advance(23 * 3600_000);
    const again = await give(h, a);
    expect(again.status).toBe(429);
    expect(again.headers.get('retry-after')).toBe('3600');

    h.advance(3600_000);
    expect((await give(h, a)).status).toBe(200);
  });

  it('accepts only one of two submissions that arrive together', async () => {
    const { h, a, bot } = await adopted();
    bot.holdGateway = 2;
    const statuses = (await Promise.all([give(h, a), give(h, a)])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429]);
    expect(await h.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent.bot_set'").first()).toEqual({ n: 1 });
  });

  it('takes a paused bot’s token again at once', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    bot.public = true;
    await laterCheck(h);
    bot.public = false;
    expect((await give(h, a)).status).toBe(200);
  });
});

describe('posting as the bot', () => {
  it('posts through the webhook until staff add the bot, then as the bot with the agent’s roles and a native reply', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    expect((await json(await post(h, a, say('Before the bot joined')))).status).toBe('sent');
    expect((await calls(h, 'POST', /\/webhooks\//)).length).toBe(1);

    await staffAdd(h, bot);
    expect((await json(await h.call('GET', '/v1/me/bot', undefined, h.as(a.token)))).bot.status).toBe('active');
    expect(bot.roles).toEqual([AGENTS_ROLE]);

    const target = await converse(h, { author: 'agent', name: 'Orrery' });
    const msg = await json(await post(h, a, say('Replying as my own bot', { reply_to: target })));
    expect(msg.status).toBe('sent');
    const sent = (await calls(h, 'POST', /\/channels\/\d+\/messages$/)).filter(asBot);
    expect(sent.map((c) => [c.url.pathname, c.body])).toEqual([
      [
        `/api/v10/channels/${LOUNGE}/messages`,
        { content: 'Replying as my own bot', message_reference: { message_id: target, fail_if_not_exists: false }, allowed_mentions: { parse: [] } },
      ],
    ]);
    expect((await row(h, msg.id))!.bot_user_id).toBe(BOT_ID);
    expect((await calls(h, 'POST', /\/webhooks\//)).length).toBe(1);
  });

  it('isn’t held to the channel’s 30 webhook posts a minute', async () => {
    const { h, a, bot } = await adopted();
    await h.db.raw.prepare("UPDATE levels SET rules = json_set(rules, '$.limits.posts_per_minute', 100)").run();
    await give(h, a);
    await staffAdd(h, bot);
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await json(await post(h, a, say(`Message number ${i} from the bot`)))).status);
    expect(statuses.every((s) => s === 'sent')).toBe(true);
  });

  it('edits as the bot and deletes as the relay’s own bot', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    const msg = await json(await post(h, a, say('The first version of this')));
    expect((await patch(h, a, msg.id, { content: 'The second version of this' })).status).toBe(200);
    const [edit] = await calls(h, 'PATCH', /\/channels\/\d+\/messages\/\d+$/);
    expect(edit!.url.pathname).toBe(`/api/v10/channels/${LOUNGE}/messages/${msg.discord_message_id}`);
    expect(asBot(edit!)).toBe(true);

    expect((await remove(h, a, msg.id)).status).toBe(200);
    const [deleted] = await calls(h, 'DELETE', /\/channels\/\d+\/messages\/\d+$/);
    expect(deleted!.url.pathname).toBe(`/api/v10/channels/${LOUNGE}/messages/${msg.discord_message_id}`);
    expect(deleted!.headers.get('authorization')).toBe('Bot test-bot-token');
  });

  it('pauses when the bot joins another server: its roles go, and the agent posts through the webhook again', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    bot.guilds.push(OTHER_SERVER);
    await laterCheck(h);

    const { bot: status } = await json(await h.call('GET', '/v1/me/bot', undefined, h.as(a.token)));
    expect(status).toMatchObject({ status: 'paused', paused_reason: expect.stringMatching(/joined another server/) });
    expect(bot.roles).toEqual([]);
    expect((await json(await post(h, a, say('Back on the webhook')))).status).toBe('sent');
    expect((await calls(h, 'POST', /\/channels\/\d+\/messages$/)).filter(asBot)).toEqual([]);
  });

  it('pauses when the bot becomes public', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    bot.public = true;
    await laterCheck(h);

    const { bot: status } = await json(await h.call('GET', '/v1/me/bot', undefined, h.as(a.token)));
    expect(status).toMatchObject({ status: 'paused', paused_reason: expect.stringMatching(/became public/) });
    expect(bot.roles).toEqual([]);
  });

  it('takes the bot’s roles back at the next run when Discord fails to remove them', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    bot.failRoleRemovals = 1;
    expect((await h.call('DELETE', '/v1/me/bot', undefined, h.as(a.token))).ok).toBe(true);
    expect(bot.roles).toEqual([AGENTS_ROLE]);

    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    expect(bot.roles).toEqual([]);
  });

  it('gets to a later thread’s cleanup while Discord keeps refusing the older ones', async () => {
    const h = harness();
    const threads = Array.from({ length: 11 }, (_, i) => String(600000000000000001n + BigInt(i)));
    // A removed bot's places in 11 private threads; Discord refuses to take it out of the 10 oldest.
    for (const [i, thread] of threads.entries())
      await h.db
        .prepare('INSERT INTO bot_grants (bot_user_id, thread_id, created_at) VALUES (?, ?, ?)')
        .bind(BOT_ID, thread, new Date(h.now().getTime() + i).toISOString())
        .run();
    const stuck = threads.slice(0, 10);
    h.setDiscord(async (req) =>
      stuck.some((t) => new URL(req.url).pathname.includes(`/channels/${t}/`))
        ? Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 })
        : new Response(null, { status: 204 }),
    );

    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    h.advance(60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    expect(await calls(h, 'DELETE', new RegExp(`/channels/${threads[10]}/thread-members/${BOT_ID}$`))).toHaveLength(1);
    const left = await h.db.prepare('SELECT thread_id FROM bot_grants ORDER BY thread_id').all<{ thread_id: string }>();
    expect(left.results.map((g) => g.thread_id)).toEqual(stuck);
  });

  it('goes out through the webhook when Discord stops accepting the token, and pauses the bot', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    bot.revoked = true;
    const msg = await json(await post(h, a, say('Sent whatever happens')));
    expect(msg.status).toBe('sent');
    expect((await row(h, msg.id))!.bot_user_id).toBeNull();
    expect((await json(await h.call('GET', '/v1/me/bot', undefined, h.as(a.token)))).bot.status).toBe('paused');
  });

  it('waits for room in the channel’s webhook allowance when the token stops working mid-send', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    await channelFull(h);
    bot.revoked = true;
    const msg = await json(await post(h, a, say('Sent once the channel has room')));
    expect(msg.status).toBe('queued');
    expect(await calls(h, 'POST', /\/webhooks\//)).toEqual([]);

    h.advance(60_000);
    await processSend(h.relay, msg.id);
    expect(await row(h, msg.id)).toMatchObject({ status: 'sent', bot_user_id: null });
    expect((await calls(h, 'POST', /\/webhooks\//)).length).toBe(1);
  });

  it('waits for room in the channel’s webhook allowance when the bot is paused before its queued post goes out', async () => {
    const { h, a, bot } = await adopted({ sender: { enqueue: async () => {} } });
    await give(h, a);
    await staffAdd(h, bot);
    const msg = await json(await post(h, a, say('Queued while the bot still worked')));
    expect(msg.status).toBe('queued');
    bot.guilds.push(OTHER_SERVER);
    await laterCheck(h);
    await channelFull(h);

    expect(await processSend(h.relay, msg.id)).toMatchObject({ retry: true });
    expect((await row(h, msg.id))!.status).toBe('queued');
    expect(await calls(h, 'POST', /\/webhooks\//)).toEqual([]);

    h.advance(60_000);
    await processSend(h.relay, msg.id);
    expect(await row(h, msg.id)).toMatchObject({ status: 'sent', bot_user_id: null });
    expect((await calls(h, 'POST', /\/webhooks\//)).length).toBe(1);
  });

  it('drops a post queued in a private conversation the agent has left, without bringing its bot back in', async () => {
    const { h, a, bot } = await adopted({ sender: { enqueue: async () => {} } });
    await give(h, a);
    await staffAdd(h, bot);
    const other = await seedAgent(h.relay, { level: 3 });
    const conv = await json(await h.call('POST', '/v1/conversations', { channel_id: LOUNGE, invite: [a.id] }, h.as(other.token)));
    await h.call('POST', `/v1/conversations/${conv.id}/accept`, undefined, h.as(a.token));
    const msg = await json(await post(h, a, say('Queued before I left', { thread_id: conv.id })));
    expect(msg.status).toBe('queued');
    expect((await h.call('POST', `/v1/conversations/${conv.id}/leave`, undefined, h.as(a.token))).status).toBe(204);

    await processSend(h.relay, msg.id);
    expect(await row(h, msg.id)).toMatchObject({ status: 'failed', status_reason: 'You left this conversation before the message could be sent.' });
    expect(await calls(h, 'PUT', new RegExp(`/thread-members/${BOT_ID}$`))).toEqual([]);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM bot_grants WHERE thread_id = ?').bind(conv.id).first()).toEqual({ n: 0 });
    expect((await calls(h, 'POST', /\/channels\/\d+\/messages$/)).filter(asBot)).toEqual([]);
    expect(await calls(h, 'POST', /\/webhooks\//)).toEqual([]);
  });
});

describe('intake', () => {
  it('takes the bot’s post as the agent’s when the Gateway shows it before Discord answers, and anything else it posts as a bot’s', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    // Discord's answer is lost: the send is uncertain until the Gateway shows the message.
    h.setDiscord(() => new Response('upstream error', { status: 502 }));
    const msg = await json(await post(h, a, say('Did this one arrive?')));
    expect(msg.status).toBe('uncertain');

    const author = { id: BOT_ID, username: 'Wren', bot: true };
    const create = (id: string, content: string) => ({
      kind: 'message_create',
      channel_id: LOUNGE,
      message_id: id,
      author,
      content,
      timestamp: h.now().toISOString(),
    });
    await ingest(h.relay, {
      source: 'test',
      events: [create('320000000000000001', 'Did this one arrive?'), create('320000000000000002', 'Not through the relay')],
    });
    expect(await row(h, msg.id)).toMatchObject({ status: 'sent', discord_message_id: '320000000000000001' });
    const kinds = await h.db
      .prepare(
        'SELECT CAST(message_id AS TEXT) AS id, author_kind, agent_id FROM conversation WHERE message_id IN (320000000000000001, 320000000000000002) ORDER BY message_id',
      )
      .all();
    expect(kinds.results).toEqual([
      { id: '320000000000000001', author_kind: 'agent', agent_id: a.id },
      { id: '320000000000000002', author_kind: 'bot', agent_id: null },
    ]);
  });
});
