// A small Discord REST client for what the relay needs: execute and edit webhook messages,
// and read guild members, roles and channels for access checks.
// https://docs.discord.com/developers/resources/webhook#execute-webhook
// https://docs.discord.com/developers/topics/rate-limits

import type { Overwrite, Role } from './permissions';

export const DISCORD_API = 'https://discord.com/api/v10';

export interface RateLimit {
  limit: number | null;
  remaining: number | null;
  resetAfterSeconds: number | null;
  bucket: string | null;
  /** Only on 429: user, global or shared. */
  scope: string | null;
  global: boolean;
}

/** Rate-limit headers are optional; every field may be null. */
export function readRateLimit(headers: Headers): RateLimit {
  const num = (name: string) => {
    const v = headers.get(name);
    return v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);
  };
  return {
    limit: num('x-ratelimit-limit'),
    remaining: num('x-ratelimit-remaining'),
    resetAfterSeconds: num('x-ratelimit-reset-after'),
    bucket: headers.get('x-ratelimit-bucket'),
    scope: headers.get('x-ratelimit-scope'),
    global: headers.get('x-ratelimit-global') === 'true',
  };
}

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
    readonly rateLimit: RateLimit,
  ) {
    super(message);
    this.name = 'DiscordError';
  }
}

export class RateLimitedError extends DiscordError {
  constructor(
    readonly retryAfterSeconds: number,
    rateLimit: RateLimit,
  ) {
    super(`Rate limited for ${retryAfterSeconds}s (${rateLimit.scope ?? 'unknown'} scope)`, 429, null, rateLimit);
    this.name = 'RateLimitedError';
  }
}

/** The request may or may not have reached Discord (timeout, reset connection). */
export class UncertainSendError extends Error {
  constructor(override readonly cause: unknown) {
    super('The request may have reached Discord; its result is unknown');
    this.name = 'UncertainSendError';
  }
}

export interface WebhookRef {
  id: string;
  token: string;
}

const WEBHOOK_URL = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{17,20})\/([\w-]+)$/;

export function parseWebhookUrl(url: string): WebhookRef | null {
  const m = WEBHOOK_URL.exec(url.trim());
  return m ? { id: m[1]!, token: m[2]! } : null;
}

/** For logs and dashboards: never show the token. */
export function redactWebhook(ref: WebhookRef): string {
  return `wh_…${ref.id.slice(-4)}`;
}

export interface ExecuteWebhookBody {
  content?: string;
  username: string;
  avatar_url?: string;
  /** Forum and media channels only: starts a post with this title. */
  thread_name?: string;
  /** Forum and media channels only: tag IDs for the new post. */
  applied_tags?: string[];
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  webhook_id?: string;
  application_id?: string;
  author?: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  /** 0 default, 19 reply; others are system messages. */
  type?: number;
}

export interface GatewayBot {
  url: string;
  shards: number;
  session_start_limit: { total: number; remaining: number; reset_after: number; max_concurrency: number };
}

export interface WebhookInfo {
  id: string;
  channel_id: string;
  guild_id?: string;
}

export interface GuildMember {
  user?: { id: string; username: string };
  roles: string[];
}

export interface ForumTag {
  id: string;
  name: string;
  moderated?: boolean;
  emoji_name?: string | null;
}

export interface GuildChannel {
  id: string;
  guild_id: string;
  name: string;
  /** 0 text, 5 announcement, 10/11/12 threads, 15 forum, 16 media; others are voice and categories. */
  type: number;
  parent_id?: string | null;
  position?: number;
  permission_overwrites?: Overwrite[];
  available_tags?: ForumTag[];
  thread_metadata?: { archived: boolean; locked?: boolean; auto_archive_duration?: number };
}

export interface CurrentApplication {
  id: string;
  name: string;
  /** GATEWAY_MESSAGE_CONTENT is 1 << 18 (100+ servers), GATEWAY_MESSAGE_CONTENT_LIMITED is 1 << 19 (under 100). */
  flags?: number;
  interactions_endpoint_url?: string | null;
  /** The person who owns the application; for a team-owned one, a stand-in user for the team. */
  owner?: DiscordUser;
  /** The Developer Portal team that owns the application, if one does. */
  team?: Team | null;
}

/** 1 invited, 2 accepted. Only accepted members are on the team. */
export const TEAM_MEMBER_ACCEPTED = 2;

/** https://docs.discord.com/developers/topics/teams */
export interface Team {
  id: string;
  name: string;
  owner_user_id: string;
  members: { user: DiscordUser; membership_state: number; role: string }[];
}

export interface CreatedWebhook {
  id: string;
  token: string;
  channel_id: string;
  name?: string | null;
}

export interface ApplicationCommand {
  id?: string;
  name: string;
  description: string;
  type?: number;
  options?: readonly unknown[];
}

/** Bit flags on the application that show the Message Content intent is on. */
export const MESSAGE_CONTENT_FLAGS = (1 << 18) | (1 << 19);

export interface RestOptions {
  botToken?: string;
  fetch?: typeof fetch;
  base?: string;
  timeoutMs?: number;
  userAgent?: string;
}

export class DiscordRest {
  private readonly f: typeof fetch;
  constructor(private readonly opts: RestOptions = {}) {
    this.f = opts.fetch ?? fetch.bind(globalThis);
  }

  /** The API root calls go to: Discord's, or a development fake. */
  get apiBase(): string {
    return this.opts.base ?? DISCORD_API;
  }

  /**
   * Posts as the agent. Always waits for Discord to save the message and never parses mentions.
   * Only a definite refusal (400, 401, 403, 404) is a DiscordError and a 429 is RateLimitedError: neither posted.
   * A lost connection, a 5xx or 408, or a 2xx whose body can't be read is UncertainSendError: it may have posted.
   */
  async executeWebhook(hook: WebhookRef, body: ExecuteWebhookBody, threadId?: string): Promise<{ message: DiscordMessage; rateLimit: RateLimit }> {
    const q = new URLSearchParams({ wait: 'true' });
    if (threadId) q.set('thread_id', threadId);
    return this.post<DiscordMessage>(`/webhooks/${hook.id}/${hook.token}?${q}`, { ...body, allowed_mentions: { parse: [] } });
  }

  /** Removes a message this webhook posted. A message that is already gone counts as removed. */
  async deleteWebhookMessage(hook: WebhookRef, messageId: string, threadId?: string): Promise<void> {
    const q = threadId ? `?${new URLSearchParams({ thread_id: threadId })}` : '';
    try {
      await this.send<void>('DELETE', `/webhooks/${hook.id}/${hook.token}/messages/${messageId}${q}`, undefined, false);
    } catch (err) {
      if (err instanceof DiscordError && err.status === 404) return;
      throw err;
    }
  }

  /** Which channel a webhook posts to; used to check a pasted webhook URL belongs to the channel. */
  getWebhook(hook: WebhookRef): Promise<WebhookInfo> {
    return this.send<WebhookInfo>('GET', `/webhooks/${hook.id}/${hook.token}`, undefined, false);
  }

  /** Up to 100 messages, oldest first when paging with `after`. Content needs the Message Content intent. */
  getChannelMessages(channelId: string, page: { after?: string; before?: string; limit?: number } = {}): Promise<DiscordMessage[]> {
    const q = new URLSearchParams({ limit: String(Math.min(Math.max(page.limit ?? 100, 1), 100)) });
    if (page.after) q.set('after', page.after);
    if (page.before) q.set('before', page.before);
    return this.send<DiscordMessage[]>('GET', `/channels/${channelId}/messages?${q}`, undefined, true);
  }

  /** The Gateway URL and how many sessions the bot may still start today. */
  getGatewayBot(): Promise<GatewayBot> {
    return this.send<GatewayBot>('GET', '/gateway/bot', undefined, true);
  }

  getCurrentUser(): Promise<DiscordUser> {
    return this.send<DiscordUser>('GET', '/users/@me', undefined, true);
  }

  /** The bot's application: its flags, interactions URL, and who owns it (a team, or one person). */
  getCurrentApplication(): Promise<CurrentApplication> {
    return this.send<CurrentApplication>('GET', '/applications/@me', undefined, true);
  }

  getGuildChannels(guildId: string): Promise<GuildChannel[]> {
    return this.send<GuildChannel[]>('GET', `/guilds/${guildId}/channels`, undefined, true);
  }

  /** Needs Manage Webhooks. Names can't contain "clyde" or "discord". */
  createWebhook(channelId: string, name: string, reason: string): Promise<CreatedWebhook> {
    return this.send<CreatedWebhook>('POST', `/channels/${channelId}/webhooks`, { name }, true, false, reason);
  }

  /** Deletes a webhook with its own token. One that is already gone counts as deleted. */
  async deleteWebhook(hook: WebhookRef): Promise<void> {
    try {
      await this.send<void>('DELETE', `/webhooks/${hook.id}/${hook.token}`, undefined, false);
    } catch (err) {
      if (err instanceof DiscordError && err.status === 404) return;
      throw err;
    }
  }

  /** Text and announcement channels only; a message can have one thread. Needs Create Public Threads. */
  startThreadFromMessage(
    channelId: string,
    messageId: string,
    thread: { name: string; auto_archive_duration?: 60 | 1440 | 4320 | 10080 },
  ): Promise<GuildChannel> {
    return this.send<GuildChannel>('POST', `/channels/${channelId}/messages/${messageId}/threads`, thread, true);
  }

  /** A message from the bot itself, for example an alert in the staff channel. Mentions are off. */
  createMessage(channelId: string, body: { content: string }): Promise<DiscordMessage> {
    return this.send<DiscordMessage>('POST', `/channels/${channelId}/messages`, { ...body, allowed_mentions: { parse: [] } }, true);
  }

  getGuildCommands(applicationId: string, guildId: string): Promise<ApplicationCommand[]> {
    return this.send<ApplicationCommand[]>('GET', `/applications/${applicationId}/guilds/${guildId}/commands`, undefined, true);
  }

  /** Replaces every guild command with this list. */
  putGuildCommands(applicationId: string, guildId: string, commands: readonly ApplicationCommand[]): Promise<ApplicationCommand[]> {
    return this.send<ApplicationCommand[]>('PUT', `/applications/${applicationId}/guilds/${guildId}/commands`, commands, true);
  }

  /** Discord does not keep allowed_mentions from the original message, so it is sent again. */
  async editWebhookMessage(hook: WebhookRef, messageId: string, content: string, threadId?: string): Promise<DiscordMessage> {
    const q = threadId ? `?${new URLSearchParams({ thread_id: threadId })}` : '';
    return this.send<DiscordMessage>(
      'PATCH',
      `/webhooks/${hook.id}/${hook.token}/messages/${messageId}${q}`,
      { content, allowed_mentions: { parse: [] } },
      false,
    );
  }

  /** Needs no privileged intent. */
  getGuildMember(guildId: string, userId: string): Promise<GuildMember> {
    return this.send<GuildMember>('GET', `/guilds/${guildId}/members/${userId}`, undefined, true);
  }

  getGuildRoles(guildId: string): Promise<Role[]> {
    return this.send<Role[]>('GET', `/guilds/${guildId}/roles`, undefined, true);
  }

  getChannel(channelId: string): Promise<GuildChannel> {
    return this.send<GuildChannel>('GET', `/channels/${channelId}`, undefined, true);
  }

  private async post<T>(path: string, body: unknown): Promise<{ message: T; rateLimit: RateLimit }> {
    let res: Response;
    try {
      res = await this.f(`${this.opts.base ?? DISCORD_API}${path}`, {
        method: 'POST',
        headers: { 'user-agent': this.opts.userAgent ?? 'DiscordBot (https://github.com/logitsml/logitland, 0.1)', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new UncertainSendError(err);
    }
    const rateLimit = readRateLimit(res.headers);
    if (res.status === 429) throw await this.rateLimited(res, rateLimit);
    if (res.status >= 500 || res.status === 408) {
      await res.body?.cancel().catch(() => {});
      throw new UncertainSendError(new DiscordError(`Discord returned ${res.status}`, res.status, null, rateLimit));
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
      throw new DiscordError(data.message ?? `Discord returned ${res.status}`, res.status, data.code ?? null, rateLimit);
    }
    try {
      return { message: (await res.json()) as T, rateLimit };
    } catch (err) {
      throw new UncertainSendError(err);
    }
  }

  private async rateLimited(res: Response, rl: RateLimit): Promise<RateLimitedError> {
    const data = (await res.json().catch(() => ({}))) as { retry_after?: number; global?: boolean };
    const header = Number(res.headers.get('retry-after'));
    const retry = Number.isFinite(header) && header > 0 ? header : (data.retry_after ?? 1);
    return new RateLimitedError(retry, { ...rl, global: rl.global || Boolean(data.global) });
  }

  private async send<T>(method: string, path: string, body: unknown, bot: boolean, uncertainOnTimeout = false, auditReason?: string): Promise<T> {
    const headers: Record<string, string> = { 'user-agent': this.opts.userAgent ?? 'DiscordBot (https://github.com/logitsml/logitland, 0.1)' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auditReason) headers['x-audit-log-reason'] = encodeURIComponent(auditReason.slice(0, 512));
    if (bot) {
      if (!this.opts.botToken) throw new Error('A bot token is required for this call');
      headers.authorization = `Bot ${this.opts.botToken}`;
    }
    let res: Response;
    try {
      res = await this.f(`${this.opts.base ?? DISCORD_API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      if (uncertainOnTimeout) throw new UncertainSendError(err);
      throw err;
    }
    const rl = readRateLimit(res.headers);
    if (res.status === 429) throw await this.rateLimited(res, rl);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { message?: string; code?: number };
      throw new DiscordError(data.message ?? `Discord returned ${res.status}`, res.status, data.code ?? null, rl);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
