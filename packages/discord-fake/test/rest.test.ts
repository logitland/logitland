// The relay's own DiscordRest client, pointed at the fake: every call in packages/discord/src/rest.ts, plus the refusals
// the relay depends on (Discord's error codes, rate limits, 5xx, slow and dropped connections).

import { DiscordError, DiscordRest, MESSAGE_CONTENT_FLAGS, RateLimitedError, UncertainSendError, type WebhookRef } from '@logitland/discord';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChannelType, Permission, snowflakeTime, type DiscordFake } from '../src/index.ts';
import { fixture, sleep, type Fixture } from './helpers.ts';

let f: Fixture;
let fake: DiscordFake;
let bot: DiscordRest;
let anonymous: DiscordRest;
const ref = (h: { id: string; token: string }): WebhookRef => ({ id: h.id, token: h.token });

beforeAll(async () => {
  f = await fixture();
  fake = f.fake;
  bot = new DiscordRest({ botToken: fake.botToken, base: fake.apiBase });
  anonymous = new DiscordRest({ base: fake.apiBase });
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.reset({ messages: true });
  fake.setRateLimits({ enforce: false, webhook: { limit: 5, windowMs: 2000 } });
});

const refusal = async (p: Promise<unknown>): Promise<DiscordError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof DiscordError) return err;
    throw err;
  }
  throw new Error('Expected Discord to refuse');
};

describe('execute webhook', () => {
  it('posts as the agent and returns the message with wait=true', async () => {
    const { message } = await bot.executeWebhook(ref(f.textHook), { content: 'hello', username: 'Atlas' });
    expect(message).toMatchObject({ channel_id: f.text.id, content: 'hello', webhook_id: f.textHook.id, type: 0, edited_timestamp: null });
    expect(message.author).toMatchObject({ id: f.textHook.id, username: 'Atlas', bot: true, discriminator: '0000' });
    expect(message.id).toMatch(/^\d{17,20}$/);
    // Snowflakes carry the creation time.
    expect(Math.abs(snowflakeTime(message.id) - Date.now())).toBeLessThan(5000);
    expect(fake.webhookMessages(f.text.id)).toHaveLength(1);
  });

  it('sends the username override, allowed_mentions with no parsing, and waits for confirmation', async () => {
    await bot.executeWebhook(ref(f.textHook), { content: 'hi', username: 'Atlas' });
    const [r] = fake.requestsTo('webhook.execute');
    expect(r!.query).toMatchObject({ wait: 'true' });
    expect(r!.body).toMatchObject({ content: 'hi', username: 'Atlas', allowed_mentions: { parse: [] } });
    expect(r!.headers['user-agent']).toMatch(/^DiscordBot \(/);
    expect(r!.headers.authorization).toBeUndefined();
  });

  it('does not ping anyone when mentions are not parsed', async () => {
    const { message } = await bot.executeWebhook(ref(f.textHook), { content: `<@${f.alice.id}> and @everyone`, username: 'Atlas' });
    expect((message as unknown as { mentions: unknown[] }).mentions).toEqual([]);
    expect((message as unknown as { mention_everyone: boolean }).mention_everyone).toBe(false);
    // The same text with Discord's defaults would have pinged.
    const res = await fetch(`${fake.apiBase}/webhooks/${f.textHook.id}/${f.textHook.token}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `<@${f.alice.id}> and @everyone` }),
    });
    const loud = (await res.json()) as { mentions: { id: string }[]; mention_everyone: boolean };
    expect(loud.mentions.map((u) => u.id)).toEqual([f.alice.id]);
    expect(loud.mention_everyone).toBe(true);
  });

  it('answers 204 without wait', async () => {
    const res = await fetch(`${fake.apiBase}/webhooks/${f.textHook.id}/${f.textHook.token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'quiet' }),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(fake.webhookMessages(f.text.id)).toHaveLength(1);
  });

  it('uses the webhook name when no username is given', async () => {
    const res = await fetch(`${fake.apiBase}/webhooks/${f.textHook.id}/${f.textHook.token}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'no name' }),
    });
    expect(((await res.json()) as { author: { username: string } }).author.username).toBe(f.textHook.name);
  });

  it('starts a forum post with thread_name; the thread ID is the starter message ID', async () => {
    const { message } = await bot.executeWebhook(ref(f.forumHook), {
      content: 'first post',
      username: 'Atlas',
      thread_name: 'A topic',
      applied_tags: [f.forum.available_tags![0]!.id],
    });
    expect(message.channel_id).toBe(message.id);
    const thread = await bot.getChannel(message.id);
    expect(thread).toMatchObject({ id: message.id, type: ChannelType.publicThread, parent_id: f.forum.id, name: 'A topic' });
    expect((thread as unknown as { applied_tags: string[] }).applied_tags).toEqual([f.forum.available_tags![0]!.id]);
    expect(fake.messages(message.id)).toHaveLength(1);
  });

  it('replies into a forum thread with thread_id', async () => {
    const { message: first } = await bot.executeWebhook(ref(f.forumHook), { content: 'first', username: 'Atlas', thread_name: 'Topic' });
    const { message: reply } = await bot.executeWebhook(ref(f.forumHook), { content: 'second', username: 'Atlas' }, first.id);
    expect(reply.channel_id).toBe(first.id);
    expect(fake.messages(first.id).map((m) => m.content)).toEqual(['first', 'second']);
    expect(fake.requestsTo('webhook.execute')[1]!.query.thread_id).toBe(first.id);
  });

  it('starts media posts the same way', async () => {
    const { message } = await bot.executeWebhook(ref(f.mediaHook), { content: 'a picture, honest', username: 'Atlas', thread_name: 'Gallery' });
    expect((await bot.getChannel(message.id)).parent_id).toBe(f.media.id);
  });

  it('refuses thread_name outside forum and media channels (220003)', async () => {
    const err = await refusal(bot.executeWebhook(ref(f.textHook), { content: 'x', username: 'A', thread_name: 'nope' }));
    expect(err).toMatchObject({ status: 400, code: 220003 });
    expect(fake.webhookMessages(f.text.id)).toHaveLength(0);
    expect(await refusal(bot.executeWebhook(ref(f.announcementHook), { content: 'x', username: 'A', thread_name: 'nope' }))).toMatchObject({ code: 220003 });
  });

  it('refuses a forum post with neither thread_id nor thread_name (220001) and with both (220002)', async () => {
    expect(await refusal(bot.executeWebhook(ref(f.forumHook), { content: 'x', username: 'A' }))).toMatchObject({ status: 400, code: 220001 });
    expect(await refusal(bot.executeWebhook(ref(f.mediaHook), { content: 'x', username: 'A' }))).toMatchObject({ code: 220001 });
    const { message } = await bot.executeWebhook(ref(f.forumHook), { content: 'x', username: 'A', thread_name: 'T' });
    expect(await refusal(bot.executeWebhook(ref(f.forumHook), { content: 'x', username: 'A', thread_name: 'T2' }, message.id))).toMatchObject({ code: 220002 });
  });

  it('refuses an unknown tag (10087) and a thread from another channel (10003)', async () => {
    expect(
      await refusal(bot.executeWebhook(ref(f.forumHook), { content: 'x', username: 'A', thread_name: 'T', applied_tags: ['100000000000000000'] })),
    ).toMatchObject({ code: 10087 });
    const { message } = await bot.executeWebhook(ref(f.forumHook), { content: 'x', username: 'A', thread_name: 'T' });
    expect(await refusal(bot.executeWebhook(ref(f.mediaHook), { content: 'y', username: 'A' }, message.id))).toMatchObject({ status: 404, code: 10003 });
  });

  it('posts into a thread of a text channel and brings an archived thread back', async () => {
    const starter = fake.say(f.text.id, { as: f.alice, content: 'let us talk' });
    const thread = fake.startThread(f.text.id, starter.id, 'Talk', f.alice);
    fake.world.updateThread(thread.id, { archived: true });
    const { message } = await bot.executeWebhook(ref(f.textHook), { content: 'in the thread', username: 'A' }, thread.id);
    expect(message.channel_id).toBe(thread.id);
    expect(fake.world.channel(thread.id).thread_metadata?.archived).toBe(false);
  });

  it('posts into a private thread the bot opened, through the channel’s own webhook (#32)', async () => {
    const thread = await bot.createPrivateThread(f.text.id, { name: 'Atlas, Borealis' });
    expect(thread).toMatchObject({ type: ChannelType.privateThread, parent_id: f.text.id, thread_metadata: { archived: false, invitable: false } });
    const { message } = await bot.executeWebhook(ref(f.textHook), { content: 'just us', username: 'Quill' }, thread.id);
    expect(message).toMatchObject({ channel_id: thread.id, webhook_id: f.textHook.id });
  });

  it('refuses an empty message (50006), long text (50035) and reserved usernames', async () => {
    expect(await refusal(bot.executeWebhook(ref(f.textHook), { content: '', username: 'A' }))).toMatchObject({ status: 400, code: 50006 });
    const long = await refusal(bot.executeWebhook(ref(f.textHook), { content: 'x'.repeat(2001), username: 'A' }));
    expect(long).toMatchObject({ status: 400, code: 50035 });
    expect(await refusal(bot.executeWebhook(ref(f.textHook), { content: 'x', username: 'Discord Helper' }))).toMatchObject({ code: 50035 });
  });

  it('words username refusals as the staging server did (#61)', async () => {
    const execute = async (username: string) => {
      const res = await fetch(`${fake.apiBase}/webhooks/${f.textHook.id}/${f.textHook.token}?wait=true`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'x', username }),
      });
      return {
        status: res.status,
        body: (await res.json()) as { author?: { username: string }; errors?: { username: { _errors: { code: string; message: string }[] } } },
      };
    };
    const errors = async (username: string) => (await execute(username)).body.errors?.username._errors;
    const first = async (username: string) => (await errors(username))?.[0];
    expect(await first('my discord bot')).toEqual({ code: 'USERNAME_INVALID_CONTAINS', message: 'Username cannot contain "discord"' });
    expect(await first('Clyde helper')).toEqual({ code: 'USERNAME_INVALID_CONTAINS', message: 'Username cannot contain "clyde"' });
    expect(await errors('   ')).toEqual([
      { code: 'BASE_TYPE_BAD_LENGTH', message: 'Must be between 1 and 80 in length.' },
      { code: 'USERNAME_INVALID', message: 'Username cannot be ""' },
    ]);
    expect(await first('a'.repeat(81))).toEqual({ code: 'BASE_TYPE_BAD_LENGTH', message: 'Must be between 1 and 80 in length.' });
    expect((await execute('a'.repeat(80))).body.author?.username).toBe('a'.repeat(80));
  });

  it('refuses an unknown webhook (10015) and a wrong token (50027)', async () => {
    expect(await refusal(bot.executeWebhook({ id: '100000000000000000', token: 'whatever' }, { content: 'x', username: 'A' }))).toMatchObject({
      status: 404,
      code: 10015,
    });
    expect(await refusal(bot.executeWebhook({ id: f.textHook.id, token: 'wrong' }, { content: 'x', username: 'A' }))).toMatchObject({
      status: 401,
      code: 50027,
    });
  });

  it('needs no bot token on webhook routes', async () => {
    await expect(anonymous.executeWebhook(ref(f.textHook), { content: 'no bot', username: 'A' })).resolves.toBeTruthy();
  });

  it('requires a JSON content type', async () => {
    const res = await fetch(`${fake.apiBase}/webhooks/${f.textHook.id}/${f.textHook.token}?wait=true`, { method: 'POST', body: 'content=hi' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: number }).code).toBe(50035);
    const bad = await fetch(`${fake.apiBase}/webhooks/${f.textHook.id}/${f.textHook.token}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{nope',
    });
    expect(((await bad.json()) as { code: number }).code).toBe(50109);
  });
});

describe('rate limit headers', () => {
  it('are on every webhook response, counted per webhook', async () => {
    const first = await bot.executeWebhook(ref(f.textHook), { content: '1', username: 'A' });
    const second = await bot.executeWebhook(ref(f.textHook), { content: '2', username: 'A' });
    expect(first.rateLimit).toMatchObject({ limit: 5, remaining: 4, bucket: expect.any(String) });
    expect(second.rateLimit.remaining).toBe(3);
    expect(second.rateLimit.resetAfterSeconds).toBeGreaterThan(0);
    // Another webhook has its own bucket.
    const other = await bot.executeWebhook(ref(f.mediaHook), { content: '1', username: 'A', thread_name: 'T' });
    expect(other.rateLimit.remaining).toBe(4);
    // Errors carry them too.
    const res = await fetch(`${fake.apiBase}/webhooks/${f.textHook.id}/${f.textHook.token}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"content":""}',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('x-ratelimit-limit')).toBe('5');
    expect(res.headers.get('x-ratelimit-reset')).toMatch(/^\d+\.\d{3}$/);
  });

  it('become a 429 when enforced', async () => {
    fake.setRateLimits({ enforce: true });
    for (let i = 0; i < 5; i++) await bot.executeWebhook(ref(f.textHook), { content: `m${i}`, username: 'A' });
    const err = await bot.executeWebhook(ref(f.textHook), { content: 'one too many', username: 'A' }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterSeconds).toBeGreaterThan(0);
    expect(fake.webhookMessages(f.text.id)).toHaveLength(5);
    await sleep(2100);
    await expect(bot.executeWebhook(ref(f.textHook), { content: 'again', username: 'A' })).resolves.toBeTruthy();
  });
});

describe('programmed failures', () => {
  it('429: Retry-After and x-ratelimit-* reach the client, and nothing is posted', async () => {
    fake.fail({ route: 'webhook.execute' }, { type: 'rate_limit', retryAfter: 2.5 });
    const err = (await bot.executeWebhook(ref(f.textHook), { content: 'x', username: 'A' }).catch((e) => e)) as RateLimitedError;
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterSeconds).toBe(3);
    expect(err.rateLimit).toMatchObject({ remaining: 0, scope: 'user', global: false });
    expect(fake.webhookMessages(f.text.id)).toHaveLength(0);
    // The rule fired once; the next call goes through.
    await expect(bot.executeWebhook(ref(f.textHook), { content: 'x', username: 'A' })).resolves.toBeTruthy();
  });

  it('429 global', async () => {
    fake.fail({ route: 'webhook.execute' }, { type: 'rate_limit', retryAfter: 1, global: true });
    const err = (await bot.executeWebhook(ref(f.textHook), { content: 'x', username: 'A' }).catch((e) => e)) as RateLimitedError;
    expect(err.rateLimit).toMatchObject({ global: true, scope: 'global' });
  });

  it('5xx is an uncertain send', async () => {
    fake.fail({ route: 'webhook.*' }, { type: 'status', status: 503 });
    const err = await bot.executeWebhook(ref(f.textHook), { content: 'x', username: 'A' }).catch((e) => e);
    expect(err).toBeInstanceOf(UncertainSendError);
    expect(fake.requestsTo('webhook.execute')[0]).toMatchObject({ status: 503, injected: 'status' });
    expect(fake.webhookMessages(f.text.id)).toHaveLength(0);
  });

  it('a dropped connection before processing posts nothing; after processing it posts and tells nobody', async () => {
    fake.fail({ route: 'webhook.execute' }, { type: 'drop' });
    expect(await bot.executeWebhook(ref(f.textHook), { content: 'lost', username: 'A' }).catch((e) => e)).toBeInstanceOf(UncertainSendError);
    expect(fake.webhookMessages(f.text.id)).toHaveLength(0);

    fake.fail({ route: 'webhook.execute' }, { type: 'drop', phase: 'after' });
    expect(await bot.executeWebhook(ref(f.textHook), { content: 'posted but unreported', username: 'A' }).catch((e) => e)).toBeInstanceOf(UncertainSendError);
    expect(fake.webhookMessages(f.text.id).map((m) => m.content)).toEqual(['posted but unreported']);
    expect(fake.requests.at(-1)).toMatchObject({ status: 0, injected: 'drop' });
  });

  it('a slow answer times the client out', async () => {
    const slowBot = new DiscordRest({ botToken: fake.botToken, base: fake.apiBase, timeoutMs: 200 });
    fake.fail({ route: 'webhook.execute' }, { type: 'slow', ms: 600 });
    expect(await slowBot.executeWebhook(ref(f.textHook), { content: 'slow', username: 'A' }).catch((e) => e)).toBeInstanceOf(UncertainSendError);
    // Before processing: the message arrives only after the delay, if at all; wait it out.
    await sleep(700);
    expect(fake.webhookMessages(f.text.id)).toHaveLength(1);
  });

  it('a slow answer after processing has the message in place already', async () => {
    const slowBot = new DiscordRest({ botToken: fake.botToken, base: fake.apiBase, timeoutMs: 200 });
    fake.fail({ route: 'webhook.execute' }, { type: 'slow', ms: 600, phase: 'after' });
    expect(await slowBot.executeWebhook(ref(f.textHook), { content: 'slow', username: 'A' }).catch((e) => e)).toBeInstanceOf(UncertainSendError);
    expect(fake.webhookMessages(f.text.id)).toHaveLength(1);
  });

  it('matches by channel, method and times, and can be removed', async () => {
    const rule = fake.fail({ channelId: f.media.id }, { type: 'status', status: 500 }, { times: Infinity });
    await expect(bot.executeWebhook(ref(f.textHook), { content: 'fine', username: 'A' })).resolves.toBeTruthy();
    expect(await bot.executeWebhook(ref(f.mediaHook), { content: 'x', username: 'A', thread_name: 'T' }).catch((e) => e)).toBeInstanceOf(UncertainSendError);
    expect(await bot.executeWebhook(ref(f.mediaHook), { content: 'x', username: 'A', thread_name: 'T' }).catch((e) => e)).toBeInstanceOf(UncertainSendError);
    expect(rule.hits).toBe(2);
    rule.remove();
    await expect(bot.executeWebhook(ref(f.mediaHook), { content: 'x', username: 'A', thread_name: 'T' })).resolves.toBeTruthy();
  });
});

describe('webhook messages', () => {
  it('edits and deletes only its own messages, in threads with thread_id', async () => {
    const { message } = await bot.executeWebhook(ref(f.textHook), { content: 'draft', username: 'A' });
    const edited = await bot.editWebhookMessage(ref(f.textHook), message.id, 'final');
    expect(edited).toMatchObject({ id: message.id, content: 'final' });
    expect(edited.edited_timestamp).not.toBeNull();
    expect(fake.requestsTo('webhook.message.edit')[0]!.body).toMatchObject({ content: 'final', allowed_mentions: { parse: [] } });

    const person = fake.say(f.text.id, { as: f.alice, content: 'mine' });
    expect(await refusal(bot.editWebhookMessage(ref(f.textHook), person.id, 'hijack'))).toMatchObject({ status: 404, code: 10008 });
    expect(await refusal(bot.editWebhookMessage(ref(f.mediaHook), message.id, 'wrong webhook'))).toMatchObject({ code: 10008 });

    await bot.deleteWebhookMessage(ref(f.textHook), message.id);
    expect(fake.messages(f.text.id).map((m) => m.id)).toEqual([person.id]);
    // A message that is already gone counts as removed.
    await expect(bot.deleteWebhookMessage(ref(f.textHook), message.id)).resolves.toBeUndefined();
    expect(fake.requestsTo('webhook.message.delete').map((r) => r.status)).toEqual([204, 404]);

    const { message: first } = await bot.executeWebhook(ref(f.forumHook), { content: 'first', username: 'A', thread_name: 'T' });
    const { message: reply } = await bot.executeWebhook(ref(f.forumHook), { content: 'reply', username: 'A' }, first.id);
    expect(await refusal(bot.editWebhookMessage(ref(f.forumHook), reply.id, 'no thread id'))).toMatchObject({ code: 10008 });
    expect(await bot.editWebhookMessage(ref(f.forumHook), reply.id, 'with thread id', first.id)).toMatchObject({ content: 'with thread id' });
    await bot.deleteWebhookMessage(ref(f.forumHook), reply.id, first.id);
    expect(fake.messages(first.id)).toHaveLength(1);
  });

  it('GET webhook returns where it posts', async () => {
    const info = await bot.getWebhook(ref(f.forumHook));
    expect(info).toMatchObject({ id: f.forumHook.id, channel_id: f.forum.id, guild_id: f.guild.id });
    expect(await refusal(bot.getWebhook({ id: f.forumHook.id, token: 'nope' }))).toMatchObject({ status: 401, code: 50027 });
  });
});

describe('bot routes', () => {
  it('need Authorization: Bot <token>', async () => {
    await expect(anonymous.getGatewayBot()).rejects.toThrow('bot token');
    const none = await fetch(`${fake.apiBase}/gateway/bot`);
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ message: '401: Unauthorized', code: 0 });
    const wrong = new DiscordRest({ botToken: 'wrong', base: fake.apiBase });
    expect(await refusal(wrong.getCurrentUser())).toMatchObject({ status: 401, code: 0 });
    const bearer = await fetch(`${fake.apiBase}/users/@me`, { headers: { authorization: `Bearer ${fake.botToken}` } });
    expect(bearer.status).toBe(401);
  });

  it('GET /gateway/bot hands out the fake Gateway URL', async () => {
    const info = await bot.getGatewayBot();
    expect(info.url).toBe(`ws://127.0.0.1:${fake.port}/gateway`);
    expect(info).toMatchObject({ shards: 1, session_start_limit: { total: 1000, remaining: 1000, max_concurrency: 1 } });
    expect(info.session_start_limit.reset_after).toBeGreaterThan(0);
  });

  it('GET /users/@me and /applications/@me', async () => {
    expect(await bot.getCurrentUser()).toMatchObject({ id: fake.application.id, bot: true });
    const app = await bot.getCurrentApplication();
    expect(app).toMatchObject({ id: fake.application.id, interactions_endpoint_url: null });
    expect(app.flags! & MESSAGE_CONTENT_FLAGS).not.toBe(0);
    fake.application.interactions_endpoint_url = 'http://127.0.0.1:1/discord/interactions';
    expect((await bot.getCurrentApplication()).interactions_endpoint_url).toBe('http://127.0.0.1:1/discord/interactions');
    fake.application.interactions_endpoint_url = null;
  });

  it('/applications/@me names one owner, or the Developer team that owns the bot', async () => {
    const solo = await bot.getCurrentApplication();
    expect(solo).toMatchObject({ owner: { id: fake.application.owner_id }, team: null });
    fake.application.team = [f.alice.id];
    const owned = await bot.getCurrentApplication();
    expect(owned.team?.members).toEqual([
      expect.objectContaining({ user: expect.objectContaining({ id: f.alice.id, username: 'alice' }), membership_state: 2 }),
    ]);
    expect(owned.owner?.id).toBe(owned.team?.id);
    fake.application.team = null;
  });

  it('message content flags follow the setup', async () => {
    const before = fake.application.flags;
    fake.application.flags = 0;
    expect((await bot.getCurrentApplication()).flags! & MESSAGE_CONTENT_FLAGS).toBe(0);
    fake.application.flags = before;
  });

  it('GET /guilds/:id/channels, /roles and /members/:id', async () => {
    const channels = await bot.getGuildChannels(f.guild.id);
    expect(channels.map((c) => c.id).sort()).toEqual([f.text.id, f.announcement.id, f.forum.id, f.media.id].sort());
    expect(channels.find((c) => c.id === f.forum.id)).toMatchObject({ type: 15, available_tags: [{ name: 'idea' }, { name: 'question' }] });
    expect(channels.find((c) => c.id === f.media.id)?.type).toBe(16);
    expect(channels.find((c) => c.id === f.announcement.id)?.type).toBe(5);
    const roles = await bot.getGuildRoles(f.guild.id);
    expect(roles.map((r) => (r as unknown as { name: string }).name)).toEqual(expect.arrayContaining(['@everyone', 'Relay', 'Mirror']));
    expect(await bot.getGuildMember(f.guild.id, f.alice.id)).toMatchObject({ user: { id: f.alice.id, username: 'alice' }, roles: [] });
    expect(await refusal(bot.getGuildMember(f.guild.id, '100000000000000000'))).toMatchObject({ status: 404, code: 10007 });
    expect(await refusal(bot.getGuildChannels('100000000000000000'))).toMatchObject({ status: 404, code: 10004 });
  });

  it('GET /channels/:id', async () => {
    expect(await bot.getChannel(f.text.id)).toMatchObject({ id: f.text.id, type: 0, guild_id: f.guild.id, name: 'lounge' });
    expect(await refusal(bot.getChannel('100000000000000000'))).toMatchObject({ status: 404, code: 10003 });
  });

  it('POST /channels/:id/webhooks creates a webhook that works', async () => {
    const created = await bot.createWebhook(f.announcement.id, 'Relay', 'testing');
    expect(created).toMatchObject({ channel_id: f.announcement.id, name: 'Relay' });
    const { message } = await bot.executeWebhook(created, { content: 'from the new hook', username: 'A' });
    expect(message.channel_id).toBe(f.announcement.id);
    expect(fake.requestsTo('channel.webhooks.create')[0]!.headers['x-audit-log-reason']).toBe('testing');
    expect(await refusal(bot.createWebhook(f.announcement.id, 'My Discord bot', 'x'))).toMatchObject({ code: 50035 });
  });

  it('DELETE /webhooks/:id/:token deletes a webhook, and a second delete counts as done', async () => {
    const created = await bot.createWebhook(f.announcement.id, 'Short-lived', 'testing');
    await bot.deleteWebhook(created);
    expect(fake.world.webhooks.has(created.id)).toBe(false);
    expect(await refusal(bot.executeWebhook(created, { content: 'gone', username: 'A' }))).toMatchObject({ status: 404, code: 10015 });
    await expect(bot.deleteWebhook(created)).resolves.toBeUndefined();
  });

  it('needs Manage Webhooks to create one', async () => {
    const poor = fake.addGuild({ name: 'poor', botPermissions: Permission.viewChannel | Permission.sendMessages });
    const channel = fake.addChannel(poor.id, { name: 'general' });
    expect(await refusal(bot.createWebhook(channel.id, 'Relay', 'x'))).toMatchObject({ status: 403, code: 50013 });
  });
});

describe('channel messages', () => {
  it('pages newest first; after returns the page closest to the cursor', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(fake.say(f.text.id, { as: f.alice, content: `m${i}` }).id);
    const newest = await bot.getChannelMessages(f.text.id, { limit: 3 });
    expect(newest.map((m) => m.content)).toEqual(['m6', 'm5', 'm4']);
    const before = await bot.getChannelMessages(f.text.id, { before: ids[4], limit: 2 });
    expect(before.map((m) => m.content)).toEqual(['m3', 'm2']);
    const after = await bot.getChannelMessages(f.text.id, { after: ids[1], limit: 3 });
    expect(after.map((m) => m.content)).toEqual(['m4', 'm3', 'm2']);
    expect((await bot.getChannelMessages(f.text.id, { after: ids[6] })).length).toBe(0);
    expect((await bot.getChannelMessages(f.text.id)).length).toBe(7);
    expect(fake.requestsTo('channel.messages.list').at(-1)!.query).toEqual({ limit: '100' });
  });

  it('rejects out-of-range limits and combined cursors', async () => {
    const res = await fetch(`${fake.apiBase}/channels/${f.text.id}/messages?limit=101`, { headers: { authorization: `Bot ${fake.botToken}` } });
    expect(res.status).toBe(400);
    const both = await fetch(`${fake.apiBase}/channels/${f.text.id}/messages?before=1&after=2`, { headers: { authorization: `Bot ${fake.botToken}` } });
    expect(both.status).toBe(400);
  });

  it('adds and removes private thread members, but not while the thread is archived (50083)', async () => {
    const thread = await bot.createPrivateThread(f.text.id, { name: 'Members' });
    await bot.addThreadMember(thread.id, f.alice.id);
    expect([...fake.world.threadMembers.get(thread.id)!]).toEqual([fake.world.botUser.id, f.alice.id]);
    await bot.setThreadArchived(thread.id, true);
    expect((await refusal(bot.removeThreadMember(thread.id, f.alice.id))).code).toBe(50083);
    await bot.setThreadArchived(thread.id, false);
    await bot.removeThreadMember(thread.id, f.alice.id);
    expect([...fake.world.threadMembers.get(thread.id)!]).toEqual([fake.world.botUser.id]);
    expect((await refusal(bot.addThreadMember(thread.id, '299999999999999999'))).code).toBe(10007);
  });

  it('needs Create Private Threads to open a private thread', async () => {
    const closed = fake.addChannel(f.guild.id, { name: 'no-private', overwrites: [{ id: f.guild.botRoleId, deny: Permission.createPrivateThreads }] });
    expect((await refusal(bot.createPrivateThread(closed.id, { name: 'Nope' }))).code).toBe(50013);
  });

  it('reads threads by their own ID', async () => {
    const { message } = await bot.executeWebhook(ref(f.forumHook), { content: 'in a thread', username: 'A', thread_name: 'T' });
    expect((await bot.getChannelMessages(message.id)).map((m) => m.content)).toEqual(['in a thread']);
  });

  it('hides other people’s text unless Message Content is enabled for the application', async () => {
    const mine = await bot.createMessage(f.text.id, { content: 'from the bot' });
    fake.say(f.text.id, { as: f.alice, content: 'secret words' });
    await bot.executeWebhook(ref(f.textHook), { content: 'webhook words', username: 'A' });
    const before = fake.application.flags;
    fake.application.flags = 0;
    const blind = await bot.getChannelMessages(f.text.id);
    expect(blind.map((m) => m.content)).toEqual(['', '', mine.content]);
    expect(blind.find((m) => m.id === mine.id)?.content).toBe('from the bot');
    fake.application.flags = before;
    expect((await bot.getChannelMessages(f.text.id)).map((m) => m.content)).toEqual(['webhook words', 'secret words', 'from the bot']);
  });

  it('shows who wrote what: people, webhooks and the bot', async () => {
    fake.say(f.text.id, { as: f.alice, content: 'hi' });
    await bot.executeWebhook(ref(f.textHook), { content: 'ho', username: 'Atlas' });
    const [hook, person] = await bot.getChannelMessages(f.text.id);
    expect(person!.author).toMatchObject({ id: f.alice.id, username: 'alice', global_name: 'Alice' });
    expect(person!.author?.bot).toBeUndefined();
    expect(hook).toMatchObject({ webhook_id: f.textHook.id });
    expect(hook!.author).toMatchObject({ username: 'Atlas', bot: true });
  });
});

describe('bot messages and threads', () => {
  it('posts a message as the bot, with mentions off', async () => {
    const message = await bot.createMessage(f.text.id, { content: 'Welcome' });
    expect(message).toMatchObject({ author: { id: fake.application.id, bot: true }, content: 'Welcome' });
    expect(fake.requestsTo('channel.messages.create')[0]!.body).toMatchObject({ allowed_mentions: { parse: [] } });
  });

  it('refuses empty messages', async () => {
    expect(await refusal(bot.createMessage(f.text.id, { content: '' }))).toMatchObject({ code: 50006 });
  });

  it('cannot post straight into a forum (40058)', async () => {
    expect(await refusal(bot.createMessage(f.forum.id, { content: 'x' }))).toMatchObject({ status: 400, code: 40058 });
  });

  it('starts a thread from a message in a text channel; the thread ID is the message ID; one thread per message', async () => {
    const m = fake.say(f.text.id, { as: f.alice, content: 'start here' });
    const thread = await bot.startThreadFromMessage(f.text.id, m.id, { name: 'Discussion', auto_archive_duration: 1440 });
    expect(thread).toMatchObject({ id: m.id, type: ChannelType.publicThread, parent_id: f.text.id, name: 'Discussion' });
    expect(await refusal(bot.startThreadFromMessage(f.text.id, m.id, { name: 'Again' }))).toMatchObject({ status: 400, code: 160004 });
    expect(fake.world.findMessage(f.text.id, m.id).flags & (1 << 5)).not.toBe(0);
  });

  it('starts announcement threads (type 10) but not in forums or media', async () => {
    const m = fake.say(f.announcement.id, { as: f.alice, content: 'news' });
    expect(await bot.startThreadFromMessage(f.announcement.id, m.id, { name: 'About the news' })).toMatchObject({
      id: m.id,
      type: ChannelType.announcementThread,
    });
    const { message } = await bot.executeWebhook(ref(f.forumHook), { content: 'post', username: 'A', thread_name: 'T' });
    expect(await refusal(bot.startThreadFromMessage(f.forum.id, message.id, { name: 'no' }))).toMatchObject({ status: 400, code: 50024 });
    expect(await refusal(bot.startThreadFromMessage(f.text.id, '100000000000000000', { name: 'ghost' }))).toMatchObject({ status: 404, code: 10008 });
  });

  it('validates thread names and archive durations', async () => {
    const m = fake.say(f.text.id, { as: f.alice, content: 'x' });
    expect(await refusal(bot.startThreadFromMessage(f.text.id, m.id, { name: '' }))).toMatchObject({ code: 50035 });
    expect(await refusal(bot.startThreadFromMessage(f.text.id, m.id, { name: 'ok', auto_archive_duration: 5 as 60 }))).toMatchObject({ code: 50035 });
  });
});

describe('guild commands', () => {
  const mirror = {
    name: 'mirror',
    type: 1,
    description: 'Join or leave the public mirror',
    options: [
      { type: 1, name: 'agree', description: 'Agree' },
      { type: 1, name: 'leave', description: 'Leave' },
    ],
  };

  it('PUT replaces the list, GET reads it back, and IDs survive a second PUT', async () => {
    expect(await bot.getGuildCommands(fake.application.id, f.guild.id)).toEqual([]);
    const [first] = await bot.putGuildCommands(fake.application.id, f.guild.id, [mirror]);
    expect(first).toMatchObject({ name: 'mirror', application_id: fake.application.id, guild_id: f.guild.id, type: 1 });
    expect(first!.id).toMatch(/^\d{17,20}$/);
    expect((await bot.getGuildCommands(fake.application.id, f.guild.id)).map((c) => c.name)).toEqual(['mirror']);
    const [again] = await bot.putGuildCommands(fake.application.id, f.guild.id, [mirror]);
    expect(again!.id).toBe(first!.id);
    expect(await bot.putGuildCommands(fake.application.id, f.guild.id, [])).toEqual([]);
  });

  it('validates names, descriptions and the application', async () => {
    expect(await refusal(bot.putGuildCommands(fake.application.id, f.guild.id, [{ ...mirror, name: 'Mirror' }]))).toMatchObject({ status: 400, code: 50035 });
    expect(await refusal(bot.putGuildCommands(fake.application.id, f.guild.id, [{ ...mirror, description: '' }]))).toMatchObject({ code: 50035 });
    expect(await refusal(bot.putGuildCommands(fake.application.id, f.guild.id, [mirror, mirror]))).toMatchObject({ code: 50035 });
    expect(await refusal(bot.getGuildCommands('100000000000000000', f.guild.id))).toMatchObject({ status: 403, code: 50001 });
  });
});

describe('unknown routes', () => {
  it('answer like Discord', async () => {
    const missing = await fetch(`${fake.apiBase}/nothing/here`, { headers: { authorization: `Bot ${fake.botToken}` } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ message: '404: Not Found', code: 0 });
    const wrong = await fetch(`${fake.apiBase}/users/@me`, { method: 'DELETE', headers: { authorization: `Bot ${fake.botToken}` } });
    expect(wrong.status).toBe(405);
    expect(fake.requestsTo()[0]).toMatchObject({ route: 'unknown', status: 404 });
  });

  it('serves /api/v9 too', async () => {
    const res = await fetch(`${fake.url}/api/v9/users/@me`, { headers: { authorization: `Bot ${fake.botToken}` } });
    expect(res.status).toBe(200);
  });
});
