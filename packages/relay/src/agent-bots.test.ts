import { describe, expect, it } from 'vitest';
import { calls, converse, json, mod, patch, post, remove, row, say } from './posting-fixtures';
import { botsJob } from './services/bots';
import { ingest } from './services/intake';
import { updateSettings } from './services/settings';
import { ADMIN_DISCORD, GUILD, LOUNGE, application, harness, seedAgent, seedChannel, seedOwner, type Harness } from './testing';

// An adopted agent's own Discord bot (#84): the relay checks the token, posts as the bot once staff add it, and goes back to
// the channel's webhook when the bot can't be used.

const BOT_ID = '500000000000000001';
const APP_ID = '500000000000000002';
const BOT_TOKEN = 'NTAwMDAwMDAwMDAwMDAwMDAx.GxYz12.an-agents-own-bot-token-for-tests';
const AGENTS_ROLE = '130000000000000001';
const OTHER_SERVER = '100000000000000099';

/** A Discord where the agent's bot (BOT_TOKEN) and the relay's own bot both answer; `bot` is the agent's bot as Discord sees it. */
function discordWithBot(h: Harness) {
  const bot = { guilds: [] as string[], roles: [] as string[], public: true, username: 'helper-bot', revoked: false };
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
      if (path === '/applications/@me') {
        if (req.method === 'PATCH') bot.public = body.bot_public;
        return Response.json({ id: APP_ID, name: 'helper', bot_public: bot.public });
      }
      if (path === '/users/@me/guilds') return Response.json(bot.guilds.map((id) => ({ id, name: 'a server' })));
      if (path === '/gateway/bot') return Response.json({ url: 'wss://gateway.discord.gg', shards: 1, session_start_limit: {} });
      const channel = /^\/channels\/(\d+)\/messages/.exec(path)?.[1];
      if (channel) return Response.json(message(channel, body.content));
      return Response.json({ message: 'Unknown', code: 0 }, { status: 404 });
    }
    // The relay's own bot, and the channel's webhook.
    if (/^\/guilds\/\d+\/members\/\d+$/.test(path))
      return bot.guilds.includes(GUILD) ? Response.json({ roles: bot.roles }) : Response.json({ message: 'Unknown Member', code: 10007 }, { status: 404 });
    const role = /^\/guilds\/\d+\/members\/\d+\/roles\/(\d+)$/.exec(path)?.[1];
    if (role) {
      bot.roles = req.method === 'PUT' ? [...bot.roles, role] : bot.roles.filter((r) => r !== role);
      return new Response(null, { status: 204 });
    }
    if (req.method === 'DELETE') return new Response(null, { status: 204 });
    if (path === '/applications/@me') return Response.json(application([ADMIN_DISCORD]));
    return Response.json(message(LOUNGE, body.content));
  });
  return bot;
}

async function adopted() {
  const h = harness({ moderator: mod() });
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

describe('giving the relay a bot', () => {
  it('checks the token, makes the bot private, connects it once, gives it the agent’s name and avatar, and keeps the token sealed', async () => {
    const { h, a, bot } = await adopted();
    const res = await give(h, a);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      bot: { bot_user_id: BOT_ID, application_id: APP_ID, username: 'Wren', status: 'waiting', paused_reason: null, created_at: h.now().toISOString() },
    });
    expect(bot.public).toBe(false);
    expect(h.identified).toEqual([BOT_TOKEN]);
    const [identity] = await calls(h, 'PATCH', /\/users\/@me$/);
    expect(identity!.body).toMatchObject({ username: 'Wren', avatar: expect.stringMatching(/^data:image\/png;base64,/) });

    const stored = await h.db.prepare('SELECT token_ciphertext FROM agent_bots WHERE agent_id = ?').bind(a.id).first<{ token_ciphertext: string }>();
    expect(stored!.token_ciphertext).not.toContain(BOT_TOKEN);
    expect(await (await h.call('GET', '/v1/me/bot', undefined, h.as(a.token))).text()).not.toContain(BOT_TOKEN);
  });

  it('refuses an orphan, and a bot that is in another server', async () => {
    const { h, owner, bot } = await adopted();
    const orphan = await seedAgent(h.relay);
    expect((await give(h, orphan)).status).toBe(403);

    bot.guilds.push(OTHER_SERVER);
    const adoptee = await seedAgent(h.relay, { ownerId: owner.id });
    const res = await give(h, adoptee);
    expect(res.status).toBe(422);
    expect((await json(res)).detail).toMatch(/in another server/);
    expect(await h.db.prepare('SELECT COUNT(*) AS n FROM agent_bots').first()).toEqual({ n: 0 });
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
    h.advance(15 * 60_000);
    await botsJob(h.relay, { deadline: Date.now() + 10_000 });

    const { bot: status } = await json(await h.call('GET', '/v1/me/bot', undefined, h.as(a.token)));
    expect(status).toMatchObject({ status: 'paused', paused_reason: expect.stringMatching(/joined another server/) });
    expect(bot.roles).toEqual([]);
    expect((await json(await post(h, a, say('Back on the webhook')))).status).toBe('sent');
    expect((await calls(h, 'POST', /\/channels\/\d+\/messages$/)).filter(asBot)).toEqual([]);
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
    await ingest(h.relay, { source: 'test', events: [create('320000000000000001', 'Did this one arrive?'), create('320000000000000002', 'Not through the relay')] });
    expect(await row(h, msg.id)).toMatchObject({ status: 'sent', discord_message_id: '320000000000000001' });
    const kinds = await h.db
      .prepare('SELECT CAST(message_id AS TEXT) AS id, author_kind, agent_id FROM conversation WHERE message_id IN (320000000000000001, 320000000000000002) ORDER BY message_id')
      .all();
    expect(kinds.results).toEqual([
      { id: '320000000000000001', author_kind: 'agent', agent_id: a.id },
      { id: '320000000000000002', author_kind: 'bot', agent_id: null },
    ]);
  });
});
