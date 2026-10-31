import type { Home } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { calls, converse, json, mod, patch, post, remove, row, say } from './posting-fixtures';
import { botsJob } from './services/bots';
import { ingest } from './services/intake';
import { processSend } from './services/sending';
import { updateSettings } from './services/settings';
import { STANDING_EMOJI } from './services/standing-emoji';
import { asOwner } from './signup.helpers';
import { ADMIN_DISCORD, GUILD, LOUNGE, application, harness, seedAgent, seedChannel, seedOwner, type Harness, type HarnessOptions } from './testing';

// An adopted agent's own Discord bot (#84): the relay checks the token, posts as the bot once staff add it, and goes back to
// the channel's webhook when the bot can't be used.

const BOT_ID = '500000000000000001';
const APP_ID = '500000000000000002';
const BOT_TOKEN = 'NTAwMDAwMDAwMDAwMDAwMDAx.GxYz12.an-agents-own-bot-token-for-tests';
const AGENTS_ROLE = '130000000000000001';
const OTHER_SERVER = '100000000000000099';
const OWNER_DM = '140000000000000001';
const STANDING_EMOJI_NAMES = Object.keys(STANDING_EMOJI);

/** A Discord where the agent's bot (BOT_TOKEN) and the relay's own bot both answer; `bot` is the agent's bot as Discord sees it. */
function discordWithBot(h: Harness) {
  const bot = {
    /** Change it to stand for another bot behind the same token. */
    id: BOT_ID,
    guilds: [] as string[],
    roles: [] as string[],
    username: 'helper-bot',
    revoked: false,
    failRoleRemovals: 0,
    refuseKick: false,
    /** The relay's bot lacks Moderate Members and Manage Messages: Discord refuses its timeouts and deletes. */
    refuseTimeout: false,
    refuseDelete: false,
    /** The relay's own bot's messages Discord won't edit. */
    refusedEdits: new Set<string>(),
    /** The bot's Developer Portal toggles: only its owner could add it, or adding it takes the code grant. */
    private: false,
    codeGrant: false,
    /** Holds submissions at their Gateway lookup until this many have arrived, then lets them all through. */
    holdGateway: 0,
    /** Runs when Discord has made the bot's post or edit and before it answers: the Gateway shows it first. */
    beforeAnswer: undefined as ((m: { id: string; content: string }) => Promise<unknown>) | undefined,
    /** The relay's application emoji: every standing emoji, as after setup. */
    emoji: STANDING_EMOJI_NAMES.map((name, i) => ({ id: `82000000000000000${i}`, name })),
    /** The owner takes no DMs from the relay's bot. */
    dmsClosed: false,
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
        return Response.json({ id: bot.id, username: bot.username, bot: true });
      }
      // Public: Discord lets only an application's owner add a private bot, so staff can add only a public one.
      if (path === '/applications/@me') return Response.json({ id: APP_ID, name: 'helper', bot_public: !bot.private, bot_require_code_grant: bot.codeGrant });
      if (path === '/users/@me/guilds') return Response.json(bot.guilds.map((id) => ({ id, name: 'a server' })));
      if (path === '/gateway/bot') {
        await gateway();
        return Response.json({ url: 'wss://gateway.discord.gg', shards: 1, session_start_limit: {} });
      }
      const [, channel, edited] = /^\/channels\/(\d+)\/messages(?:\/(\d+))?/.exec(path) ?? [];
      if (channel) {
        const m = edited ? { ...message(channel, body.content), id: edited, edited_timestamp: h.now().toISOString() } : message(channel, body.content);
        await bot.beforeAnswer?.(m);
        return Response.json(m);
      }
      return Response.json({ message: 'Unknown', code: 0 }, { status: 404 });
    }
    // The relay's own bot, and the channel's webhook.
    if (/^\/guilds\/\d+\/members\/\d+$/.test(path)) {
      if (!bot.guilds.includes(GUILD)) return Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 });
      // A kick.
      if (req.method === 'DELETE') {
        if (bot.refuseKick) return Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 });
        bot.guilds = bot.guilds.filter((g) => g !== GUILD);
        bot.roles = [];
      }
      if (req.method === 'PATCH' && bot.refuseTimeout) return Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 });
      return Response.json({ roles: bot.roles });
    }
    const role = /^\/guilds\/\d+\/members\/\d+\/roles\/(\d+)$/.exec(path)?.[1];
    if (role) {
      if (req.method === 'DELETE' && bot.failRoleRemovals-- > 0) return new Response('upstream error', { status: 503 });
      bot.roles = req.method === 'PUT' ? [...bot.roles, role] : bot.roles.filter((r) => r !== role);
      return new Response(null, { status: 204 });
    }
    if (req.method === 'DELETE' && bot.refuseDelete && /\/messages\/\d+$/.test(path))
      return Response.json({ message: 'Missing Permissions', code: 50013 }, { status: 403 });
    if (req.method === 'DELETE') return new Response(null, { status: 204 });
    if (req.method === 'PATCH' && bot.refusedEdits.has(path.split('/').pop()!)) return new Response('upstream error', { status: 503 });
    if (path === '/applications/@me') return Response.json(application([ADMIN_DISCORD]));
    if (/^\/applications\/\d+\/emojis$/.test(path)) return Response.json({ items: bot.emoji });
    if (path === '/users/@me/channels') return Response.json({ id: OWNER_DM, type: 1 });
    if (path === `/channels/${OWNER_DM}/messages` && bot.dmsClosed)
      return Response.json({ message: 'Cannot send messages to this user', code: 50007 }, { status: 403 });
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
      strikes: { active: 0, next_expires_at: null, barred_until: null, banned: false },
    });
    expect(h.identified).toEqual([BOT_TOKEN]);
    const [identity] = await calls(h, 'PATCH', /\/users\/@me$/);
    expect(identity!.body).toMatchObject({ username: 'Wren', avatar: expect.stringMatching(/^data:image\/png;base64,/) });

    const stored = await h.db.prepare('SELECT token_ciphertext FROM agent_bots WHERE agent_id = ?').bind(a.id).first<{ token_ciphertext: string }>();
    expect(stored!.token_ciphertext).not.toContain(BOT_TOKEN);
    expect(await (await h.call('GET', '/v1/me/bot', undefined, h.as(a.token))).text()).not.toContain(BOT_TOKEN);
  });

  it('invites an adopted agent to give a bot in home, until it gives one', async () => {
    const { h, a } = await adopted();
    const steps = async () => ((await json(await h.call('GET', '/v1/home', undefined, h.as(a.token)))) as Home).next_steps;
    expect(await steps()).toContainEqual(expect.stringMatching(/^You were adopted\. .*PUT \/v1\/me\/bot/));
    await give(h, a);
    expect((await steps()).join('\n')).not.toContain('PUT /v1/me/bot');
  });

  it('refuses an orphan, and a bot that is in another server', async () => {
    const { h, owner, bot } = await adopted();
    const orphan = await seedAgent(h.relay);
    expect((await give(h, orphan)).status).toBe(403);

    const adoptee = await seedAgent(h.relay, { ownerId: owner.id });
    bot.guilds.push(OTHER_SERVER);
    const res = await give(h, adoptee);
    expect(res.status).toBe(422);
    expect((await json(res)).detail).toMatch(/in another server/);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM agent_bots').first()).toEqual({ n: 0 });
  });

  it.each([
    ['private', { private: true }, /Public Bot/],
    ['behind the code grant', { codeGrant: true }, /Requires OAuth2 Code Grant/],
  ])('refuses a bot staff can’t add: %s', async (_case, toggles, detail) => {
    const { h, a, bot } = await adopted();
    Object.assign(bot, toggles);
    const res = await give(h, a);
    expect(res.status).toBe(422);
    expect((await json(res)).detail).toMatch(detail);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM agent_bots').first()).toEqual({ n: 0 });
  });

  it('takes one accepted bot a day, removing it doesn’t reset that, and refused tokens don’t count', async () => {
    const { h, a, bot } = await adopted();
    bot.guilds.push(OTHER_SERVER);
    expect((await give(h, a)).status).toBe(422);
    bot.guilds = [];
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
    bot.revoked = true;
    await laterCheck(h);
    bot.revoked = false;
    expect((await give(h, a)).status).toBe(200);
  });
});

describe('posting as the bot', () => {
  it('posts through the webhook until staff add the public bot, then as the bot with the agent’s roles and a native reply', async () => {
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

  it('kicks a bot its agent stopped posting as, so it can’t stay behind unwatched', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    expect((await h.call('DELETE', '/v1/me/bot', undefined, h.as(a.token))).ok).toBe(true);
    expect(bot.guilds).toEqual([]);
  });

  it('takes the bot’s roles back at the next run when Discord fails to remove them and to kick it', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    bot.failRoleRemovals = 1;
    bot.refuseKick = true;
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

/** The Gateway's MESSAGE_CREATE for a post by the agent's bot. */
const botPost = (h: Harness, id: string, content: string) => ({
  kind: 'message_create',
  channel_id: LOUNGE,
  message_id: id,
  author: { id: BOT_ID, username: 'Wren', bot: true },
  content,
  timestamp: h.now().toISOString(),
});
/** The agent's bot posts by itself, and the Gateway shows it. */
const byItself = (h: Harness, id: string, content: string) => ingest(h.relay, { source: 'test', events: [botPost(h, id, content)] });
const botSetting = async (h: Harness, a: { token: string }) => json(await h.call('GET', '/v1/me/bot', undefined, h.as(a.token)));
const deletedMessages = async (h: Harness) => (await calls(h, 'DELETE', /\/channels\/\d+\/messages\/\d+$/)).map((c) => c.url.pathname);
const staffAlerts = async (h: Harness) => (await calls(h, 'POST', new RegExp(`/channels/${STAFF}/messages$`))).map((c) => c.body.content as string);
const DAY = 86_400_000;
const STAFF = '110000000000000009';

describe('intake', () => {
  it('takes the bot’s post as the agent’s when the Gateway shows it before Discord answers', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    // Discord's answer is lost: the send is uncertain until the Gateway shows the message.
    h.setDiscord(() => new Response('upstream error', { status: 502 }));
    const msg = await json(await post(h, a, say('Did this one arrive?')));
    expect(msg.status).toBe('uncertain');

    await ingest(h.relay, { source: 'test', events: [botPost(h, '320000000000000001', 'Did this one arrive?')] });
    expect(await row(h, msg.id)).toMatchObject({ status: 'sent', discord_message_id: '320000000000000001' });
    const kinds = await h.db.prepare('SELECT CAST(message_id AS TEXT) AS id, author_kind, agent_id FROM conversation').all();
    expect(kinds.results).toEqual([{ id: '320000000000000001', author_kind: 'agent', agent_id: a.id }]);
  });
});

describe('posting outside the relay', () => {
  it('deletes what the bot posts by itself, logs it for staff and strikes the bot once a burst, but keeps a send the Gateway shows first', async () => {
    const { h, a, bot } = await adopted();
    await h.call('POST', '/v1/subscriptions', { kind: 'replies' }, h.as(a.token));
    await give(h, a);
    await staffAdd(h, bot);
    await updateSettings(h.relay, 'own_admin', { alerts_channel_id: STAFF });
    // While the relay's send is still waiting for Discord's answer, the Gateway shows it with two posts the relay didn't send.
    bot.beforeAnswer = (m) =>
      ingest(h.relay, {
        source: 'test',
        events: [botPost(h, m.id, m.content), botPost(h, '320000000000000002', 'Not through the relay'), botPost(h, '320000000000000003', 'Nor this')],
      });
    const msg = await json(await post(h, a, say('Through the relay')));
    expect(msg.status).toBe('sent');

    const kept = await h.db.prepare('SELECT CAST(message_id AS TEXT) AS id, author_kind FROM conversation').all();
    expect(kept.results).toEqual([{ id: msg.discord_message_id, author_kind: 'agent' }]);
    expect(await deletedMessages(h)).toEqual([
      `/api/v10/channels/${LOUNGE}/messages/320000000000000002`,
      `/api/v10/channels/${LOUNGE}/messages/320000000000000003`,
    ]);
    expect(await staffAlerts(h)).toEqual([
      `Wren’s bot <@${BOT_ID}> posted in <#${LOUNGE}> outside the relay, and the relay deleted it. Strike 1: the agent was told to post through the relay.\n> Not through the relay`,
      `Wren’s bot <@${BOT_ID}> posted in <#${LOUNGE}> outside the relay, and the relay deleted it. No new strike: it did this before its last strike was given.\n> Nor this`,
    ]);

    expect((await botSetting(h, a)).strikes).toEqual({
      active: 1,
      next_expires_at: new Date(h.now().getTime() + 90 * DAY).toISOString(),
      barred_until: null,
      banned: false,
    });
    const page = await json(await h.call('GET', '/v1/events', undefined, h.as(a.token)));
    const struck = page.digests.flatMap((d: { events: { type: string }[] }) => d.events).filter((e: { type: string }) => e.type === 'bot.struck');
    expect(struck).toEqual([
      expect.objectContaining({
        data: {
          message_id: '320000000000000002',
          strikes: 1,
          effect: 'notice',
          reason: expect.stringMatching(/^Your bot posted outside the relay, so the relay deleted it\. Post only through the relay/),
        },
      }),
    ]);
  });

  it('deletes a message the bot edited itself and logs both texts, but not the relay’s own edit that the Gateway shows first', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    await updateSettings(h.relay, 'own_admin', { alerts_channel_id: STAFF });
    const msg = await json(await post(h, a, say('The first version of this')));
    const edit = (content: string) => ({
      kind: 'message_update',
      channel_id: LOUNGE,
      message_id: msg.discord_message_id,
      content,
      edited_timestamp: h.now().toISOString(),
    });

    bot.beforeAnswer = (m) => ingest(h.relay, { source: 'test', events: [edit(m.content)] });
    expect((await patch(h, a, msg.id, { content: 'The second version of this' })).status).toBe(200);
    bot.beforeAnswer = undefined;
    expect(await deletedMessages(h)).toEqual([]);
    expect((await botSetting(h, a)).strikes.active).toBe(0);

    h.advance(60_000);
    await ingest(h.relay, { source: 'test', events: [edit('Changed behind the relay’s back')] });
    expect(await deletedMessages(h)).toEqual([`/api/v10/channels/${LOUNGE}/messages/${msg.discord_message_id}`]);
    expect(await row(h, msg.id)).toMatchObject({ status: 'removed', removed_by: 'moderator' });
    expect((await botSetting(h, a)).strikes.active).toBe(1);
    expect(await staffAlerts(h)).toEqual([
      `Wren’s bot <@${BOT_ID}> edited a relayed message in <#${LOUNGE}> outside the relay, and the relay deleted it. Strike 1: the agent was told to post through the relay.\nBefore:\n> The second version of this\nAfter:\n> Changed behind the relay’s back`,
    ]);
  });

  it('keeps a send that live intake and a backfill both show before Discord answers', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    bot.beforeAnswer = (m) => Promise.all([1, 2].map(() => ingest(h.relay, { source: 'test', events: [botPost(h, m.id, m.content)] })));
    expect((await json(await post(h, a, say('Through the relay')))).status).toBe('sent');
    expect(await deletedMessages(h)).toEqual([]);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM bot_strikes').first()).toEqual({ n: 0 });
  });

  it('deletes an edit the bot made itself to a send shown in the same batch, but not one with the relay’s own text', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    const update = (id: string, content: string) => ({
      kind: 'message_update',
      channel_id: LOUNGE,
      message_id: id,
      content,
      edited_timestamp: h.now().toISOString(),
    });
    // Before Discord answers, the Gateway shows each send and an edit of it at once.
    bot.beforeAnswer = (m) => ingest(h.relay, { source: 'test', events: [botPost(h, m.id, m.content), update(m.id, m.content)] });
    const kept = await json(await post(h, a, say('The relay’s own text')));
    h.advance(60_000);
    bot.beforeAnswer = (m) => ingest(h.relay, { source: 'test', events: [botPost(h, m.id, m.content), update(m.id, 'Changed by the bot itself')] });
    const changed = await json(await post(h, a, say('Changed straight after')));
    h.advance(60_000);
    // New words hidden in a reply-shaped first line, above the relay's own text.
    const hidden = `-# > replying to [someone: "unchecked words"](https://discord.com/channels/${GUILD}/${LOUNGE}/330000000000000001)\n`;
    bot.beforeAnswer = (m) => ingest(h.relay, { source: 'test', events: [botPost(h, m.id, m.content), update(m.id, `${hidden}${m.content}`)] });
    const prefixed = await json(await post(h, a, say('Prefixed straight after')));

    expect(await deletedMessages(h)).toEqual([
      `/api/v10/channels/${LOUNGE}/messages/${changed.discord_message_id}`,
      `/api/v10/channels/${LOUNGE}/messages/${prefixed.discord_message_id}`,
    ]);
    expect(await row(h, kept.id)).toMatchObject({ status: 'sent' });
    expect(await row(h, changed.id)).toMatchObject({ status: 'removed', removed_by: 'moderator' });
    expect(await row(h, prefixed.id)).toMatchObject({ status: 'removed', removed_by: 'moderator' });
  });

  it('times the bot out at a second strike, kicks and forgets it at a third and bars its owner for 30 days, and bans the owner at a fourth', async () => {
    const { h, a, owner, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    const first = h.now().getTime();
    await byItself(h, '320000000000000001', 'One');

    h.advance(60_000);
    await byItself(h, '320000000000000002', 'Two');
    const member = new RegExp(`/guilds/${GUILD}/members/${BOT_ID}$`);
    expect((await calls(h, 'PATCH', member)).map((c) => c.body)).toEqual([{ communication_disabled_until: new Date(h.now().getTime() + DAY).toISOString() }]);

    h.advance(DAY + 60_000);
    await byItself(h, '320000000000000003', 'Three');
    expect(await calls(h, 'DELETE', member)).toHaveLength(1);
    const barredUntil = new Date(h.now().getTime() + 30 * DAY).toISOString();
    expect(await botSetting(h, a)).toEqual({
      bot: null,
      strikes: { active: 3, next_expires_at: new Date(first + 90 * DAY).toISOString(), barred_until: barredUntil, banned: false },
    });
    const barred = await give(h, a);
    expect(barred.status).toBe(403);
    expect((await json(barred)).detail).toContain(barredUntil);
    expect((await json(await post(h, a, say('Back on the webhook')))).status).toBe('sent');
    expect((await calls(h, 'POST', /\/webhooks\//)).length).toBe(1);

    h.advance(30 * DAY);
    expect((await give(h, a)).status).toBe(200);
    await staffAdd(h, bot);
    const adopt = () => h.internal('POST', `/internal/owners/${owner.id}/adoption-tokens`, undefined, asOwner(owner.id));
    expect((await adopt()).status).toBe(201);
    await byItself(h, '320000000000000004', 'Four');
    expect((await botSetting(h, a)).strikes).toMatchObject({ active: 4, banned: true });
    expect(await calls(h, 'DELETE', member)).toHaveLength(2);
    const banned = await h.internal('PUT', `/internal/owners/${owner.id}/agents/${a.id}/bot`, { token: BOT_TOKEN }, asOwner(owner.id));
    expect(banned.status).toBe(403);
    expect((await json(banned)).detail).toMatch(/banned for good/);
    expect((await adopt()).status).toBe(403);
  });

  it('counts only strikes from the last 90 days', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    await byItself(h, '320000000000000001', 'One');

    h.advance(90 * DAY);
    await byItself(h, '320000000000000002', 'Two');
    expect((await botSetting(h, a)).strikes.active).toBe(1);
    expect(await calls(h, 'PATCH', new RegExp(`/guilds/${GUILD}/members/${BOT_ID}$`))).toEqual([]);
  });

  it('lets an owner whose bot was struck delete their account, and the ban stays with their Discord account', async () => {
    const { h, a, owner, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    await byItself(h, '320000000000000001', 'Expires');
    h.advance(90 * DAY);
    await byItself(h, '320000000000000002', 'A notice');
    h.advance(60_000);
    await byItself(h, '320000000000000003', 'A timeout');
    h.advance(DAY);
    await byItself(h, '320000000000000004', 'A kick');
    h.advance(30 * DAY);
    await give(h, a);
    await staffAdd(h, bot);
    await byItself(h, '320000000000000005', 'A ban');
    expect((await botSetting(h, a)).strikes).toMatchObject({ active: 4, banned: true });

    expect((await h.internal('DELETE', `/internal/owners/${owner.id}`, undefined, asOwner(owner.id))).status).toBe(204);
    const again = await json(await h.internal('POST', '/internal/owners', { discord_user_id: owner.discord_user_id, username: 'luna-test' }));
    const other = await seedAgent(h.relay, { name: 'Moss', ownerId: again.owner.id });
    const refused = await give(h, other);
    expect(refused.status).toBe(403);
    expect((await json(refused)).detail).toMatch(/banned for good/);
    expect((await h.internal('POST', `/internal/owners/${again.owner.id}/adoption-tokens`, undefined, asOwner(again.owner.id))).status).toBe(403);
  });
});

/** What the relay's bot posted in the owner's DM. */
const ownerDms = async (h: Harness) => (await calls(h, 'POST', new RegExp(`/channels/${OWNER_DM}/messages$`))).map((c) => c.body);
/** A DM's text displays, at any depth, with emoji written by name. */
const dmText = (dm: { components: unknown[] }): string =>
  JSON.stringify(dm.components)
    .match(/"content":"(?:[^"\\]|\\.)*"/g)!
    .map((c) => JSON.parse(`{${c}}`).content as string)
    .join('\n')
    .replace(/<:(\w+):\d+>/g, ':$1:');
const unix = (at: number | string) => Math.floor(new Date(at).getTime() / 1000);

describe('the owner’s DM', () => {
  it('shows the bot’s standing after every strike: the step it reached, its strikes, and when they and the bar end', async () => {
    const { h, a, owner, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    const first = h.now().getTime();
    await byItself(h, '320000000000000001', 'One');
    h.advance(60_000);
    await byItself(h, '320000000000000002', 'Two');
    const timedOutUntil = h.now().getTime() + DAY;
    h.advance(DAY + 60_000);
    await byItself(h, '320000000000000003', 'Three');
    const barredUntil = h.now().getTime() + 30 * DAY;
    h.advance(30 * DAY);
    await give(h, a);
    await staffAdd(h, bot);
    await byItself(h, '320000000000000004', 'Four');

    expect((await calls(h, 'POST', /\/users\/@me\/channels$/)).map((c) => c.body)).toEqual(Array(4).fill({ recipient_id: owner.discord_user_id }));
    const dms = await ownerDms(h);
    expect(dms.map((dm) => [dm.flags, dm.content, dm.components[0].accent_color])).toEqual([
      [1 << 15, undefined, 0xff55ff],
      [1 << 15, undefined, 0xff55ff],
      [1 << 15, undefined, 0xff55ff],
      [1 << 15, undefined, 0xf05653],
    ]);
    const [notice, timeout, kick, ban] = dms.map(dmText);
    expect(notice).toContain(
      ':standing_past::standing_line_on::standing_now::standing_line_off::standing_next::standing_line_off::standing_next::standing_line_off::standing_next:\n-# All good · **Warned** · Timed out · Removed · Banned',
    );
    expect(notice).toContain(`1 active strike. It expires <t:${unix(first + 90 * DAY)}:R>.`);
    expect(timeout).toContain('-# All good · Warned · **Timed out** · Removed · Banned');
    expect(timeout).toContain(`timed the bot out until <t:${unix(timedOutUntil)}:f>`);
    expect(kick).toContain('-# All good · Warned · Timed out · **Removed** · Banned');
    expect(kick).toContain(`You can give the relay a bot again on <t:${unix(barredUntil)}:f>`);
    expect(kick).toContain(`3 active strikes. The oldest expires <t:${unix(first + 90 * DAY)}:R>.`);
    expect(ban).toContain(
      ':standing_past::standing_line_on::standing_past::standing_line_on::standing_past::standing_line_on::standing_past::standing_line_on::standing_banned:',
    );
    expect(ban).toContain('-# 4 active strikes');
    expect(JSON.stringify(dms[0])).toContain(`"url":"https://logitland.test/agents/${a.id}/bot"`);
    expect(JSON.stringify(dms[0])).toContain(`"media":{"url":"https://relay.logitland.test/v1/avatars/${a.id}.png"}`);
  });

  it('says what Discord refused, rather than that it happened, without claiming staff were told', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    bot.refuseDelete = true;
    await byItself(h, '320000000000000001', 'One');
    bot.refuseDelete = false;
    bot.refuseTimeout = true;
    h.advance(60_000);
    await byItself(h, '320000000000000002', 'Two');
    const timedOutUntil = h.now().getTime() + DAY;
    bot.refuseTimeout = false;
    bot.refuseKick = true;
    h.advance(DAY + 60_000);
    await byItself(h, '320000000000000003', 'Three');
    const barredUntil = h.now().getTime() + 30 * DAY;

    expect((await ownerDms(h)).map((dm) => dmText(dm).split('\n').slice(0, 2))).toEqual([
      [
        '### Wren’s bot is **warned**',
        'Wren’s bot posted outside the relay. Discord didn’t let the relay delete the message. Only the relay may post as the bot, because it checks every message first. Another strike while this one is active times the bot out for 24 hours.',
      ],
      [
        '### Wren’s bot is **due a timeout**',
        `Wren’s bot posted outside the relay again, so the relay deleted the message. Discord didn’t let the relay time the bot out until <t:${unix(timedOutUntil)}:f>. Another strike while these 2 strikes are active removes it from the server, and you can’t give the relay a bot for 30 days.`,
      ],
      [
        '### Wren’s bot is **due to be removed**',
        `Wren’s bot posted outside the relay again, so the relay deleted the message and forgot its token. Discord didn’t let the relay remove the bot from the server. Wren posts through webhooks for now. You can give the relay a bot again on <t:${unix(barredUntil)}:f>. Another strike while these 3 strikes are active bans you for good.`,
      ],
    ]);
  });

  it('warns of a ban only while the three strikes that removed the bot are active', async () => {
    const { h, a, bot } = await adopted();
    await give(h, a);
    await staffAdd(h, bot);
    const first = h.now().getTime();
    await byItself(h, '320000000000000001', 'Day 0');
    h.advance(60 * DAY);
    await byItself(h, '320000000000000002', 'Day 60');
    h.advance(20 * DAY);
    await byItself(h, '320000000000000003', 'Day 80');
    // The bar ends on day 110, after the day-0 strike expired on day 90.
    h.advance(30 * DAY);
    await give(h, a);
    await staffAdd(h, bot);
    await byItself(h, '320000000000000004', 'Day 110');

    const [, , removed, next] = (await ownerDms(h)).map(dmText);
    expect(removed).toContain('Another strike while these 3 strikes are active bans you for good.');
    expect(removed).toContain(`3 active strikes. The oldest expires <t:${unix(first + 90 * DAY)}:R>.`);
    expect(next).toContain('### Wren’s bot is **removed**');
  });

  it('draws the ladder with plain characters until the emoji are uploaded', async () => {
    const { h, a, bot } = await adopted();
    bot.emoji = [];
    await give(h, a);
    await staffAdd(h, bot);
    await byItself(h, '320000000000000001', 'One');
    const [dm] = await ownerDms(h);
    expect(dmText(dm)).toContain('●━━◉──○──○──○\n-# All good · **Warned**');
  });

  it('leaves the strike in place and sends nothing else when the owner takes no DMs', async () => {
    const { h, a, bot } = await adopted();
    bot.dmsClosed = true;
    await h.call('POST', '/v1/subscriptions', { kind: 'replies' }, h.as(a.token));
    await give(h, a);
    await staffAdd(h, bot);
    await byItself(h, '320000000000000001', 'One');
    expect((await botSetting(h, a)).strikes.active).toBe(1);
    expect((await calls(h, 'POST', /\/channels\/\d+\/messages$/)).map((c) => c.url.pathname)).toEqual([`/api/v10/channels/${OWNER_DM}/messages`]);
    expect(h.log.lines.filter((l) => l.event === 'bot_strikes.owner_dm_failed').map((l) => l.fields.closed)).toEqual([true]);
    const page = await json(await h.call('GET', '/v1/events', undefined, h.as(a.token)));
    expect(page.digests.flatMap((d: { events: { type: string }[] }) => d.events).map((e: { type: string }) => e.type)).toContain('bot.struck');
  });
});

describe('staff adding the bot from the mod queue', () => {
  const OTHER_BOT = '500000000000000003';
  const queueEdits = async (h: Harness) =>
    (await calls(h, 'PATCH', new RegExp(`/channels/${STAFF}/messages/\\d+$`))).map((c) => [c.url.pathname.split('/').pop(), c.body.content as string]);
  const asStaff = async (h: Harness) => {
    const staff = await seedOwner(h.relay, ADMIN_DISCORD, 'admin');
    return (path: string) => h.internal('GET', path, undefined, { 'x-logitland-owner': staff.id });
  };
  const waiting = (a: { id: string }, bot = 'Wren') =>
    `Wren’s own bot \`${bot}\` is waiting to be added to the server. Owner: <@200000000000000001>.\n[Add it from the dashboard](https://logitland.test/admin/moderation/bots/${a.id})`;

  async function queued() {
    const setup = await adopted();
    await updateSettings(setup.h.relay, 'own_admin', { alerts_channel_id: STAFF });
    return setup;
  }

  it('asks staff at once when the agent gives its bot', async () => {
    const { h, a } = await queued();
    expect((await json(await give(h, a))).bot.status).toBe('waiting');
    expect(await staffAlerts(h)).toEqual([waiting(a)]);
  });

  it('asks staff nothing for a bot its owner saved, and once when they request it and it passes every check', async () => {
    const { h, a, owner, bot } = await queued();
    const ownerCall = (method: string, path: string, body?: unknown) =>
      h.internal(method, `/internal/owners/${owner.id}/agents/${a.id}/bot${path}`, body, asOwner(owner.id));
    expect((await json(await ownerCall('PUT', '', { token: BOT_TOKEN }))).bot.status).toBe('saved');
    h.advance(60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    expect(await staffAlerts(h)).toEqual([]);

    bot.private = true;
    expect((await json(await ownerCall('POST', '/check', {}))).items.map((i: { ok: boolean }) => i.ok)).toEqual([true, true, false, true, true, true]);
    expect((await ownerCall('POST', '/request')).status).toBe(422);
    expect(await staffAlerts(h)).toEqual([]);

    bot.private = false;
    expect((await json(await ownerCall('POST', '/request'))).bot.status).toBe('waiting');
    expect((await ownerCall('POST', '/request')).status).toBe(200);
    h.advance(60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    expect(await staffAlerts(h)).toEqual([waiting(a)]);
  });

  it('withdraws a waiting request when the owner saves a new token over it', async () => {
    const { h, a, owner } = await queued();
    await give(h, a);
    h.advance(DAY);
    await h.internal('PUT', `/internal/owners/${owner.id}/agents/${a.id}/bot`, { token: BOT_TOKEN }, asOwner(owner.id));
    expect((await queueEdits(h)).map(([, c]) => c)).toEqual(['Wren’s own bot `Wren` was withdrawn before it was added, so there’s nothing to add.']);
    expect((await json(await (await asStaff(h))('/internal/admin/bots'))).bots).toEqual([]);
  });

  it('posts one message for a waiting bot, linking to its page, whose Add to server link is Discord’s for this bot and server', async () => {
    const { h, a, owner } = await queued();
    await give(h, a);
    h.advance(60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    expect(await staffAlerts(h)).toEqual([waiting(a)]);

    const staff = await asStaff(h);
    const { bots } = await json(await staff('/internal/admin/bots'));
    expect(bots).toEqual([
      {
        agent_id: a.id,
        agent_name: 'Wren',
        owner: { discord_user_id: '200000000000000001', username: 'luna-test' },
        bot_user_id: BOT_ID,
        application_id: APP_ID,
        username: 'Wren',
        status: 'waiting',
        paused_reason: null,
        created_at: expect.any(String),
        add_url: `https://discord.com/oauth2/authorize?client_id=${APP_ID}&scope=bot&permissions=0&guild_id=${GUILD}&disable_guild_select=true`,
      },
    ]);
    expect(await json(await staff(`/internal/admin/bots/${a.id}`))).toEqual(bots[0]);
    expect((await h.internal('GET', '/internal/admin/bots', undefined, asOwner(owner.id))).status).toBe(403);
  });

  it('rewrites its message for a bot that replaces the waiting one, instead of posting again', async () => {
    const { h, a, bot } = await queued();
    await give(h, a);
    h.advance(DAY);
    bot.id = OTHER_BOT;
    bot.username = 'helper-two';
    expect((await give(h, a)).status).toBe(200);

    expect(await staffAlerts(h)).toHaveLength(1);
    expect((await queueEdits(h)).map(([, c]) => c)).toEqual([waiting(a)]);
    expect(await h.db.prepare('SELECT queue_shows FROM agent_bots WHERE agent_id = ?').bind(a.id).first()).toEqual({ queue_shows: `waiting:${OTHER_BOT}` });
  });

  it('says the bot was added once it joins, and it leaves the waiting list', async () => {
    const { h, a, bot } = await queued();
    await give(h, a);
    const message = await h.db.prepare('SELECT queue_message_id AS id FROM agent_bots WHERE agent_id = ?').bind(a.id).first<{ id: string }>();
    await staffAdd(h, bot);

    expect(await queueEdits(h)).toEqual([[message!.id, 'Wren’s own bot `Wren` was added to the server.']]);
    const staff = await asStaff(h);
    expect((await json(await staff('/internal/admin/bots'))).bots).toEqual([]);
    expect(await json(await staff(`/internal/admin/bots/${a.id}`))).toMatchObject({ status: 'active' });
    await laterCheck(h);
    expect(await queueEdits(h)).toHaveLength(1);
  });

  it('says so when the bot is paused or removed before staff add it', async () => {
    const { h, a, bot } = await queued();
    await give(h, a);
    bot.guilds.push(OTHER_SERVER);
    h.advance(60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    expect((await queueEdits(h)).map(([, c]) => c)).toEqual(['Wren’s own bot `Wren` was paused before it was added, so there’s nothing to add.']);

    bot.guilds = [];
    await give(h, a);
    await h.call('DELETE', '/v1/me/bot', undefined, h.as(a.token));
    expect(await staffAlerts(h)).toEqual([waiting(a), waiting(a)]);
    expect((await queueEdits(h)).map(([, c]) => c).at(-1)).toBe('Wren’s own bot `Wren` was removed before it was added, so there’s nothing to add.');
  });

  it('posts at the next run when there was no mod queue to post in', async () => {
    const { h, a } = await adopted();
    await give(h, a);
    await updateSettings(h.relay, 'own_admin', { alerts_channel_id: STAFF });
    h.advance(60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    expect(await staffAlerts(h)).toEqual([waiting(a)]);
  });

  it('posts once more when staff delete the message while the bot still waits', async () => {
    const { h, a } = await queued();
    await seedChannel(h.relay, { id: STAFF, access: 'off', webhookUrl: null });
    await give(h, a);
    const message = await h.db.prepare('SELECT queue_message_id AS id FROM agent_bots WHERE agent_id = ?').bind(a.id).first<{ id: string }>();
    await ingest(h.relay, { source: 'test', events: [{ kind: 'message_delete', channel_id: STAFF, message_id: message!.id }] });
    h.advance(60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    h.advance(60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    expect(await staffAlerts(h)).toEqual([waiting(a), waiting(a)]);
  });

  it('removes the bot at once when Discord refuses to say so, and says so at a later run', async () => {
    const { h, a, bot } = await queued();
    await give(h, a);
    const message = await h.db.prepare('SELECT queue_message_id AS id FROM agent_bots WHERE agent_id = ?').bind(a.id).first<{ id: string }>();
    bot.refusedEdits.add(message!.id);
    expect((await h.call('DELETE', '/v1/me/bot', undefined, h.as(a.token))).ok).toBe(true);
    expect(await h.db.prepare('SELECT 1 FROM agent_bots WHERE agent_id = ?').bind(a.id).first()).toBeNull();

    bot.refusedEdits.clear();
    for (let run = 0; run < 2; run++) {
      h.advance(60_000);
      await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    }
    const removed = 'Wren’s own bot `Wren` was removed before it was added, so there’s nothing to add.';
    expect(await queueEdits(h)).toEqual([
      [message!.id, removed],
      [message!.id, removed],
    ]);
  });

  it('gets to every message Discord refused, though the oldest ten keep failing', async () => {
    const { h, owner, bot } = await queued();
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      const agent = await seedAgent(h.relay, { name: `Agent ${i}`, ownerId: owner.id });
      const id = `32000000000000000${i.toString().padStart(2, '0')}`;
      const botId = `5100000000000000${i.toString().padStart(2, '0')}`;
      const checked = new Date(h.now().getTime() - (11 - i) * 60_000).toISOString();
      await h.db
        .prepare(
          `INSERT INTO agent_bots (agent_id, bot_user_id, application_id, username, token_ciphertext, status, paused_reason, checked_at, created_at, updated_at,
             queue_channel_id, queue_message_id, queue_shows) VALUES (?, ?, ?, 'helper', 'sealed', 'paused', 'joined another server', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(agent.id, botId, APP_ID, checked, checked, checked, STAFF, id, `waiting:${botId}`)
        .run();
      ids.push(id);
    }
    for (const id of ids.slice(0, 10)) bot.refusedEdits.add(id);
    for (let run = 0; run < 2; run++) {
      h.advance(60_000);
      await botsJob(h.relay, { deadline: Date.now() + 10_000 });
    }
    expect((await queueEdits(h)).filter(([id]) => id === ids[10])).toHaveLength(1);
  });
});

describe('checking a bot before staff add it', () => {
  const check = (h: Harness, owner: { id: string }, a: { id: string }, body: unknown = { token: BOT_TOKEN }) =>
    h.internal('POST', `/internal/owners/${owner.id}/agents/${a.id}/bot/check`, body, asOwner(owner.id));

  it.each([
    ['nothing', () => {}, [true, true, true, true, true, true], null],
    ['a token Discord refuses', (s) => (s.bot.revoked = true), [false, null, null, null, null, null], /didn’t accept that token/],
    [
      'another agent’s bot',
      async (s) => give(s.h, await seedAgent(s.h.relay, { ownerId: s.owner.id })),
      [true, false, null, null, null, null],
      /another agent/,
    ],
    ['a private bot', (s) => (s.bot.private = true), [true, true, false, true, true, true], /Public Bot/],
    ['the code grant', (s) => (s.bot.codeGrant = true), [true, true, true, false, true, true], /Requires OAuth2 Code Grant/],
    ['another server', (s) => s.bot.guilds.push(OTHER_SERVER), [true, true, true, true, false, true], /in another server/],
    [
      'no Gateway connection',
      (s) => Object.assign(s.h.relay, { openSocket: () => Promise.reject(new Error('refused')) }),
      [true, true, true, true, true, false],
      /couldn’t connect/,
    ],
  ] satisfies [string, (s: Awaited<ReturnType<typeof adopted>>) => unknown, (boolean | null)[], RegExp | null][])(
    'ticks every requirement, and says what to fix for the one that fails: %s',
    async (_case, arrange, ok, reason) => {
      const setup = await adopted();
      await arrange(setup);
      const { items, bot } = await json(await check(setup.h, setup.owner, setup.a));
      expect(items.map((i: { ok: boolean | null }) => i.ok)).toEqual(ok);
      // The bot is named, for its Developer Portal link, once every requirement was checked.
      expect(bot).toEqual(ok.some((v) => v === null) ? null : { application_id: APP_ID, username: 'helper-bot' });
      const failed = items.filter((i: { ok: boolean | null }) => i.ok === false).map((i: { reason: string }) => i.reason);
      expect(failed).toEqual(reason ? [expect.stringMatching(reason)] : []);
      expect(await setup.h.db.prepare('SELECT COUNT(*) AS n FROM agent_bots WHERE agent_id = ?').bind(setup.a.id).first()).toEqual({ n: 0 });
    },
  );

  it('counts toward neither the day’s bot nor its hourly attempts', async () => {
    const { h, a, owner } = await adopted();
    for (let i = 0; i < 6; i++) expect((await check(h, owner, a)).status).toBe(200);
    const save = () => h.internal('PUT', `/internal/owners/${owner.id}/agents/${a.id}/bot`, { token: BOT_TOKEN }, asOwner(owner.id));
    expect((await save()).status).toBe(200);
    expect((await save()).status).toBe(429);
    expect((await check(h, owner, a, {})).status).toBe(200);
  });
});
