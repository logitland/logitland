import { describe, expect, it, vi } from 'vitest';
import {
  DiscordRest,
  Permission,
  RateLimitedError,
  UncertainSendError,
  canReadHistory,
  canSend,
  canView,
  channelPermissions,
  parseWebhookUrl,
  readRateLimit,
  redactWebhook,
} from './index';

const GUILD = '100000000000000001';
const MEMBER = { userId: '200000000000000001', roleIds: ['300000000000000001'] };
const roles = [
  { id: GUILD, permissions: String(Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.READ_MESSAGE_HISTORY) },
  { id: '300000000000000001', permissions: '0' },
];

describe('channelPermissions', () => {
  it('uses @everyone and role permissions as the base', () => {
    expect(canSend(channelPermissions(GUILD, roles, MEMBER, []))).toBe(true);
  });

  it('applies @everyone deny, then role allow, then member deny, in that order', () => {
    const p = channelPermissions(GUILD, roles, MEMBER, [
      { id: GUILD, type: 0, allow: '0', deny: String(Permission.VIEW_CHANNEL) },
      { id: '300000000000000001', type: 0, allow: String(Permission.VIEW_CHANNEL), deny: '0' },
      { id: MEMBER.userId, type: 1, allow: '0', deny: String(Permission.SEND_MESSAGES) },
    ]);
    expect(canView(p)).toBe(true);
    expect(canSend(p)).toBe(false);
  });

  it('role deny wins only when no role allows the same bit', () => {
    const p = channelPermissions(GUILD, roles, { ...MEMBER, roleIds: ['300000000000000001', '300000000000000002'] }, [
      { id: '300000000000000001', type: 0, allow: '0', deny: String(Permission.READ_MESSAGE_HISTORY) },
      { id: '300000000000000002', type: 0, allow: String(Permission.READ_MESSAGE_HISTORY), deny: '0' },
    ]);
    expect(canReadHistory(p)).toBe(true);
  });

  it('treats missing VIEW_CHANNEL as no access at all', () => {
    const p = channelPermissions(GUILD, roles, MEMBER, [{ id: GUILD, type: 0, allow: '0', deny: String(Permission.VIEW_CHANNEL) }]);
    expect(canSend(p)).toBe(false);
    expect(canReadHistory(p)).toBe(false);
  });

  it('lets ADMINISTRATOR bypass overwrites', () => {
    const p = channelPermissions(
      GUILD,
      [...roles, { id: '300000000000000009', permissions: String(Permission.ADMINISTRATOR) }],
      { ...MEMBER, roleIds: ['300000000000000009'] },
      [{ id: GUILD, type: 0, allow: '0', deny: String(Permission.VIEW_CHANNEL) }],
    );
    expect(canView(p)).toBe(true);
  });
});

describe('webhook URLs', () => {
  it('parses and redacts', () => {
    const ref = parseWebhookUrl('https://discord.com/api/webhooks/123456789012345678/abc-DEF_123');
    expect(ref).toEqual({ id: '123456789012345678', token: 'abc-DEF_123' });
    expect(redactWebhook(ref!)).toBe('wh_…5678');
    expect(parseWebhookUrl('https://evil.example/api/webhooks/1/2')).toBeNull();
  });
});

describe('DiscordRest', () => {
  const hook = { id: '123456789012345678', token: 'tok' };

  it('executes with wait=true and no parsed mentions', async () => {
    const f = vi.fn(async () => Response.json({ id: '1', channel_id: '2', content: 'hi', timestamp: '', edited_timestamp: null }));
    await new DiscordRest({ fetch: f as unknown as typeof fetch }).executeWebhook(hook, { content: 'hi', username: 'Orrery' }, '999999999999999999');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('wait=true');
    expect(url).toContain('thread_id=999999999999999999');
    expect(JSON.parse(String(init.body)).allowed_mentions).toEqual({ parse: [] });
  });

  it('turns 429 into RateLimitedError using Retry-After', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ retry_after: 64.57, global: false }), { status: 429, headers: { 'retry-after': '65', 'x-ratelimit-scope': 'shared' } }),
    );
    const err = await new DiscordRest({ fetch: f as unknown as typeof fetch }).executeWebhook(hook, { content: 'x', username: 'y' }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterSeconds).toBe(65);
    expect(err.rateLimit.scope).toBe('shared');
  });

  it('reports a transport failure while sending as uncertain', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('network reset');
    });
    await expect(new DiscordRest({ fetch: f as unknown as typeof fetch }).executeWebhook(hook, { content: 'x', username: 'y' })).rejects.toBeInstanceOf(
      UncertainSendError,
    );
  });

  it('treats a 5xx or an unreadable 2xx as uncertain, and only 4xx as refused', async () => {
    const rest = (res: () => Response) => new DiscordRest({ fetch: (async () => res()) as unknown as typeof fetch });
    await expect(rest(() => new Response('bad gateway', { status: 502 })).executeWebhook(hook, { content: 'x', username: 'y' })).rejects.toBeInstanceOf(
      UncertainSendError,
    );
    await expect(rest(() => new Response('{not json', { status: 200 })).executeWebhook(hook, { content: 'x', username: 'y' })).rejects.toBeInstanceOf(
      UncertainSendError,
    );
    const refused = await rest(() => Response.json({ message: 'Unknown Webhook', code: 10015 }, { status: 404 }))
      .executeWebhook(hook, { content: 'x', username: 'y' })
      .catch((e) => e);
    expect(refused).not.toBeInstanceOf(UncertainSendError);
    expect(refused.status).toBe(404);
  });

  it('returns rate-limit headers with a posted message', async () => {
    const f = async () =>
      Response.json(
        { id: '1', channel_id: '2', content: 'hi', timestamp: '', edited_timestamp: null },
        { headers: { 'x-ratelimit-remaining': '4', 'x-ratelimit-reset-after': '2' } },
      );
    const { message, rateLimit } = await new DiscordRest({ fetch: f as unknown as typeof fetch }).executeWebhook(hook, { content: 'hi', username: 'Orrery' });
    expect(message.id).toBe('1');
    expect(rateLimit).toMatchObject({ remaining: 4, resetAfterSeconds: 2 });
  });

  it('counts deleting an already-deleted message as done', async () => {
    const f = async () => Response.json({ message: 'Unknown Message', code: 10008 }, { status: 404 });
    await expect(new DiscordRest({ fetch: f as unknown as typeof fetch }).deleteWebhookMessage(hook, '1')).resolves.toBeUndefined();
  });

  it('calls the setup, thread and command endpoints with the bot token', async () => {
    const calls: [string, RequestInit][] = [];
    const f = async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return init.method === 'PUT' && url.includes('/commands')
        ? Response.json([])
        : Response.json({ id: '9', token: 't', channel_id: '1', name: 'x', type: 11, guild_id: '2' });
    };
    const rest = new DiscordRest({ botToken: 'b', fetch: f as unknown as typeof fetch });
    await rest.getGuildChannels('2');
    await rest.createWebhook('1', 'Logitland relay', 'Relaying this channel');
    await rest.startThreadFromMessage('1', '5', { name: 'Ideas', auto_archive_duration: 1440 });
    await rest.createMessage('1', { content: 'hi' });
    await rest.putGuildCommands('3', '2', [{ name: 'consent', description: 'd' }]);
    await rest.getCurrentApplication();
    const paths = calls.map(([u, i]) => `${i.method} ${new URL(u).pathname}`);
    expect(paths).toEqual([
      'GET /api/v10/guilds/2/channels',
      'POST /api/v10/channels/1/webhooks',
      'POST /api/v10/channels/1/messages/5/threads',
      'POST /api/v10/channels/1/messages',
      'PUT /api/v10/applications/3/guilds/2/commands',
      'GET /api/v10/applications/@me',
    ]);
    for (const [, init] of calls) expect((init.headers as Record<string, string>).authorization).toBe('Bot b');
    expect(JSON.parse(String(calls[3]![1].body)).allowed_mentions).toEqual({ parse: [] });
  });

  it('sends forum tags through the webhook', async () => {
    const f = vi.fn(async () => Response.json({ id: '1', channel_id: '2', content: '', timestamp: '', edited_timestamp: null }));
    await new DiscordRest({ fetch: f as unknown as typeof fetch }).executeWebhook(hook, {
      username: 'Orrery',
      thread_name: 'Q',
      applied_tags: ['7'],
      content: 'hi',
    });
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.applied_tags).toEqual(['7']);
  });

  it('sends an audit-log reason with changes the server log shows', async () => {
    const f = vi.fn(async () => Response.json({ id: '9', token: 't' }));
    await new DiscordRest({ botToken: 'b', fetch: f as unknown as typeof fetch }).createWebhook('1', 'Logitland relay', 'Relaying this channel');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/channels/1/webhooks');
    expect((init.headers as Record<string, string>)['x-audit-log-reason']).toBe(encodeURIComponent('Relaying this channel'));
  });

  it('reads optional rate-limit headers', () => {
    expect(readRateLimit(new Headers())).toMatchObject({ limit: null, remaining: null, bucket: null });
    expect(readRateLimit(new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1.5' }))).toMatchObject({
      remaining: 0,
      resetAfterSeconds: 1.5,
    });
  });
});
